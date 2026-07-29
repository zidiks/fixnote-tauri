import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  aiChatRequestSchema,
  aiProposalDecisionSchema,
  type AiChatRequest,
  type AiChatResponse,
  type AiProposalDecision,
  type AiProposalDecisionResult,
  type AiThreadHistory,
} from '@fixnote/contracts';
import { z } from 'zod';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { AiService } from './ai.service.js';

const uuidSchema = z.string().uuid();

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

  @Get('thread')
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Query('resourceId') resourceId?: string,
  ): Promise<AiThreadHistory> {
    return this.ai.history(
      user,
      resourceId ? uuidSchema.parse(resourceId) : undefined,
    );
  }

  @Patch('proposals/:proposalId')
  decideProposal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('proposalId') proposalId: string,
    @Body() body: AiProposalDecision,
  ): Promise<AiProposalDecisionResult> {
    return this.ai.decideProposal(
      user,
      uuidSchema.parse(proposalId),
      aiProposalDecisionSchema.parse(body),
    );
  }
}
