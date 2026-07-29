import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthModule } from "./auth/auth.module.js";
import { SupabaseAuthGuard } from "./auth/supabase-auth.guard.js";
import { CryptoModule } from "./crypto/crypto.module.js";
import { FoldersModule } from "./folders/folders.module.js";
import { HealthController } from "./health.controller.js";
import { ProfilesModule } from "./profiles/profiles.module.js";
import { ResourcesModule } from "./resources/resources.module.js";
import { InvitesModule } from "./invites/invites.module.js";
import { SearchModule } from "./search/search.module.js";
import { AiModule } from "./ai/ai.module.js";
import { LinksModule } from "./links/links.module.js";

@Module({
  imports: [
    AuthModule,
    CryptoModule,
    ProfilesModule,
    FoldersModule,
    ResourcesModule,
    InvitesModule,
    SearchModule,
    AiModule,
    LinksModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: SupabaseAuthGuard,
    },
  ],
})
export class AppModule {}
