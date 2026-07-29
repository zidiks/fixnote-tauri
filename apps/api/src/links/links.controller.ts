import { Controller, Get, Query } from '@nestjs/common';
import { LinksService } from './links.service.js';

@Controller('links')
export class LinksController {
  constructor(private readonly linksService: LinksService) {}

  @Get('preview')
  preview(@Query('url') url: string | undefined) {
    return this.linksService.preview(url);
  }
}
