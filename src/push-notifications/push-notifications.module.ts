import { Module } from '@nestjs/common';
import { PushNotificationsController } from './push-notifications.controller.js';
import { PushNotificationsService } from './push-notifications.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [PrismaModule, AuthModule, NotificationsModule],
  controllers: [PushNotificationsController],
  providers: [PushNotificationsService],
  exports: [PushNotificationsService],
})
export class PushNotificationsModule {}
