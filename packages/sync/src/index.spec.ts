import assert from "node:assert/strict";
import { test } from "node:test";
import * as Y from "yjs";
import { createNoteDocument, parseRoomName, roomNames } from "./index.js";

test("offline Yjs updates converge in either order", () => {
  const first = createNoteDocument();
  const second = createNoteDocument();
  first.title.insert(0, "Fix");
  second.title.insert(0, "Note");

  const firstUpdate = Y.encodeStateAsUpdate(first.document);
  const secondUpdate = Y.encodeStateAsUpdate(second.document);
  Y.applyUpdate(first.document, secondUpdate);
  Y.applyUpdate(second.document, firstUpdate);

  assert.equal(first.title.toString(), second.title.toString());
});

test("builds and parses resource room names", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  assert.deepEqual(parseRoomName(roomNames.resource(id)), { type: "resource", id });
});

