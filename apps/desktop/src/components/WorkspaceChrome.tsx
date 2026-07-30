import type { FolderColor, FolderSummary } from '@fixnote/contracts';
import {
  ChevronDown,
  Ellipsis,
  FileText,
  Folder,
  FolderPlus,
  Grid2X2,
  Inbox,
  List,
  LogOut,
  PanelLeft,
  Plus,
  Search,
  Settings,
  Shapes,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import {
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
import { FolderContextMenu } from './SpatialHome';
import {
  NativeWindowControls,
  toggleNativeMaximize,
} from './WindowControls';

export type CollectionView =
  | { kind: 'space' }
  | { kind: 'inbox' }
  | { kind: 'folder'; folderId: string }
  | { kind: 'trash' };

export type LibraryLayout = 'grid' | 'list';
export type SidebarMode = 'fixed' | 'auto';

interface WorkspaceChromeProps {
  activeView: CollectionView | null;
  folders: FolderSummary[];
  inboxCount: number;
  trashCount: number;
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
  onSignOut: () => Promise<void>;
}

export function WorkspaceChrome({
  activeView,
  folders,
  inboxCount,
  trashCount,
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
  onSignOut,
}: WorkspaceChromeProps) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOverride, setSidebarOverride] = useState(false);
  const [foldersExpanded, setFoldersExpanded] = useState(true);
  const [folderSectionMenuOpen, setFolderSectionMenuOpen] = useState(false);
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);
  const [folderMenu, setFolderMenu] = useState<{
    folder: FolderSummary;
    x: number;
    y: number;
  } | null>(null);
  const sidebarVisible = sidebarMode === 'fixed' || sidebarOverride;

  function createSidebarFolder() {
    const name = window.prompt('Folder name', 'Untitled folder')?.trim();
    if (!name) return;
    const parentId =
      activeView?.kind === 'folder' ? activeView.folderId : null;
    setFoldersExpanded(true);
    setFolderSectionMenuOpen(false);
    void onCreateFolder(name, parentId);
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
          <button
            className="workspace-search-disabled"
            disabled
            aria-label="Search is coming soon"
            title="Search is coming soon"
          >
            <Search size={14} />
          </button>
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
          <button
            className={`workspace-ai-button${chatOpen ? ' is-active' : ''}`}
            onClick={onToggleChat}
            aria-expanded={chatOpen}
          >
            <Sparkles size={14} /> Ask AI
          </button>
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
          <nav className="workspace-sidebar-nav" aria-label="Workspace">
            <SidebarButton
              active={activeView?.kind === 'inbox'}
              icon={Inbox}
              label="Inbox"
              count={inboxCount}
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

          <nav className="workspace-sidebar-nav workspace-sidebar-bottom">
            <SidebarButton
              active={activeView?.kind === 'trash'}
              icon={Trash2}
              label="Trash"
              count={trashCount}
              onClick={() => onNavigate({ kind: 'trash' })}
            />
          </nav>
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
              `Delete “${folderMenu.folder.name}”? Its items will return to Inbox.`,
            );
            if (confirmed) void onDeleteFolder(folderMenu.folder.id);
            setFolderMenu(null);
          }}
        />
      )}

      <AnimatePresence>
        {settingsOpen && (
          <motion.div
            className="workspace-settings-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onPointerDown={() => setSettingsOpen(false)}
          >
            <motion.section
              className="workspace-settings"
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <header>
                <div>
                  <span>Preferences</span>
                  <h2>Workspace settings</h2>
                </div>
                <button onClick={() => setSettingsOpen(false)} aria-label="Close">
                  <X size={16} />
                </button>
              </header>

              <SettingsChoice
                title="Inbox and folders"
                description="Choose how typed cards are arranged."
              >
                <button
                  className={libraryLayout === 'grid' ? 'is-selected' : ''}
                  onClick={() => onLibraryLayoutChange('grid')}
                >
                  <Grid2X2 size={19} />
                  <span><strong>Grid</strong><small>Two columns</small></span>
                </button>
                <button
                  className={libraryLayout === 'list' ? 'is-selected' : ''}
                  onClick={() => onLibraryLayoutChange('list')}
                >
                  <List size={19} />
                  <span><strong>List</strong><small>Compact rows</small></span>
                </button>
              </SettingsChoice>

              <SettingsChoice
                title="Sidebar"
                description="Keep it visible or reveal it from the left edge."
              >
                <button
                  className={sidebarMode === 'fixed' ? 'is-selected' : ''}
                  onClick={() => onSidebarModeChange('fixed')}
                >
                  <PanelLeft size={19} />
                  <span><strong>Always visible</strong><small>Floating panel</small></span>
                </button>
                <button
                  className={sidebarMode === 'auto' ? 'is-selected' : ''}
                  onClick={() => onSidebarModeChange('auto')}
                >
                  <PanelLeft size={19} />
                  <span><strong>Auto reveal</strong><small>Hover left edge</small></span>
                </button>
              </SettingsChoice>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
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
  icon: typeof Inbox;
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
