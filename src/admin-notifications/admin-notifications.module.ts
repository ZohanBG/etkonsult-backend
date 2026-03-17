import { Module } from '@nestjs/common';
import { AdminNotificationsController } from './admin-notifications.controller.js';
import { AdminNotificationsService } from './admin-notifications.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PushNotificationsModule } from '../push-notifications/push-notifications.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [PrismaModule, AuthModule, PushNotificationsModule, NotificationsModule],
  controllers: [AdminNotificationsController],
  providers: [AdminNotificationsService],
  exports: [AdminNotificationsService],
})
export class AdminNotificationsModule {}
