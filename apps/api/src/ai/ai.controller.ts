import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
const languageSchema = z.string().trim().min(2).max(12).optional();

interface UploadedAudio {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

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

  @Post('transcribe')
  @UseInterceptors(FileInterceptor('audio', {
    limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  }))
  transcribe(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: UploadedAudio | undefined,
    @Query('language') language?: string,
  ): Promise<{ text: string }> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Audio file is required');
    }
    if (
      file.mimetype &&
      !file.mimetype.startsWith('audio/') &&
      file.mimetype !== 'video/webm'
    ) {
      throw new BadRequestException('Unsupported audio format');
    }
    return this.ai.transcribe(
      user,
      file,
      languageSchema.parse(language),
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
