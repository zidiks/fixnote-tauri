import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Y from 'yjs';
import { projectSearchChunks } from './projection.js';

test('projects a note into one searchable document chunk', () => {
  const document = new Y.Doc();
  const content = document.getXmlFragment('content');
  const paragraph = new Y.XmlElement('p');
  paragraph.insert(0, [new Y.XmlText('Первый абзац')]);
  content.insert(0, [paragraph]);

  assert.deepEqual(
    projectSearchChunks(document, 'NOTE', 'План релиза'),
    [{
      nodeId: null,
      kind: 'document',
      content: 'План релиза\nПервый абзац',
    }],
  );
});

test('projects every textual board shape with its node id', () => {
  const document = new Y.Doc();
  const shapes = document.getMap<Y.Map<unknown>>('shapes');
  const order = document.getArray<string>('order');
  const sticky = new Y.Map<unknown>();
  sticky.set('text', 'Проверить onboarding');
  const line = new Y.Map<unknown>();
  line.set('points', [0, 0, 10, 10]);
  shapes.set('sticky-1', sticky);
  shapes.set('line-1', line);
  order.push(['line-1', 'sticky-1']);

  assert.deepEqual(
    projectSearchChunks(document, 'BOARD', 'Launch map'),
    [
      {
        nodeId: null,
        kind: 'document',
        content: 'Launch map',
      },
      {
        nodeId: 'sticky-1',
        kind: 'board-node',
        content: 'Проверить onboarding',
      },
    ],
  );
});
