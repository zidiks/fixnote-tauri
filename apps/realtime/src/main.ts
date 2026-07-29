import './env.js';
import { Server } from '@hocuspocus/server';
import { prisma } from '@fixnote/database';
import { authenticateToken } from './auth.js';
import {
  authorizeRoom,
  loadEncryptedDocument,
  storeEncryptedDocument,
} from './storage.js';

if (process.env.NODE_ENV === 'production' && process.env.AUTH_MODE === 'mock') {
  throw new Error('AUTH_MODE=mock is forbidden in production');
}

const port = Number(process.env.REALTIME_PORT ?? 4001);

const server = new Server({
  port,
  address: process.env.REALTIME_HOST ?? '127.0.0.1',
  quiet: true,
  debounce: 1_500,
  maxDebounce: 10_000,

  async onAuthenticate({ token, documentName, connectionConfig }) {
    const user = await authenticateToken(token);
    await prisma.profile.upsert({
      where: { id: user.id },
      create: {
        id: user.id,
        email: user.email ?? null,
      },
      update: user.email ? { email: user.email } : {},
    });
    const access = await authorizeRoom(documentName, user.id);
    connectionConfig.readOnly = access === 'viewer';
    return { userId: user.id, access };
  },

  async onLoadDocument({ documentName }) {
    return loadEncryptedDocument(documentName);
  },

  async onStoreDocument({ documentName, document }) {
    await storeEncryptedDocument(documentName, document);
  },

  async onRequest({ request, response }) {
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok', service: 'realtime' }));
    }
  },
});

await server.listen();
console.log(`FixNote realtime listening on ${server.webSocketURL}`);
