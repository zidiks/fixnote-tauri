import { Module } from '@nestjs/common';
import { SearchModule } from '../search/search.module.js';
import { AiController } from './ai.controller.js';
import { AiService } from './ai.service.js';

@Module({
  imports: [SearchModule],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
