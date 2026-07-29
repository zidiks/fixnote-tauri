import { Module } from '@nestjs/common';
import { CryptoModule } from '../crypto/crypto.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { SearchController } from './search.controller.js';
import { SearchService } from './search.service.js';

@Module({
  imports: [CryptoModule, ProfilesModule],
  controllers: [SearchController],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
