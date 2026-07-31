import type { FolderColor, FolderSummary } from '@fixnote/contracts';
import desktopPackage from '../../package.json';
import {
  Check,
  ChevronDown,
  Ellipsis,
  FileText,
  Folder,
  FolderPlus,
  Grid2X2,
  List,
  LogOut,
  MessageCircle,
  Mic,
  PanelLeft,
  Plus,
  Search,
  Settings,
  Shapes,
  Sparkles,
  TextQuote,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from 'react';
import type {
  ImportCandidate,
  WorkspaceDropTarget,
  WorkspaceResource,
} from '../domain';
import {
  candidatesFromDataTransfer,
  hasImportPayload,
} from '../lib/imports';
import { AppModal } from './AppModal';
import { BrandMark } from './BrandMark';
import {
  CommandPalette,
  type CommandItem,
} from './motion/command-palette';
import { FolderContextMenu } from './SpatialHome';
import { Switch } from './motion/switch';
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from './motion/tabs';
import {
  NativeWindowControls,
  toggleNativeMaximize,
} from './WindowControls';

export type CollectionView =
  | { kind: 'flow' }
  | { kind: 'space' }
  | { kind: 'inbox' }
  | { kind: 'folder'; folderId: string }
  | { kind: 'trash' };

export type LibraryLayout = 'grid' | 'list';
export type SidebarMode = 'fixed' | 'auto';

type WorkspaceMenu = 'edit' | 'help';
type EditCommand =
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'delete'
  | 'selectAll';

interface WorkspaceChromeProps {
  activeView: CollectionView | null;
  folders: FolderSummary[];
  resources: WorkspaceResource[];
  openTabs: WorkspaceResource[];
  activeTabId: string | null;
  libraryLayout: LibraryLayout;
  sidebarMode: SidebarMode;
  chatOpen: boolean;
  pointerDropTarget: WorkspaceDropTarget | null;
  onNavigate: (view: CollectionView) => void;
  onSelectTab: (resourceId: string) => void;
  onCloseTab: (resourceId: string) => void;
  onLibraryLayoutChange: (layout: LibraryLayout) => void;
  onSidebarModeChange: (mode: SidebarMode) => void;
  onDropResource: (
    resourceId: string,
    target: WorkspaceDropTarget,
  ) => Promise<void> | void;
  onDropFolder: (
    folderId: string,
    target: WorkspaceDropTarget,
  ) => Promise<void> | void;
  onImportToTarget: (
    candidates: ImportCandidate[],
    target: WorkspaceDropTarget,
  ) => Promise<void> | void;
  onCreateFolder: (name: string, parentId: string | null) => Promise<void>;
  onRenameFolder: (folderId: string, name: string) => Promise<void>;
  onChangeFolderColor: (folderId: string, color: FolderColor) => Promise<void>;
  onDeleteFolder: (folderId: string) => Promise<void>;
  onToggleChat: () => void;
  onStartVoiceInput: () => void;
  onSignOut: () => Promise<void>;
}

export function WorkspaceChrome({
  activeView,
  folders,
  resources,
  openTabs,
  activeTabId,
  libraryLayout,
  sidebarMode,
  chatOpen,
  pointerDropTarget,
  onNavigate,
  onSelectTab,
  onCloseTab,
  onLibraryLayoutChange,
  onSidebarModeChange,
  onDropResource,
  onDropFolder,
  onImportToTarget,
  onCreateFolder,
  onRenameFolder,
  onChangeFolderColor,
  onDeleteFolder,
  onToggleChat,
  onStartVoiceInput,
  onSignOut,
}: WorkspaceChromeProps) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [workspaceMenu, setWorkspaceMenu] =
    useState<WorkspaceMenu | null>(null);
  const [sidebarOverride, setSidebarOverride] = useState(false);
  const [foldersExpanded, setFoldersExpanded] = useState(true);
  const [folderSectionMenuOpen, setFolderSectionMenuOpen] = useState(false);
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);
  const [folderMenu, setFolderMenu] = useState<{
    folder: FolderSummary;
    x: number;
    y: number;
  } | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const sidebarVisible = sidebarMode === 'fixed' || sidebarOverride;

  const commandItems = useMemo<CommandItem[]>(
    () => [
      {
        id: 'flow',
        label: 'Flow',
        group: 'Navigate',
        hint: '⌘1',
        icon: MessageCircle,
        onSelect: () => onNavigate({ kind: 'flow' }),
      },
      {
        id: 'artifacts',
        label: 'Artifacts',
        group: 'Navigate',
        hint: '⌘2',
        icon: TextQuote,
        onSelect: () => onNavigate({ kind: 'inbox' }),
      },
      {
        id: 'space',
        label: 'Space',
        group: 'Navigate',
        hint: '⌘3',
        icon: Grid2X2,
        onSelect: () => onNavigate({ kind: 'space' }),
      },
      {
        id: 'trash',
        label: 'Trash',
        group: 'Navigate',
        icon: Trash2,
        onSelect: () => onNavigate({ kind: 'trash' }),
      },
      ...resources.slice(0, 36).map((resource) => ({
        id: `resource:${resource.id}`,
        label: resource.title,
        group: 'Artifacts',
        hint: resource.kind === 'board' ? 'Board' : 'Note',
        icon: resource.kind === 'board' ? Shapes : FileText,
        keywords: [resource.preview],
        onSelect: () => onSelectTab(resource.id),
      })),
      {
        id: 'settings',
        label: 'Settings',
        group: 'Workspace',
        icon: Settings,
        onSelect: () => setSettingsOpen(true),
      },
    ],
    [onNavigate, onSelectTab, resources],
  );

  useEffect(() => {
    if (!workspaceMenu && !aboutOpen) return;

    const closeMenuFromOutside = (event: PointerEvent) => {
      const target = event.target;
      if (
        workspaceMenu &&
        target instanceof Element &&
        !target.closest('.workspace-app-menu')
      ) {
        setWorkspaceMenu(null);
      }
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setWorkspaceMenu(null);
      setAboutOpen(false);
    };

    window.addEventListener('pointerdown', closeMenuFromOutside);
    window.addEventListener('keydown', closeWithEscape);
    return () => {
      window.removeEventListener('pointerdown', closeMenuFromOutside);
      window.removeEventListener('keydown', closeWithEscape);
    };
  }, [aboutOpen, workspaceMenu]);

  async function runEditCommand(command: EditCommand) {
    setWorkspaceMenu(null);
    if (command === 'paste') {
      try {
        const text = await navigator.clipboard.readText();
        if (text) document.execCommand('insertText', false, text);
      } catch {
        document.execCommand('paste');
      }
      return;
    }
    document.execCommand(command);
  }

  function createSidebarFolder() {
    const name = window.prompt('Folder name', 'Untitled folder')?.trim();
    if (!name) return;
    setFoldersExpanded(true);
    setFolderSectionMenuOpen(false);
    void onCreateFolder(name, null);
  }

  function targetKey(target: WorkspaceDropTarget) {
    return target.kind === 'space' ? 'space' : `folder:${target.folderId}`;
  }

  function canAcceptDrop(dataTransfer: DataTransfer): boolean {
    return (
      dataTransfer.types.includes('application/x-fixnote-resource-id') ||
      dataTransfer.types.includes('application/x-fixnote-folder-id') ||
      hasImportPayload(dataTransfer)
    );
  }

  function continueDrop(
    event: DragEvent<HTMLButtonElement>,
    target: WorkspaceDropTarget,
  ) {
    if (!canAcceptDrop(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    const internalMove =
      event.dataTransfer.types.includes('application/x-fixnote-resource-id') ||
      event.dataTransfer.types.includes('application/x-fixnote-folder-id');
    event.dataTransfer.dropEffect =
      internalMove && target.kind === 'folder'
        ? 'move'
        : 'copy';
    setDropTargetKey(targetKey(target));
  }

  function acceptDrop(
    event: DragEvent<HTMLButtonElement>,
    target: WorkspaceDropTarget,
  ) {
    if (!canAcceptDrop(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    const resourceId = event.dataTransfer.getData(
      'application/x-fixnote-resource-id',
    );
    const folderId = event.dataTransfer.getData(
      'application/x-fixnote-folder-id',
    );
    setDropTargetKey(null);
    if (resourceId) {
      void onDropResource(resourceId, target);
      return;
    }
    if (folderId) {
      void onDropFolder(folderId, target);
      return;
    }
    const candidates = candidatesFromDataTransfer(event.dataTransfer);
    if (candidates.length) void onImportToTarget(candidates, target);
  }

  const activeDropTargetKey = pointerDropTarget
    ? targetKey(pointerDropTarget)
    : dropTargetKey;

  return (
    <>
      <header
        className="workspace-titlebar"
        data-tauri-drag-region
        onDoubleClick={(event) => {
          const target = event.target;
          if (target instanceof Element && target.closest('button')) return;
          toggleNativeMaximize();
        }}
      >
        <div className="workspace-titlebar-leading">
          <button
            className={sidebarMode === 'fixed' ? 'is-active' : ''}
            onClick={() => {
              onSidebarModeChange(
                sidebarMode === 'fixed' ? 'auto' : 'fixed',
              );
              setSidebarOverride(false);
            }}
            aria-label="Toggle sidebar"
          >
            <PanelLeft size={15} />
          </button>
          <nav className="workspace-app-menus" aria-label="Application menu">
            <div className="workspace-app-menu">
              <button
                type="button"
                className={workspaceMenu === 'edit' ? 'is-open' : ''}
                aria-haspopup="menu"
                aria-expanded={workspaceMenu === 'edit'}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() =>
                  setWorkspaceMenu((current) =>
                    current === 'edit' ? null : 'edit',
                  )
                }
              >
                Правка
              </button>
              <AnimatePresence>
                {workspaceMenu === 'edit' && (
                  <motion.div
                    className="workspace-native-dropdown workspace-edit-menu"
                    role="menu"
                    aria-label="Правка"
                    initial={{ opacity: 0, y: -5, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.98 }}
                    transition={{ duration: 0.12 }}
                  >
                    <EditMenuItem
                      label="Undo"
                      shortcut="Ctrl+Z"
                      onSelect={() => void runEditCommand('undo')}
                    />
                    <EditMenuItem
                      label="Redo"
                      shortcut="Ctrl+Y"
                      onSelect={() => void runEditCommand('redo')}
                    />
                    <MenuSeparator />
                    <EditMenuItem
                      label="Cut"
                      shortcut="Ctrl+X"
                      onSelect={() => void runEditCommand('cut')}
                    />
                    <EditMenuItem
                      label="Copy"
                      shortcut="Ctrl+C"
                      onSelect={() => void runEditCommand('copy')}
                    />
                    <EditMenuItem
                      label="Paste"
                      shortcut="Ctrl+V"
                      onSelect={() => void runEditCommand('paste')}
                    />
                    <EditMenuItem
                      label="Delete"
                      onSelect={() => void runEditCommand('delete')}
                    />
                    <MenuSeparator />
                    <EditMenuItem
                      label="Select All"
                      shortcut="Ctrl+A"
                      onSelect={() => void runEditCommand('selectAll')}
                    />
                    <MenuSeparator />
                    <EditMenuItem
                      label="Settings…"
                      shortcut="Ctrl+,"
                      onSelect={() => {
                        setWorkspaceMenu(null);
                        setSettingsOpen(true);
                      }}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="workspace-app-menu">
              <button
                type="button"
                className={workspaceMenu === 'help' ? 'is-open' : ''}
                aria-haspopup="menu"
                aria-expanded={workspaceMenu === 'help'}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() =>
                  setWorkspaceMenu((current) =>
                    current === 'help' ? null : 'help',
                  )
                }
              >
                Справка
              </button>
              <AnimatePresence>
                {workspaceMenu === 'help' && (
                  <motion.div
                    className="workspace-native-dropdown workspace-help-menu"
                    role="menu"
                    aria-label="Справка"
                    initial={{ opacity: 0, y: -5, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.98 }}
                    transition={{ duration: 0.12 }}
                  >
                    <EditMenuItem
                      label="About"
                      onSelect={() => {
                        setWorkspaceMenu(null);
                        setAboutOpen(true);
                      }}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </nav>
        </div>

        <div className="workspace-tabs" aria-label="Open resources">
          {openTabs.map((resource) => (
            <button
              key={resource.id}
              className={activeTabId === resource.id ? 'is-active' : ''}
              onClick={() => onSelectTab(resource.id)}
              title={resource.title}
            >
              {resource.kind === 'board' ? (
                <Shapes size={13} />
              ) : (
                <FileText size={13} />
              )}
              <span>{resource.title}</span>
              <i
                role="button"
                aria-label={`Close ${resource.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseTab(resource.id);
                }}
              >
                <X size={11} />
              </i>
            </button>
          ))}
          <span className="workspace-titlebar-drag-fill" data-tauri-drag-region />
        </div>

        <div className="workspace-titlebar-actions">
          <div className="profile-menu-wrap">
            <button
              className="avatar-button"
              onClick={() => setProfileOpen((current) => !current)}
              aria-expanded={profileOpen}
              aria-label="Profile"
            >
              Z
            </button>
            {profileOpen && (
              <div className="profile-menu workspace-profile-menu" role="menu">
                <span>FixNote profile</span>
                <button
                  role="menuitem"
                  onClick={() => {
                    setProfileOpen(false);
                    setSettingsOpen(true);
                  }}
                >
                  <Settings size={15} /> Settings
                </button>
                <button
                  className="is-danger"
                  role="menuitem"
                  onClick={() => {
                    setProfileOpen(false);
                    void onSignOut();
                  }}
                >
                  <LogOut size={15} /> Log out
                </button>
              </div>
            )}
          </div>
          <NativeWindowControls />
        </div>
      </header>

      <div
        className={`workspace-sidebar-zone is-${sidebarMode}${sidebarVisible ? ' is-visible' : ''}`}
        onDragEnter={() => {
          if (sidebarMode === 'auto') setSidebarOverride(true);
        }}
        onMouseEnter={() => {
          if (sidebarMode === 'auto') setSidebarOverride(true);
        }}
        onMouseLeave={() => {
          if (sidebarMode === 'auto') setSidebarOverride(false);
        }}
      >
        <motion.aside
          className="workspace-sidebar"
          animate={{ x: sidebarVisible ? 0 : -286, opacity: sidebarVisible ? 1 : 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 31 }}
        >
          <div className="workspace-sidebar-brand">
            <button
              className="workspace-brand-button"
              onClick={() => onNavigate({ kind: 'flow' })}
              aria-label="Open Flow"
            >
              <BrandMark />
              <strong>FixNote</strong>
            </button>
            <button
              className="workspace-search-button"
              onClick={() => setCommandOpen(true)}
              aria-label="Search FixNote"
            >
              <Search size={16} />
            </button>
          </div>
          <nav className="workspace-sidebar-nav" aria-label="Workspace">
            <SidebarButton
              active={activeView?.kind === 'flow'}
              icon={MessageCircle}
              label="Flow"
              onClick={() => onNavigate({ kind: 'flow' })}
            />
            <SidebarButton
              active={activeView?.kind === 'inbox'}
              icon={TextQuote}
              label="Artifacts"
              onClick={() => onNavigate({ kind: 'inbox' })}
            />
            <SidebarButton
              active={activeView?.kind === 'space'}
              icon={Grid2X2}
              label="Space"
              dropTarget="space"
              dropActive={activeDropTargetKey === 'space'}
              onClick={() => onNavigate({ kind: 'space' })}
              onDragOver={(event) => continueDrop(event, { kind: 'space' })}
              onDragLeave={() => setDropTargetKey(null)}
              onDrop={(event) => acceptDrop(event, { kind: 'space' })}
            />
            <SidebarButton
              active={activeView?.kind === 'trash'}
              icon={Trash2}
              label="Trash"
              onClick={() => onNavigate({ kind: 'trash' })}
            />
          </nav>

          <div className="workspace-sidebar-section">
            <div className="workspace-sidebar-section-header">
              <button
                className="workspace-sidebar-section-toggle"
                onClick={() => setFoldersExpanded((current) => !current)}
                aria-expanded={foldersExpanded}
              >
                <span>Folders</span>
                <ChevronDown
                  size={13}
                  className={foldersExpanded ? 'is-expanded' : ''}
                />
              </button>
              <div
                className="workspace-sidebar-section-actions"
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) {
                    setFolderSectionMenuOpen(false);
                  }
                }}
              >
                <button
                  onClick={() =>
                    setFolderSectionMenuOpen((current) => !current)
                  }
                  aria-label="Folder section actions"
                  aria-expanded={folderSectionMenuOpen}
                >
                  <Ellipsis size={15} />
                </button>
                {folderSectionMenuOpen && (
                  <div className="workspace-sidebar-section-menu" role="menu">
                    <button role="menuitem" onClick={createSidebarFolder}>
                      <FolderPlus size={14} />
                      <span>New folder</span>
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => {
                        setFoldersExpanded((current) => !current);
                        setFolderSectionMenuOpen(false);
                      }}
                    >
                      <ChevronDown size={14} />
                      <span>
                        {foldersExpanded ? 'Collapse section' : 'Expand section'}
                      </span>
                    </button>
                  </div>
                )}
                <button
                  onClick={createSidebarFolder}
                  aria-label="Create folder"
                >
                  <Plus size={15} />
                </button>
              </div>
            </div>
            <AnimatePresence initial={false}>
              {foldersExpanded && (
                <motion.div
                  className="workspace-sidebar-folder-list"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                >
                  {folders
                    .filter((folder) => folder.parentId === null)
                    .map((folder) => (
                      <FolderBranch
                        key={folder.id}
                        folder={folder}
                        folders={folders}
                        activeView={activeView}
                        depth={0}
                        dropTargetKey={activeDropTargetKey}
                        onNavigate={onNavigate}
                        onContinueDrop={continueDrop}
                        onAcceptDrop={acceptDrop}
                        onDropLeave={() => setDropTargetKey(null)}
                        onOpenMenu={(folder, x, y) =>
                          setFolderMenu({
                            folder,
                            x: Math.min(x, window.innerWidth - 204),
                            y: Math.min(y, window.innerHeight - 230),
                          })
                        }
                      />
                    ))}
                  {folders.length === 0 && <small>No folders yet</small>}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <AnimatePresence initial={false}>
            {activeView?.kind !== 'flow' && (
              <motion.div
                className="workspace-sidebar-ai-tools"
                initial={{ opacity: 0, y: 8, height: 0 }}
                animate={{ opacity: 1, y: 0, height: 'auto' }}
                exit={{ opacity: 0, y: 8, height: 0 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              >
                <button
                  className={chatOpen ? 'is-active' : ''}
                  onClick={onToggleChat}
                  aria-expanded={chatOpen}
                >
                  <Sparkles size={14} /> <span>AI Mode</span>
                </button>
                <button onClick={onStartVoiceInput} aria-label="Start voice input">
                  <Mic size={15} /> <span>Voice</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.aside>
      </div>

      {folderMenu && (
        <FolderContextMenu
          {...folderMenu}
          onClose={() => setFolderMenu(null)}
          onOpen={() => {
            onNavigate({ kind: 'folder', folderId: folderMenu.folder.id });
            setFolderMenu(null);
          }}
          onRename={() => {
            const nextName = window
              .prompt('Folder name', folderMenu.folder.name)
              ?.trim();
            if (nextName && nextName !== folderMenu.folder.name) {
              void onRenameFolder(folderMenu.folder.id, nextName);
            }
            setFolderMenu(null);
          }}
          onColorChange={(color) => {
            void onChangeFolderColor(folderMenu.folder.id, color);
            setFolderMenu((current) =>
              current
                ? { ...current, folder: { ...current.folder, color } }
                : null,
            );
          }}
          onDelete={() => {
            const confirmed = window.confirm(
              `Delete “${folderMenu.folder.name}”? Its items will return to Artifacts.`,
            );
            if (confirmed) void onDeleteFolder(folderMenu.folder.id);
            setFolderMenu(null);
          }}
        />
      )}

      <AppModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        ariaLabel="Workspace settings"
        eyebrow="Preferences"
        title="Shape your workspace."
        description="Choose how your library is arranged and how the sidebar behaves."
        className="workspace-settings"
        footer={
          <button
            type="button"
            className="app-modal-primary-action"
            onClick={() => setSettingsOpen(false)}
          >
            Done
          </button>
        }
      >
        <div className="workspace-settings-content">
              <SettingsChoice
                title="Artifacts and folders"
                description="Choose how typed cards are arranged."
              >
                <Tabs
                  value={libraryLayout}
                  onValueChange={(value) =>
                    onLibraryLayoutChange(value as LibraryLayout)
                  }
                  variant="segment"
                  className="workspace-settings-tabs"
                >
                  <TabsList>
                    <TabsTrigger value="grid">
                      <Grid2X2 size={15} /> Grid
                    </TabsTrigger>
                    <TabsTrigger value="list">
                      <List size={15} /> List
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </SettingsChoice>

              <SettingsChoice
                title="Sidebar"
                description="Keep it visible or reveal it from the left edge."
              >
                <div className="workspace-settings-toggle">
                  <span>
                    <strong>Always visible</strong>
                    <small>Turn off to reveal it from the left edge.</small>
                  </span>
                  <Switch
                    checked={sidebarMode === 'fixed'}
                    onCheckedChange={(checked) =>
                      onSidebarModeChange(checked ? 'fixed' : 'auto')
                    }
                    ariaLabel="Keep sidebar visible"
                  />
                </div>
              </SettingsChoice>
        </div>
      </AppModal>

      <AppModal
        open={aboutOpen}
        onOpenChange={setAboutOpen}
        ariaLabel="About FixNote"
        eyebrow={`FixNote ${desktopPackage.version}`}
        title="Keep the ideas worth keeping."
        description="A quiet, local-first place for notes, visual boards, and AI-assisted thinking."
        className="workspace-about"
        footer={
          <button
            type="button"
            className="app-modal-primary-action"
            onClick={() => setAboutOpen(false)}
          >
            Done
          </button>
        }
      >
        <div className="workspace-about-facts">
          <div>
            <Check size={15} aria-hidden="true" />
            <span>Local-first workspace</span>
          </div>
          <div>
            <Check size={15} aria-hidden="true" />
            <span>Notes and visual boards</span>
          </div>
          <div>
            <Check size={15} aria-hidden="true" />
            <span>AI-assisted thinking</span>
          </div>
        </div>
      </AppModal>

      <CommandPalette
        items={commandItems}
        open={commandOpen}
        onOpenChange={setCommandOpen}
        placeholder="Search artifacts or run a command…"
      />
    </>
  );
}

function EditMenuItem({
  label,
  shortcut,
  onSelect,
}: {
  label: string;
  shortcut?: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onPointerDown={(event) => event.preventDefault()}
      onClick={onSelect}
    >
      <span>{label}</span>
      {shortcut && <kbd>{shortcut}</kbd>}
    </button>
  );
}

function MenuSeparator() {
  return <div className="workspace-menu-separator" role="separator" />;
}

function SidebarButton({
  active,
  icon: Icon,
  label,
  count,
  dropActive,
  dropTarget,
  onClick,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  count?: number;
  dropActive?: boolean;
  dropTarget?: string;
  onClick: () => void;
  onDragOver?: (event: DragEvent<HTMLButtonElement>) => void;
  onDragLeave?: () => void;
  onDrop?: (event: DragEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      className={`${active ? 'is-active' : ''}${dropActive ? ' is-drop-target' : ''}`}
      data-sidebar-drop-target={dropTarget}
      onClick={onClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <Icon size={16} />
      <span>{label}</span>
      {count !== undefined && <b>{count}</b>}
    </button>
  );
}

function FolderBranch({
  folder,
  folders,
  activeView,
  depth,
  dropTargetKey,
  onNavigate,
  onContinueDrop,
  onAcceptDrop,
  onDropLeave,
  onOpenMenu,
}: {
  folder: FolderSummary;
  folders: FolderSummary[];
  activeView: CollectionView | null;
  depth: number;
  dropTargetKey: string | null;
  onNavigate: (view: CollectionView) => void;
  onContinueDrop: (
    event: DragEvent<HTMLButtonElement>,
    target: WorkspaceDropTarget,
  ) => void;
  onAcceptDrop: (
    event: DragEvent<HTMLButtonElement>,
    target: WorkspaceDropTarget,
  ) => void;
  onDropLeave: () => void;
  onOpenMenu: (folder: FolderSummary, x: number, y: number) => void;
}) {
  const children = folders.filter((candidate) => candidate.parentId === folder.id);
  const dropTarget = { kind: 'folder', folderId: folder.id } as const;
  return (
    <>
      <button
        className={`${activeView?.kind === 'folder' && activeView.folderId === folder.id ? 'is-active' : ''}${dropTargetKey === `folder:${folder.id}` ? ' is-drop-target' : ''}`}
        data-sidebar-drop-target={`folder:${folder.id}`}
        style={{ '--folder-depth': depth } as CSSProperties}
        draggable
        onClick={() => onNavigate({ kind: 'folder', folderId: folder.id })}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'copyMove';
          event.dataTransfer.setData(
            'application/x-fixnote-folder-id',
            folder.id,
          );
          event.dataTransfer.setData('text/plain', folder.name);
        }}
        onDragOver={(event) => onContinueDrop(event, dropTarget)}
        onDragLeave={onDropLeave}
        onDrop={(event) => onAcceptDrop(event, dropTarget)}
        onContextMenu={(event) => {
          event.preventDefault();
          onOpenMenu(folder, event.clientX, event.clientY);
        }}
      >
        <Folder size={15} />
        <span>{folder.name}</span>
      </button>
      {children.map((child) => (
        <FolderBranch
          key={child.id}
          folder={child}
          folders={folders}
          activeView={activeView}
          depth={depth + 1}
          dropTargetKey={dropTargetKey}
          onNavigate={onNavigate}
          onContinueDrop={onContinueDrop}
          onAcceptDrop={onAcceptDrop}
          onDropLeave={onDropLeave}
          onOpenMenu={onOpenMenu}
        />
      ))}
    </>
  );
}

function SettingsChoice({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="workspace-settings-group">
      <div>
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      <div className="workspace-settings-options">{children}</div>
    </div>
  );
}
