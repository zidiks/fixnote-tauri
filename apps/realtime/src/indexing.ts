import { createHash } from 'node:crypto';
import { EnvelopeCrypto, createKeyringFromEnv, resourceAad } from '@fixnote/crypto';
import {
  Prisma,
  prisma,
  type ResourceKind,
} from '@fixnote/database';
import * as Y from 'yjs';

const envelope = new EnvelopeCrypto(createKeyringFromEnv());

interface IndexableResource {
  id: string;
  kind: ResourceKind;
  titleCiphertext: Uint8Array;
}

export async function indexDocument(
  resource: IndexableResource,
  document: Y.Doc,
  dataKey: Buffer,
): Promise<void> {
  const kind = resource.kind === 'NOTE' ? 'note' : 'board';
  const title = envelope.decryptText(
    resource.titleCiphertext,
    dataKey,
    resourceAad(resource.id, kind, 'title'),
  );
  const body = projectText(document);
  const content = [title, body].filter(Boolean).join('\n').trim();
  if (!content) return;

  const contentHash = createHash('sha256')
    .update(content, 'utf8')
    .digest('hex');
  const existing = await prisma.searchChunk.findFirst({
    where: {
      resourceId: resource.id,
      nodeId: null,
      kind: 'document',
    },
    select: { id: true, contentHash: true },
  });

  if (existing?.contentHash === contentHash) return;

  const ciphertext = envelope.encryptText(
    content,
    dataKey,
    resourceAad(
      resource.id,
      kind,
      'search:document',
    ),
  );

  const chunk = existing
    ? await prisma.searchChunk.update({
        where: { id: existing.id },
        data: {
          contentHash,
          contentCiphertext: dbBytes(ciphertext),
          projectionVersion: { increment: 1 },
        },
      })
    : await prisma.searchChunk.create({
        data: {
          resourceId: resource.id,
          nodeId: null,
          kind: 'document',
          contentHash,
          contentCiphertext: dbBytes(ciphertext),
        },
      });

  await prisma.$executeRaw`
    UPDATE "search_chunks"
    SET "searchVector" = to_tsvector('simple', ${content})
    WHERE "id" = ${chunk.id}::uuid
  `;

  const embedding = await embed(`passage: ${content}`);
  if (embedding) {
    const vector = `[${embedding.join(',')}]`;
    await prisma.$executeRaw`
      UPDATE "search_chunks"
      SET "embedding" = ${vector}::vector
      WHERE "id" = ${chunk.id}::uuid
    `;
  }
}

function projectText(document: Y.Doc): string {
  const fragments: string[] = [];
  const note = document.getXmlFragment('content').toString();
  if (note) fragments.push(stripMarkup(note));

  const shapes = document.getMap<Y.Map<unknown>>('shapes');
  shapes.forEach((shape) => {
    const text = shape.get('text');
    if (typeof text === 'string') fragments.push(text);
  });

  return fragments
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50_000);
}

function stripMarkup(value: string) {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

async function embed(input: string): Promise<number[] | null> {
  if (!process.env.EMBEDDINGS_API_URL) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(
      `${process.env.EMBEDDINGS_API_URL.replace(/\/$/, '')}/embed`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inputs: [input], truncate: true }),
        signal: controller.signal,
      },
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as unknown;
    if (
      Array.isArray(payload) &&
      Array.isArray(payload[0]) &&
      payload[0].every((value) => typeof value === 'number')
    ) {
      return payload[0] as number[];
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function dbBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(value);
}
