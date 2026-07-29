import { Global, Module } from "@nestjs/common";
import { CryptoModule } from "../crypto/crypto.module.js";
import { ProfilesService } from "./profiles.service.js";

@Global()
@Module({
  imports: [CryptoModule],
  providers: [ProfilesService],
  exports: [ProfilesService],
})
export class ProfilesModule {}
