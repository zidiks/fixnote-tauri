import { Module } from '@nestjs/common';
import { CryptoModule } from '../crypto/crypto.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { FoldersController } from './folders.controller.js';
import { FoldersService } from './folders.service.js';

@Module({
  imports: [CryptoModule, ProfilesModule],
  controllers: [FoldersController],
  providers: [FoldersService],
})
export class FoldersModule {}
