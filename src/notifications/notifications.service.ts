import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsSyncService } from './notifications-sync.service.js';

export interface CreateNotificationData {
  title: string;
  body: string;
  variant: string;
  requestId?: string;
  requestType?: string;
  isAdminBroadcast?: boolean;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly syncService: NotificationsSyncService,
  ) {}

  async create(userId: string, data: CreateNotificationData) {
    const notification = await this.prisma.notification.create({
      data: {
        userId,
        title: data.title,
        body: data.body,
        variant: data.variant,
        requestId: data.requestId ?? null,
        requestType: data.requestType ?? null,
        isAdminBroadcast: data.isAdminBroadcast ?? false,
      },
    });

    this.syncService.emit({
      type: 'created',
      userId,
      notification: {
        id: notification.id,
        title: notification.title,
        body: notification.body,
        variant: notification.variant,
        requestId: notification.requestId,
        requestType: notification.requestType,
        isAdminBroadcast: notification.isAdminBroadcast,
        read: notification.read,
        createdAt: notification.createdAt.toISOString(),
      },
    });

    return notification;
  }

  async createForUsers(userIds: string[], data: CreateNotificationData) {
    await Promise.allSettled(userIds.map((uid) => this.create(uid, data)));
  }

  async findForUser(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async markRead(userId: string, notificationId: string) {
    await this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { read: true },
    });

    this.syncService.emit({
      type: 'read',
      userId,
      notificationId,
    });
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });

    this.syncService.emit({
      type: 'read_all',
      userId,
    });
  }

  async clearAll(userId: string) {
    await this.prisma.notification.deleteMany({
      where: { userId },
    });

    this.syncService.emit({
      type: 'cleared',
      userId,
    });
  }
}
