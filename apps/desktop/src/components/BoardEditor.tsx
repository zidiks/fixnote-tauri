import {
  ArrowLeft,
  Bot,
  Circle,
  MousePointer2,
  Pencil,
  Share2,
  StickyNote,
  Type,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Circle as KonvaCircle,
  Group,
  Layer,
  Line,
  Rect,
  Stage,
  Text,
} from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import * as Y from 'yjs';
import type { WorkspaceResource } from '../domain';
import { useCollaboration } from '../lib/use-collaboration';
import { ShareDialog } from './ShareDialog';

type BoardTool = 'select' | 'sticky' | 'draw' | 'text' | 'circle';

interface BoardShape {
  id: string;
  type: 'sticky' | 'text' | 'line' | 'circle';
  x: number;
  y: number;
  text?: string;
  color?: string;
  points?: number[];
  radius?: number;
}

interface PeerCursor {
  clientId: number;
  name: string;
  color: string;
  x: number;
  y: number;
}

interface BoardEditorProps {
  resource: WorkspaceResource;
  onBack: () => void;
  onOpenChat: () => void;
}

export function BoardEditor({
  resource,
  onBack,
  onOpenChat,
}: BoardEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const drawingId = useRef<string | null>(null);
  const [size, setSize] = useState({ width: 1200, height: 760 });
  const [tool, setTool] = useState<BoardTool>('select');
  const [shapes, setShapes] = useState<BoardShape[]>([]);
  const [peers, setPeers] = useState<PeerCursor[]>([]);
  const [shareOpen, setShareOpen] = useState(false);
  const { document, provider, status } = useCollaboration(resource.id);
  const shapeMap = useMemo(
    () => document.getMap<Y.Map<unknown>>('shapes'),
    [document],
  );
  const order = useMemo(() => document.getArray<string>('order'), [document]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setSize({
        width: Math.round(entry.contentRect.width),
        height: Math.round(entry.contentRect.height),
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const refresh = () => {
      setShapes(
        order
          .toArray()
          .map((id) => shapeMap.get(id))
          .filter((shape): shape is Y.Map<unknown> => Boolean(shape))
          .map(readShape),
      );
    };
    shapeMap.observeDeep(refresh);
    order.observe(refresh);

    if (shapeMap.size === 0) {
      document.transact(() => {
        putShape(shapeMap, order, {
          id: crypto.randomUUID(),
          type: 'sticky',
          x: 230,
          y: 190,
          text: 'What should feel effortless?',
          color: '#fff1a8',
        });
        putShape(shapeMap, order, {
          id: crypto.randomUUID(),
          type: 'sticky',
          x: 520,
          y: 340,
          text: 'Realtime, local-first, calm.',
          color: '#bdebdc',
        });
        putShape(shapeMap, order, {
          id: crypto.randomUUID(),
          type: 'text',
          x: 470,
          y: 120,
          text: 'Launch map',
          color: '#202522',
        });
      });
    }
    refresh();
    return () => {
      shapeMap.unobserveDeep(refresh);
      order.unobserve(refresh);
    };
  }, [document, order, shapeMap]);

  useEffect(() => {
    const awareness = provider?.awareness;
    if (!awareness) return;
    const colors = ['#6b7cff', '#f26b5e', '#159b78', '#a056d7'];
    awareness.setLocalStateField('user', {
      name: 'You',
      color: colors[document.clientID % colors.length],
    });
    const refresh = () => {
      const next: PeerCursor[] = [];
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === document.clientID || !state.cursor) return;
        next.push({
          clientId,
          name: state.user?.name ?? 'Guest',
          color: state.user?.color ?? '#6b7cff',
          x: state.cursor.x,
          y: state.cursor.y,
        });
      });
      setPeers(next);
    };
    awareness.on('change', refresh);
    return () => awareness.off('change', refresh);
  }, [document.clientID, provider]);

  function addAt(x: number, y: number) {
    const common = { id: crypto.randomUUID(), x, y };
    if (tool === 'sticky') {
      putShape(shapeMap, order, {
        ...common,
        type: 'sticky',
        text: 'New thought',
        color: '#fff1a8',
      });
      setTool('select');
    } else if (tool === 'text') {
      putShape(shapeMap, order, {
        ...common,
        type: 'text',
        text: 'Type something',
        color: '#202522',
      });
      setTool('select');
    } else if (tool === 'circle') {
      putShape(shapeMap, order, {
        ...common,
        type: 'circle',
        radius: 56,
        color: '#7f8cff',
      });
      setTool('select');
    }
  }

  function pointerPosition(event: KonvaEventObject<MouseEvent>) {
    return event.target.getStage()?.getPointerPosition() ?? { x: 0, y: 0 };
  }

  function handlePointerDown(event: KonvaEventObject<MouseEvent>) {
    const point = pointerPosition(event);
    if (tool === 'draw') {
      const id = crypto.randomUUID();
      drawingId.current = id;
      putShape(shapeMap, order, {
        id,
        type: 'line',
        x: 0,
        y: 0,
        points: [point.x, point.y],
        color: '#252a27',
      });
      return;
    }
    if (tool !== 'select') addAt(point.x, point.y);
  }

  function handlePointerMove(event: KonvaEventObject<MouseEvent>) {
    const point = pointerPosition(event);
    provider?.awareness?.setLocalStateField('cursor', point);
    const id = drawingId.current;
    if (!id) return;
    const shape = shapeMap.get(id);
    if (!shape) return;
    const points = (shape.get('points') as number[] | undefined) ?? [];
    shape.set('points', [...points, point.x, point.y]);
  }

  function handlePointerUp() {
    drawingId.current = null;
  }

  return (
    <div className="board-shell">
      <header className="board-header">
        <button className="round-back" onClick={onBack} aria-label="Back">
          <ArrowLeft size={20} />
        </button>
        <div className="board-title">
          <strong>{resource.title}</strong>
          <span>
            <i className={`status-dot status-${status}`} />
            {status === 'online' ? 'Live' : 'Local'}
          </span>
        </div>
        <div className="board-header-actions">
          <div className="presence-stack">
            <span style={{ background: '#6b7cff' }}>Y</span>
            {peers.slice(0, 3).map((peer) => (
              <span key={peer.clientId} style={{ background: peer.color }}>
                {peer.name[0]}
              </span>
            ))}
          </div>
          <button className="soft-button" onClick={onOpenChat}>
            <Bot size={16} /> Ask AI
          </button>
          <button className="soft-button" onClick={() => setShareOpen(true)}>
            <Share2 size={16} /> Share
          </button>
        </div>
      </header>

      <div ref={containerRef} className="board-stage">
        <Stage
          width={size.width}
          height={size.height}
          onMouseDown={handlePointerDown}
          onMouseMove={handlePointerMove}
          onMouseUp={handlePointerUp}
          onMouseLeave={handlePointerUp}
        >
          <Layer>
            {shapes.map((shape) => (
              <BoardShapeNode
                key={shape.id}
                shape={shape}
                onMove={(x, y) => {
                  const target = shapeMap.get(shape.id);
                  target?.set('x', x);
                  target?.set('y', y);
                }}
              />
            ))}
            {peers.map((peer) => (
              <Group key={peer.clientId} x={peer.x} y={peer.y}>
                <Line
                  points={[0, 0, 0, 18, 5, 13, 10, 22, 14, 20, 9, 11, 17, 10]}
                  closed
                  fill={peer.color}
                  stroke="white"
                  strokeWidth={1.5}
                />
                <Rect
                  x={14}
                  y={16}
                  width={Math.max(46, peer.name.length * 7 + 14)}
                  height={22}
                  cornerRadius={7}
                  fill={peer.color}
                />
                <Text
                  x={21}
                  y={21}
                  text={peer.name}
                  fill="white"
                  fontSize={11}
                  fontStyle="bold"
                />
              </Group>
            ))}
          </Layer>
        </Stage>

        <div className="board-tools">
          <BoardToolButton
            tool="select"
            current={tool}
            onChange={setTool}
            icon={MousePointer2}
            label="Select"
          />
          <BoardToolButton
            tool="sticky"
            current={tool}
            onChange={setTool}
            icon={StickyNote}
            label="Sticky"
          />
          <BoardToolButton
            tool="text"
            current={tool}
            onChange={setTool}
            icon={Type}
            label="Text"
          />
          <BoardToolButton
            tool="draw"
            current={tool}
            onChange={setTool}
            icon={Pencil}
            label="Draw"
          />
          <BoardToolButton
            tool="circle"
            current={tool}
            onChange={setTool}
            icon={Circle}
            label="Circle"
          />
        </div>
      </div>
      <ShareDialog
        open={shareOpen}
        resource={resource}
        onClose={() => setShareOpen(false)}
      />
    </div>
  );
}

function BoardShapeNode({
  shape,
  onMove,
}: {
  shape: BoardShape;
  onMove: (x: number, y: number) => void;
}) {
  if (shape.type === 'line') {
    return (
      <Line
        points={shape.points ?? []}
        stroke={shape.color ?? '#252a27'}
        strokeWidth={3}
        lineCap="round"
        lineJoin="round"
        tension={0.18}
      />
    );
  }
  if (shape.type === 'circle') {
    return (
      <KonvaCircle
        x={shape.x}
        y={shape.y}
        radius={shape.radius ?? 56}
        stroke={shape.color ?? '#7f8cff'}
        strokeWidth={4}
        draggable
        onDragEnd={(event) => onMove(event.target.x(), event.target.y())}
      />
    );
  }
  if (shape.type === 'text') {
    return (
      <Text
        x={shape.x}
        y={shape.y}
        text={shape.text ?? ''}
        fill={shape.color ?? '#202522'}
        fontFamily="Inter, sans-serif"
        fontSize={34}
        fontStyle="bold"
        draggable
        onDragEnd={(event) => onMove(event.target.x(), event.target.y())}
      />
    );
  }
  return (
    <Group
      x={shape.x}
      y={shape.y}
      draggable
      onDragEnd={(event) => onMove(event.target.x(), event.target.y())}
    >
      <Rect
        width={210}
        height={154}
        fill={shape.color ?? '#fff1a8'}
        cornerRadius={5}
        shadowColor="#2c312e"
        shadowBlur={18}
        shadowOpacity={0.12}
        shadowOffsetY={8}
      />
      <Text
        x={20}
        y={22}
        width={170}
        text={shape.text ?? ''}
        fill="#242724"
        fontFamily="Inter, sans-serif"
        fontSize={18}
        lineHeight={1.35}
      />
    </Group>
  );
}

function BoardToolButton({
  tool,
  current,
  onChange,
  icon: Icon,
  label,
}: {
  tool: BoardTool;
  current: BoardTool;
  onChange: (tool: BoardTool) => void;
  icon: typeof MousePointer2;
  label: string;
}) {
  return (
    <button
      className={current === tool ? 'is-active' : ''}
      onClick={() => onChange(tool)}
      title={label}
      aria-label={label}
    >
      <Icon size={18} />
    </button>
  );
}

function putShape(
  shapes: Y.Map<Y.Map<unknown>>,
  order: Y.Array<string>,
  shape: BoardShape,
) {
  const value = new Y.Map<unknown>();
  Object.entries(shape).forEach(([key, entry]) => {
    if (entry !== undefined) value.set(key, entry);
  });
  shapes.set(shape.id, value);
  order.push([shape.id]);
}

function readShape(value: Y.Map<unknown>): BoardShape {
  return {
    id: String(value.get('id')),
    type: value.get('type') as BoardShape['type'],
    x: Number(value.get('x') ?? 0),
    y: Number(value.get('y') ?? 0),
    ...(typeof value.get('text') === 'string'
      ? { text: value.get('text') as string }
      : {}),
    ...(typeof value.get('color') === 'string'
      ? { color: value.get('color') as string }
      : {}),
    ...(Array.isArray(value.get('points'))
      ? { points: value.get('points') as number[] }
      : {}),
    ...(typeof value.get('radius') === 'number'
      ? { radius: value.get('radius') as number }
      : {}),
  };
}
