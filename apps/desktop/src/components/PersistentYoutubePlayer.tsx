import { X } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
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

const FLOAT_WIDTH = 336;
const FLOAT_GAP = 22;
const FLOAT_BOTTOM = 88;

export function PersistentYoutubePlayer({
  playback,
  onClose,
}: PersistentYoutubePlayerProps) {
  const [geometry, setGeometry] = useState<PlayerGeometry>(() =>
    floatingGeometry(),
  );
  const [transitioning, setTransitioning] = useState(false);
  const [positionedResourceId, setPositionedResourceId] = useState<
    string | null
  >(null);
  const geometryRef = useRef(geometry);
  const transitionTimerRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (!playback) return;
    let frame = 0;
    let firstMeasurement = true;
    setTransitioning(false);

    const update = () => {
      const next = measurePlayer(playback.resourceId);
      if (!sameGeometry(geometryRef.current, next)) {
        if (
          !firstMeasurement &&
          geometryRef.current.docked !== next.docked
        ) {
          setTransitioning(true);
          if (transitionTimerRef.current !== null) {
            window.clearTimeout(transitionTimerRef.current);
          }
          transitionTimerRef.current = window.setTimeout(() => {
            setTransitioning(false);
            transitionTimerRef.current = null;
          }, 280);
        }
        geometryRef.current = next;
        setGeometry(next);
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

  return (
    <aside
      className={`persistent-youtube-player ${geometry.docked ? 'is-docked' : 'is-floating'}${transitioning ? ' is-transitioning' : ''}`}
      style={{
        left: geometry.left,
        top: geometry.top,
        width: geometry.width,
        height: geometry.height,
        borderRadius: geometry.radius,
        visibility:
          positionedResourceId === playback.resourceId
            ? 'visible'
            : 'hidden',
      }}
      onClick={() => {
        if (!geometry.docked) onClose();
      }}
      onContextMenu={(event) => event.preventDefault()}
      aria-label={`Playing ${playback.title}`}
    >
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
    </aside>
  );
}

function measurePlayer(resourceId: string): PlayerGeometry {
  const anchor = document.querySelector<HTMLElement>(
    `[data-youtube-anchor="${CSS.escape(resourceId)}"]`,
  );
  if (!anchor) return floatingGeometry();

  const rect = anchor.getBoundingClientRect();
  const visible =
    rect.width > 0 &&
    rect.height > 0 &&
    rect.right > 0 &&
    rect.bottom > 0 &&
    rect.left < window.innerWidth &&
    rect.top < window.innerHeight;
  if (!visible) return floatingGeometry();

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

function floatingGeometry(): PlayerGeometry {
  const width = Math.min(FLOAT_WIDTH, Math.max(240, window.innerWidth - 44));
  const height = width * (9 / 16);
  return {
    left: Math.max(FLOAT_GAP, window.innerWidth - width - FLOAT_GAP),
    top: Math.max(FLOAT_GAP, window.innerHeight - height - FLOAT_BOTTOM),
    width,
    height,
    radius: 18,
    docked: false,
  };
}

function sameGeometry(a: PlayerGeometry, b: PlayerGeometry): boolean {
  return (
    a.docked === b.docked &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5 &&
    Math.abs(a.radius - b.radius) < 0.5
  );
}
