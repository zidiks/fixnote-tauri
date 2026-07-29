import { Module } from '@nestjs/common';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { InvitesController } from './invites.controller.js';
import { InvitesService } from './invites.service.js';

@Module({
  imports: [ProfilesModule],
  controllers: [InvitesController],
  providers: [InvitesService],
})
export class InvitesModule {}
