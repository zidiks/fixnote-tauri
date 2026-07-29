import Collaboration from '@tiptap/extension-collaboration';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { Mark, mergeAttributes } from '@tiptap/core';
import {
  EditorContent,
  type Editor,
  useEditor,
} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  ArrowLeft,
  Bold,
  Bot,
  Braces,
  EyeOff,
  Highlighter,
  Italic,
  Link2,
  MessageSquareQuote,
  MousePointer2,
  Share2,
  Strikethrough,
  UnderlineIcon,
} from 'lucide-react';
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { WorkspaceResource } from '../domain';
import { useImportedAssetUrl } from '../lib/use-imported-asset-url';
import { useCollaboration } from '../lib/use-collaboration';
import { ShareDialog } from './ShareDialog';

interface NoteEditorProps {
  resource: WorkspaceResource;
  onBack: () => void;
  onRename: (title: string) => Promise<void>;
  onOpenChat: () => void;
}

interface ToolbarPosition {
  left: number;
  top: number;
}

type EditorMode = 'cursor' | 'marker';

interface MarkerStroke {
  pointerId: number;
  lastPosition: number;
}

interface MarkerWheelState {
  pointerId: number;
  x: number;
  y: number;
  selectedIndex: number;
}

const MARKER_COLORS = [
  { name: 'Yellow', value: '#f6df68' },
  { name: 'Coral', value: '#f5a09a' },
  { name: 'Pink', value: '#efacd2' },
  { name: 'Violet', value: '#c9b6f2' },
  { name: 'Blue', value: '#9bcdf0' },
  { name: 'Mint', value: '#a9dfc2' },
] as const;

const MARKER_OPTIONS = [
  { name: 'Default', value: 'default', swatch: '#f3f4f1' },
  ...MARKER_COLORS.map((color) => ({ ...color, swatch: color.value })),
] as const;

const Spoiler = Mark.create({
  name: 'spoiler',
  parseHTML() {
    return [{ tag: 'span[data-spoiler]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-spoiler': '',
        class: 'inline-spoiler',
      }),
      0,
    ];
  },
});

const MarkerHighlight = Mark.create({
  name: 'markerHighlight',
  inclusive: false,
  addAttributes() {
    return {
      color: {
        default: MARKER_COLORS[0].value,
        parseHTML: (element) =>
          element.getAttribute('data-marker-color') ??
          MARKER_COLORS[0].value,
      },
    };
  },
  parseHTML() {
    return [{ tag: 'mark[data-marker-color]' }];
  },
  renderHTML({ HTMLAttributes }) {
    const { color, ...attributes } = HTMLAttributes;
    return [
      'mark',
      mergeAttributes(attributes, {
        'data-marker-color': color,
        class: 'inline-marker',
        style: `background-color: ${String(color)}`,
      }),
      0,
    ];
  },
});

export function NoteEditor({
  resource,
  onBack,
  onRename,
  onOpenChat,
}: NoteEditorProps) {
  const [title, setTitle] = useState(resource.title);
  const [toolbar, setToolbar] = useState<ToolbarPosition | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [mode, setMode] = useState<EditorMode>('cursor');
  const [markerColor, setMarkerColor] = useState<string>(
    MARKER_COLORS[0].value,
  );
  const [markerWheel, setMarkerWheel] =
    useState<MarkerWheelState | null>(null);
  const [markerDrawing, setMarkerDrawing] = useState(false);
  const { document, status, hydrated } = useCollaboration(resource.id);
  const importedContentApplied = useRef(false);
  const markerStrokeRef = useRef<MarkerStroke | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const imageAssetId =
    resource.imported?.kind === 'file' &&
    resource.imported.fileType === 'image'
      ? resource.imported.assetId
      : null;
  const imageUrl = useImportedAssetUrl(imageAssetId);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          undoRedo: false,
          link: {
            openOnClick: false,
            autolink: true,
            linkOnPaste: true,
            markdownLinks: true,
            HTMLAttributes: { rel: 'noopener noreferrer' },
          },
        }),
        Image.configure({
          allowBase64: true,
          HTMLAttributes: {
            class: 'note-inline-image',
            loading: 'lazy',
          },
          resize: {
            enabled: true,
            minWidth: 120,
            minHeight: 80,
            alwaysPreserveAspectRatio: true,
          },
        }),
        Placeholder.configure({
          placeholder: 'Start with a thought…',
        }),
        Spoiler,
        MarkerHighlight,
        Collaboration.configure({ document, field: 'content' }),
      ],
      editorProps: {
        attributes: {
          class: 'note-prose',
          spellcheck: 'true',
        },
        handlePaste(view, event) {
          const imageFiles = imageFilesFrom(event.clipboardData);
          if (imageFiles.length) {
            event.preventDefault();
            void insertImageFiles(view, imageFiles).catch(() => undefined);
            return true;
          }

          const pastedText = event.clipboardData
            ?.getData('text/plain')
            .trim();
          const href = pastedText ? safeHttpUrl(pastedText) : null;
          if (href && view.state.selection.empty) {
            const link = view.state.schema.marks.link;
            if (!link) return false;
            event.preventDefault();
            view.dispatch(
              view.state.tr
                .replaceSelectionWith(
                  view.state.schema.text(pastedText!, [
                    link.create({
                      href,
                      rel: 'noopener noreferrer',
                      target: '_blank',
                    }),
                  ]),
                )
                .scrollIntoView(),
            );
            return true;
          }
          return false;
        },
        handleDrop(view, event, _slice, moved) {
          if (moved) return false;
          const imageFiles = imageFilesFrom(event.dataTransfer);
          if (!imageFiles.length) return false;
          event.preventDefault();
          void insertImageFiles(view, imageFiles).catch(() => undefined);
          return true;
        },
      },
      onSelectionUpdate({ editor: currentEditor }) {
        updateToolbar(currentEditor, setToolbar);
      },
      onBlur() {
        setToolbar(null);
      },
    },
    [document],
  );

  useEffect(() => setTitle(resource.title), [resource.title]);

  useLayoutEffect(() => {
    resizeTitle(titleRef.current);
  }, [title]);

  useEffect(() => {
    const handleResize = () => resizeTitle(titleRef.current);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!editor || !hydrated || importedContentApplied.current || !editor.isEmpty) return;
    const importedText = textFromImport(resource);
    if (!importedText) return;
    importedContentApplied.current = true;
    editor.commands.setContent({
      type: 'doc',
      content: importedText.split(/\r?\n/).map((line) => ({
        type: 'paragraph',
        ...(line ? { content: [{ type: 'text', text: line }] } : {}),
      })),
    });
  }, [editor, hydrated, resource]);

  function saveTitle() {
    const next = title.trim() || 'Untitled note';
    setTitle(next);
    if (next !== resource.title) void onRename(next);
  }

  function beginEditorGesture(event: ReactPointerEvent<HTMLDivElement>) {
    if (mode !== 'marker' || !editor) return;

    if (event.button === 2) {
      event.preventDefault();
      event.stopPropagation();
      const selectedIndex = Math.max(
        0,
        MARKER_OPTIONS.findIndex((option) => option.value === markerColor),
      );
      setMarkerWheel({
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        selectedIndex,
      });
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    if (event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element) || !target.closest('.note-prose')) return;
    const position = editor.view.posAtCoords({
      left: event.clientX,
      top: event.clientY,
    })?.pos;
    if (position === undefined) return;

    event.preventDefault();
    setToolbar(null);
    markerStrokeRef.current = {
      pointerId: event.pointerId,
      lastPosition: position,
    };
    setMarkerDrawing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    editor.view.focus();
  }

  function moveEditorGesture(event: ReactPointerEvent<HTMLDivElement>) {
    if (
      markerWheel &&
      markerWheel.pointerId === event.pointerId
    ) {
      event.preventDefault();
      const selectedIndex = markerSectorAt(
        event.clientX - markerWheel.x,
        event.clientY - markerWheel.y,
        markerWheel.selectedIndex,
      );
      if (selectedIndex !== markerWheel.selectedIndex) {
        setMarkerWheel((current) =>
          current ? { ...current, selectedIndex } : current,
        );
      }
      return;
    }

    const stroke = markerStrokeRef.current;
    if (!stroke || stroke.pointerId !== event.pointerId || !editor) return;
    event.preventDefault();
    const position = editor.view.posAtCoords({
      left: event.clientX,
      top: event.clientY,
    })?.pos;
    if (position === undefined || position === stroke.lastPosition) return;

    const from = Math.min(stroke.lastPosition, position);
    const to = Math.max(stroke.lastPosition, position);
    const marker = editor.schema.marks.markerHighlight;
    if (marker && from < to) {
      const transaction = editor.state.tr;
      if (markerColor === 'default') {
        transaction.removeMark(from, to, marker);
      } else {
        transaction.addMark(from, to, marker.create({ color: markerColor }));
      }
      editor.view.dispatch(transaction);
    }
    stroke.lastPosition = position;
  }

  function endEditorGesture(event: ReactPointerEvent<HTMLDivElement>) {
    if (markerWheel?.pointerId === event.pointerId) {
      event.preventDefault();
      setMarkerColor(MARKER_OPTIONS[markerWheel.selectedIndex]!.value);
      setMarkerWheel(null);
    }
    if (markerStrokeRef.current?.pointerId === event.pointerId) {
      markerStrokeRef.current = null;
      setMarkerDrawing(false);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function cancelEditorGesture(event: ReactPointerEvent<HTMLDivElement>) {
    if (markerWheel?.pointerId === event.pointerId) setMarkerWheel(null);
    if (markerStrokeRef.current?.pointerId === event.pointerId) {
      markerStrokeRef.current = null;
      setMarkerDrawing(false);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div
      className={`document-shell${mode === 'marker' ? ' is-marker-mode' : ''}${markerDrawing ? ' is-marker-drawing' : ''}`}
      onPointerDown={beginEditorGesture}
      onPointerMove={moveEditorGesture}
      onPointerUp={endEditorGesture}
      onPointerCancel={cancelEditorGesture}
      onContextMenu={(event) => {
        if (mode === 'marker') event.preventDefault();
      }}
    >
      <header className="document-header">
        <button className="round-back" onClick={onBack} aria-label="Back">
          <ArrowLeft size={20} />
        </button>
        <div className="document-status">
          <span className={`status-dot status-${status}`} />
          {status === 'online'
            ? 'Synced'
            : status === 'connecting'
              ? 'Connecting'
              : 'Saved locally'}
        </div>
        <div className="document-actions">
          <button className="soft-button" onClick={onOpenChat}>
            <Bot size={16} /> Ask AI
          </button>
          <button className="soft-button" onClick={() => setShareOpen(true)}>
            <Share2 size={16} /> Share
          </button>
        </div>
      </header>

      <main className="note-page">
        <textarea
          ref={titleRef}
          className="note-title"
          rows={1}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={saveTitle}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              saveTitle();
              editor?.commands.focus('start');
            }
          }}
          aria-label="Note title"
        />
        <div className="note-byline">
          <span>Just now</span>
          <i />
          <span>Private note</span>
        </div>
        {imageAssetId && (
          <figure className="note-imported-image">
            {imageUrl ? (
              <img src={imageUrl} alt={resource.title} />
            ) : (
              <span aria-label="Loading image" />
            )}
          </figure>
        )}
        <EditorContent editor={editor} />
      </main>

      {editor && toolbar && (
        <SelectionToolbar editor={editor} position={toolbar} />
      )}
      <EditorModeToolbar
        mode={mode}
        markerColor={markerColor}
        onChange={(nextMode) => {
          setMode(nextMode);
          setMarkerDrawing(false);
          setToolbar(null);
        }}
      />
      {markerWheel && (
        <MarkerColorWheel
          x={markerWheel.x}
          y={markerWheel.y}
          selectedIndex={markerWheel.selectedIndex}
        />
      )}
      <ShareDialog
        open={shareOpen}
        resource={resource}
        onClose={() => setShareOpen(false)}
      />
    </div>
  );
}

function EditorModeToolbar({
  mode,
  markerColor,
  onChange,
}: {
  mode: EditorMode;
  markerColor: string;
  onChange: (mode: EditorMode) => void;
}) {
  return (
    <div className="note-mode-toolbar" aria-label="Editor mode">
      <button
        className={mode === 'cursor' ? 'is-active' : ''}
        onClick={() => onChange('cursor')}
        title="Cursor"
        aria-label="Cursor mode"
        aria-pressed={mode === 'cursor'}
      >
        <MousePointer2 size={17} />
      </button>
      <button
        className={mode === 'marker' ? 'is-active' : ''}
        onClick={() => onChange('marker')}
        title="Marker · right-drag to choose color"
        aria-label="Marker mode"
        aria-pressed={mode === 'marker'}
      >
        <Highlighter size={17} />
        <i
          className={markerColor === 'default' ? 'is-default' : ''}
          style={
            markerColor === 'default'
              ? undefined
              : { background: markerColor }
          }
        />
      </button>
    </div>
  );
}

function MarkerColorWheel({
  x,
  y,
  selectedIndex,
}: {
  x: number;
  y: number;
  selectedIndex: number;
}) {
  return (
    <div
      className="marker-color-wheel"
      style={{ left: x, top: y }}
      aria-label={`${MARKER_OPTIONS[selectedIndex]!.name} marker`}
    >
      <svg viewBox="0 0 176 176" aria-hidden="true">
        <defs>
          <pattern
            id="marker-default-pattern"
            width="8"
            height="8"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="8" height="8" fill="#f3f4f1" />
            <rect width="2" height="8" fill="#c9ceca" />
          </pattern>
        </defs>
        {MARKER_OPTIONS.map((option, index) => (
          <path
            key={option.value}
            className={index === selectedIndex ? 'is-selected' : ''}
            d={markerSectorPath(index, index === selectedIndex ? 79 : 72)}
            fill={
              option.value === 'default'
                ? 'url(#marker-default-pattern)'
                : option.swatch
            }
          />
        ))}
        <circle cx="88" cy="88" r="25" className="marker-wheel-center" />
        <circle
          cx="88"
          cy="88"
          r="8"
          fill={MARKER_OPTIONS[selectedIndex]!.swatch}
          className="marker-wheel-current"
        />
        {MARKER_OPTIONS[selectedIndex]!.value === 'default' && (
          <path
            d="M 83 83 L 93 93 M 93 83 L 83 93"
            className="marker-wheel-remove"
          />
        )}
      </svg>
    </div>
  );
}

function markerSectorAt(
  dx: number,
  dy: number,
  fallback: number,
): number {
  if (Math.hypot(dx, dy) < 30) return fallback;
  const angle = (Math.atan2(dy, dx) + Math.PI / 2 + Math.PI * 2) %
    (Math.PI * 2);
  return Math.floor(angle / ((Math.PI * 2) / MARKER_OPTIONS.length));
}

function markerSectorPath(index: number, outerRadius: number): string {
  const center = 88;
  const innerRadius = 31;
  const step = (Math.PI * 2) / MARKER_OPTIONS.length;
  const gap = 0.025;
  const start = -Math.PI / 2 + index * step + gap;
  const end = -Math.PI / 2 + (index + 1) * step - gap;
  const outerStart = polarPoint(center, outerRadius, start);
  const outerEnd = polarPoint(center, outerRadius, end);
  const innerEnd = polarPoint(center, innerRadius, end);
  const innerStart = polarPoint(center, innerRadius, start);
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 0 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerRadius} ${innerRadius} 0 0 0 ${innerStart.x} ${innerStart.y}`,
    'Z',
  ].join(' ');
}

function polarPoint(center: number, radius: number, angle: number) {
  return {
    x: center + Math.cos(angle) * radius,
    y: center + Math.sin(angle) * radius,
  };
}

function resizeTitle(element: HTMLTextAreaElement | null) {
  if (!element) return;
  element.style.height = '0px';
  element.style.height = `${element.scrollHeight}px`;
}

function imageFilesFrom(transfer: DataTransfer | null): File[] {
  if (!transfer) return [];
  return Array.from(transfer.files).filter((file) =>
    file.type.startsWith('image/'),
  );
}

async function insertImageFiles(
  view: Editor['view'],
  files: File[],
): Promise<void> {
  const imageType = view.state.schema.nodes.image;
  if (!imageType) return;
  for (const file of files) {
    const src = await readFileAsDataUrl(file);
    if (view.isDestroyed) return;
    view.dispatch(
      view.state.tr
        .replaceSelectionWith(
          imageType.create({
            src,
            alt: file.name || 'Pasted image',
            title: file.name || null,
          }),
        )
        .scrollIntoView(),
    );
  }
  view.focus();
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Could not read image'));
    });
    reader.addEventListener('error', () =>
      reject(reader.error ?? new Error('Could not read image')),
    );
    reader.readAsDataURL(file);
  });
}

function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function textFromImport(resource: WorkspaceResource): string | null {
  const imported = resource.imported;
  if (!imported) return null;
  if (imported.kind === 'text') return imported.text;
  if (imported.kind === 'link') return imported.url;
  return imported.text ?? null;
}

function SelectionToolbar({
  editor,
  position,
}: {
  editor: Editor;
  position: ToolbarPosition;
}) {
  const setLink = () => {
    const previous = editor.getAttributes('link').href as string | undefined;
    const href = window.prompt('Link URL', previous ?? 'https://');
    if (href === null) return;
    if (!href.trim()) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
  };

  const actions = [
    {
      name: 'Bold',
      icon: Bold,
      active: editor.isActive('bold'),
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      name: 'Italic',
      icon: Italic,
      active: editor.isActive('italic'),
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      name: 'Underline',
      icon: UnderlineIcon,
      active: editor.isActive('underline'),
      run: () => editor.chain().focus().toggleUnderline().run(),
    },
    {
      name: 'Strike',
      icon: Strikethrough,
      active: editor.isActive('strike'),
      run: () => editor.chain().focus().toggleStrike().run(),
    },
    {
      name: 'Quote',
      icon: MessageSquareQuote,
      active: editor.isActive('blockquote'),
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      name: 'Monospace',
      icon: Braces,
      active: editor.isActive('code'),
      run: () => editor.chain().focus().toggleCode().run(),
    },
    {
      name: 'Spoiler',
      icon: EyeOff,
      active: editor.isActive('spoiler'),
      run: () => editor.chain().focus().toggleMark('spoiler').run(),
    },
    {
      name: 'Link',
      icon: Link2,
      active: editor.isActive('link'),
      run: setLink,
    },
  ];

  return (
    <div
      className="selection-toolbar"
      style={{ left: position.left, top: position.top }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {actions.map(({ name, icon: Icon, active, run }) => (
        <button
          key={name}
          className={active ? 'is-active' : ''}
          onClick={run}
          title={name}
          aria-label={name}
        >
          <Icon size={15} />
        </button>
      ))}
    </div>
  );
}

function updateToolbar(
  editor: Editor,
  setToolbar: (position: ToolbarPosition | null) => void,
) {
  const { from, to } = editor.state.selection;
  if (from === to) {
    setToolbar(null);
    return;
  }
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  setToolbar({
    left: rect.left + rect.width / 2,
    top: rect.top - 10,
  });
}
