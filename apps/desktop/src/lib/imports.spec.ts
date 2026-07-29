import assert from 'node:assert/strict';
import test from 'node:test';
import {
  candidatesFromText,
  classifyFile,
  classifyLink,
} from './imports.js';

test('classifies common link families', () => {
  assert.equal(classifyLink(new URL('https://youtu.be/dQw4w9WgXcQ')), 'youtube');
  assert.equal(classifyLink(new URL('https://github.com/openai/codex')), 'code');
  assert.equal(classifyLink(new URL('https://example.com/report.pdf')), 'document');
  assert.equal(classifyLink(new URL('https://example.com/blog/a-story')), 'article');
});

test('splits a clipboard list of URLs but keeps prose together', () => {
  assert.deepEqual(candidatesFromText('https://a.test\nhttps://b.test'), [
    { kind: 'link', url: 'https://a.test' },
    { kind: 'link', url: 'https://b.test' },
  ]);
  assert.deepEqual(candidatesFromText('A thought\nwith two lines'), [
    { kind: 'text', text: 'A thought\nwith two lines' },
  ]);
});

test('classifies files by mime type and extension', () => {
  assert.equal(classifyFile({ name: 'photo.png', type: 'image/png' }), 'image');
  assert.equal(classifyFile({ name: 'notes.md', type: '' }), 'text');
  assert.equal(classifyFile({ name: 'deck.pptx', type: '' }), 'document');
  assert.equal(classifyFile({ name: 'backup.zip', type: '' }), 'archive');
});
