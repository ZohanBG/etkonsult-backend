import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationsSyncService } from './notifications-sync.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsSyncService],
  exports: [NotificationsService, NotificationsSyncService],
})
export class NotificationsModule {}
