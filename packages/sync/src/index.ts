import * as Y from "yjs";

export const NOTE_TITLE_FIELD = "title";
export const NOTE_CONTENT_FIELD = "content";
export const CANVAS_SHAPES_FIELD = "shapes";
export const CANVAS_ORDER_FIELD = "order";
export const CANVAS_META_FIELD = "meta";

export interface NoteDocument {
  document: Y.Doc;
  title: Y.Text;
  content: Y.XmlFragment;
}

export interface CanvasDocument {
  document: Y.Doc;
  shapes: Y.Map<Y.Map<unknown>>;
  order: Y.Array<string>;
  meta: Y.Map<unknown>;
}

export function createNoteDocument(document = new Y.Doc()): NoteDocument {
  return {
    document,
    title: document.getText(NOTE_TITLE_FIELD),
    content: document.getXmlFragment(NOTE_CONTENT_FIELD),
  };
}

export function createCanvasDocument(document = new Y.Doc()): CanvasDocument {
  return {
    document,
    shapes: document.getMap<Y.Map<unknown>>(CANVAS_SHAPES_FIELD),
    order: document.getArray<string>(CANVAS_ORDER_FIELD),
    meta: document.getMap(CANVAS_META_FIELD),
  };
}

export const roomNames = {
  resource(resourceId: string): string {
    return `resource:${resourceId}`;
  },
  folder(folderId: string): string {
    return `folder:${folderId}`;
  },
  home(userId: string): string {
    return `home:${userId}`;
  },
};

export function parseRoomName(name: string):
  | { type: "resource" | "folder" | "home"; id: string }
  | null {
  const match = /^(resource|folder|home):([0-9a-f-]{36})$/i.exec(name);
  if (!match) return null;
  const type = match[1];
  const id = match[2];
  if (!type || !id) return null;
  return { type: type as "resource" | "folder" | "home", id };
}

