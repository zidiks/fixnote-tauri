import { Injectable, NotFoundException } from '@nestjs/common';
import {
  type CreateFolderInput,
  type FolderSummary,
} from '@fixnote/contracts';
import { prisma, type Folder } from '@fixnote/database';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';

type FolderWithKey = Folder;

@Injectable()
export class FoldersService {
  constructor(
    private readonly crypto: CryptoService,
    private readonly profiles: ProfilesService,
  ) {}

  async list(user: AuthenticatedUser): Promise<FolderSummary[]> {
    const profile = await this.profiles.ensure(user);
    const folders = await prisma.folder.findMany({
      where: { ownerId: profile.id, deletedAt: null },
      orderBy: [{ parentId: 'asc' }, { createdAt: 'asc' }],
    });

    return folders.map((folder) => this.toSummary(folder));
  }

  async create(
    user: AuthenticatedUser,
    input: CreateFolderInput,
  ): Promise<FolderSummary> {
    const profile = await this.profiles.ensure(user);

    if (input.parentId) {
      const parent = await prisma.folder.findFirst({
        where: {
          id: input.parentId,
          ownerId: profile.id,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!parent) throw new NotFoundException('Parent folder not found');
    }

    const id = input.id ?? crypto.randomUUID();
    const keyAad = this.crypto.folderDataKeyAad(id);
    const nameAad = this.crypto.folderFieldAad(id, 'name');
    const dataKey = this.crypto.envelope.generateDataKey();
    const wrapped = this.crypto.envelope.wrapDataKey(dataKey, keyAad);
    const encryptedName = this.crypto.envelope.encrypt(
      Buffer.from(input.name, 'utf8'),
      dataKey,
      nameAad,
    );

    const folder = await prisma.$transaction(async (tx) => {
      const created = await tx.folder.create({
        data: {
          id,
          ownerId: profile.id,
          ...(input.parentId !== undefined
            ? { parentId: input.parentId }
            : {}),
          nameCiphertext: dbBytes(encryptedName),
          wrappedDek: dbBytes(wrapped),
          keyVersion: this.crypto.keyVersion,
        },
      });

      return tx.folder.findUniqueOrThrow({
        where: { id: created.id },
      });
    });

    return this.toSummary(folder);
  }

  private toSummary(folder: FolderWithKey): FolderSummary {
    const dataKey = this.crypto.envelope.unwrapDataKey(
      folder.wrappedDek,
      this.crypto.folderDataKeyAad(folder.id),
    );
    const name = this.crypto.envelope
      .decrypt(
        folder.nameCiphertext,
        dataKey,
        this.crypto.folderFieldAad(folder.id, 'name'),
      )
      .toString('utf8');

    return {
      id: folder.id,
      parentId: folder.parentId,
      name,
      ownerId: folder.ownerId,
      createdAt: folder.createdAt.toISOString(),
      updatedAt: folder.updatedAt.toISOString(),
    };
  }
}

function dbBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(value);
}
