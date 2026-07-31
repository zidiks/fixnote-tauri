import {
  type LucideIcon,
  Bot,
  FileText,
  ArrowUpRight,
  Command,
  Folder,
  FolderPlus,
  FolderOpen,
  FileArchive,
  FileImage,
  FileVideo,
  Image as ImageIcon,
  LogOut,
  Music2,
  Pencil,
  Plus,
  Search,
  Shapes,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type CSSProperties,
  type ReactNode,
  type WheelEvent,
  useMemo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type {
  FolderColor,
  FolderSummary,
  UpdateResourceInput,
} from '@fixnote/contracts';
import { roomNames } from '@fixnote/sync';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';
import type {
  ImportCandidate,
  ImportedContent,
  ImportedFileType,
  LinkPreviewMetadata,
  WorkspaceDropTarget,
  WorkspaceResource,
  YoutubePlayback,
} from '../domain';
import { searchWorkspace } from '../lib/api';
import { candidatesFromText, youtubeVideoId } from '../lib/imports';
import { loadLinkPreview } from '../lib/link-preview';
import { openExternalUrl } from '../lib/open-external';
import { useImportedAssetUrl } from '../lib/use-imported-asset-url';
import { AppContextMenu } from './AppContextMenu';
import {
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
} from './motion/context-menu';

interface SpatialHomeProps {
  loading: boolean;
  folders: FolderSummary[];
  resources: WorkspaceResource[];
  activeFolder: string | null;
  onActiveFolderChange: (folderId: string | null) => void;
  activeYoutubeResourceId: string | null;
  onToggleYoutube: (playback: YoutubePlayback) => void;
  onOpen: (resourceId: string) => void;
  onCreate: (
    kind: WorkspaceResource['kind'],
    title?: string,
    folderId?: string | null,
    position?: WorkspaceResource['position'],
  ) => Promise<WorkspaceResource>;
  onImport: (
    candidates: ImportCandidate[],
    position: WorkspaceResource['position'],
    folderId: string | null,
  ) => Promise<void>;
  onPatch: (resourceId: string, patch: UpdateResourceInput) => Promise<void>;
  onDelete: (resourceId: string) => Promise<void>;
  onRenameFolder: (folderId: string, name: string) => Promise<void>;
  onChangeFolderColor: (folderId: string, color: FolderColor) => Promise<void>;
  onDeleteFolder: (folderId: string) => Promise<void>;
  onMoveFolder: (folderId: string, parentId: string | null, position: WorkspaceResource['position']) => Promise<void>;
  onCreateFolder: (name: string, parentId: string | null, position: WorkspaceResource['position']) => Promise<void>;
  onOpenChat: () => void;
  onSignOut: () => Promise<void>;
  showChrome?: boolean;
  showAllResources?: boolean;
  preserveFolderOnMove?: boolean;
  filterQuery?: string;
  deleteLabel?: string;
  onSidebarDragTargetChange?: (target: WorkspaceDropTarget | null) => void;
  onDropResourceToSidebar?: (
    resourceId: string,
    target: WorkspaceDropTarget,
  ) => Promise<void> | void;
}

interface Camera {
  x: number;
  y: number;
  scale: number;
}

const SNAP = 24;
const FOLDER_SIZE = {
  width: SNAP * 12,
  height: SNAP * 7,
};
const FOLDER_POSITION_STORAGE_KEY = 'fixnote:folder-positions';
const defaultFolderPositions = [
  { x: -168, y: 528 },
  { x: 264, y: 552 },
  { x: 720, y: 528 },
];

type FolderPositions = Record<string, WorkspaceResource['position']>;

function defaultFolderPosition(index: number): WorkspaceResource['position'] {
  return (
    defaultFolderPositions[index] ?? {
      x: 1152 + (index - 3) * 336,
      y: 528,
    }
  );
}

function folderPosition(folder: FolderSummary, index: number, local: FolderPositions) {
  const position =
    folder.position.x !== 0 || folder.position.y !== 0
      ? folder.position
      : local[folder.id] ?? defaultFolderPosition(index);
  return {
    x: snap(position.x),
    y: snap(position.y),
  };
}

function sidebarDropTargetAt(
  clientX: number,
  clientY: number,
): WorkspaceDropTarget | null {
  for (const element of document.elementsFromPoint(clientX, clientY)) {
    const dropTarget = element.closest<HTMLElement>(
      '[data-sidebar-drop-target]',
    )?.dataset.sidebarDropTarget;
    if (dropTarget === 'space') return { kind: 'space' };
    if (dropTarget?.startsWith('folder:')) {
      const folderId = dropTarget.slice('folder:'.length);
      if (folderId) return { kind: 'folder', folderId };
    }
  }
  return null;
}

interface ResourceContextMenuState {
  resource: WorkspaceResource;
  x: number;
  y: number;
}

interface FolderContextMenuState {
  folder: FolderSummary;
  x: number;
  y: number;
}

function loadFolderPositions(): FolderPositions {
  try {
    const stored = window.localStorage.getItem(FOLDER_POSITION_STORAGE_KEY);
    if (!stored) return {};
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed).flatMap(([id, value]) => {
        if (
          !value ||
          typeof value !== 'object' ||
          !Number.isFinite((value as { x?: unknown }).x) ||
          !Number.isFinite((value as { y?: unknown }).y)
        ) {
          return [];
        }
        return [
          [
            id,
            {
              x: (value as { x: number }).x,
              y: (value as { y: number }).y,
            },
          ],
        ];
      }),
    );
  } catch {
    return {};
  }
}

export function SpatialHome({
  loading,
  folders,
  resources,
  activeFolder,
  onActiveFolderChange,
  activeYoutubeResourceId,
  onToggleYoutube,
  onOpen,
  onCreate,
  onImport,
  onPatch,
  onDelete,
  onRenameFolder,
  onChangeFolderColor,
  onDeleteFolder,
  onMoveFolder,
  onCreateFolder,
  onOpenChat,
  onSignOut,
  showChrome = true,
  showAllResources = false,
  preserveFolderOnMove = false,
  filterQuery,
  deleteLabel = 'Delete',
  onSidebarDragTargetChange,
  onDropResourceToSidebar,
}: SpatialHomeProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    cameraX: number;
    cameraY: number;
  } | null>(null);
  const [camera, setCamera] = useState<Camera>({
    x: 80,
    y: 40,
    scale: 0.9,
  });
  const [query, setQuery] = useState('');
  const effectiveQuery = filterQuery ?? query;
  const [semanticIds, setSemanticIds] = useState<Set<string>>(new Set());
  const [folderPositions, setFolderPositions] =
    useState<FolderPositions>(loadFolderPositions);
  const [contextMenu, setContextMenu] =
    useState<ResourceContextMenuState | null>(null);
  const [folderContextMenu, setFolderContextMenu] =
    useState<FolderContextMenuState | null>(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [folderDropTargetId, setFolderDropTargetId] = useState<string | null>(null);
  const [draggingResource, setDraggingResource] = useState(false);
  const [draggingFolder, setDraggingFolder] = useState(false);
  const [homeDropActive, setHomeDropActive] = useState(false);
  const homeDropRef = useRef<HTMLDivElement>(null);
  const centeredScopeRef = useRef<string | null>(null);
  const externalDragDepthRef = useRef(0);
  const [externalDragActive, setExternalDragActive] = useState(false);
  const [importMessage, setImportMessage] = useState<{
    tone: 'success' | 'error' | 'progress';
    text: string;
  } | null>(null);
  const importMessageTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const preventNativeZoom = (event: globalThis.WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
      }
    };

    viewport.addEventListener('wheel', preventNativeZoom, { passive: false });
    return () => viewport.removeEventListener('wheel', preventNativeZoom);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      FOLDER_POSITION_STORAGE_KEY,
      JSON.stringify(folderPositions),
    );
  }, [folderPositions]);

  useEffect(
    () => () => {
      if (importMessageTimerRef.current) {
        window.clearTimeout(importMessageTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const normalized = effectiveQuery.trim();
    if (!normalized) {
      setSemanticIds(new Set());
      return;
    }
    const timeout = window.setTimeout(() => {
      void searchWorkspace(normalized).then((results) => {
        setSemanticIds(
          new Set(results.map((result) => result.resourceId)),
        );
      });
    }, 220);
    return () => window.clearTimeout(timeout);
  }, [effectiveQuery]);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const clipboard = event.clipboardData;
      if (!clipboard) return;
      const files = Array.from(clipboard.files);
      const candidates: ImportCandidate[] = files.length
        ? files.map((file) => ({ kind: 'file', file }))
        : candidatesFromText(clipboard.getData('text/plain'));
      if (!candidates.length) return;
      event.preventDefault();
      const viewport = viewportRef.current?.getBoundingClientRect();
      if (!viewport) return;
      const position = clientToWorld(
        viewport.left + viewport.width / 2,
        viewport.top + viewport.height / 2,
      );
      void runImport(candidates, position, activeFolder);
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [activeFolder, camera, onImport]);

  const visibleResources = useMemo(() => {
    const normalized = effectiveQuery.trim().toLocaleLowerCase();
    return resources.filter((resource) => {
      const inFolder = showAllResources
        ? true
        : activeFolder
        ? resource.folderId === activeFolder
        : normalized
          ? true
          : resource.folderId === null;
      const matches =
        !normalized ||
        semanticIds.has(resource.id) ||
        `${resource.title} ${resource.preview}`
          .toLocaleLowerCase()
          .includes(normalized);
      return inFolder && matches;
    });
  }, [activeFolder, effectiveQuery, resources, semanticIds, showAllResources]);

  const visibleFolders = useMemo(
    () => folders.filter((folder) => folder.parentId === activeFolder),
    [activeFolder, folders],
  );

  useLayoutEffect(() => {
    if (loading) return;
    const scope = activeFolder ?? 'home';
    if (centeredScopeRef.current === scope) return;
    const viewport = viewportRef.current?.getBoundingClientRect();
    if (!viewport) return;
    const items = [
      ...visibleResources.map((resource) => ({
        x: resource.position.x,
        y: resource.position.y,
        width: resource.size.width,
        height: resource.size.height,
      })),
      ...visibleFolders.map((folder) => {
        const index = folders.findIndex((item) => item.id === folder.id);
        const position = folderPosition(folder, index, folderPositions);
        return { ...position, ...FOLDER_SIZE };
      }),
    ];
    if (!items.length) return;
    const minX = Math.min(...items.map((item) => item.x));
    const maxX = Math.max(...items.map((item) => item.x + item.width));
    const minY = Math.min(...items.map((item) => item.y));
    const maxY = Math.max(...items.map((item) => item.y + item.height));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    setCamera((current) => ({
      ...current,
      x: viewport.width / 2 - centerX * current.scale,
      y: viewport.height / 2 - centerY * current.scale,
    }));
    centeredScopeRef.current = scope;
  }, [activeFolder, folderPositions, folders, loading, visibleFolders, visibleResources]);

  function beginPan(event: ReactPointerEvent<HTMLDivElement>) {
    setContextMenu(null);
    setFolderContextMenu(null);
    setCreateMenuOpen(false);
    setProfileMenuOpen(false);
    if (event.button !== 0) return;
    const target = event.target;
    if (
      !event.ctrlKey &&
      target instanceof Element &&
      target.closest('button, input, textarea, [data-no-canvas-pan]')
    ) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      cameraX: camera.x,
      cameraY: camera.y,
    };
  }

  function movePan(event: ReactPointerEvent<HTMLDivElement>) {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    setCamera((current) => ({
      ...current,
      x: pan.cameraX + event.clientX - pan.startX,
      y: pan.cameraY + event.clientY - pan.startY,
    }));
  }

  function endPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (panRef.current?.pointerId !== event.pointerId) return;
    panRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function zoom(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const isZoomGesture = event.ctrlKey || event.metaKey;
    if (!isZoomGesture) {
      const horizontalDelta =
        event.shiftKey && Math.abs(event.deltaX) < Math.abs(event.deltaY)
          ? event.deltaY
          : event.deltaX;
      setCamera((current) => ({
        ...current,
        x: current.x - horizontalDelta,
        y: current.y - (event.shiftKey ? 0 : event.deltaY),
      }));
      return;
    }

    const viewport = viewportRef.current?.getBoundingClientRect();
    if (!viewport) return;
    const pointerX = event.clientX - viewport.left;
    const pointerY = event.clientY - viewport.top;
    const nextScale = clamp(camera.scale * Math.exp(-event.deltaY * 0.001), 0.35, 1.8);
    const worldX = (pointerX - camera.x) / camera.scale;
    const worldY = (pointerY - camera.y) / camera.scale;
    setCamera({
      scale: nextScale,
      x: pointerX - worldX * nextScale,
      y: pointerY - worldY * nextScale,
    });
  }

  function dropFolderFor(
    position: WorkspaceResource['position'],
    size: WorkspaceResource['size'],
  ) {
    const center = {
      x: position.x + size.width / 2,
      y: position.y + size.height / 2,
    };
    const folder = visibleFolders.find((entry, index) => {
      const targetPosition = folderPosition(entry, index, folderPositions);
      return (
        center.x >= targetPosition.x &&
        center.x <= targetPosition.x + FOLDER_SIZE.width &&
        center.y >= targetPosition.y &&
        center.y <= targetPosition.y + FOLDER_SIZE.height
      );
    });
    return folder?.id ?? null;
  }

  function clientToWorld(clientX: number, clientY: number) {
    const viewport = viewportRef.current?.getBoundingClientRect();
    if (!viewport) return { x: 0, y: 0 };
    return {
      x: snap((clientX - viewport.left - camera.x) / camera.scale),
      y: snap((clientY - viewport.top - camera.y) / camera.scale),
    };
  }

  function creationPosition(
    size: WorkspaceResource['size'],
    itemCount: number,
  ): WorkspaceResource['position'] {
    const viewport = viewportRef.current?.getBoundingClientRect();
    if (!viewport) return { x: 0, y: 0 };
    const center = clientToWorld(
      viewport.left + viewport.width / 2,
      viewport.top + viewport.height / 2,
    );
    const cascade = (itemCount % 4) * SNAP;
    return {
      x: snap(center.x - size.width / 2 + cascade),
      y: snap(center.y - size.height / 2 + cascade),
    };
  }

  function beginExternalDrop(event: ReactDragEvent<HTMLDivElement>) {
    if (!hasImportableData(event.dataTransfer)) return;
    event.preventDefault();
    externalDragDepthRef.current += 1;
    setExternalDragActive(true);
  }

  function continueExternalDrop(event: ReactDragEvent<HTMLDivElement>) {
    if (!hasImportableData(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setExternalDragActive(true);
    const position = clientToWorld(event.clientX, event.clientY);
    setDropTargetId(dropFolderFor(position, { width: 320, height: 220 }));
  }

  function leaveExternalDrop(event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault();
    externalDragDepthRef.current = Math.max(0, externalDragDepthRef.current - 1);
    if (externalDragDepthRef.current === 0) {
      setExternalDragActive(false);
      setDropTargetId(null);
    }
  }

  function finishExternalDrop(event: ReactDragEvent<HTMLDivElement>) {
    if (!hasImportableData(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    externalDragDepthRef.current = 0;
    setExternalDragActive(false);
    setDropTargetId(null);
    const candidates = candidatesFromTransfer(event.dataTransfer);
    if (!candidates.length) return;
    const position = clientToWorld(event.clientX, event.clientY);
    const folderId = dropFolderFor(position, { width: 320, height: 220 }) ?? activeFolder;
    void runImport(candidates, position, folderId);
  }

  async function runImport(
    candidates: ImportCandidate[],
    position: WorkspaceResource['position'],
    folderId: string | null,
  ) {
    if (importMessageTimerRef.current) {
      window.clearTimeout(importMessageTimerRef.current);
    }
    setImportMessage({
      tone: 'progress',
      text: `Adding ${candidates.length === 1 ? 'item' : `${candidates.length} items`}…`,
    });
    try {
      await onImport(candidates, position, folderId);
      setImportMessage({
        tone: 'success',
        text: candidates.length === 1 ? 'Added to FixNote' : `${candidates.length} items added`,
      });
    } catch {
      setImportMessage({
        tone: 'error',
        text: 'Could not add this item',
      });
    }
    importMessageTimerRef.current = window.setTimeout(
      () => setImportMessage(null),
      2600,
    );
  }

  function isOverHomeDropzone(clientX: number, clientY: number) {
    const bounds = homeDropRef.current?.getBoundingClientRect();
    return !!bounds && clientX >= bounds.left && clientX <= bounds.right && clientY >= bounds.top && clientY <= bounds.bottom;
  }

  function folderDropTargetFor(folderId: string, position: WorkspaceResource['position']) {
    const center = {
      x: position.x + FOLDER_SIZE.width / 2,
      y: position.y + FOLDER_SIZE.height / 2,
    };
    return visibleFolders.find((candidate, index) => {
      if (candidate.id === folderId) return false;
      const target = folderPosition(candidate, index, folderPositions);
      return (
        center.x >= target.x &&
        center.x <= target.x + FOLDER_SIZE.width &&
        center.y >= target.y &&
        center.y <= target.y + FOLDER_SIZE.height
      );
    })?.id ?? null;
  }

  return (
    <div className="spatial-shell">
      {showChrome && <header className="spatial-topbar">
        <div className="search-box">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search your memory"
          />
          <kbd>
            <Command size={11} /> K
          </kbd>
        </div>
        <div className="topbar-actions">
          <button className="soft-button" onClick={onOpenChat}>
            <Sparkles size={15} /> Ask AI
          </button>
          <div className="profile-menu-wrap">
            <button
              className="avatar-button"
              aria-label="Profile"
              aria-expanded={profileMenuOpen}
              onClick={() => setProfileMenuOpen((current) => !current)}
            >
              Z
            </button>
            {profileMenuOpen && (
              <div className="profile-menu" role="menu">
                <span>FixNote profile</span>
                <button
                  role="menuitem"
                  onClick={() => {
                    setProfileMenuOpen(false);
                    void onSignOut();
                  }}
                >
                  <LogOut size={15} /> Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>}

      {activeFolder && (
        <div className="folder-breadcrumb">
          <button onClick={() => onActiveFolderChange(null)}>All notes</button>
          <span>/</span>
          <strong>
            {folders.find((folder) => folder.id === activeFolder)?.name}
          </strong>
        </div>
      )}

      {activeFolder && (draggingResource || draggingFolder) && (
        <div
          ref={homeDropRef}
          className={`folder-home-dropzone${homeDropActive ? ' is-active' : ''}`}
        >
          Drop here to move to home
        </div>
      )}

      <div
        ref={viewportRef}
        className={`spatial-viewport ${panRef.current ? 'is-panning' : ''}`}
        onPointerDown={beginPan}
        onPointerMove={movePan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onWheel={zoom}
        onDragEnter={beginExternalDrop}
        onDragOver={continueExternalDrop}
        onDragLeave={leaveExternalDrop}
        onDrop={finishExternalDrop}
      >
        <div
          className="spatial-world"
          style={{
            transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`,
          }}
        >
          {loading ? (
            <div className="canvas-loading">Restoring your space…</div>
          ) : (
            visibleResources.map((resource) => (
              <ResourceCard
                key={resource.id}
                resource={resource}
                scale={camera.scale}
                youtubeActive={activeYoutubeResourceId === resource.id}
                onToggleYoutube={onToggleYoutube}
                onOpen={() => onOpen(resource.id)}
                onOpenMenu={(x, y) =>
                  setContextMenu({
                    resource,
                    x: Math.min(x, window.innerWidth - 204),
                    y: Math.min(y, window.innerHeight - 154),
                  })
                }
                onCommit={(position, size) => {
                    const folderId = preserveFolderOnMove
                      ? resource.folderId
                      : homeDropActive
                        ? null
                        : dropFolderFor(position, size) ?? activeFolder;
                    setDropTargetId(null);
                    setHomeDropActive(false);
                    setDraggingResource(false);
                    void onPatch(resource.id, {
                      position,
                      size,
                      folderId,
                    });
                  }}
                onDropToSidebar={(target) =>
                  onDropResourceToSidebar?.(resource.id, target)
                }
                onDragMove={(position, size, clientX, clientY) => {
                  setDraggingResource(true);
                  const sidebarTarget = sidebarDropTargetAt(clientX, clientY);
                  onSidebarDragTargetChange?.(sidebarTarget);
                  if (sidebarTarget) {
                    setHomeDropActive(false);
                    setDropTargetId(null);
                    return;
                  }
                  const overHome = activeFolder !== null && isOverHomeDropzone(clientX, clientY);
                  setHomeDropActive(overHome);
                  setDropTargetId(overHome ? null : dropFolderFor(position, size));
                }}
                onDragEnd={() => {
                  setDropTargetId(null);
                  setHomeDropActive(false);
                  setDraggingResource(false);
                  onSidebarDragTargetChange?.(null);
                }}
              />
            ))
          )}

          {visibleFolders.map((folder, index) => {
              const position =
                folderPosition(folder, index, folderPositions);
              const count = resources.filter(
                (resource) => resource.folderId === folder.id,
              ).length;
              return (
                <FolderStack
                  key={folder.id}
                  folder={folder}
                  position={position}
                  scale={camera.scale}
                  count={count}
                  isDropTarget={dropTargetId === folder.id || folderDropTargetId === folder.id}
                  onOpen={() => onActiveFolderChange(folder.id)}
                  onOpenMenu={(x, y) =>
                    setFolderContextMenu({
                      folder,
                      x: Math.min(x, window.innerWidth - 204),
                      y: Math.min(y, window.innerHeight - 224),
                    })
                  }
                  onMove={(nextPosition) => {
                    setFolderPositions((current) => ({
                      ...current,
                      [folder.id]: nextPosition,
                    }));
                    const parentId = folderDropTargetFor(folder.id, nextPosition);
                    setFolderDropTargetId(null);
                    void onMoveFolder(folder.id, homeDropActive ? null : parentId ?? folder.parentId, nextPosition);
                  }}
                  onDragMove={(nextPosition, clientX, clientY) => {
                    setDraggingFolder(true);
                    setHomeDropActive(isOverHomeDropzone(clientX, clientY));
                    setFolderDropTargetId(folderDropTargetFor(folder.id, nextPosition));
                  }}
                  onDragEnd={() => {
                    setDraggingFolder(false);
                    setHomeDropActive(false);
                    setFolderDropTargetId(null);
                  }}
                />
              );
            })}
        </div>

        {visibleResources.length === 0 && visibleFolders.length === 0 && !loading && (
          <div className="empty-canvas">
            <Search size={22} />
            <strong>Nothing here yet</strong>
            <span>Try another search or create a note.</span>
          </div>
        )}

        {externalDragActive && (
          <div className="external-drop-overlay">
            <span><Upload size={24} /></span>
            <strong>Drop to add to FixNote</strong>
            <small>Links, text, documents, images and video</small>
          </div>
        )}
      </div>

      {importMessage && (
        <div className={`import-toast is-${importMessage.tone}`} role="status">
          {importMessage.tone === 'progress' ? <Upload size={14} /> : <span />}
          {importMessage.text}
        </div>
      )}

      {contextMenu && (
        <ResourceContextMenu
          {...contextMenu}
          onClose={() => setContextMenu(null)}
          onOpen={() => {
            setContextMenu(null);
            onOpen(contextMenu.resource.id);
          }}
          onRename={() => {
            const title = window.prompt(
              'Переименовать карточку',
              contextMenu.resource.title,
            );
            const nextTitle = title?.trim();
            setContextMenu(null);
            if (nextTitle && nextTitle !== contextMenu.resource.title) {
              void onPatch(contextMenu.resource.id, { title: nextTitle });
            }
          }}
          onDelete={() => {
            const confirmed = window.confirm(
              `Удалить «${contextMenu.resource.title}»?`,
            );
            setContextMenu(null);
            if (confirmed) void onDelete(contextMenu.resource.id);
          }}
          deleteLabel={deleteLabel}
        />
      )}

      {folderContextMenu && (
        <FolderContextMenu
          {...folderContextMenu}
          onClose={() => setFolderContextMenu(null)}
          onOpen={() => {
            setFolderContextMenu(null);
            onActiveFolderChange(folderContextMenu.folder.id);
          }}
          onRename={() => {
            const name = window.prompt(
              'Переименовать папку',
              folderContextMenu.folder.name,
            );
            const nextName = name?.trim();
            setFolderContextMenu(null);
            if (nextName && nextName !== folderContextMenu.folder.name) {
              void onRenameFolder(folderContextMenu.folder.id, nextName);
            }
          }}
          onColorChange={(color) => {
            const { id } = folderContextMenu.folder;
            setFolderContextMenu((current) =>
              current
                ? {
                    ...current,
                    folder: { ...current.folder, color },
                  }
                : null,
            );
            void onChangeFolderColor(id, color);
          }}
          onDelete={() => {
            const confirmed = window.confirm(
              `Удалить «${folderContextMenu.folder.name}»? Заметки останутся на главной доске.`,
            );
            setFolderContextMenu(null);
            if (confirmed) void onDeleteFolder(folderContextMenu.folder.id);
          }}
        />
      )}

      <div className="create-cluster">
        <div
          className="create-menu-trigger"
          onMouseEnter={() => setCreateMenuOpen(true)}
          onMouseLeave={() => setCreateMenuOpen(false)}
        >
          {createMenuOpen && (
            <div className="create-menu" role="menu" aria-label="Create">
              <button
                role="menuitem"
                onClick={() => {
                  setCreateMenuOpen(false);
                  void onCreate(
                    'note',
                    undefined,
                    activeFolder,
                    creationPosition(
                      { width: 320, height: 220 },
                      visibleResources.length + visibleFolders.length,
                    ),
                  );
                }}
              >
                <FileText size={16} />
                <span><strong>Note</strong><small>Write an idea</small></span>
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  const parentId = activeFolder;
                  const name = window.prompt('Folder name', 'Untitled folder')?.trim();
                  if (!name) return;
                  setCreateMenuOpen(false);
                  void onCreateFolder(
                    name,
                    parentId,
                    creationPosition(
                      FOLDER_SIZE,
                      visibleResources.length + visibleFolders.length,
                    ),
                  );
                }}
              >
                <FolderPlus size={16} />
                <span><strong>Folder</strong><small>Keep things together</small></span>
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setCreateMenuOpen(false);
                  void onCreate(
                    'board',
                    undefined,
                    activeFolder,
                    creationPosition(
                      { width: 320, height: 220 },
                      visibleResources.length + visibleFolders.length,
                    ),
                  );
                }}
              >
                <Shapes size={16} />
                <span><strong>Board</strong><small>Map things out</small></span>
              </button>
            </div>
          )}
          <button
            className="create-primary"
            onClick={() => setCreateMenuOpen((current) => !current)}
            title="Create"
            aria-expanded={createMenuOpen}
          >
            <Plus size={22} />
          </button>
        </div>
      </div>
    </div>
  );
}

interface ResourceCardProps {
  resource: WorkspaceResource;
  scale: number;
  youtubeActive: boolean;
  onToggleYoutube: (playback: YoutubePlayback) => void;
  onOpen: () => void;
  onOpenMenu: (x: number, y: number) => void;
  onCommit: (
    position: WorkspaceResource['position'],
    size: WorkspaceResource['size'],
  ) => void;
  onDragMove: (
    position: WorkspaceResource['position'],
    size: WorkspaceResource['size'],
    clientX: number,
    clientY: number,
  ) => void;
  onDragEnd: () => void;
  onDropToSidebar?: (target: WorkspaceDropTarget) => Promise<void> | void;
}

function ResourceCard({
  resource,
  scale,
  youtubeActive,
  onToggleYoutube,
  onOpen,
  onOpenMenu,
  onCommit,
  onDragMove,
  onDragEnd,
  onDropToSidebar,
}: ResourceCardProps) {
  const [position, setPosition] = useState(resource.position);
  const [size, setSize] = useState(resource.size);
  const [interactionType, setInteractionType] = useState<
    'move' | 'resize' | null
  >(null);
  const interaction = useRef<{
    type: 'move' | 'resize';
    pointerId: number;
    startX: number;
    startY: number;
    position: typeof position;
    size: typeof size;
    currentPosition: typeof position;
    currentSize: typeof size;
    moved: boolean;
  } | null>(null);

  function begin(
    event: ReactPointerEvent<HTMLElement>,
    type: 'move' | 'resize',
  ) {
    if (event.button !== 0) return;
    if (event.ctrlKey) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setInteractionType(type);
    interaction.current = {
      type,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      position,
      size,
      currentPosition: position,
      currentSize: size,
      moved: false,
    };
  }

  function move(event: ReactPointerEvent<HTMLElement>) {
    const active = interaction.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const dx = (event.clientX - active.startX) / scale;
    const dy = (event.clientY - active.startY) / scale;
    if (Math.abs(dx) + Math.abs(dy) > 3) active.moved = true;
    if (active.type === 'move') {
      const nextPosition = {
        x: active.position.x + dx,
        y: active.position.y + dy,
      };
      active.currentPosition = nextPosition;
      setPosition(nextPosition);
      if (active.moved) {
        onDragMove(
          nextPosition,
          active.currentSize,
          event.clientX,
          event.clientY,
        );
      }
    } else {
      const nextSize = {
        width: clamp(active.size.width + dx, 240, 960),
        height: clamp(active.size.height + dy, 168, 720),
      };
      active.currentSize = nextSize;
      setSize(nextSize);
    }
  }

  function end(event: ReactPointerEvent<HTMLElement>) {
    const active = interaction.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.stopPropagation();
    interaction.current = null;
    setInteractionType(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!active.moved && active.type === 'move') {
      activate();
    } else {
      const sidebarTarget =
        active.type === 'move'
          ? sidebarDropTargetAt(event.clientX, event.clientY)
          : null;
      if (sidebarTarget && onDropToSidebar) {
        setPosition(active.position);
        setSize(active.size);
        void onDropToSidebar(sidebarTarget);
        onDragEnd();
        return;
      }
      const settledPosition =
        active.type === 'move'
          ? {
              x: snap(active.currentPosition.x),
              y: snap(active.currentPosition.y),
            }
          : active.currentPosition;
      const settledSize = {
        width: clamp(snap(active.currentSize.width), 240, 960),
        height: clamp(snap(active.currentSize.height), 168, 720),
      };
      setPosition(settledPosition);
      setSize(settledSize);
      onCommit(settledPosition, settledSize);
    }
    onDragEnd();
  }

  function activate() {
    const imported = resource.imported;
    if (imported?.kind !== 'link') {
      onOpen();
      return;
    }
    if (imported.linkType === 'youtube') {
      const videoId =
        imported.videoId ?? youtubeVideoId(new URL(imported.url));
      if (videoId) {
        onToggleYoutube({
          resourceId: resource.id,
          videoId,
          title: resource.title,
        });
        return;
      }
    }
    void openExternalUrl(imported.url);
  }

  function cancel(event: ReactPointerEvent<HTMLElement>) {
    const active = interaction.current;
    if (!active || active.pointerId !== event.pointerId) return;
    interaction.current = null;
    setInteractionType(null);
    setPosition(active.position);
    setSize(active.size);
    onDragEnd();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <article
      className={`resource-card accent-${resource.accent}${resource.kind === 'note' && !resource.imported ? ' is-note' : ''}${resource.imported ? ` is-imported imported-${resource.imported.kind}${resource.imported.kind === 'file' ? ` imported-file-${resource.imported.fileType}` : ''}` : ''}${interactionType ? ` is-interacting is-${interactionType}` : ''}${interactionType === 'move' ? ' is-dragging' : ''}`}
      style={{
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
      }}
      data-youtube-anchor={
        resource.imported?.kind === 'link' &&
        resource.imported.linkType === 'youtube'
          ? resource.id
          : undefined
      }
      onPointerDown={(event) => begin(event, 'move')}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={cancel}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenMenu(event.clientX, event.clientY);
      }}
    >
      {resource.imported?.kind === 'link' ? (
        <div className="link-card-clip">
          <ImportedPreview
            resource={resource}
            youtubePlaying={youtubeActive}
          />
        </div>
      ) : resource.imported ? (
        <ImportedPreview resource={resource} youtubePlaying={youtubeActive} />
      ) : resource.kind === 'note' ? (
        <NotePreview resource={resource} />
      ) : (
        <>
          <div className="resource-meta">
            <span>Board</span>
            <i />
          </div>
          <h2>{resource.title}</h2>
          <div className="board-preview" aria-hidden="true">
            <span className="preview-sticky one">Launch</span>
            <span className="preview-sticky two">Research</span>
            <span className="preview-line" />
            <span className="preview-dot a" />
            <span className="preview-dot b" />
          </div>
        </>
      )}
      {resource.kind !== 'note' && (
        <footer>
          <span>{formatUpdatedAt(resource.updatedAt)}</span>
          {resource.role !== 'owner' && <b>{resource.role}</b>}
        </footer>
      )}
      <button
        className="resize-handle"
        onPointerDown={(event) => begin(event, 'resize')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={cancel}
        aria-label="Resize card"
      />
    </article>
  );
}

export function LibraryResourceCard({
  resource,
  layout,
  youtubeActive,
  onToggleYoutube,
  onOpen,
  onOpenMenu,
}: {
  resource: WorkspaceResource;
  layout: 'grid' | 'list';
  youtubeActive: boolean;
  onToggleYoutube: (playback: YoutubePlayback) => void;
  onOpen: () => void;
  onOpenMenu: (x: number, y: number) => void;
}) {
  function activate() {
    const imported = resource.imported;
    if (imported?.kind !== 'link') {
      onOpen();
      return;
    }
    if (imported.linkType === 'youtube') {
      const videoId =
        imported.videoId ?? youtubeVideoId(new URL(imported.url));
      if (videoId) {
        onToggleYoutube({
          resourceId: resource.id,
          videoId,
          title: resource.title,
        });
        return;
      }
    }
    void openExternalUrl(imported.url);
  }

  return (
    <article
      className={`library-resource-card is-${layout} accent-${resource.accent}${resource.kind === 'note' && !resource.imported ? ' is-note' : ''}${resource.imported ? ` is-imported imported-${resource.imported.kind}${resource.imported.kind === 'file' ? ` imported-file-${resource.imported.fileType}` : ''}` : ''}`}
      draggable
      data-youtube-anchor={
        resource.imported?.kind === 'link' &&
        resource.imported.linkType === 'youtube'
          ? resource.id
          : undefined
      }
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'copyMove';
        event.dataTransfer.setData(
          'application/x-fixnote-resource-id',
          resource.id,
        );
        event.dataTransfer.setData('text/plain', resource.title);
      }}
      onClick={activate}
      onContextMenu={(event) => {
        event.preventDefault();
        onOpenMenu(event.clientX, event.clientY);
      }}
    >
      <div className="library-resource-preview">
        {resource.imported?.kind === 'link' ? (
          <div className="link-card-clip">
            <ImportedPreview
              resource={resource}
              youtubePlaying={youtubeActive}
            />
          </div>
        ) : resource.imported ? (
          <ImportedPreview
            resource={resource}
            youtubePlaying={youtubeActive}
          />
        ) : resource.kind === 'note' ? (
          <NotePreview resource={resource} />
        ) : (
          <>
            <div className="resource-meta">
              <span>Board</span>
              <i />
            </div>
            <h2>{resource.title}</h2>
            <div className="board-preview" aria-hidden="true">
              <span className="preview-sticky one">Idea</span>
              <span className="preview-sticky two">Next</span>
              <span className="preview-line" />
              <span className="preview-dot a" />
              <span className="preview-dot b" />
            </div>
          </>
        )}
      </div>
      {layout === 'list' && (
        <div className="library-resource-copy">
          <span>{resourceTypeLabel(resource)}</span>
          <strong>{resource.title}</strong>
          <p>{resource.preview}</p>
          <time dateTime={resource.updatedAt}>
            {formatUpdatedAt(resource.updatedAt)}
          </time>
        </div>
      )}
    </article>
  );
}

function resourceTypeLabel(resource: WorkspaceResource): string {
  if (resource.kind === 'board') return 'Board';
  if (!resource.imported) return 'Note';
  if (resource.imported.kind === 'link') {
    return resource.imported.linkType === 'youtube'
      ? 'YouTube'
      : resource.imported.linkType === 'social'
        ? 'Social link'
        : 'Link';
  }
  if (resource.imported.kind === 'file') {
    return filePresentation(resource.imported.fileType).label;
  }
  return 'Text';
}

function ImportedPreview({
  resource,
  youtubePlaying,
}: {
  resource: WorkspaceResource;
  youtubePlaying: boolean;
}) {
  const imported = resource.imported!;
  const assetUrl = useImportedAssetUrl(
    imported.kind === 'file' ? imported.assetId : null,
  );
  const linkMetadata = useLinkPreviewMetadata(
    imported.kind === 'link' ? imported : null,
  );

  if (imported.kind === 'text') {
    return (
      <div className="imported-preview imported-text-preview">
        <ImportBadge icon={FileText} label="Pasted text" />
        <h2>{resource.title}</h2>
        <p>{resource.preview}</p>
      </div>
    );
  }

  if (imported.kind === 'link') {
    const videoId =
      imported.videoId ??
      (imported.linkType === 'youtube'
        ? youtubeVideoId(new URL(imported.url))
        : null);
    const title = linkMetadata?.title || resource.title;
    const description = linkMetadata?.description || resource.preview;
    const siteName = linkMetadata?.siteName || imported.host;
    const imageUrl =
      linkMetadata?.imageUrl ||
      (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null);

    if (imported.linkType === 'youtube' && videoId) {
      return (
        <div
          className={`imported-preview link-preview youtube-preview${youtubePlaying ? ' is-playing' : ''}`}
        >
          <img
            className="link-preview-image"
            src={imageUrl!}
            alt=""
            draggable={false}
          />
          {!youtubePlaying && (
              <span className="youtube-play" aria-hidden="true">
                <span />
              </span>
          )}
          <div className="link-preview-copy">
            <small>YouTube</small>
            <strong>{title}</strong>
          </div>
        </div>
      );
    }

    return (
      <div
        className={`imported-preview link-preview og-preview link-${imported.linkType}${imageUrl ? ' has-image' : ''}`}
      >
        <LinkPreviewArtwork
          src={imageUrl}
          url={imported.url}
          host={imported.host}
          title={title}
        />
        <div className="link-preview-copy">
          <small>{siteName}</small>
          <strong>{title}</strong>
          {description && <p>{description}</p>}
        </div>
        <ArrowUpRight className="import-open-mark" size={17} />
      </div>
    );
  }

  const fileMeta = filePresentation(imported.fileType);
  if (imported.fileType === 'image') {
    return (
      <div className="imported-image-preview">
        {assetUrl ? <img src={assetUrl} alt="" draggable={false} /> : <span />}
        <time dateTime={resource.updatedAt}>{formatUpdatedAt(resource.updatedAt)}</time>
      </div>
    );
  }

  return (
    <div className={`imported-preview file-preview file-${imported.fileType}`}>
      <ImportBadge icon={fileMeta.icon} label={fileMeta.label} />
      {imported.fileType === 'video' && assetUrl ? (
        <video src={assetUrl} muted preload="metadata" />
      ) : (
        <div className="file-preview-icon">
          <fileMeta.icon size={34} strokeWidth={1.45} />
        </div>
      )}
      <h2>{resource.title}</h2>
      <p>{resource.preview}</p>
    </div>
  );
}

type ImportedLink = Extract<ImportedContent, { kind: 'link' }>;

function useLinkPreviewMetadata(
  imported: ImportedLink | null,
): LinkPreviewMetadata | null {
  const [metadata, setMetadata] = useState<LinkPreviewMetadata | null>(
    imported?.metadata ?? null,
  );

  useEffect(() => {
    let disposed = false;
    setMetadata(imported?.metadata ?? null);
    if (!imported || imported.metadata?.imageUrl) return;
    void loadLinkPreview(imported.url, {
      refresh: Boolean(imported.metadata),
    })
      .then((next) => {
        if (!disposed) {
          setMetadata((current) => ({
            ...current,
            ...next,
          }));
        }
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [imported]);

  return metadata;
}

function LinkPreviewArtwork({
  src,
  url,
  host,
  title,
}: {
  src: string | null;
  url: string;
  host: string;
  title: string;
}) {
  const [failed, setFailed] = useState(false);
  const [faviconFailed, setFaviconFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    setFaviconFailed(false);
  }, [src, url]);

  if (!src || failed) {
    const hue = hashHue(host);
    const monogram = (host.replace(/^www\./, '')[0] ?? title[0] ?? 'W')
      .toLocaleUpperCase();
    const faviconUrl = `${new URL(url).origin}/favicon.ico`;
    return (
      <span
        className="link-preview-fallback is-generated"
        style={{ '--link-preview-hue': hue } as CSSProperties}
        aria-hidden="true"
      >
        <span className="link-preview-orb">
          {!faviconFailed && (
            <img
              src={faviconUrl}
              alt=""
              draggable={false}
              referrerPolicy="no-referrer"
              onError={() => setFaviconFailed(true)}
            />
          )}
          {faviconFailed && <b>{monogram}</b>}
        </span>
        <i>{host}</i>
      </span>
    );
  }

  return (
    <img
      className="link-preview-image"
      src={src}
      alt=""
      draggable={false}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

function hashHue(value: string): number {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash % 360;
}

function ImportBadge({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <span className="import-badge">
      <Icon size={12} strokeWidth={1.8} /> {label}
    </span>
  );
}

function filePresentation(type: ImportedFileType): { icon: LucideIcon; label: string } {
  return {
    image: { icon: ImageIcon, label: 'Image' },
    video: { icon: FileVideo, label: 'Video' },
    audio: { icon: Music2, label: 'Audio' },
    document: { icon: FileText, label: 'Document' },
    text: { icon: FileText, label: 'Text file' },
    archive: { icon: FileArchive, label: 'Archive' },
    file: { icon: FileImage, label: 'File' },
  }[type];
}

function NotePreview({ resource }: { resource: WorkspaceResource }) {
  const [content, setContent] = useState(resource.preview);

  useEffect(() => {
    const document = new Y.Doc();
    const persistence = new IndexeddbPersistence(
      roomNames.resource(resource.id),
      document,
    );
    let disposed = false;
    const updatePreview = () => {
      const text = readNoteText(document);
      if (!disposed && text) setContent(text);
    };

    persistence.on('synced', updatePreview);
    document.on('update', updatePreview);
    return () => {
      disposed = true;
      document.off('update', updatePreview);
      persistence.destroy();
      document.destroy();
    };
  }, [resource.id]);

  return (
    <div className="note-preview">
      <h2>{resource.title}</h2>
      <time className="note-preview-date" dateTime={resource.updatedAt}>
        {formatUpdatedAt(resource.updatedAt)}
      </time>
      <div className="note-preview-content">{renderNotePreview(content)}</div>
    </div>
  );
}

function readNoteText(document: Y.Doc): string {
  return document.getXmlFragment('content').toString().trim();
}

function renderNotePreview(content: string): ReactNode {
  if (!content.includes('<')) return content;
  const parsed = new DOMParser().parseFromString(
    `<preview>${content}</preview>`,
    'text/xml',
  );
  if (parsed.querySelector('parsererror')) return content.replace(/<[^>]*>/g, ' ');
  return renderPreviewNodes(Array.from(parsed.documentElement.childNodes));
}

function renderPreviewNodes(nodes: Node[]): ReactNode[] {
  return nodes.map((node, index) => renderPreviewNode(node, index));
}

function renderPreviewNode(node: Node, key: number): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const element = node as Element;
  const children = renderPreviewNodes(Array.from(element.childNodes));
  switch (element.tagName.toLowerCase()) {
    case 'paragraph':
      return <p key={key}>{children}</p>;
    case 'heading':
      return <strong className="note-preview-heading" key={key}>{children}</strong>;
    case 'bulletlist':
      return <ul key={key}>{children}</ul>;
    case 'orderedlist':
      return <ol key={key}>{children}</ol>;
    case 'listitem':
      return <li key={key}>{children}</li>;
    case 'bold':
    case 'strong':
      return <strong key={key}>{children}</strong>;
    case 'italic':
    case 'em':
      return <em key={key}>{children}</em>;
    case 'underline':
      return <u key={key}>{children}</u>;
    case 'strike':
      return <s key={key}>{children}</s>;
    case 'highlight':
      return <mark key={key}>{children}</mark>;
    case 'markerhighlight':
      return (
        <mark
          key={key}
          style={{
            backgroundColor:
              element.getAttribute('color') ??
              element.getAttribute('data-marker-color') ??
              '#f6df68',
          }}
        >
          {children}
        </mark>
      );
    case 'link': {
      const href = element.getAttribute('href');
      return href ? (
        <a key={key} href={href} tabIndex={-1}>
          {children}
        </a>
      ) : (
        <span key={key}>{children}</span>
      );
    }
    case 'image': {
      const src = element.getAttribute('src');
      return src ? (
        <img
          key={key}
          className="note-preview-image"
          src={src}
          alt={element.getAttribute('alt') ?? ''}
        />
      ) : null;
    }
    case 'hardbreak':
      return <br key={key} />;
    default:
      return <span key={key}>{children}</span>;
  }
}

function formatUpdatedAt(updatedAt: string) {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(updatedAt));
}

function ResourceContextMenu({
  resource,
  x,
  y,
  onClose,
  onOpen,
  onRename,
  onDelete,
  deleteLabel,
}: ResourceContextMenuState & {
  onClose: () => void;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  deleteLabel: string;
}) {
  return (
    <AppContextMenu
      x={x}
      y={y}
      ariaLabel={`Actions for ${resource.title}`}
      onClose={onClose}
    >
      <ContextMenuLabel>Resource</ContextMenuLabel>
      <ContextMenuItem textValue="Open" onSelect={onOpen}>
        <ArrowUpRight size={15} /> Open
      </ContextMenuItem>
      <ContextMenuItem textValue="Rename" onSelect={onRename}>
        <Pencil size={15} /> Rename
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        tone="destructive"
        textValue={deleteLabel}
        onSelect={onDelete}
      >
        <Trash2 size={15} /> {deleteLabel}
      </ContextMenuItem>
    </AppContextMenu>
  );
}

export function FolderContextMenu({
  folder,
  x,
  y,
  onClose,
  onOpen,
  onRename,
  onColorChange,
  onDelete,
}: FolderContextMenuState & {
  onClose: () => void;
  onOpen: () => void;
  onRename: () => void;
  onColorChange: (color: FolderColor) => void;
  onDelete: () => void;
}) {
  return (
    <AppContextMenu
      x={x}
      y={y}
      ariaLabel={`Actions for ${folder.name}`}
      onClose={onClose}
    >
      <ContextMenuLabel>Folder</ContextMenuLabel>
      <ContextMenuItem textValue="Open" onSelect={onOpen}>
        <ArrowUpRight size={15} /> Open
      </ContextMenuItem>
      <ContextMenuItem textValue="Rename" onSelect={onRename}>
        <Pencil size={15} /> Rename
      </ContextMenuItem>
      <ContextMenuSeparator />
      <div className="folder-color-picker" aria-label="Folder color choices">
        {FOLDER_COLORS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            className={`folder-color-swatch is-${value}`}
            aria-label={label}
            aria-pressed={(folder.color ?? 'default') === value}
            title={label}
            onClick={() => onColorChange(value)}
          />
        ))}
      </div>
      <ContextMenuSeparator />
      <ContextMenuItem
        tone="destructive"
        textValue="Delete"
        onSelect={onDelete}
      >
        <Trash2 size={15} /> Delete
      </ContextMenuItem>
    </AppContextMenu>
  );
}

interface FolderStackProps {
  folder: FolderSummary;
  position: WorkspaceResource['position'];
  scale: number;
  count: number;
  isDropTarget: boolean;
  onOpen: () => void;
  onOpenMenu: (x: number, y: number) => void;
  onMove: (position: WorkspaceResource['position']) => void;
  onDragMove: (
    position: WorkspaceResource['position'],
    clientX: number,
    clientY: number,
  ) => void;
  onDragEnd: () => void;
}

function FolderStack({
  folder,
  position: initialPosition,
  scale,
  count,
  isDropTarget,
  onOpen,
  onOpenMenu,
  onMove,
  onDragMove,
  onDragEnd,
}: FolderStackProps) {
  const [position, setPosition] = useState(initialPosition);
  const [dragging, setDragging] = useState(false);
  const interaction = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startPosition: WorkspaceResource['position'];
    position: WorkspaceResource['position'];
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    setPosition(initialPosition);
  }, [initialPosition.x, initialPosition.y]);

  function begin(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    if (event.ctrlKey) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    interaction.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPosition: position,
      position,
      moved: false,
    };
  }

  function move(event: ReactPointerEvent<HTMLButtonElement>) {
    const active = interaction.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const dx = (event.clientX - active.startX) / scale;
    const dy = (event.clientY - active.startY) / scale;
    if (Math.abs(dx) + Math.abs(dy) > 3) {
      active.moved = true;
      setDragging(true);
    }
    const nextPosition = {
      x: active.startPosition.x + dx,
      y: active.startPosition.y + dy,
    };
    active.position = nextPosition;
    setPosition(nextPosition);
    if (active.moved) onDragMove(nextPosition, event.clientX, event.clientY);
  }

  function end(event: ReactPointerEvent<HTMLButtonElement>) {
    const active = interaction.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.stopPropagation();
    interaction.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (active.moved) {
      const settledPosition = {
        x: snap(active.position.x),
        y: snap(active.position.y),
      };
      setPosition(settledPosition);
      onMove(settledPosition);
    } else {
      onOpen();
    }
    onDragEnd();
  }

  function cancel(event: ReactPointerEvent<HTMLButtonElement>) {
    const active = interaction.current;
    if (!active || active.pointerId !== event.pointerId) return;
    interaction.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setPosition(active.startPosition);
    onDragEnd();
  }

  return (
    <button
      className={`folder-stack folder-color-${folder.color ?? 'default'}${dragging ? ' is-dragging' : ''}${isDropTarget ? ' is-drop-target' : ''}`}
      style={{ left: position.x, top: position.y }}
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={cancel}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenMenu(event.clientX, event.clientY);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      aria-label={`Open ${folder.name}`}
    >
      <span className="folder-back" />
      <span className="folder-middle" />
      <span className="folder-front">
        <FolderOpen size={25} />
        <strong>{folder.name}</strong>
        <small>
          {count} {count === 1 ? 'item' : 'items'}
        </small>
        {isDropTarget && <em className="folder-drop-hint">Move here</em>}
      </span>
    </button>
  );
}

function snap(value: number) {
  return Math.round(value / SNAP) * SNAP;
}

const FOLDER_COLORS: ReadonlyArray<{
  value: FolderColor;
  label: string;
}> = [
  { value: 'default', label: 'Default' },
  { value: 'sage', label: 'Sage' },
  { value: 'sky', label: 'Sky' },
  { value: 'yellow', label: 'Yellow' },
  { value: 'rose', label: 'Rose' },
];

function candidatesFromTransfer(dataTransfer: DataTransfer): ImportCandidate[] {
  const files = Array.from(dataTransfer.files);
  if (files.length) return files.map((file) => ({ kind: 'file', file }));

  const uriList = dataTransfer
    .getData('text/uri-list')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
    .join('\n');
  return candidatesFromText(uriList || dataTransfer.getData('text/plain'));
}

function hasImportableData(dataTransfer: DataTransfer): boolean {
  return (
    dataTransfer.files.length > 0 ||
    dataTransfer.types.includes('Files') ||
    dataTransfer.types.includes('text/plain') ||
    dataTransfer.types.includes('text/uri-list')
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    !!target.closest('input, textarea, [contenteditable="true"]')
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
