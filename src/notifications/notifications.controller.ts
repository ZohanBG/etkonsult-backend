import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator.js';

@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  async list(@CurrentUser() user: CurrentUserData) {
    return this.service.findForUser(user.userId);
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markRead(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    await this.service.markRead(user.userId, id);
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markAllRead(@CurrentUser() user: CurrentUserData) {
    await this.service.markAllRead(user.userId);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearAll(@CurrentUser() user: CurrentUserData) {
    await this.service.clearAll(user.userId);
  }
}
