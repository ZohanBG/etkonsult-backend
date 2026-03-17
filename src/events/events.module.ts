import { Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway.js';
import { AuthModule } from '../auth/auth.module.js';
import { RequestsModule } from '../requests/requests.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [AuthModule, RequestsModule, NotificationsModule],
  providers: [EventsGateway],
})
export class EventsModule {}
