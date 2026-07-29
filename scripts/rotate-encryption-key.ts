import '../apps/api/src/env.js';
import {
  EnvelopeCrypto,
  createKeyringFromEnv,
  folderAad,
  profileAad,
  resourceAad,
} from '../packages/crypto/src/index.js';
import {
  ResourceKind,
  prisma,
} from '../packages/database/src/index.js';

const KEY_BYTES = 32;
const KEY_VERSION = 1;

async function main(): Promise<void> {
  const encodedNewKey = process.env.NEW_FIXNOTE_KEK_V1?.trim();
  if (!encodedNewKey) {
    throw new Error('NEW_FIXNOTE_KEK_V1 is required');
  }

  const newKey = Buffer.from(encodedNewKey, 'base64');
  if (newKey.length !== KEY_BYTES) {
    throw new Error('NEW_FIXNOTE_KEK_V1 must decode to exactly 32 bytes');
  }

  const oldEnvelope = new EnvelopeCrypto(
    createKeyringFromEnv({
      ...process.env,
      NODE_ENV: 'development',
      FIXNOTE_KEK_VERSION: String(KEY_VERSION),
      FIXNOTE_KEK_V1: '',
    }),
  );
  const newEnvelope = new EnvelopeCrypto({
    activeVersion: KEY_VERSION,
    keys: new Map([[KEY_VERSION, newKey]]),
  });

  const [resources, folders, profiles, assetCount] = await Promise.all([
    prisma.resource.findMany({
      include: { key: true },
      orderBy: { id: 'asc' },
    }),
    prisma.folder.findMany({ orderBy: { id: 'asc' } }),
    prisma.profile.findMany({
      where: { homeWrappedDek: { not: null } },
      orderBy: { id: 'asc' },
    }),
    prisma.asset.count(),
  ]);

  if (assetCount > 0) {
    throw new Error(
      `Refusing KEK rewrap: ${assetCount} asset key(s) use an unverified AAD contract`,
    );
  }

  const resourceUpdates = resources.map((resource) => {
    if (!resource.key) {
      throw new Error(`Resource ${resource.id} is missing its wrapped DEK`);
    }
    const kind = resource.kind === ResourceKind.NOTE ? 'note' : 'board';
    const keyAad = resourceAad(resource.id, kind, 'dek');
    const dataKey = oldEnvelope.unwrapDataKey(
      resource.key.wrappedDek,
      keyAad,
    );
    oldEnvelope.decryptText(
      resource.titleCiphertext,
      dataKey,
      resourceAad(resource.id, kind, 'title'),
    );
    return {
      id: resource.id,
      aad: keyAad,
      wrappedDek: newEnvelope.wrapDataKey(dataKey, keyAad),
    };
  });

  const folderUpdates = folders.map((folder) => {
    const keyAad = folderAad(folder.id, 'dek');
    const dataKey = oldEnvelope.unwrapDataKey(folder.wrappedDek, keyAad);
    oldEnvelope.decryptText(
      folder.nameCiphertext,
      dataKey,
      folderAad(folder.id, 'name'),
    );
    return {
      id: folder.id,
      aad: keyAad,
      wrappedDek: newEnvelope.wrapDataKey(dataKey, keyAad),
    };
  });

  const profileUpdates = profiles.map((profile) => {
    if (!profile.homeWrappedDek) {
      throw new Error(`Profile ${profile.id} is missing its home DEK`);
    }
    const keyAad = profileAad(profile.id, 'home:dek');
    const dataKey = oldEnvelope.unwrapDataKey(
      profile.homeWrappedDek,
      keyAad,
    );
    return {
      id: profile.id,
      aad: keyAad,
      wrappedDek: newEnvelope.wrapDataKey(dataKey, keyAad),
    };
  });

  await prisma.$transaction(async (tx) => {
    for (const resource of resourceUpdates) {
      await tx.resourceKey.update({
        where: { resourceId: resource.id },
        data: {
          wrappedDek: dbBytes(resource.wrappedDek),
          keyVersion: KEY_VERSION,
        },
      });
    }
    for (const folder of folderUpdates) {
      await tx.folder.update({
        where: { id: folder.id },
        data: {
          wrappedDek: dbBytes(folder.wrappedDek),
          keyVersion: KEY_VERSION,
        },
      });
    }
    for (const profile of profileUpdates) {
      await tx.profile.update({
        where: { id: profile.id },
        data: {
          homeWrappedDek: dbBytes(profile.wrappedDek),
          homeKeyVersion: KEY_VERSION,
        },
      });
    }
  });

  const [rewrappedResources, rewrappedFolders, rewrappedProfiles] =
    await Promise.all([
      prisma.resourceKey.findMany({
        where: { resourceId: { in: resourceUpdates.map(({ id }) => id) } },
      }),
      prisma.folder.findMany({
        where: { id: { in: folderUpdates.map(({ id }) => id) } },
      }),
      prisma.profile.findMany({
        where: { id: { in: profileUpdates.map(({ id }) => id) } },
      }),
    ]);

  for (const row of rewrappedResources) {
    const expected = resourceUpdates.find(({ id }) => id === row.resourceId);
    if (!expected) throw new Error(`Unexpected resource key ${row.resourceId}`);
    newEnvelope.unwrapDataKey(row.wrappedDek, expected.aad);
  }
  for (const row of rewrappedFolders) {
    const expected = folderUpdates.find(({ id }) => id === row.id);
    if (!expected) throw new Error(`Unexpected folder key ${row.id}`);
    newEnvelope.unwrapDataKey(row.wrappedDek, expected.aad);
  }
  for (const row of rewrappedProfiles) {
    const expected = profileUpdates.find(({ id }) => id === row.id);
    if (!expected || !row.homeWrappedDek) {
      throw new Error(`Unexpected profile key ${row.id}`);
    }
    newEnvelope.unwrapDataKey(row.homeWrappedDek, expected.aad);
  }

  process.stdout.write(
    `${JSON.stringify({
      resources: resourceUpdates.length,
      folders: folderUpdates.length,
      profiles: profileUpdates.length,
      keyVersion: KEY_VERSION,
    })}\n`,
  );
}

function dbBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(value);
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
