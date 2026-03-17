import { Module } from '@nestjs/common';
import { RequestsController } from './requests.controller.js';
import { RequestsService } from './requests.service.js';
import { RequestsEventsService } from './requests-events.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { UploadsModule } from '../uploads/uploads.module.js';
import { PushNotificationsModule } from '../push-notifications/push-notifications.module.js';

@Module({
  imports: [PrismaModule, AuthModule, UploadsModule, PushNotificationsModule],
  controllers: [RequestsController],
  providers: [RequestsService, RequestsEventsService],
  exports: [RequestsService, RequestsEventsService],
})
export class RequestsModule {}
