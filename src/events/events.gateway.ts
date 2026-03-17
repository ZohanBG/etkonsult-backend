import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { Subscription } from 'rxjs';
import { SessionService } from '../auth/services/session.service.js';
import { RequestsEventsService } from '../requests/requests-events.service.js';
import { NotificationsSyncService } from '../notifications/notifications-sync.service.js';

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
  },
})
export class EventsGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(EventsGateway.name);
  private subscriptions: Subscription[] = [];

  constructor(
    private readonly sessionService: SessionService,
    private readonly requestsEvents: RequestsEventsService,
    private readonly notificationsSync: NotificationsSyncService,
  ) {}

  onModuleInit() {
    // Request events → broadcast to ALL authenticated clients (for table refresh)
    this.subscriptions.push(
      this.requestsEvents.subscribe().subscribe((event) => {
        this.server.emit('request:event', event);
      }),
    );

    // Notification sync → emit only to the target user's room
    this.subscriptions.push(
      this.notificationsSync.subscribe().subscribe((event) => {
        this.server.to(`user:${event.userId}`).emit('notification:sync', event);
      }),
    );
  }

  onModuleDestroy() {
    this.subscriptions.forEach((s) => s.unsubscribe());
    this.subscriptions = [];
  }

  async handleConnection(client: Socket) {
    try {
      const token = this.extractToken(client);
      const fingerprint = client.handshake.auth?.fingerprint as string;

      if (!token || !fingerprint) {
        this.logger.debug(`Client ${client.id} rejected: missing token or fingerprint`);
        client.disconnect();
        return;
      }

      const session = await this.sessionService.validateSession(token, fingerprint);
      if (!session) {
        this.logger.debug(`Client ${client.id} rejected: invalid session`);
        client.disconnect();
        return;
      }

      // Store userId on the socket for reference
      (client.data as { userId: string }).userId = session.userId;

      // Join user-specific room for targeted events
      client.join(`user:${session.userId}`);

      this.logger.debug(`Client connected: ${client.id} (user: ${session.userId})`);
    } catch (err) {
      this.logger.error('WebSocket auth failed:', err);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Client disconnected: ${client.id}`);
  }

  private extractToken(client: Socket): string | null {
    // Try auth object first
    if (client.handshake.auth?.token) {
      return client.handshake.auth.token as string;
    }

    // Try cookie (browser sends cookies automatically with withCredentials)
    const cookies = client.handshake.headers.cookie;
    if (cookies) {
      const match = cookies.match(/auth_token=([^;]+)/);
      if (match) return match[1];
    }

    return null;
  }
}
