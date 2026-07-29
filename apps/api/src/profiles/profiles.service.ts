import { Inject, Injectable } from "@nestjs/common";
import { prisma, type Profile } from "@fixnote/database";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { CryptoService } from "../crypto/crypto.service.js";

@Injectable()
export class ProfilesService {
  constructor(
    @Inject(CryptoService) private readonly crypto: CryptoService,
  ) {}

  async ensure(user: AuthenticatedUser): Promise<Profile> {
    const homeKey = this.crypto.envelope.generateDataKey();
    const wrappedHomeKey = this.crypto.envelope.wrapDataKey(
      homeKey,
      this.crypto.profileFieldAad(user.id, "home:dek"),
    );
    let profile = await prisma.profile.upsert({
      where: { id: user.id },
      create: {
        id: user.id,
        email: user.email ?? null,
        displayName: user.displayName ?? null,
        homeWrappedDek: dbBytes(wrappedHomeKey),
        homeKeyVersion: this.crypto.keyVersion,
      },
      update: {
        ...(user.email ? { email: user.email } : {}),
        ...(user.displayName ? { displayName: user.displayName } : {}),
      },
    });

    if (!profile.homeWrappedDek) {
      await prisma.profile.updateMany({
        where: { id: profile.id, homeWrappedDek: null },
        data: {
          homeWrappedDek: dbBytes(wrappedHomeKey),
          homeKeyVersion: this.crypto.keyVersion,
        },
      });
      profile = await prisma.profile.findUniqueOrThrow({
        where: { id: profile.id },
      });
    }

    return profile;
  }

  unwrapHomeKey(profile: Profile): Buffer {
    if (!profile.homeWrappedDek) {
      throw new Error(`Profile ${profile.id} is missing its wrapped home key`);
    }
    return this.crypto.envelope.unwrapDataKey(
      profile.homeWrappedDek,
      this.crypto.profileFieldAad(profile.id, "home:dek"),
    );
  }
}

function dbBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(value);
}
