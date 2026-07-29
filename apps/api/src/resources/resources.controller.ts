import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  createResourceSchema,
  inviteCollaboratorSchema,
  updateResourceSchema,
  type CreateResourceInput,
  type InviteCollaboratorInput,
  type ResourceSummary,
  type ShareEntry,
  type UpdateResourceInput,
} from '@fixnote/contracts';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { ResourcesService } from './resources.service.js';

@Controller('resources')
export class ResourcesController {
  constructor(@Inject(ResourcesService) private readonly resources: ResourcesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('folderId') folderId?: string,
  ): Promise<ResourceSummary[]> {
    return this.resources.list(user, folderId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateResourceInput,
  ): Promise<ResourceSummary> {
    return this.resources.create(user, createResourceSchema.parse(body));
  }

  @Patch(':resourceId')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('resourceId') resourceId: string,
    @Body() body: UpdateResourceInput,
  ): Promise<ResourceSummary> {
    return this.resources.update(
      user,
      resourceId,
      updateResourceSchema.parse(body),
    );
  }

  @Get(':resourceId/collaborators')
  collaborators(
    @CurrentUser() user: AuthenticatedUser,
    @Param('resourceId') resourceId: string,
  ): Promise<ShareEntry[]> {
    return this.resources.listSharing(user, resourceId);
  }

  @Post(':resourceId/invites')
  invite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('resourceId') resourceId: string,
    @Body() body: InviteCollaboratorInput,
  ): Promise<ShareEntry> {
    return this.resources.invite(
      user,
      resourceId,
      inviteCollaboratorSchema.parse(body),
    );
  }

  @Delete(':resourceId/collaborators/:profileId')
  async revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('resourceId') resourceId: string,
    @Param('profileId') profileId: string,
  ): Promise<{ revoked: true }> {
    await this.resources.revoke(user, resourceId, profileId);
    return { revoked: true };
  }

  @Delete(':resourceId')
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('resourceId') resourceId: string,
  ): Promise<{ deleted: true }> {
    await this.resources.remove(user, resourceId);
    return { deleted: true };
  }
}
