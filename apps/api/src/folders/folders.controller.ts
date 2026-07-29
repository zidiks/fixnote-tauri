import { Body, Controller, Delete, Get, Inject, Param, Patch, Post } from '@nestjs/common';
import {
  createFolderSchema,
  updateFolderSchema,
  type CreateFolderInput,
  type FolderSummary,
  type UpdateFolderInput,
} from '@fixnote/contracts';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { FoldersService } from './folders.service.js';

@Controller('folders')
export class FoldersController {
  constructor(@Inject(FoldersService) private readonly folders: FoldersService) {}

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

  @Patch(':folderId')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('folderId') folderId: string,
    @Body() body: UpdateFolderInput,
  ): Promise<FolderSummary> {
    return this.folders.update(user, folderId, updateFolderSchema.parse(body));
  }

  @Delete(':folderId')
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('folderId') folderId: string,
  ): Promise<{ deleted: true }> {
    await this.folders.remove(user, folderId);
    return { deleted: true };
  }
}
