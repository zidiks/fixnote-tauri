import { Global, Module } from "@nestjs/common";
import { ProfilesService } from "./profiles.service.js";

@Global()
@Module({
  providers: [ProfilesService],
  exports: [ProfilesService],
})
export class ProfilesModule {}

