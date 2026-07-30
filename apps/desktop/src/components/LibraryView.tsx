import type { FolderColor, FolderSummary } from '@fixnote/contracts';
import {
  ArrowUpRight,
  FileText,
  Folder,
  FolderPlus,
  Grid2X2,
  Plus,
  RotateCcw,
  Shapes,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from 'react';
import type {
  ImportCandidate,
  WorkspaceResource,
  YoutubePlayback,
} from '../domain';
import { candidatesFromText } from '../lib/imports';
import { FolderContextMenu, LibraryResourceCard } from './SpatialHome';
import type { CollectionView, LibraryLayout } from './WorkspaceChrome';

interface LibraryViewProps {
  loading: boolean;
  view: Exclude<CollectionView, { kind: 'space' }>;
  layout: LibraryLayout;
  query: string;
  resources: WorkspaceResource[];
  allResources: WorkspaceResource[];
  folders: FolderSummary[];
  activeYoutubeResourceId: string | null;
  onToggleYoutube: (playback: YoutubePlayback) => void;
  onOpen: (resourceId: string) => void;
  onOpenFolder: (folderId: string) => void;
  onCreate: (kind: WorkspaceResource['kind']) => Promise<WorkspaceResource>;
  onCreateFolder: (name: string) => Promise<void>;
  onRenameFolder: (folderId: string, name: string) => Promise<void>;
  onChangeFolderColor: (folderId: string, color: FolderColor) => Promise<void>;
  onDeleteFolder: (folderId: string) => Promise<void>;
  onImport: (candidates: ImportCandidate[]) => Promise<WorkspaceResource[]>;
  onPinToSpace: (resourceId: string) => void;
  onTrash: (resourceId: string) => void;
  onRestore: (resourceId: string) => void;
  onDeletePermanently: (resourceId: string) => Promise<void>;
}

interface LibraryMenuState {
  resource: WorkspaceResource;
  x: number;
  y: number;
}

export function LibraryView({
  loading,
  view,
  layout,
  query,
  resources,
  allResources,
  folders,
  activeYoutubeResourceId,
  onToggleYoutube,
  onOpen,
  onOpenFolder,
  onCreate,
  onCreateFolder,
  onRenameFolder,
  onChangeFolderColor,
  onDeleteFolder,
  onImport,
  onPinToSpace,
  onTrash,
  onRestore,
  onDeletePermanently,
}: LibraryViewProps) {
  const [menu, setMenu] = useState<LibraryMenuState | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [externalDragActive, setExternalDragActive] = useState(false);
  const [folderMenu, setFolderMenu] = useState<{
    folder: FolderSummary;
    x: number;
    y: number;
  } | null>(null);
  const dragDepth = useRef(0);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const isTrash = view.kind === 'trash';

  const visibleResources = useMemo(
    () =>
      [...resources]
        .filter(
          (resource) =>
            !normalizedQuery ||
            `${resource.title} ${resource.preview}`
              .toLocaleLowerCase()
              .includes(normalizedQuery),
        )
        .sort(
          (first, second) =>
            new Date(second.createdAt).getTime() -
            new Date(first.createdAt).getTime(),
        ),
    [normalizedQuery, resources],
  );

  const childFolders = useMemo(() => {
    if (view.kind !== 'folder') return [];
    return folders.filter((folder) => folder.parentId === view.folderId);
  }, [folders, view]);

  useEffect(() => {
    if (isTrash) return;
    const handlePaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.matches(
          'input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]',
        )
      ) {
        return;
      }
      const files = Array.from(event.clipboardData?.files ?? []);
      const candidates = files.length
        ? files.map((file) => ({ kind: 'file' as const, file }))
        : candidatesFromText(event.clipboardData?.getData('text/plain') ?? '');
      if (!candidates.length) return;
      event.preventDefault();
      void onImport(candidates);
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [isTrash, onImport]);

  const title =
    view.kind === 'inbox'
      ? 'Inbox'
      : view.kind === 'trash'
        ? 'Trash'
        : folders.find((folder) => folder.id === view.folderId)?.name ??
          'Folder';

  const subtitle =
    view.kind === 'inbox'
      ? 'Everything new, in chronological order.'
      : view.kind === 'trash'
        ? 'Restore items or remove them permanently.'
        : 'A focused collection of notes and sources.';

  function beginExternalDrag(event: DragEvent<HTMLDivElement>) {
    if (isTrash || !hasImportPayload(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setExternalDragActive(true);
  }

  function continueExternalDrag(event: DragEvent<HTMLDivElement>) {
    if (isTrash || !hasImportPayload(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }

  function leaveExternalDrag(event: DragEvent<HTMLDivElement>) {
    if (!hasImportPayload(event.dataTransfer)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setExternalDragActive(false);
  }

  function finishExternalDrop(event: DragEvent<HTMLDivElement>) {
    if (isTrash || !hasImportPayload(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setExternalDragActive(false);
    const candidates = candidatesFromTransfer(event.dataTransfer);
    if (candidates.length) void onImport(candidates);
  }

  return (
    <section
      className="library-view"
      onDragEnter={beginExternalDrag}
      onDragOver={continueExternalDrag}
      onDragLeave={leaveExternalDrag}
      onDrop={finishExternalDrop}
    >
      <header className="library-header">
        <div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        {!isTrash && (
          <div className="library-create-wrap">
            <button
              className="library-create-button"
              onClick={() => setCreateOpen((current) => !current)}
            >
              <Plus size={17} /> New
            </button>
            {createOpen && (
              <div className="library-create-menu">
                <button
                  onClick={() => {
                    setCreateOpen(false);
                    void onCreate('note');
                  }}
                >
                  <FileText size={15} /> Note
                </button>
                <button
                  onClick={() => {
                    setCreateOpen(false);
                    void onCreate('board');
                  }}
                >
                  <Shapes size={15} /> Board
                </button>
                <button
                  onClick={() => {
                    const name = window
                      .prompt('Folder name', 'Untitled folder')
                      ?.trim();
                    if (!name) return;
                    setCreateOpen(false);
                    void onCreateFolder(name);
                  }}
                >
                  <FolderPlus size={15} /> Folder
                </button>
              </div>
            )}
          </div>
        )}
      </header>

      {childFolders.length > 0 && (
        <div className="library-folders">
          {childFolders.map((folder) => (
            <button
              key={folder.id}
              onClick={() => onOpenFolder(folder.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                setFolderMenu({
                  folder,
                  x: Math.min(event.clientX, window.innerWidth - 204),
                  y: Math.min(event.clientY, window.innerHeight - 230),
                });
              }}
            >
              <span className={`folder-chip is-${folder.color}`}>
                <Folder size={17} />
              </span>
              <strong>{folder.name}</strong>
              <small>
                {allResources.filter((resource) => resource.folderId === folder.id)
                  .length}{' '}
                items
              </small>
            </button>
          ))}
        </div>
      )}

      <div className={`library-resources is-${layout}`}>
        {loading ? (
          Array.from({ length: 6 }, (_, index) => (
            <div className="library-card-skeleton" key={index} />
          ))
        ) : (
          visibleResources.map((resource) => (
            <LibraryResourceCard
              key={resource.id}
              resource={resource}
              layout={layout}
              youtubeActive={activeYoutubeResourceId === resource.id}
              onToggleYoutube={onToggleYoutube}
              onOpen={() => onOpen(resource.id)}
              onOpenMenu={(x, y) =>
                setMenu({
                  resource,
                  x: Math.min(x, window.innerWidth - 210),
                  y: Math.min(y, window.innerHeight - 220),
                })
              }
            />
          ))
        )}
      </div>

      {!loading &&
        visibleResources.length === 0 &&
        childFolders.length === 0 && (
          <div className="library-empty">
            <Grid2X2 size={22} />
            <strong>
              {normalizedQuery
                ? 'Nothing matches this search'
                : isTrash
                  ? 'Trash is empty'
                  : 'Nothing here yet'}
            </strong>
            <span>
              {isTrash
                ? 'Deleted items will appear here.'
                : 'Drop something here, paste it, or create a note.'}
            </span>
          </div>
        )}

      {externalDragActive && (
        <div className="library-drop-overlay">
          <span><Upload size={22} /></span>
          <strong>Drop into {title}</strong>
          <small>Links, text, documents, images and video</small>
        </div>
      )}

      {menu && (
        <div
          className="resource-context-menu library-context-menu"
          role="menu"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            onClick={() => {
              setMenu(null);
              onOpen(menu.resource.id);
            }}
          >
            <ArrowUpRight size={15} /> Open
          </button>
          {!isTrash && (
            <button
              onClick={() => {
                onPinToSpace(menu.resource.id);
                setMenu(null);
              }}
            >
              <Grid2X2 size={15} /> Add to Space
            </button>
          )}
          <div className="resource-context-menu-divider" />
          {isTrash ? (
            <>
              <button
                onClick={() => {
                  onRestore(menu.resource.id);
                  setMenu(null);
                }}
              >
                <RotateCcw size={15} /> Restore
              </button>
              <button
                className="is-danger"
                onClick={() => {
                  const confirmed = window.confirm(
                    `Delete “${menu.resource.title}” permanently?`,
                  );
                  setMenu(null);
                  if (confirmed) void onDeletePermanently(menu.resource.id);
                }}
              >
                <Trash2 size={15} /> Delete permanently
              </button>
            </>
          ) : (
            <button
              className="is-danger"
              onClick={() => {
                onTrash(menu.resource.id);
                setMenu(null);
              }}
            >
              <Trash2 size={15} /> Move to Trash
            </button>
          )}
        </div>
      )}

      {folderMenu && (
        <FolderContextMenu
          {...folderMenu}
          onClose={() => setFolderMenu(null)}
          onOpen={() => {
            onOpenFolder(folderMenu.folder.id);
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
    </section>
  );
}

function hasImportPayload(dataTransfer: DataTransfer): boolean {
  if (
    dataTransfer.types.includes('application/x-fixnote-resource-id')
  ) {
    return false;
  }
  return (
    dataTransfer.files.length > 0 ||
    dataTransfer.types.includes('Files') ||
    dataTransfer.types.includes('text/plain') ||
    dataTransfer.types.includes('text/uri-list')
  );
}

function candidatesFromTransfer(dataTransfer: DataTransfer): ImportCandidate[] {
  const files = Array.from(dataTransfer.files);
  if (files.length) {
    return files.map((file) => ({ kind: 'file', file }));
  }
  const uriList = dataTransfer
    .getData('text/uri-list')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
    .join('\n');
  return candidatesFromText(uriList || dataTransfer.getData('text/plain'));
}
