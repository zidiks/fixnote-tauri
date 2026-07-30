import { X } from 'lucide-react';
import {
  type PointerEvent as ReactPointerEvent,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { YoutubePlayback } from '../domain';

interface PersistentYoutubePlayerProps {
  playback: YoutubePlayback | null;
  onClose: () => void;
}

interface PlayerGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
  radius: number;
  docked: boolean;
}

type FloatCorner =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

interface PlayerDrag {
  pointerId: number;
  startX: number;
  startY: number;
  originLeft: number;
  originTop: number;
  moved: boolean;
}

interface PlayerResize {
  pointerId: number;
  startX: number;
  startY: number;
  startWidth: number;
  corner: FloatCorner;
}

interface WorkspaceBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const FLOAT_WIDTH = 336;
const FLOAT_MIN_WIDTH = 240;
const FLOAT_MAX_WIDTH = 640;
const FLOAT_GAP = 22;

export function PersistentYoutubePlayer({
  playback,
  onClose,
}: PersistentYoutubePlayerProps) {
  const [docked, setDocked] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [positionedResourceId, setPositionedResourceId] = useState<
    string | null
  >(null);
  const playerRef = useRef<HTMLElement>(null);
  const floatCornerRef = useRef<FloatCorner>('bottom-right');
  const floatWidthRef = useRef(FLOAT_WIDTH);
  const geometryRef = useRef(
    floatingGeometry(floatCornerRef.current, floatWidthRef.current),
  );
  const dragRef = useRef<PlayerDrag | null>(null);
  const resizeRef = useRef<PlayerResize | null>(null);
  const suppressClickRef = useRef(false);
  const transitionTimerRef = useRef<number | null>(null);

  function beginTransition(player: HTMLElement) {
    player.classList.add('is-transitioning');
    void player.offsetWidth;
    setTransitioning(true);
    if (transitionTimerRef.current !== null) {
      window.clearTimeout(transitionTimerRef.current);
    }
    transitionTimerRef.current = window.setTimeout(() => {
      setTransitioning(false);
      transitionTimerRef.current = null;
    }, 280);
  }

  useLayoutEffect(() => {
    const player = playerRef.current;
    if (!playback || !player) return;
    let frame = 0;
    let firstMeasurement = true;
    player.classList.remove('is-transitioning');
    setTransitioning(false);

    const update = () => {
      if (dragRef.current || resizeRef.current) {
        frame = window.requestAnimationFrame(update);
        return;
      }
      const next = measurePlayer(
        playback.resourceId,
        floatCornerRef.current,
        floatWidthRef.current,
      );
      if (firstMeasurement || !sameGeometry(geometryRef.current, next)) {
        const dockChanged = geometryRef.current.docked !== next.docked;
        if (!firstMeasurement && dockChanged) {
          beginTransition(player);
        }
        applyGeometry(player, next);
        geometryRef.current = next;
        if (firstMeasurement || dockChanged) setDocked(next.docked);
      }
      if (firstMeasurement) {
        firstMeasurement = false;
        setPositionedResourceId(playback.resourceId);
      }
      frame = window.requestAnimationFrame(update);
    };

    update();
    return () => {
      window.cancelAnimationFrame(frame);
      if (transitionTimerRef.current !== null) {
        window.clearTimeout(transitionTimerRef.current);
        transitionTimerRef.current = null;
      }
    };
  }, [playback]);

  if (!playback) return null;

  function beginDrag(event: ReactPointerEvent<HTMLElement>) {
    if (docked || event.button !== 0) return;
    const target = event.target;
    if (target instanceof Element && target.closest('button')) return;
    const player = playerRef.current;
    if (!player) return;
    event.preventDefault();
    suppressClickRef.current = false;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originLeft: geometryRef.current.left,
      originTop: geometryRef.current.top,
      moved: false,
    };
    if (transitionTimerRef.current !== null) {
      window.clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
    player.classList.remove('is-transitioning');
    player.classList.add('is-dragging');
    setTransitioning(false);
    player.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    const player = playerRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !player) return;
    event.preventDefault();
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) >= 4) drag.moved = true;
    const current = geometryRef.current;
    const bounds = workspaceBounds();
    const next: PlayerGeometry = {
      ...current,
      left: clamp(
        drag.originLeft + dx,
        bounds.left + FLOAT_GAP,
        Math.max(
          bounds.left + FLOAT_GAP,
          bounds.right - current.width - FLOAT_GAP,
        ),
      ),
      top: clamp(
        drag.originTop + dy,
        bounds.top + FLOAT_GAP,
        Math.max(
          bounds.top + FLOAT_GAP,
          bounds.bottom - current.height - FLOAT_GAP,
        ),
      ),
      docked: false,
    };
    applyGeometry(player, next);
    geometryRef.current = next;
  }

  function endDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    const player = playerRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !player) return;
    dragRef.current = null;
    player.classList.remove('is-dragging');
    if (player.hasPointerCapture(event.pointerId)) {
      player.releasePointerCapture(event.pointerId);
    }
    if (!drag.moved) return;

    event.preventDefault();
    suppressClickRef.current = true;
    const bounds = workspaceBounds();
    const corner = nearestCorner(geometryRef.current, bounds);
    floatCornerRef.current = corner;
    const next = floatingGeometry(corner, floatWidthRef.current, bounds);
    beginTransition(player);
    applyGeometry(player, next);
    geometryRef.current = next;
  }

  function beginResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (docked || event.button !== 0) return;
    const player = playerRef.current;
    if (!player) return;
    event.preventDefault();
    event.stopPropagation();
    resizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: geometryRef.current.width,
      corner: floatCornerRef.current,
    };
    player.classList.remove('is-transitioning');
    player.classList.add('is-resizing');
    setTransitioning(false);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveResize(event: ReactPointerEvent<HTMLButtonElement>) {
    const resize = resizeRef.current;
    const player = playerRef.current;
    if (!resize || resize.pointerId !== event.pointerId || !player) return;
    event.preventDefault();
    event.stopPropagation();
    const horizontalDelta = resize.corner.endsWith('left')
      ? event.clientX - resize.startX
      : resize.startX - event.clientX;
    const verticalDelta =
      (resize.corner.startsWith('top')
        ? event.clientY - resize.startY
        : resize.startY - event.clientY) *
      (16 / 9);
    const desiredWidth =
      resize.startWidth + (horizontalDelta + verticalDelta) / 2;
    const bounds = workspaceBounds();
    const next = floatingGeometry(resize.corner, desiredWidth, bounds);
    applyGeometry(player, next);
    geometryRef.current = next;
  }

  function endResize(event: ReactPointerEvent<HTMLButtonElement>) {
    const resize = resizeRef.current;
    const player = playerRef.current;
    if (!resize || resize.pointerId !== event.pointerId || !player) return;
    event.preventDefault();
    event.stopPropagation();
    resizeRef.current = null;
    floatWidthRef.current = geometryRef.current.width;
    player.classList.remove('is-resizing');
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <aside
      ref={playerRef}
      className={`persistent-youtube-player ${docked ? 'is-docked' : 'is-floating'}${transitioning ? ' is-transitioning' : ''}`}
      style={{
        visibility:
          positionedResourceId === playback.resourceId
            ? 'visible'
            : 'hidden',
      }}
      onPointerDown={beginDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={(event) => {
        endDrag(event);
        suppressClickRef.current = false;
      }}
      onClick={() => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        if (!docked) onClose();
      }}
      onContextMenu={(event) => event.preventDefault()}
      aria-label={`Playing ${playback.title}`}
    >
      <div className="persistent-player-surface">
        <iframe
          key={playback.videoId}
          src={`https://www.youtube-nocookie.com/embed/${playback.videoId}?autoplay=1&controls=0&playsinline=1&rel=0`}
          title={playback.title}
          allow="autoplay; encrypted-media; picture-in-picture"
        />
        <div className="persistent-player-title">
          <span>Playing</span>
          <strong>{playback.title}</strong>
        </div>
        <button
          className="persistent-player-close"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          aria-label="Stop video"
        >
          <X size={14} />
        </button>
        <span className="persistent-player-pause" aria-hidden="true">
          <i />
          <i />
        </span>
      </div>
      <button
        className={`persistent-player-resize is-${innerResizeCorner(floatCornerRef.current)}`}
        onPointerDown={beginResize}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        onClick={(event) => event.stopPropagation()}
        aria-label="Resize video"
      />
    </aside>
  );
}

function measurePlayer(
  resourceId: string,
  floatCorner: FloatCorner,
  floatWidth: number,
): PlayerGeometry {
  const anchor = document.querySelector<HTMLElement>(
    `[data-youtube-anchor="${CSS.escape(resourceId)}"]`,
  );
  if (!anchor) return floatingGeometry(floatCorner, floatWidth);

  const rect = anchor.getBoundingClientRect();
  const bounds = workspaceBounds();
  const visible =
    rect.width > 0 &&
    rect.height > 0 &&
    rect.left >= bounds.left &&
    rect.top >= bounds.top &&
    rect.right <= bounds.right &&
    rect.bottom <= bounds.bottom;
  if (!visible) return floatingGeometry(floatCorner, floatWidth, bounds);

  const scale = anchor.offsetWidth > 0 ? rect.width / anchor.offsetWidth : 1;
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    radius: 18 * scale,
    docked: true,
  };
}

function floatingGeometry(
  corner: FloatCorner,
  desiredWidth: number,
  bounds = workspaceBounds(),
): PlayerGeometry {
  const horizontalRoom = Math.max(
    160,
    bounds.right - bounds.left - FLOAT_GAP * 2,
  );
  const verticalRoom = Math.max(
    90,
    bounds.bottom - bounds.top - FLOAT_GAP * 2,
  );
  const maximumWidth = Math.max(
    160,
    Math.min(FLOAT_MAX_WIDTH, horizontalRoom, verticalRoom * (16 / 9)),
  );
  const minimumWidth = Math.min(FLOAT_MIN_WIDTH, maximumWidth);
  const width = clamp(desiredWidth, minimumWidth, maximumWidth);
  const height = width * (9 / 16);
  const right = corner.endsWith('right');
  const bottom = corner.startsWith('bottom');
  return {
    left: right
      ? bounds.right - width - FLOAT_GAP
      : bounds.left + FLOAT_GAP,
    top: bottom
      ? bounds.bottom - height - FLOAT_GAP
      : bounds.top + FLOAT_GAP,
    width,
    height,
    radius: 18,
    docked: false,
  };
}

function nearestCorner(
  geometry: PlayerGeometry,
  bounds = workspaceBounds(),
): FloatCorner {
  const horizontal =
    geometry.left + geometry.width / 2 < (bounds.left + bounds.right) / 2
      ? 'left'
      : 'right';
  const vertical =
    geometry.top + geometry.height / 2 < (bounds.top + bounds.bottom) / 2
      ? 'top'
      : 'bottom';
  return `${vertical}-${horizontal}`;
}

function workspaceBounds(): WorkspaceBounds {
  let left = 0;
  let top = 40;
  let right = window.innerWidth;
  let bottom = window.innerHeight;

  const content = document.querySelector<HTMLElement>('.app-content');
  if (content) {
    const rect = content.getBoundingClientRect();
    left = rect.left;
    top = rect.top;
    right = rect.right;
    bottom = rect.bottom;
  }

  const sidebar = document.querySelector<HTMLElement>(
    '.workspace-sidebar-zone.is-visible .workspace-sidebar',
  );
  if (sidebar) {
    const rect = sidebar.getBoundingClientRect();
    if (rect.right > 0) {
      left = Math.max(left, rect.right);
    }
  }

  const chat = document.querySelector<HTMLElement>('.ai-dock');
  if (chat) {
    const rect = chat.getBoundingClientRect();
    if (rect.left < window.innerWidth) {
      right = Math.min(right, rect.left);
    }
  }

  if (right < left) right = left;
  if (bottom < top) bottom = top;
  return { left, top, right, bottom };
}

function innerResizeCorner(corner: FloatCorner): FloatCorner {
  const vertical = corner.startsWith('top') ? 'bottom' : 'top';
  const horizontal = corner.endsWith('left') ? 'right' : 'left';
  return `${vertical}-${horizontal}`;
}

function sameGeometry(a: PlayerGeometry, b: PlayerGeometry): boolean {
  return (
    a.docked === b.docked &&
    Math.abs(a.left - b.left) < 0.01 &&
    Math.abs(a.top - b.top) < 0.01 &&
    Math.abs(a.width - b.width) < 0.01 &&
    Math.abs(a.height - b.height) < 0.01 &&
    Math.abs(a.radius - b.radius) < 0.01
  );
}

function applyGeometry(
  player: HTMLElement,
  geometry: PlayerGeometry,
): void {
  const left = alignToScreenPixel(geometry.left);
  const top = alignToScreenPixel(geometry.top);
  const right = alignToScreenPixel(geometry.left + geometry.width);
  const bottom = alignToScreenPixel(geometry.top + geometry.height);
  player.style.transform = `translate3d(${left}px, ${top}px, 0)`;
  player.style.width = `${Math.max(0, right - left)}px`;
  player.style.height = `${Math.max(0, bottom - top)}px`;
  player.style.borderRadius = `${geometry.radius}px`;
}

function alignToScreenPixel(value: number): number {
  const ratio = window.devicePixelRatio || 1;
  return Math.round(value * ratio) / ratio;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
