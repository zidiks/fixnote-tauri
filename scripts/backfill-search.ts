import '../apps/api/src/env.js';
import {
  EnvelopeCrypto,
  createKeyringFromEnv,
  documentAad,
  resourceAad,
} from '../packages/crypto/src/index.js';
import {
  ResourceKind,
  prisma,
} from '../packages/database/src/index.js';
import {
  indexResourceTitle,
  indexYjsUpdate,
} from '../packages/search/src/index.js';

const envelope = new EnvelopeCrypto(createKeyringFromEnv());

async function main(): Promise<void> {
  const resources = await prisma.resource.findMany({
    where: { deletedAt: null },
    include: { key: true, state: true },
    orderBy: { id: 'asc' },
  });
  let documents = 0;
  let titleOnly = 0;

  for (const resource of resources) {
    if (!resource.key) {
      throw new Error(`Resource ${resource.id} is missing its wrapped DEK`);
    }
    const kind = resource.kind === ResourceKind.NOTE ? 'note' : 'board';
    const dataKey = envelope.unwrapDataKey(
      resource.key.wrappedDek,
      resourceAad(resource.id, kind, 'dek'),
    );

    if (resource.state) {
      const update = envelope.decrypt(
        resource.state.ciphertext,
        dataKey,
        documentAad(
          resource.state.documentName,
          resource.state.schemaVersion,
        ),
      );
      await indexYjsUpdate(resource, update, dataKey, {
        embeddings: true,
      });
      documents += 1;
    } else {
      await indexResourceTitle(resource, dataKey, undefined, {
        embeddings: true,
      });
      titleOnly += 1;
    }
  }

  const grouped = await prisma.searchChunk.groupBy({
    by: ['kind'],
    where: {
      resource: { deletedAt: null },
    },
    _count: { _all: true },
    orderBy: { kind: 'asc' },
  });
  const withoutVector = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*)::bigint AS "count"
    FROM "search_chunks"
    WHERE "searchVector" IS NULL
  `;

  process.stdout.write(
    `${JSON.stringify({
      resources: resources.length,
      documents,
      titleOnly,
      chunks: Object.fromEntries(
        grouped.map((entry) => [entry.kind, entry._count._all]),
      ),
      chunksWithoutSearchVector: Number(withoutVector[0]?.count ?? 0),
    })}\n`,
  );
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack : String(error)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
