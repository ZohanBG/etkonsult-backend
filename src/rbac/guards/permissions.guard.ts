import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator.js';
import type { Permission } from '../permissions.js';

interface RequestWithUser {
  user?: {
    userId: string;
    sessionId: string;
  };
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No permissions required - allow access
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    // Get user's roles and permissions
    const userWithRoles = await this.prisma.user.findUnique({
      where: { id: user.userId },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!userWithRoles) {
      throw new ForbiddenException('User not found');
    }

    // Collect all permissions from all roles
    const userPermissions = new Set<string>();
    for (const userRole of userWithRoles.roles) {
      const rolePermissions = userRole.role.permissions as string[];
      for (const permission of rolePermissions) {
        userPermissions.add(permission);
      }
    }

    // Check if user has any of the required permissions
    const hasPermission = requiredPermissions.some((permission) =>
      userPermissions.has(permission),
    );

    if (!hasPermission) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
