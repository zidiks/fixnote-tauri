import * as Y from 'yjs';

export interface SearchProjection {
  nodeId: string | null;
  kind: 'document' | 'board-node';
  content: string;
}

export function projectSearchChunks(
  document: Y.Doc,
  resourceKind: 'NOTE' | 'BOARD',
  title: string,
): SearchProjection[] {
  const normalizedTitle = normalizeText(title, 240);

  if (resourceKind === 'NOTE') {
    const body = stripMarkup(
      document.getXmlFragment('content').toString(),
    );
    const content = [normalizedTitle, body]
      .filter(Boolean)
      .join('\n')
      .trim();
    return content
      ? [{ nodeId: null, kind: 'document', content }]
      : [];
  }

  const chunks: SearchProjection[] = normalizedTitle
    ? [{
        nodeId: null,
        kind: 'document',
        content: normalizedTitle,
      }]
    : [];
  const shapes = document.getMap<Y.Map<unknown>>('shapes');
  const order = document.getArray<string>('order').toArray();
  const orderedIds = [
    ...order,
    ...[...shapes.keys()]
      .filter((id) => !order.includes(id))
      .sort(),
  ];

  for (const id of orderedIds) {
    const shape = shapes.get(id);
    const text = shape?.get('text');
    if (typeof text !== 'string') continue;
    const content = normalizeText(text, 8_000);
    if (!content) continue;
    chunks.push({
      nodeId: id,
      kind: 'board-node',
      content,
    });
  }

  return chunks;
}

export function stripMarkup(value: string): string {
  return normalizeText(
    value
      .replace(/<[^>]+>/g, ' ')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'")
      .replaceAll('&nbsp;', ' ')
      .replaceAll('&amp;', '&'),
    50_000,
  );
}

function normalizeText(value: string, maxLength: number): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}
