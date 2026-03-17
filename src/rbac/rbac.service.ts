import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CacheService } from '../cache/cache.service.js';
import { DEFAULT_ROLES, PERMISSIONS, getAllPermissions, PERMISSION_LABELS } from './permissions.js';
import type { Permission } from './permissions.js';
import type { Prisma } from '@prisma/client';
import type { CreateRoleDto, UpdateRoleDto } from './dto/role.dto.js';

@Injectable()
export class RbacService {
  private readonly logger = new Logger(RbacService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  // Seed default roles — creates missing ones, updates permissions of existing system roles
  async seedDefaultRoles(): Promise<void> {
    for (const [key, roleData] of Object.entries(DEFAULT_ROLES)) {
      const existingRole = await this.prisma.role.findUnique({
        where: { name: roleData.name },
      });

      if (!existingRole) {
        await this.prisma.role.create({
          data: {
            name: roleData.name,
            description: roleData.description,
            permissions: roleData.permissions as Prisma.InputJsonValue,
            isSystem: roleData.isSystem,
          },
        });
        this.logger.log(`Created default role: ${key}`);
      } else {
        // Always sync permissions for system roles so code changes take effect on restart
        await this.prisma.role.update({
          where: { name: roleData.name },
          data: { permissions: roleData.permissions as Prisma.InputJsonValue },
        });
        this.logger.log(`Synced permissions for system role: ${key}`);
      }
    }
  }

  // Get all roles
  async getAllRoles() {
    return this.prisma.role.findMany({
      include: {
        _count: {
          select: { users: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  // Get role by ID
  async getRoleById(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: {
        _count: {
          select: { users: true },
        },
      },
    });

    if (!role) {
      throw new NotFoundException('Role not found');
    }

    return role;
  }

  // Create role
  async createRole(dto: CreateRoleDto) {
    // Validate permissions
    const validPermissions = Object.values(PERMISSIONS);
    const invalidPermissions = dto.permissions.filter(
      (p) => !validPermissions.includes(p as Permission),
    );

    if (invalidPermissions.length > 0) {
      throw new BadRequestException(`Invalid permissions: ${invalidPermissions.join(', ')}`);
    }

    // Check for duplicate name
    const existingRole = await this.prisma.role.findUnique({
      where: { name: dto.name },
    });

    if (existingRole) {
      throw new BadRequestException('Role with this name already exists');
    }

    return this.prisma.role.create({
      data: {
        name: dto.name,
        description: dto.description,
        permissions: dto.permissions as Prisma.InputJsonValue,
        isSystem: false,
      },
    });
  }

  // Update role
  async updateRole(id: string, dto: UpdateRoleDto) {
    const role = await this.prisma.role.findUnique({ where: { id } });

    if (!role) {
      throw new NotFoundException('Role not found');
    }

    if (role.isSystem && dto.name && dto.name !== role.name) {
      throw new BadRequestException('Cannot rename system roles');
    }

    // Validate permissions if provided
    if (dto.permissions) {
      const validPermissions = Object.values(PERMISSIONS);
      const invalidPermissions = dto.permissions.filter(
        (p) => !validPermissions.includes(p as Permission),
      );

      if (invalidPermissions.length > 0) {
        throw new BadRequestException(`Invalid permissions: ${invalidPermissions.join(', ')}`);
      }
    }

    // Check for duplicate name if changing
    if (dto.name && dto.name !== role.name) {
      const existingRole = await this.prisma.role.findUnique({
        where: { name: dto.name },
      });

      if (existingRole) {
        throw new BadRequestException('Role with this name already exists');
      }
    }

    const updatedRole = await this.prisma.role.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        permissions: dto.permissions as Prisma.InputJsonValue | undefined,
      },
    });

    // If permissions changed, invalidate cache for all users with this role
    if (dto.permissions) {
      const usersWithRole = await this.prisma.userRole.findMany({
        where: { roleId: id },
        select: { userId: true },
      });

      await Promise.all(
        usersWithRole.map((ur) => this.cacheService.invalidateUserPermissions(ur.userId)),
      );
    }

    return updatedRole;
  }

  // Delete role
  async deleteRole(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: {
        _count: {
          select: { users: true },
        },
      },
    });

    if (!role) {
      throw new NotFoundException('Role not found');
    }

    if (role.isSystem) {
      throw new BadRequestException('Cannot delete system roles');
    }

    if (role._count.users > 0) {
      throw new BadRequestException(
        `Cannot delete role with ${role._count.users} assigned user(s). Remove users first.`,
      );
    }

    await this.prisma.role.delete({ where: { id } });
    return { deleted: true };
  }

  // Get all available permissions
  getAvailablePermissions() {
    return {
      permissions: getAllPermissions(),
      labels: PERMISSION_LABELS,
    };
  }

  // Get user permissions (with caching)
  async getUserPermissions(userId: string): Promise<string[]> {
    // Try cache first
    const cached = await this.cacheService.getUserPermissions(userId);
    if (cached) {
      return cached;
    }

    // Fetch from database
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!user) {
      return [];
    }

    const permissions = new Set<string>();
    for (const userRole of user.roles) {
      const rolePermissions = userRole.role.permissions as string[];
      for (const permission of rolePermissions) {
        permissions.add(permission);
      }
    }

    const permissionsArray = Array.from(permissions);

    // Cache the permissions
    await this.cacheService.setUserPermissions(userId, permissionsArray);

    return permissionsArray;
  }

  // Check if user has permission
  async userHasPermission(userId: string, permission: Permission): Promise<boolean> {
    const permissions = await this.getUserPermissions(userId);
    return permissions.includes(permission);
  }

  // Assign role to user
  async assignRoleToUser(userId: string, roleId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) {
      throw new NotFoundException('Role not found');
    }

    // Check if already assigned
    const existing = await this.prisma.userRole.findUnique({
      where: {
        userId_roleId: { userId, roleId },
      },
    });

    if (existing) {
      return existing; // Already assigned
    }

    const result = await this.prisma.userRole.create({
      data: { userId, roleId },
    });

    // Invalidate user's permissions cache
    await this.cacheService.invalidateUserPermissions(userId);

    return result;
  }

  // Remove role from user
  async removeRoleFromUser(userId: string, roleId: string) {
    await this.prisma.userRole.delete({
      where: {
        userId_roleId: { userId, roleId },
      },
    }).catch(() => {
      // Role not assigned - ignore
    });

    // Invalidate user's permissions cache
    await this.cacheService.invalidateUserPermissions(userId);

    return { removed: true };
  }

  // Get user's roles
  async getUserRoles(userId: string) {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId },
      include: {
        role: true,
      },
    });

    return userRoles.map((ur) => ur.role);
  }
}
