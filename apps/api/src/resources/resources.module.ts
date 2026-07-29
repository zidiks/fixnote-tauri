import { Module } from '@nestjs/common';
import { CryptoModule } from '../crypto/crypto.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { ResourcesController } from './resources.controller.js';
import { ResourcesService } from './resources.service.js';

@Module({
  imports: [CryptoModule, ProfilesModule],
  controllers: [ResourcesController],
  providers: [ResourcesService],
  exports: [ResourcesService],
})
export class ResourcesModule {}
