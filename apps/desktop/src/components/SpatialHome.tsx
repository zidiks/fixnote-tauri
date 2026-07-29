import {
  Bot,
  Command,
  FilePlus2,
  Folder,
  FolderOpen,
  LayoutDashboard,
  Plus,
  Search,
  Settings2,
  Shapes,
  Sparkles,
} from 'lucide-react';
import {
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
  useMemo,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { FolderSummary, UpdateResourceInput } from '@fixnote/contracts';
import type { WorkspaceResource } from '../domain';
import { searchWorkspace } from '../lib/api';

interface SpatialHomeProps {
  loading: boolean;
  folders: FolderSummary[];
  resources: WorkspaceResource[];
  onOpen: (resourceId: string) => void;
  onCreate: (
    kind: WorkspaceResource['kind'],
    title?: string,
  ) => Promise<WorkspaceResource>;
  onPatch: (resourceId: string, patch: UpdateResourceInput) => Promise<void>;
  onOpenChat: () => void;
}

interface Camera {
  x: number;
  y: number;
  scale: number;
}

const SNAP = 24;
const folderPositions = [
  { x: -160, y: 520 },
  { x: 260, y: 560 },
  { x: 720, y: 520 },
];

export function SpatialHome({
  loading,
  folders,
  resources,
  onOpen,
  onCreate,
  onPatch,
  onOpenChat,
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
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [semanticIds, setSemanticIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const normalized = query.trim();
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
  }, [query]);

  const visibleResources = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return resources.filter((resource) => {
      const inFolder = activeFolder
        ? resource.folderId === activeFolder
        : true;
      const matches =
        !normalized ||
        semanticIds.has(resource.id) ||
        `${resource.title} ${resource.preview}`
          .toLocaleLowerCase()
          .includes(normalized);
      return inFolder && matches;
    });
  }, [activeFolder, query, resources, semanticIds]);

  function beginPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const target = event.target;
    if (
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
    if (!event.ctrlKey && !event.metaKey) {
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
    const index = folderPositions.findIndex(
      (folder) =>
        center.x >= folder.x &&
        center.x <= folder.x + 300 &&
        center.y >= folder.y &&
        center.y <= folder.y + 176,
    );
    return folders[index]?.id;
  }

  return (
    <div className="spatial-shell">
      <header className="spatial-topbar">
        <button className="brand-button" onClick={() => setActiveFolder(null)}>
          <span className="brand-mark">f</span>
          <span>FixNote</span>
        </button>
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
          <button className="avatar-button" aria-label="Profile">
            Z
          </button>
        </div>
      </header>

      {activeFolder && (
        <div className="folder-breadcrumb">
          <button onClick={() => setActiveFolder(null)}>All notes</button>
          <span>/</span>
          <strong>
            {folders.find((folder) => folder.id === activeFolder)?.name}
          </strong>
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
      >
        <div
          className="spatial-world"
          style={{
            transform: `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.scale})`,
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
                onOpen={() => onOpen(resource.id)}
                onCommit={(position, size) => {
                  const folderId = dropFolderFor(position, size);
                  void onPatch(resource.id, {
                    position,
                    size,
                    ...(folderId ? { folderId } : {}),
                  });
                }}
              />
            ))
          )}

          {!activeFolder &&
            folders.map((folder, index) => {
              const position =
                folderPositions[index] ?? {
                  x: 1140 + (index - 3) * 340,
                  y: 540,
                };
              const count = resources.filter(
                (resource) => resource.folderId === folder.id,
              ).length;
              return (
                <button
                  key={folder.id}
                  className="folder-stack"
                  style={{ left: position.x, top: position.y }}
                  onDoubleClick={() => setActiveFolder(folder.id)}
                >
                  <span className="folder-back" />
                  <span className="folder-middle" />
                  <span className="folder-front">
                    <FolderOpen size={25} />
                    <strong>{folder.name}</strong>
                    <small>
                      {count} {count === 1 ? 'item' : 'items'}
                    </small>
                  </span>
                </button>
              );
            })}
        </div>

        {visibleResources.length === 0 && !loading && (
          <div className="empty-canvas">
            <Search size={22} />
            <strong>Nothing here yet</strong>
            <span>Try another search or create a note.</span>
          </div>
        )}
      </div>

      <nav className="canvas-tools" aria-label="Canvas controls">
        <button title="Overview">
          <LayoutDashboard size={17} />
        </button>
        <button title="Folders">
          <Folder size={17} />
        </button>
        <button title="Preferences">
          <Settings2 size={17} />
        </button>
      </nav>

      <div className="create-cluster">
        <button
          className="create-secondary"
          onClick={() => void onCreate('board')}
          title="New board"
        >
          <Shapes size={18} />
        </button>
        <button
          className="create-secondary"
          onClick={() => void onCreate('note')}
          title="New note"
        >
          <FilePlus2 size={18} />
        </button>
        <button
          className="create-primary"
          onClick={() => void onCreate('note')}
          title="Create"
        >
          <Plus size={22} />
        </button>
      </div>
      <div className="zoom-label">{Math.round(camera.scale * 100)}%</div>
    </div>
  );
}

interface ResourceCardProps {
  resource: WorkspaceResource;
  scale: number;
  onOpen: () => void;
  onCommit: (
    position: WorkspaceResource['position'],
    size: WorkspaceResource['size'],
  ) => void;
}

function ResourceCard({
  resource,
  scale,
  onOpen,
  onCommit,
}: ResourceCardProps) {
  const [position, setPosition] = useState(resource.position);
  const [size, setSize] = useState(resource.size);
  const interaction = useRef<{
    type: 'move' | 'resize';
    pointerId: number;
    startX: number;
    startY: number;
    position: typeof position;
    size: typeof size;
    moved: boolean;
  } | null>(null);

  function begin(
    event: ReactPointerEvent<HTMLElement>,
    type: 'move' | 'resize',
  ) {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    interaction.current = {
      type,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      position,
      size,
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
      setPosition({
        x: snap(active.position.x + dx),
        y: snap(active.position.y + dy),
      });
    } else {
      setSize({
        width: clamp(snap(active.size.width + dx), 240, 960),
        height: clamp(snap(active.size.height + dy), 168, 720),
      });
    }
  }

  function end(event: ReactPointerEvent<HTMLElement>) {
    const active = interaction.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.stopPropagation();
    interaction.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (!active.moved && active.type === 'move') onOpen();
    else onCommit(position, size);
  }

  return (
    <article
      className={`resource-card accent-${resource.accent}`}
      style={{
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
      }}
      onPointerDown={(event) => begin(event, 'move')}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div className="resource-meta">
        <span>{resource.kind === 'note' ? 'Note' : 'Board'}</span>
        <i />
      </div>
      <h2>{resource.title}</h2>
      {resource.kind === 'note' ? (
        <p>{resource.preview}</p>
      ) : (
        <div className="board-preview" aria-hidden="true">
          <span className="preview-sticky one">Launch</span>
          <span className="preview-sticky two">Research</span>
          <span className="preview-line" />
          <span className="preview-dot a" />
          <span className="preview-dot b" />
        </div>
      )}
      <footer>
        <span>
          {new Intl.DateTimeFormat('en', {
            month: 'short',
            day: 'numeric',
          }).format(new Date(resource.updatedAt))}
        </span>
        {resource.role !== 'owner' && <b>{resource.role}</b>}
      </footer>
      <button
        className="resize-handle"
        onPointerDown={(event) => begin(event, 'resize')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        aria-label="Resize card"
      />
    </article>
  );
}

function snap(value: number) {
  return Math.round(value / SNAP) * SNAP;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
