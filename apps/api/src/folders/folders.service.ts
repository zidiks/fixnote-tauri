import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type CreateFolderInput,
  type FolderSummary,
  type UpdateFolderInput,
} from '@fixnote/contracts';
import { prisma, type Folder } from '@fixnote/database';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';

type FolderWithKey = Folder;

@Injectable()
export class FoldersService {
  constructor(
    @Inject(CryptoService) private readonly crypto: CryptoService,
    @Inject(ProfilesService) private readonly profiles: ProfilesService,
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
          ...(input.position
            ? { positionX: input.position.x, positionY: input.position.y }
            : {}),
          ...(input.color ? { color: input.color } : {}),
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

  async update(
    user: AuthenticatedUser,
    folderId: string,
    input: UpdateFolderInput,
  ): Promise<FolderSummary> {
    const profile = await this.profiles.ensure(user);
    const folder = await this.findOwned(folderId, profile.id);
    if (input.parentId === folder.id) {
      throw new NotFoundException('A folder cannot contain itself');
    }
    if (input.parentId) {
      await this.findOwned(input.parentId, profile.id);
      if (await this.isDescendant(input.parentId, folder.id, profile.id)) {
        throw new NotFoundException('A folder cannot contain one of its ancestors');
      }
    }
    const data =
      input.name === undefined
        ? {
            ...(input.color !== undefined ? { color: input.color } : {}),
            ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
            ...(input.position ? { positionX: input.position.x, positionY: input.position.y } : {}),
          }
        : {
            ...(input.color !== undefined ? { color: input.color } : {}),
            nameCiphertext: dbBytes(
              this.crypto.envelope.encrypt(
                Buffer.from(input.name, 'utf8'),
                this.crypto.envelope.unwrapDataKey(
                  folder.wrappedDek,
                  this.crypto.folderDataKeyAad(folder.id),
                ),
                this.crypto.folderFieldAad(folder.id, 'name'),
              ),
            ),
            ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
            ...(input.position ? { positionX: input.position.x, positionY: input.position.y } : {}),
          };
    const updated = await prisma.folder.update({
      where: { id: folder.id },
      data,
    });
    return this.toSummary(updated);
  }

  async remove(user: AuthenticatedUser, folderId: string): Promise<void> {
    const profile = await this.profiles.ensure(user);
    await this.findOwned(folderId, profile.id);
    await prisma.$transaction([
      prisma.resource.updateMany({
        where: { ownerId: profile.id, folderId },
        data: { folderId: null },
      }),
      prisma.folder.updateMany({
        where: { ownerId: profile.id, parentId: folderId, deletedAt: null },
        data: { parentId: null },
      }),
      prisma.folder.update({
        where: { id: folderId },
        data: { deletedAt: new Date() },
      }),
    ]);
  }

  private async findOwned(folderId: string, ownerId: string): Promise<Folder> {
    const folder = await prisma.folder.findFirst({
      where: { id: folderId, ownerId, deletedAt: null },
    });
    if (!folder) throw new NotFoundException('Folder not found');
    return folder;
  }

  private async isDescendant(folderId: string, ancestorId: string, ownerId: string): Promise<boolean> {
    let currentId: string | null = folderId;
    while (currentId) {
      if (currentId === ancestorId) return true;
      const current: { parentId: string | null } | null = await prisma.folder.findFirst({
        where: { id: currentId, ownerId, deletedAt: null },
        select: { parentId: true },
      });
      currentId = current?.parentId ?? null;
    }
    return false;
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
      position: { x: folder.positionX, y: folder.positionY },
      name,
      color: folder.color as FolderSummary['color'],
      ownerId: folder.ownerId,
      createdAt: folder.createdAt.toISOString(),
      updatedAt: folder.updatedAt.toISOString(),
    };
  }
}

function dbBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(value);
}
