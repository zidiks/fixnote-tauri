import { Injectable } from "@nestjs/common";
import { prisma } from "@fixnote/database";
import type { AuthenticatedUser } from "../auth/auth.types.js";

@Injectable()
export class ProfilesService {
  ensure(user: AuthenticatedUser) {
    return prisma.profile.upsert({
      where: { id: user.id },
      create: {
        id: user.id,
        email: user.email ?? null,
        displayName: user.displayName ?? null,
      },
      update: {
        ...(user.email ? { email: user.email } : {}),
        ...(user.displayName ? { displayName: user.displayName } : {}),
      },
    });
  }
}
