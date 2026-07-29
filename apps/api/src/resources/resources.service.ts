import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  type CollaboratorRole,
  type CreateResourceInput,
  type InviteCollaboratorInput,
  type ResourceSummary,
  type ShareEntry,
  type UpdateResourceInput,
} from '@fixnote/contracts';
import {
  prisma,
  Prisma,
  ResourceKind as PrismaResourceKind,
  CollaboratorRole as PrismaCollaboratorRole,
} from '@fixnote/database';
import { indexResourceTitle } from '@fixnote/search';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { createHash, randomBytes } from 'node:crypto';

type ResourceWithAccess = Prisma.ResourceGetPayload<{
  include: {
    key: true;
    collaborators: true;
  };
}>;

@Injectable()
export class ResourcesService {
  private readonly logger = new Logger(ResourcesService.name);

  constructor(
    @Inject(CryptoService) private readonly crypto: CryptoService,
    @Inject(ProfilesService) private readonly profiles: ProfilesService,
  ) {}

  async list(
    user: AuthenticatedUser,
    folderId?: string,
  ): Promise<ResourceSummary[]> {
    const profile = await this.profiles.ensure(user);
    const resources = await prisma.resource.findMany({
      where: {
        deletedAt: null,
        ...(folderId ? { folderId } : {}),
        OR: [
          { ownerId: profile.id },
          {
            collaborators: {
              some: { userId: profile.id, revokedAt: null },
            },
          },
        ],
      },
      include: { key: true, collaborators: true },
      orderBy: { updatedAt: 'desc' },
    });

    return resources.map((resource) =>
      this.toSummary(resource, this.roleFor(resource, profile.id)),
    );
  }

  async create(
    user: AuthenticatedUser,
    input: CreateResourceInput,
  ): Promise<ResourceSummary> {
    const profile = await this.profiles.ensure(user);

    if (input.folderId) {
      await this.assertOwnedFolder(profile.id, input.folderId);
    }

    if (input.id) {
      const existing = await prisma.resource.findFirst({
        where: {
          id: input.id,
          ownerId: profile.id,
          deletedAt: null,
        },
        include: { key: true, collaborators: true },
      });
      if (existing) {
        return this.toSummary(existing, 'owner');
      }
    }

    const id = input.id ?? crypto.randomUUID();
    const keyAad = this.crypto.resourceDataKeyAad(id, input.kind);
    const titleAad = this.crypto.resourceFieldAad(id, input.kind, 'title');
    const dataKey = this.crypto.envelope.generateDataKey();
    const wrapped = this.crypto.envelope.wrapDataKey(dataKey, keyAad);
    const encryptedTitle = this.crypto.envelope.encrypt(
      Buffer.from(input.title, 'utf8'),
      dataKey,
      titleAad,
    );
    const titleHash = this.crypto.envelope.hashText(input.title, dataKey);

    const resource = await prisma.$transaction(async (tx) => {
      const created = await tx.resource.create({
        data: {
          id,
          ownerId: profile.id,
          ...(input.folderId !== undefined
            ? { folderId: input.folderId }
            : {}),
          kind: toPrismaKind(input.kind),
          titleCiphertext: dbBytes(encryptedTitle),
          titleHash,
          positionX: input.position?.x ?? 0,
          positionY: input.position?.y ?? 0,
          width: input.size?.width ?? 320,
          height: input.size?.height ?? 220,
        },
      });

      await tx.resourceKey.create({
        data: {
          resourceId: created.id,
          wrappedDek: dbBytes(wrapped),
          keyVersion: this.crypto.keyVersion,
        },
      });

      return tx.resource.findUniqueOrThrow({
        where: { id: created.id },
        include: { key: true, collaborators: true },
      });
    });

    await this.indexTitle(resource, dataKey);
    return this.toSummary(resource, 'owner');
  }

  async update(
    user: AuthenticatedUser,
    resourceId: string,
    input: UpdateResourceInput,
  ): Promise<ResourceSummary> {
    const profile = await this.profiles.ensure(user);
    const resource = await this.findAccessible(resourceId, profile.id);
    const role = this.roleFor(resource, profile.id);

    if (role === 'viewer') {
      throw new ForbiddenException('Viewer access cannot modify this resource');
    }

    if (input.folderId !== undefined) {
      if (role !== 'owner') {
        throw new ForbiddenException(
          'Only the owner can move a resource between personal folders',
        );
      }
      if (input.folderId !== null) {
        await this.assertOwnedFolder(profile.id, input.folderId);
      }
    }

    const data: Prisma.ResourceUpdateInput = {};
    let titleIndex:
      | { dataKey: Buffer; previousTitle: string }
      | undefined;

    if (input.title !== undefined) {
      const dataKey = this.unwrapResourceKey(resource);
      const aad = this.crypto.resourceFieldAad(
        resource.id,
        fromPrismaKind(resource.kind),
        'title',
      );
      data.titleCiphertext = dbBytes(
        this.crypto.envelope.encrypt(
          Buffer.from(input.title, 'utf8'),
          dataKey,
          aad,
        ),
      );
      data.titleHash = this.crypto.envelope.hashText(input.title, dataKey);
      titleIndex = {
        dataKey,
        previousTitle: this.crypto.envelope.decryptText(
          resource.titleCiphertext,
          dataKey,
          aad,
        ),
      };
    }

    if (input.folderId !== undefined) {
      data.folder =
        input.folderId === null
          ? { disconnect: true }
          : { connect: { id: input.folderId } };
    }

    if (input.position) {
      data.positionX = input.position.x;
      data.positionY = input.position.y;
    }

    if (input.size) {
      data.width = input.size.width;
      data.height = input.size.height;
    }

    const updated = await prisma.resource.update({
      where: { id: resourceId },
      data,
      include: { key: true, collaborators: true },
    });

    if (titleIndex) {
      await this.indexTitle(
        updated,
        titleIndex.dataKey,
        titleIndex.previousTitle,
      );
    }
    return this.toSummary(updated, role);
  }

  async listSharing(
    user: AuthenticatedUser,
    resourceId: string,
  ): Promise<ShareEntry[]> {
    const profile = await this.profiles.ensure(user);
    const resource = await this.findOwned(resourceId, profile.id);
    const dataKey = this.unwrapResourceKey(resource);

    const [collaborators, invites] = await Promise.all([
      prisma.resourceAcl.findMany({
        where: { resourceId, revokedAt: null },
        include: { user: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.invite.findMany({
        where: {
          resourceId,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return [
      ...collaborators.flatMap((entry) =>
        entry.user.email
          ? [
              {
                id: entry.userId,
                email: entry.user.email,
                displayName: entry.user.displayName,
                role: fromPrismaRole(entry.role),
                status: 'active' as const,
                invitationUrl: null,
              },
            ]
          : [],
      ),
      ...invites.map((invite) => ({
        id: invite.id,
        email: this.crypto.envelope.decryptText(
          invite.emailCiphertext,
          dataKey,
          this.crypto.resourceFieldAad(
            resource.id,
            fromPrismaKind(resource.kind),
            `invite:${invite.id}:email`,
          ),
        ),
        displayName: null,
        role: fromPrismaRole(invite.role),
        status: 'pending' as const,
        invitationUrl: null,
      })),
    ];
  }

  async invite(
    user: AuthenticatedUser,
    resourceId: string,
    input: InviteCollaboratorInput,
  ): Promise<ShareEntry> {
    const owner = await this.profiles.ensure(user);
    const resource = await this.findOwned(resourceId, owner.id);
    const email = input.email.trim().toLocaleLowerCase();

    if (owner.email?.toLocaleLowerCase() === email) {
      throw new ForbiddenException('The owner already has access');
    }

    const existingProfile = await prisma.profile.findUnique({
      where: { email },
    });
    const role = toPrismaRole(input.role);

    if (existingProfile) {
      await prisma.resourceAcl.upsert({
        where: {
          resourceId_userId: {
            resourceId,
            userId: existingProfile.id,
          },
        },
        create: {
          resourceId,
          userId: existingProfile.id,
          role,
        },
        update: {
          role,
          revokedAt: null,
          acceptedAt: new Date(),
        },
      });
      return {
        id: existingProfile.id,
        email,
        displayName: existingProfile.displayName,
        role: input.role,
        status: 'active',
        invitationUrl: null,
      };
    }

    const inviteId = crypto.randomUUID();
    const rawToken = randomBytes(32).toString('base64url');
    const dataKey = this.unwrapResourceKey(resource);
    const emailCiphertext = this.crypto.envelope.encryptText(
      email,
      dataKey,
      this.crypto.resourceFieldAad(
        resource.id,
        fromPrismaKind(resource.kind),
        `invite:${inviteId}:email`,
      ),
    );

    await prisma.invite.create({
      data: {
        id: inviteId,
        resourceId,
        createdById: owner.id,
        emailHash: stableHash(email),
        emailCiphertext: dbBytes(emailCiphertext),
        tokenHash: stableHash(rawToken),
        role,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000),
      },
    });

    return {
      id: inviteId,
      email,
      displayName: null,
      role: input.role,
      status: 'pending',
      invitationUrl: `fixnote://invite/${rawToken}`,
    };
  }

  async revoke(
    user: AuthenticatedUser,
    resourceId: string,
    profileId: string,
  ): Promise<void> {
    const owner = await this.profiles.ensure(user);
    await this.findOwned(resourceId, owner.id);
    const revokedAt = new Date();
    await prisma.$transaction([
      prisma.resourceAcl.updateMany({
        where: { resourceId, userId: profileId, revokedAt: null },
        data: { revokedAt },
      }),
      prisma.invite.updateMany({
        where: { id: profileId, resourceId, revokedAt: null },
        data: { revokedAt },
      }),
    ]);
  }

  async remove(
    user: AuthenticatedUser,
    resourceId: string,
  ): Promise<void> {
    const profile = await this.profiles.ensure(user);
    const resource = await this.findAccessible(resourceId, profile.id);

    if (resource.ownerId !== profile.id) {
      throw new ForbiddenException('Only the owner can delete a resource');
    }

    await prisma.resource.update({
      where: { id: resourceId },
      data: { deletedAt: new Date() },
    });
  }

  private async findAccessible(
    resourceId: string,
    profileId: string,
  ): Promise<ResourceWithAccess> {
    const resource = await prisma.resource.findFirst({
      where: {
        id: resourceId,
        deletedAt: null,
        OR: [
          { ownerId: profileId },
          {
            collaborators: {
              some: { userId: profileId, revokedAt: null },
            },
          },
        ],
      },
      include: { key: true, collaborators: true },
    });

    if (!resource) {
      throw new NotFoundException('Resource not found');
    }

    return resource;
  }

  private async findOwned(
    resourceId: string,
    ownerId: string,
  ): Promise<ResourceWithAccess> {
    const resource = await prisma.resource.findFirst({
      where: { id: resourceId, ownerId, deletedAt: null },
      include: { key: true, collaborators: true },
    });
    if (!resource) {
      throw new NotFoundException('Owned resource not found');
    }
    return resource;
  }

  private roleFor(
    resource: ResourceWithAccess,
    profileId: string,
  ): CollaboratorRole {
    if (resource.ownerId === profileId) return 'owner';
    const acl = resource.collaborators.find(
      (entry) => entry.userId === profileId && entry.revokedAt === null,
    );
    if (!acl) throw new ForbiddenException('Resource access is missing');
    return fromPrismaRole(acl.role);
  }

  private unwrapResourceKey(resource: ResourceWithAccess): Buffer {
    if (!resource.key) {
      throw new Error(`Resource ${resource.id} is missing its wrapped key`);
    }

    return this.crypto.envelope.unwrapDataKey(
      resource.key.wrappedDek,
      this.crypto.resourceDataKeyAad(
        resource.id,
        fromPrismaKind(resource.kind),
      ),
    );
  }

  private toSummary(
    resource: ResourceWithAccess,
    role: CollaboratorRole,
  ): ResourceSummary {
    const dataKey = this.unwrapResourceKey(resource);
    const title = this.crypto.envelope
      .decrypt(
        resource.titleCiphertext,
        dataKey,
        this.crypto.resourceFieldAad(
          resource.id,
          fromPrismaKind(resource.kind),
          'title',
        ),
      )
      .toString('utf8');

    return {
      id: resource.id,
      ownerId: resource.ownerId,
      kind: resource.kind === PrismaResourceKind.NOTE ? 'note' : 'board',
      title,
      folderId: resource.folderId,
      role,
      position: {
        x: resource.positionX,
        y: resource.positionY,
      },
      size: {
        width: resource.width,
        height: resource.height,
      },
      createdAt: resource.createdAt.toISOString(),
      updatedAt: resource.updatedAt.toISOString(),
    };
  }

  private async assertOwnedFolder(
    profileId: string,
    folderId: string,
  ): Promise<void> {
    const folder = await prisma.folder.findFirst({
      where: { id: folderId, ownerId: profileId, deletedAt: null },
      select: { id: true },
    });

    if (!folder) {
      throw new NotFoundException('Folder not found');
    }
  }

  private async indexTitle(
    resource: ResourceWithAccess,
    dataKey: Buffer,
    previousTitle?: string,
  ): Promise<void> {
    try {
      await indexResourceTitle(resource, dataKey, previousTitle);
    } catch (error) {
      this.logger.error(
        `Search title projection failed for ${resource.id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}

function toPrismaKind(kind: CreateResourceInput['kind']): PrismaResourceKind {
  return kind === 'note'
    ? PrismaResourceKind.NOTE
    : PrismaResourceKind.BOARD;
}

function fromPrismaKind(kind: PrismaResourceKind): CreateResourceInput['kind'] {
  return kind === PrismaResourceKind.NOTE ? 'note' : 'board';
}

function fromPrismaRole(
  role: PrismaCollaboratorRole,
): Exclude<CollaboratorRole, 'owner'> {
  return role === PrismaCollaboratorRole.EDITOR ? 'editor' : 'viewer';
}

function toPrismaRole(role: Exclude<CollaboratorRole, 'owner'>) {
  return role === 'editor'
    ? PrismaCollaboratorRole.EDITOR
    : PrismaCollaboratorRole.VIEWER;
}

function stableHash(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function dbBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(value);
}
