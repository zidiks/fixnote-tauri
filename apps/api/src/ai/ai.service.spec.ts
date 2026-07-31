import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectAiProposal } from './ai.service.js';

test('detects a create-note proposal and keeps quoted title', () => {
  assert.deepEqual(
    detectAiProposal('Создай заметку «План релиза»'),
    {
      type: 'create_note',
      title: 'План релиза',
      content: null,
      summary: null,
    },
  );
});

test('turns captured voice text into a note draft', () => {
  assert.deepEqual(
    detectAiProposal('Обсудить план релиза с командой', undefined, true),
    {
      type: 'create_note',
      title: 'Новая мысль из AI-чата',
      content: 'Обсудить план релиза с командой',
      summary: null,
    },
  );
});

test('keeps note body separate from an explicit quoted title', () => {
  assert.deepEqual(
    detectAiProposal('Создай заметку «План релиза»:\n- Проверить CI\n- Выпустить сборку'),
    {
      type: 'create_note',
      title: 'План релиза',
      content: '- Проверить CI\n- Выпустить сборку',
      summary: null,
    },
  );
});

test('detects a resource rename only inside a resource scope', () => {
  const resourceId = '0b86f5c2-f83e-44cb-9260-eedbdd4c4f76';
  assert.deepEqual(
    detectAiProposal('Переименуй в «Итоги встречи»', resourceId),
    {
      type: 'rename_resource',
      title: 'Итоги встречи',
      resourceId,
    },
  );
  assert.equal(
    detectAiProposal('Переименуй в «Итоги встречи»'),
    null,
  );
});

test('does not turn an ordinary RAG question into an action', () => {
  assert.equal(
    detectAiProposal('Что я писал про создание заметок?'),
    null,
  );
});
