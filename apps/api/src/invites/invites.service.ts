import {
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AcceptInviteResult } from '@fixnote/contracts';
import {
  CollaboratorRole,
  prisma,
} from '@fixnote/database';
import { createHash } from 'node:crypto';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { ProfilesService } from '../profiles/profiles.service.js';

@Injectable()
export class InvitesService {
  constructor(@Inject(ProfilesService) private readonly profiles: ProfilesService) {}

  async accept(
    user: AuthenticatedUser,
    rawToken: string,
  ): Promise<AcceptInviteResult> {
    const profile = await this.profiles.ensure(user);
    if (!profile.email) {
      throw new ForbiddenException('An email address is required');
    }

    const invite = await prisma.invite.findUnique({
      where: { tokenHash: stableHash(rawToken) },
    });
    if (!invite) throw new NotFoundException('Invite not found');
    if (
      invite.revokedAt ||
      invite.acceptedAt ||
      invite.expiresAt <= new Date()
    ) {
      throw new GoneException('Invite is no longer active');
    }
    if (invite.emailHash !== stableHash(profile.email.toLocaleLowerCase())) {
      throw new ForbiddenException(
        'This invite belongs to another email address',
      );
    }

    await prisma.$transaction([
      prisma.resourceAcl.upsert({
        where: {
          resourceId_userId: {
            resourceId: invite.resourceId,
            userId: profile.id,
          },
        },
        create: {
          resourceId: invite.resourceId,
          userId: profile.id,
          role: invite.role,
        },
        update: {
          role: invite.role,
          revokedAt: null,
          acceptedAt: new Date(),
        },
      }),
      prisma.invite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      }),
    ]);

    return {
      resourceId: invite.resourceId,
      role:
        invite.role === CollaboratorRole.EDITOR ? 'editor' : 'viewer',
    };
  }
}

function stableHash(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
