import { EnvelopeCrypto, createKeyringFromEnv, documentAad, resourceAad } from '@fixnote/crypto';
import {
  CollaboratorRole,
  prisma,
  type ResourceKind,
} from '@fixnote/database';
import { parseRoomName } from '@fixnote/sync';
import * as Y from 'yjs';
import { indexDocument } from './indexing.js';

const keyring = createKeyringFromEnv();
const envelope = new EnvelopeCrypto(keyring);

export type AccessLevel = 'owner' | 'editor' | 'viewer';

export async function authorizeRoom(
  documentName: string,
  userId: string,
): Promise<AccessLevel> {
  const room = parseRoomName(documentName);
  if (!room || room.type !== 'resource') {
    throw new Error('Only resource collaboration rooms are enabled');
  }

  const resource = await prisma.resource.findFirst({
    where: {
      id: room.id,
      deletedAt: null,
      OR: [
        { ownerId: userId },
        {
          collaborators: {
            some: { userId, revokedAt: null },
          },
        },
      ],
    },
    select: {
      ownerId: true,
      collaborators: {
        where: { userId, revokedAt: null },
        select: { role: true },
      },
    },
  });

  if (!resource) throw new Error('Resource access denied');
  if (resource.ownerId === userId) return 'owner';
  return resource.collaborators[0]?.role === CollaboratorRole.EDITOR
    ? 'editor'
    : 'viewer';
}

export async function loadEncryptedDocument(
  documentName: string,
): Promise<Y.Doc | null> {
  const room = requireResourceRoom(documentName);
  const [resource, state] = await Promise.all([
    prisma.resource.findUnique({
      where: { id: room.id },
      include: { key: true },
    }),
    prisma.encryptedYjsState.findUnique({
      where: { documentName },
    }),
  ]);

  if (!resource || !resource.key || !state) return null;

  const dataKey = envelope.unwrapDataKey(
    resource.key.wrappedDek,
    resourceKeyAad(resource.id, resource.kind),
  );
  const update = envelope.decrypt(
    state.ciphertext,
    dataKey,
    documentAad(documentName, state.schemaVersion),
  );
  const document = new Y.Doc();
  Y.applyUpdate(document, update);
  return document;
}

export async function storeEncryptedDocument(
  documentName: string,
  document: Y.Doc,
): Promise<void> {
  const room = requireResourceRoom(documentName);
  const resource = await prisma.resource.findUnique({
    where: { id: room.id },
    include: { key: true },
  });

  if (!resource || !resource.key || resource.deletedAt) {
    throw new Error('Cannot persist a missing resource');
  }

  const dataKey = envelope.unwrapDataKey(
    resource.key.wrappedDek,
    resourceKeyAad(resource.id, resource.kind),
  );
  const update = Y.encodeStateAsUpdate(document);
  const ciphertext = envelope.encrypt(
    update,
    dataKey,
    documentAad(documentName),
  );
  const stateVector = Y.encodeStateVector(document);

  await prisma.encryptedYjsState.upsert({
    where: { documentName },
    create: {
      documentName,
      resourceId: resource.id,
      ownerId: resource.ownerId,
      ciphertext: dbBytes(ciphertext),
      stateVector: dbBytes(stateVector),
    },
    update: {
      ciphertext: dbBytes(ciphertext),
      stateVector: dbBytes(stateVector),
      revision: { increment: 1 },
    },
  });

  try {
    await indexDocument(resource, document, dataKey);
  } catch (error) {
    console.error('Search projection failed', error);
  }
}

function requireResourceRoom(documentName: string) {
  const room = parseRoomName(documentName);
  if (!room || room.type !== 'resource') {
    throw new Error('Invalid resource room name');
  }
  return room;
}

function resourceKeyAad(id: string, kind: ResourceKind): string {
  return resourceAad(
    id,
    kind === 'NOTE' ? 'note' : 'board',
    'dek',
  );
}

function dbBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(value);
}
