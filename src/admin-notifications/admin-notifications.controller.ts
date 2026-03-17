import {
  Controller,
  Post,
  Body,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { AdminNotificationsService, type AdminNotificationVariant } from './admin-notifications.service.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { AuditInterceptor, Audit } from '../audit/audit.interceptor.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PushNotificationsService } from '../push-notifications/push-notifications.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { IsString, IsArray, IsOptional, IsIn, MinLength, MaxLength } from 'class-validator';

class BroadcastNotificationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(300)
  body!: string;

  @IsIn(['info', 'success', 'warning', 'danger'])
  variant!: AdminNotificationVariant;

  // 'all' | 'role' | 'users'
  @IsIn(['all', 'role', 'users'])
  targetType!: 'all' | 'role' | 'users';

  // Role names when targetType === 'role'
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetRoles?: string[];

  // User IDs when targetType === 'users'
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetUserIds?: string[];
}

@Controller('admin-notifications')
@UseGuards(AuthGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
export class AdminNotificationsController {
  private readonly logger = new Logger(AdminNotificationsController.name);

  constructor(
    private readonly service: AdminNotificationsService,
    private readonly prisma: PrismaService,
    private readonly pushService: PushNotificationsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /** Admin sends a notification */
  @Post('broadcast')
  @RequirePermissions(PERMISSIONS.USER_READ)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({
    action: 'BROADCAST_NOTIFICATION',
    entityType: 'AdminNotification',
    getNewValue: (req) => {
      const dto = req.body as unknown as BroadcastNotificationDto;
      return {
        title: dto.title,
        body: dto.body,
        variant: dto.variant,
        targetType: dto.targetType,
        targetRoles: dto.targetRoles,
        targetUserIds: dto.targetUserIds,
      };
    },
  })
  async broadcast(@Body() dto: BroadcastNotificationDto) {
    let targetUserIds: string[] = [];

    if (dto.targetType === 'all') {
      // Empty = all connected clients (filtered on frontend)
      targetUserIds = [];
    } else if (dto.targetType === 'role' && dto.targetRoles?.length) {
      // Resolve role names → user IDs
      const users = await this.prisma.user.findMany({
        where: {
          roles: {
            some: {
              role: { name: { in: dto.targetRoles } },
            },
          },
        },
        select: { id: true },
      });
      targetUserIds = users.map((u) => u.id);
    } else if (dto.targetType === 'users' && dto.targetUserIds?.length) {
      targetUserIds = dto.targetUserIds;
    }

    this.service.emit({
      id: crypto.randomUUID(),
      source: 'admin',
      title: dto.title,
      body: dto.body,
      variant: dto.variant,
      targetUserIds,
    });

    const pushPayload = { title: dto.title, body: dto.body, url: '/', variant: dto.variant };
    const notifData = { title: dto.title, body: dto.body, variant: dto.variant, isAdminBroadcast: true };

    if (targetUserIds.length > 0) {
      this.pushService.sendToUsers(targetUserIds, pushPayload).catch((err) => this.logger.error('Push notification failed:', err));
      this.notificationsService.createForUsers(targetUserIds, notifData).catch((err) => this.logger.error('In-app notification failed:', err));
    } else {
      this.pushService.sendToAll(pushPayload).catch((err) => this.logger.error('Push notification failed:', err));
      // For "all" broadcast, resolve all active users
      this.prisma.user.findMany({ where: { status: 'ACTIVE' }, select: { id: true } })
        .then((users) => this.notificationsService.createForUsers(users.map((u) => u.id), notifData))
        .catch((err) => this.logger.error('In-app notification failed:', err));
    }
  }

  /** List all roles (for the target picker) */
  @Post('roles-list')
  @RequirePermissions(PERMISSIONS.USER_READ)
  @HttpCode(HttpStatus.OK)
  async listRoles() {
    return this.prisma.role.findMany({
      select: { id: true, name: true, description: true, _count: { select: { users: true } } },
      orderBy: { name: 'asc' },
    });
  }

  /** List all users (for the target picker) */
  @Post('users-list')
  @RequirePermissions(PERMISSIONS.USER_READ)
  @HttpCode(HttpStatus.OK)
  async listUsers() {
    return this.prisma.user.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        username: true,
        email: true,
        roles: { include: { role: { select: { name: true } } } },
      },
      orderBy: { username: 'asc' },
    });
  }
}
