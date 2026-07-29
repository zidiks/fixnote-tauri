import { createHash } from 'node:crypto';
import {
  EnvelopeCrypto,
  createKeyringFromEnv,
  resourceAad,
  searchChunkAad,
} from '@fixnote/crypto';
import {
  Prisma,
  prisma,
  type ResourceKind,
} from '@fixnote/database';
import * as Y from 'yjs';
import {
  projectSearchChunks,
  type SearchProjection,
} from './projection.js';

const envelope = new EnvelopeCrypto(createKeyringFromEnv());
let embeddingsUnavailableUntil = 0;

export interface IndexableResource {
  id: string;
  kind: ResourceKind;
  titleCiphertext: Uint8Array;
}

interface IndexOptions {
  embeddings?: boolean;
}

interface ChangedChunk {
  id: string;
  content: string;
}

export async function indexResourceTitle(
  resource: IndexableResource,
  dataKey: Buffer,
  previousTitle?: string,
  options: IndexOptions = {},
): Promise<void> {
  const kind = resourceKind(resource.kind);
  const title = decryptTitle(resource, dataKey, kind);
  const existing = await prisma.searchChunk.findFirst({
    where: {
      resourceId: resource.id,
      nodeId: null,
      kind: 'document',
    },
  });
  let content = title;

  if (existing && previousTitle !== undefined) {
    const previousContent = envelope.decryptText(
      existing.contentCiphertext,
      dataKey,
      searchChunkAad(
        resource.id,
        kind,
        existing.kind,
        existing.nodeId,
      ),
    );
    if (previousContent === previousTitle) {
      content = title;
    } else if (previousContent.startsWith(`${previousTitle}\n`)) {
      content = `${title}${previousContent.slice(previousTitle.length)}`;
    } else if (resource.kind === 'NOTE') {
      const firstBreak = previousContent.indexOf('\n');
      content = firstBreak >= 0
        ? `${title}${previousContent.slice(firstBreak)}`
        : title;
    }
  }

  const changed = await syncProjections(
    resource,
    dataKey,
    content
      ? [{ nodeId: null, kind: 'document', content }]
      : [],
    ['document'],
  );
  if (options.embeddings) {
    await updateEmbeddings(changed);
  }
}

export async function indexYjsDocument(
  resource: IndexableResource,
  document: Y.Doc,
  dataKey: Buffer,
  options: IndexOptions = { embeddings: true },
): Promise<void> {
  const kind = resourceKind(resource.kind);
  const title = decryptTitle(resource, dataKey, kind);
  const projections = projectSearchChunks(
    document,
    resource.kind,
    title,
  );
  const changed = await syncProjections(
    resource,
    dataKey,
    projections,
    resource.kind === 'BOARD'
      ? ['document', 'board-node']
      : ['document'],
  );
  if (options.embeddings) {
    await updateEmbeddings(changed);
  }
}

export async function indexYjsUpdate(
  resource: IndexableResource,
  update: Uint8Array,
  dataKey: Buffer,
  options: IndexOptions = { embeddings: true },
): Promise<void> {
  const document = new Y.Doc();
  try {
    Y.applyUpdate(document, update);
    await indexYjsDocument(resource, document, dataKey, options);
  } finally {
    document.destroy();
  }
}

async function syncProjections(
  resource: IndexableResource,
  dataKey: Buffer,
  projections: SearchProjection[],
  managedKinds: SearchProjection['kind'][],
): Promise<ChangedChunk[]> {
  const kind = resourceKind(resource.kind);
  const existing = await prisma.searchChunk.findMany({
    where: {
      resourceId: resource.id,
      kind: { in: managedKinds },
    },
  });
  const byKey = new Map(
    existing.map((chunk) => [chunkKey(chunk.kind, chunk.nodeId), chunk]),
  );
  const desiredKeys = new Set(
    projections.map((projection) =>
      chunkKey(projection.kind, projection.nodeId),
    ),
  );

  return prisma.$transaction(async (tx) => {
    const changed: ChangedChunk[] = [];

    for (const projection of projections) {
      const key = chunkKey(projection.kind, projection.nodeId);
      const current = byKey.get(key);
      const hash = sha256(projection.content);
      if (current?.contentHash === hash) continue;

      const ciphertext = envelope.encryptText(
        projection.content,
        dataKey,
        searchChunkAad(
          resource.id,
          kind,
          projection.kind,
          projection.nodeId,
        ),
      );
      const chunk = current
        ? await tx.searchChunk.update({
            where: { id: current.id },
            data: {
              contentHash: hash,
              contentCiphertext: dbBytes(ciphertext),
              projectionVersion: { increment: 1 },
            },
          })
        : await tx.searchChunk.create({
            data: {
              resourceId: resource.id,
              nodeId: projection.nodeId,
              kind: projection.kind,
              contentHash: hash,
              contentCiphertext: dbBytes(ciphertext),
            },
          });

      await tx.$executeRaw(Prisma.sql`
        UPDATE "search_chunks"
        SET
          "searchVector" = to_tsvector('simple', ${projection.content}),
          "embedding" = NULL
        WHERE "id" = ${chunk.id}::uuid
      `);
      changed.push({ id: chunk.id, content: projection.content });
    }

    const obsoleteIds = existing
      .filter(
        (chunk) =>
          managedKinds.includes(
            chunk.kind as SearchProjection['kind'],
          ) &&
          !desiredKeys.has(chunkKey(chunk.kind, chunk.nodeId)),
      )
      .map((chunk) => chunk.id);
    if (obsoleteIds.length) {
      await tx.searchChunk.deleteMany({
        where: { id: { in: obsoleteIds } },
      });
    }

    return changed;
  });
}

async function updateEmbeddings(chunks: ChangedChunk[]): Promise<void> {
  if (!chunks.length || Date.now() < embeddingsUnavailableUntil) return;
  const embeddings = await embedMany(
    chunks.map((chunk) => `passage: ${chunk.content}`),
  );
  if (!embeddings) return;

  const updates = chunks.flatMap((chunk, index) => {
    const embedding = embeddings[index];
    if (!embedding) return [];
    const vector = `[${embedding.join(',')}]`;
    return [
      prisma.$executeRaw(Prisma.sql`
        UPDATE "search_chunks"
        SET "embedding" = ${vector}::"extensions"."vector"
        WHERE "id" = ${chunk.id}::uuid
      `),
    ];
  });
  if (updates.length) {
    await prisma.$transaction(updates);
  }
}

async function embedMany(inputs: string[]): Promise<number[][] | null> {
  if (!process.env.EMBEDDINGS_API_URL || !inputs.length) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_500);
  try {
    const response = await fetch(
      `${process.env.EMBEDDINGS_API_URL.replace(/\/$/, '')}/embed`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inputs, truncate: true }),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      embeddingsUnavailableUntil = Date.now() + 60_000;
      return null;
    }
    const payload = (await response.json()) as unknown;
    const dimensions = Number(
      process.env.EMBEDDINGS_DIMENSIONS ?? '768',
    );
    if (
      Array.isArray(payload) &&
      payload.length === inputs.length &&
      payload.every(
        (embedding) =>
          Array.isArray(embedding) &&
          embedding.length === dimensions &&
          embedding.every((value) => typeof value === 'number'),
      )
    ) {
      return payload as number[][];
    }
    embeddingsUnavailableUntil = Date.now() + 60_000;
    return null;
  } catch {
    embeddingsUnavailableUntil = Date.now() + 60_000;
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function decryptTitle(
  resource: IndexableResource,
  dataKey: Buffer,
  kind: 'note' | 'board',
): string {
  return envelope.decryptText(
    resource.titleCiphertext,
    dataKey,
    resourceAad(resource.id, kind, 'title'),
  );
}

function resourceKind(kind: ResourceKind): 'note' | 'board' {
  return kind === 'NOTE' ? 'note' : 'board';
}

function chunkKey(kind: string, nodeId: string | null): string {
  return `${kind}:${nodeId ?? ''}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function dbBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(value);
}
