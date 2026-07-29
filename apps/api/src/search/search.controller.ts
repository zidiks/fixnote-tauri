import { Controller, Get, Query } from '@nestjs/common';
import type { SearchResult } from '@fixnote/contracts';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { SearchService } from './search.service.js';

@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  run(
    @CurrentUser() user: AuthenticatedUser,
    @Query('q') query = '',
    @Query('resourceId') resourceId?: string,
  ): Promise<SearchResult[]> {
    return this.search.search(user, query, resourceId);
  }
}
