import { Controller, Param, Post } from '@nestjs/common';
import type { AcceptInviteResult } from '@fixnote/contracts';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { InvitesService } from './invites.service.js';

@Controller('invites')
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Post(':token/accept')
  accept(
    @CurrentUser() user: AuthenticatedUser,
    @Param('token') token: string,
  ): Promise<AcceptInviteResult> {
    return this.invites.accept(user, token);
  }
}
