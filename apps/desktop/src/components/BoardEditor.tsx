import {
  ArrowLeft,
  Bot,
  Circle,
  MousePointer2,
  Pencil,
  Share2,
  StickyNote,
  Type,
  Redo2,
  Undo2,
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

interface TextEditState {
  id: string;
  value: string;
}

interface BoardCamera {
  x: number;
  y: number;
  scale: number;
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
  const panRef = useRef<{
    startX: number;
    startY: number;
    cameraX: number;
    cameraY: number;
  } | null>(null);
  const [size, setSize] = useState({ width: 1200, height: 760 });
  const [camera, setCamera] = useState<BoardCamera>({
    x: 0,
    y: 0,
    scale: 1,
  });
  const [controlPressed, setControlPressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [tool, setTool] = useState<BoardTool>('select');
  const [shapes, setShapes] = useState<BoardShape[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [textEdit, setTextEdit] = useState<TextEditState | null>(null);
  const [historyState, setHistoryState] = useState({
    canUndo: false,
    canRedo: false,
  });
  const [peers, setPeers] = useState<PeerCursor[]>([]);
  const [shareOpen, setShareOpen] = useState(false);
  const { document, provider, status } = useCollaboration(resource.id);
  const shapeMap = useMemo(
    () => document.getMap<Y.Map<unknown>>('shapes'),
    [document],
  );
  const order = useMemo(() => document.getArray<string>('order'), [document]);
  const undoManager = useMemo(
    () => new Y.UndoManager([shapeMap, order]),
    [order, shapeMap],
  );

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
      undoManager.clear();
    }
    refresh();
    return () => {
      shapeMap.unobserveDeep(refresh);
      order.unobserve(refresh);
    };
  }, [document, order, shapeMap, undoManager]);

  useEffect(() => {
    const refresh = () =>
      setHistoryState({
        canUndo: undoManager.undoStack.length > 0,
        canRedo: undoManager.redoStack.length > 0,
      });
    undoManager.on('stack-item-added', refresh);
    undoManager.on('stack-item-popped', refresh);
    undoManager.on('stack-cleared', refresh);
    undoManager.on('stack-item-updated', refresh);
    refresh();
    return () => {
      undoManager.off('stack-item-added', refresh);
      undoManager.off('stack-item-popped', refresh);
      undoManager.off('stack-cleared', refresh);
      undoManager.off('stack-item-updated', refresh);
      undoManager.destroy();
    };
  }, [undoManager]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Control') setControlPressed(true);
      if (isEditableElement(event.target)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        setTextEdit(null);
        setSelectedId(null);
        if (event.shiftKey) undoManager.redo();
        else undoManager.undo();
        return;
      }
      if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        selectedId
      ) {
        event.preventDefault();
        removeShape(selectedId);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Control') setControlPressed(false);
    };
    const resetControl = () => {
      setControlPressed(false);
      setIsPanning(false);
      panRef.current = null;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', resetControl);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', resetControl);
    };
  }, [selectedId, undoManager]);

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
    undoManager.stopCapturing();
    if (tool === 'sticky') {
      const shape: BoardShape = {
        ...common,
        type: 'sticky',
        text: 'New thought',
        color: '#fff1a8',
      };
      putShape(shapeMap, order, shape);
      setSelectedId(shape.id);
      setTextEdit({ id: shape.id, value: shape.text ?? '' });
      setTool('select');
    } else if (tool === 'text') {
      const shape: BoardShape = {
        ...common,
        type: 'text',
        text: 'Type something',
        color: '#202522',
      };
      putShape(shapeMap, order, shape);
      setSelectedId(shape.id);
      setTextEdit({ id: shape.id, value: shape.text ?? '' });
      setTool('select');
    } else if (tool === 'circle') {
      const shape: BoardShape = {
        ...common,
        type: 'circle',
        radius: 56,
        color: '#7f8cff',
      };
      putShape(shapeMap, order, shape);
      setSelectedId(shape.id);
      setTool('select');
    }
    undoManager.stopCapturing();
  }

  function pointerPosition(event: KonvaEventObject<MouseEvent>) {
    const point = event.target.getStage()?.getPointerPosition() ?? {
      x: 0,
      y: 0,
    };
    return {
      x: (point.x - camera.x) / camera.scale,
      y: (point.y - camera.y) / camera.scale,
    };
  }

  function handlePointerDown(event: KonvaEventObject<MouseEvent>) {
    if (event.evt.ctrlKey) {
      const point = event.target.getStage()?.getPointerPosition();
      if (!point) return;
      event.evt.preventDefault();
      panRef.current = {
        startX: point.x,
        startY: point.y,
        cameraX: camera.x,
        cameraY: camera.y,
      };
      setIsPanning(true);
      return;
    }
    const point = pointerPosition(event);
    if (tool === 'draw') {
      undoManager.stopCapturing();
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
    if (tool === 'select' && event.target === event.target.getStage()) {
      setSelectedId(null);
      setTextEdit(null);
    }
    if (tool !== 'select') addAt(point.x, point.y);
  }

  function handlePointerMove(event: KonvaEventObject<MouseEvent>) {
    const pan = panRef.current;
    if (pan) {
      const point = event.target.getStage()?.getPointerPosition();
      if (!point) return;
      setCamera((current) => ({
        ...current,
        x: pan.cameraX + point.x - pan.startX,
        y: pan.cameraY + point.y - pan.startY,
      }));
      return;
    }
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
    panRef.current = null;
    setIsPanning(false);
    if (drawingId.current) undoManager.stopCapturing();
    drawingId.current = null;
  }

  function handleWheel(event: KonvaEventObject<WheelEvent>) {
    if (!event.evt.ctrlKey) return;
    event.evt.preventDefault();
    const point = event.target.getStage()?.getPointerPosition();
    if (!point) return;
    const nextScale = clamp(
      camera.scale * Math.exp(-event.evt.deltaY * 0.001),
      0.35,
      2.5,
    );
    const worldX = (point.x - camera.x) / camera.scale;
    const worldY = (point.y - camera.y) / camera.scale;
    setCamera({
      scale: nextScale,
      x: point.x - worldX * nextScale,
      y: point.y - worldY * nextScale,
    });
  }

  function moveShape(id: string, x: number, y: number) {
    const target = shapeMap.get(id);
    if (!target) return;
    undoManager.stopCapturing();
    document.transact(() => {
      target.set('x', x);
      target.set('y', y);
    });
    undoManager.stopCapturing();
  }

  function beginTextEdit(shape: BoardShape) {
    if (shape.type !== 'sticky' && shape.type !== 'text') return;
    setSelectedId(shape.id);
    setTextEdit({ id: shape.id, value: shape.text ?? '' });
  }

  function commitTextEdit() {
    if (!textEdit) return;
    const target = shapeMap.get(textEdit.id);
    if (target && target.get('text') !== textEdit.value) {
      undoManager.stopCapturing();
      target.set('text', textEdit.value);
      undoManager.stopCapturing();
    }
    setTextEdit(null);
  }

  function removeShape(id: string) {
    const index = order.toArray().indexOf(id);
    if (!shapeMap.has(id)) return;
    undoManager.stopCapturing();
    document.transact(() => {
      shapeMap.delete(id);
      if (index >= 0) order.delete(index, 1);
    });
    undoManager.stopCapturing();
    setTextEdit(null);
    setSelectedId(null);
  }

  function undo() {
    setTextEdit(null);
    setSelectedId(null);
    undoManager.undo();
  }

  function redo() {
    setTextEdit(null);
    setSelectedId(null);
    undoManager.redo();
  }

  const editingShape = textEdit
    ? shapes.find((shape) => shape.id === textEdit.id)
    : undefined;

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

      <div
        ref={containerRef}
        className={`board-stage${controlPressed ? ' is-control-navigation' : ''}${
          isPanning ? ' is-panning' : ''
        }`}
      >
        <Stage
          width={size.width}
          height={size.height}
          onMouseDown={handlePointerDown}
          onMouseMove={handlePointerMove}
          onMouseUp={handlePointerUp}
          onMouseLeave={handlePointerUp}
          onWheel={handleWheel}
        >
          <Layer
            x={camera.x}
            y={camera.y}
            scaleX={camera.scale}
            scaleY={camera.scale}
          >
            {shapes.map((shape) => (
              <BoardShapeNode
                key={shape.id}
                shape={shape}
                selected={selectedId === shape.id}
                draggable={
                  tool === 'select' &&
                  !controlPressed &&
                  textEdit?.id !== shape.id
                }
                onSelect={() => setSelectedId(shape.id)}
                onEdit={() => beginTextEdit(shape)}
                onMove={(x, y) => moveShape(shape.id, x, y)}
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

        {editingShape && textEdit && (
          <textarea
            key={editingShape.id}
            className={`board-text-editor is-${editingShape.type}`}
            style={{
              left: camera.x + editingShape.x * camera.scale,
              top: camera.y + editingShape.y * camera.scale,
              transform: `scale(${camera.scale})`,
              transformOrigin: 'top left',
              color: editingShape.type === 'text'
                ? editingShape.color ?? '#202522'
                : '#242724',
              background:
                editingShape.type === 'sticky'
                  ? editingShape.color ?? '#fff1a8'
                  : 'transparent',
            }}
            value={textEdit.value}
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) =>
              setTextEdit((current) =>
                current ? { ...current, value: event.target.value } : current,
              )
            }
            onBlur={commitTextEdit}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Escape') {
                event.preventDefault();
                setTextEdit(null);
              } else if (
                event.key === 'Enter' &&
                (event.ctrlKey || event.metaKey)
              ) {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
            aria-label="Edit board text"
          />
        )}

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
          <span className="board-tools-divider" aria-hidden="true" />
          <button
            onClick={undo}
            disabled={!historyState.canUndo}
            title="Undo"
            aria-label="Undo"
          >
            <Undo2 size={18} />
          </button>
          <button
            onClick={redo}
            disabled={!historyState.canRedo}
            title="Redo"
            aria-label="Redo"
          >
            <Redo2 size={18} />
          </button>
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
  selected,
  draggable,
  onSelect,
  onEdit,
  onMove,
}: {
  shape: BoardShape;
  selected: boolean;
  draggable: boolean;
  onSelect: () => void;
  onEdit: () => void;
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
        opacity={selected ? 0.72 : 1}
        onClick={onSelect}
        onTap={onSelect}
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
        strokeWidth={selected ? 6 : 4}
        draggable={draggable}
        {...(selected
          ? {
              shadowColor: '#3c6554',
              shadowBlur: 12,
              shadowOpacity: 0.22,
            }
          : {})}
        onClick={onSelect}
        onTap={onSelect}
        onDragStart={onSelect}
        onDragEnd={(event) => onMove(event.target.x(), event.target.y())}
      />
    );
  }
  if (shape.type === 'text') {
    return (
      <Group
        x={shape.x}
        y={shape.y}
        draggable={draggable}
        onClick={onSelect}
        onTap={onSelect}
        onDblClick={onEdit}
        onDblTap={onEdit}
        onDragStart={onSelect}
        onDragEnd={(event) => onMove(event.target.x(), event.target.y())}
      >
        {selected && (
          <Rect
            x={-10}
            y={-8}
            width={440}
            height={62}
            cornerRadius={8}
            stroke="#557164"
            strokeWidth={1.5}
            dash={[5, 4]}
          />
        )}
        <Text
          width={420}
          text={shape.text ?? ''}
          fill={shape.color ?? '#202522'}
          fontFamily="Inter, sans-serif"
          fontSize={34}
          fontStyle="bold"
          lineHeight={1.15}
        />
      </Group>
    );
  }
  return (
    <Group
      x={shape.x}
      y={shape.y}
      draggable={draggable}
      onClick={onSelect}
      onTap={onSelect}
      onDblClick={onEdit}
      onDblTap={onEdit}
      onDragStart={onSelect}
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
        {...(selected ? { stroke: '#557164', strokeWidth: 2 } : {})}
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

function isEditableElement(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest('input, textarea, [contenteditable="true"]'))
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
