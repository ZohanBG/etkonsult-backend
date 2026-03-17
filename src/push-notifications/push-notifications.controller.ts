import { Controller, Post, Delete, Get, Body, UseGuards } from '@nestjs/common';
import { IsString, IsObject, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PushNotificationsService } from './push-notifications.service.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator.js';

class PushKeysDto {
  @IsString() p256dh!: string;
  @IsString() auth!: string;
}

class SaveSubscriptionDto {
  @IsString() endpoint!: string;
  @IsObject() @ValidateNested() @Type(() => PushKeysDto) keys!: PushKeysDto;
}

class DeleteSubscriptionDto {
  @IsString() endpoint!: string;
}

@Controller('push')
@UseGuards(AuthGuard)
export class PushNotificationsController {
  constructor(private readonly service: PushNotificationsService) {}

  @Get('vapid-public-key')
  getVapidPublicKey() {
    return { publicKey: this.service.getVapidPublicKey() };
  }

  @Post('subscribe')
  async subscribe(
    @Body() dto: SaveSubscriptionDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    await this.service.saveSubscription(user.userId, {
      endpoint: dto.endpoint,
      keys: dto.keys,
    });
    return { ok: true };
  }

  @Delete('unsubscribe')
  async unsubscribe(@Body() dto: DeleteSubscriptionDto) {
    await this.service.deleteSubscription(dto.endpoint);
    return { ok: true };
  }
}
