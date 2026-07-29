import { Body, Controller, Inject, Post } from '@nestjs/common';
import {
  aiChatRequestSchema,
  type AiChatRequest,
  type AiChatResponse,
} from '@fixnote/contracts';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { AiService } from './ai.service.js';

@Controller('ai')
export class AiController {
  constructor(@Inject(AiService) private readonly ai: AiService) {}

  @Post('chat')
  chat(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: AiChatRequest,
  ): Promise<AiChatResponse> {
    return this.ai.chat(user, aiChatRequestSchema.parse(body));
  }
}
