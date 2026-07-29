import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  createFolderSchema,
  type CreateFolderInput,
  type FolderSummary,
} from '@fixnote/contracts';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { FoldersService } from './folders.service.js';

@Controller('folders')
export class FoldersController {
  constructor(private readonly folders: FoldersService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<FolderSummary[]> {
    return this.folders.list(user);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateFolderInput,
  ): Promise<FolderSummary> {
    return this.folders.create(user, createFolderSchema.parse(body));
  }
}
