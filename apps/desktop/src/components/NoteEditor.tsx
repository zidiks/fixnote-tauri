import Collaboration from '@tiptap/extension-collaboration';
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
  Italic,
  Link2,
  MessageSquareQuote,
  Share2,
  Strikethrough,
  UnderlineIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { WorkspaceResource } from '../domain';
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

export function NoteEditor({
  resource,
  onBack,
  onRename,
  onOpenChat,
}: NoteEditorProps) {
  const [title, setTitle] = useState(resource.title);
  const [toolbar, setToolbar] = useState<ToolbarPosition | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const { document, status } = useCollaboration(resource.id);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          undoRedo: false,
          link: {
            openOnClick: false,
            autolink: true,
            HTMLAttributes: { rel: 'noopener noreferrer' },
          },
        }),
        Placeholder.configure({
          placeholder: 'Start with a thought…',
        }),
        Spoiler,
        Collaboration.configure({ document, field: 'content' }),
      ],
      editorProps: {
        attributes: {
          class: 'note-prose',
          spellcheck: 'true',
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

  function saveTitle() {
    const next = title.trim() || 'Untitled note';
    setTitle(next);
    if (next !== resource.title) void onRename(next);
  }

  return (
    <div className="document-shell">
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
        <input
          className="note-title"
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
        <EditorContent editor={editor} />
      </main>

      {editor && toolbar && (
        <SelectionToolbar editor={editor} position={toolbar} />
      )}
      <ShareDialog
        open={shareOpen}
        resource={resource}
        onClose={() => setShareOpen(false)}
      />
    </div>
  );
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
