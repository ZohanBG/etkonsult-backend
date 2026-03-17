import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { RequestEvent } from '../requests/requests-events.service.js';

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  variant: 'info' | 'success' | 'warning' | 'danger';
  requestId?: string;
}

@Injectable()
export class PushNotificationsService {
  private readonly logger = new Logger(PushNotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly notificationsService: NotificationsService,
  ) {
    webpush.setVapidDetails(
      configService.getOrThrow<string>('VAPID_SUBJECT'),
      configService.getOrThrow<string>('VAPID_PUBLIC_KEY'),
      configService.getOrThrow<string>('VAPID_PRIVATE_KEY'),
    );
  }

  getVapidPublicKey(): string {
    return this.configService.getOrThrow<string>('VAPID_PUBLIC_KEY');
  }

  async saveSubscription(
    userId: string,
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  ): Promise<void> {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: subscription.endpoint },
      update: { userId, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
      create: {
        userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
    });
  }

  async deleteSubscription(endpoint: string): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({ where: { endpoint } });
  }

  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    const subscriptions = await this.prisma.pushSubscription.findMany({ where: { userId } });
    if (subscriptions.length === 0) return;

    await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify(payload),
          );
        } catch (err: unknown) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 410 || statusCode === 404) {
            // Subscription expired or unregistered — clean up
            await this.prisma.pushSubscription.deleteMany({ where: { id: sub.id } });
          } else {
            this.logger.warn(`Push failed for user ${userId}: ${(err as Error).message}`);
          }
        }
      }),
    );
  }

  async sendToUsers(userIds: string[], payload: PushPayload): Promise<void> {
    await Promise.allSettled(userIds.map((uid) => this.sendToUser(uid, payload)));
  }

  async sendToAll(payload: PushPayload): Promise<void> {
    const rows = await this.prisma.pushSubscription.findMany({
      select: { userId: true },
      distinct: ['userId'],
    });
    await this.sendToUsers(rows.map((r) => r.userId), payload);
  }

  /** Mirror of NotificationContext.buildNotification() — same filtering + Bulgarian text */
  async sendRequestEvent(event: RequestEvent): Promise<void> {
    const reg = `рег. ${event.registrationNumber}`;
    const typeLabel = event.requestType === 'NOVA_POLICA' ? 'нова полица' : 'вноска';

    if (event.actorRole === 'AGENT') {
      // Staff sees agent actions — find users with request:read_all permission
      const staffUsers = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT DISTINCT u.id FROM users u
        JOIN user_roles ur ON ur."userId" = u.id
        JOIN roles r ON r.id = ur."roleId"
        WHERE r.permissions::jsonb ? 'request:read_all'
      `);
      const userIds = staffUsers.map((u) => u.id);
      if (userIds.length === 0) return;

      const url = `/requests?requestId=${event.requestId}`;
      let payload: PushPayload | null = null;

      if (event.type === 'created') {
        payload = { title: `Нова заявка за ${typeLabel}`, body: reg, url, variant: 'info', requestId: event.requestId };
      } else if (event.newStatus === 'PRIETA_OFERTA') {
        payload = { title: 'Агентът прие офертата', body: reg, url, variant: 'success', requestId: event.requestId };
      } else if (event.newStatus === 'OTKAZANA_OFERTA') {
        payload = { title: 'Агентът отхвърли офертата', body: reg, url, variant: 'danger', requestId: event.requestId };
      } else if (event.newStatus === 'OTKAZANA_OT_AGENT') {
        payload = { title: 'Агентът отказа заявката', body: reg, url, variant: 'warning', requestId: event.requestId };
      }

      if (payload) {
        await this.sendToUsers(userIds, payload);
        await this.notificationsService.createForUsers(userIds, {
          title: payload.title,
          body: payload.body,
          variant: payload.variant,
          requestId: event.requestId,
          requestType: event.requestType,
        });
      }

    } else if (event.actorRole === 'STAFF') {
      // Agent sees staff actions on their own requests
      const url = `/requests/my?requestId=${event.requestId}`;
      let payload: PushPayload | null = null;

      if (event.newStatus === 'OBRABOTENA') {
        payload = { title: 'Получихте оферта', body: reg, url, variant: 'info', requestId: event.requestId };
      } else if (event.newStatus === 'ZAVURSHENA') {
        payload = { title: 'Заявката е завършена', body: reg, url, variant: 'success', requestId: event.requestId };
      } else if (event.newStatus === 'OTKAZANA') {
        payload = { title: 'Заявката е отказана', body: reg, url, variant: 'danger', requestId: event.requestId };
      }

      if (payload) {
        await this.sendToUser(event.agentId, payload);
        await this.notificationsService.create(event.agentId, {
          title: payload.title,
          body: payload.body,
          variant: payload.variant,
          requestId: event.requestId,
          requestType: event.requestType,
        });
      }
    }
  }
}
