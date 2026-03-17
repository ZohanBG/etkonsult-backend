import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PasswordService } from '../auth/services/password.service.js';
import { UserStatus } from '@prisma/client';
import type { CreateUserDto, UpdateUserDto, UserQueryDto } from './dto/user.dto.js';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
  ) {}

  async findAll(query: UserQueryDto) {
    const page = parseInt(query.page || '1', 10);
    const limit = parseInt(query.limit || '10', 10);
    const skip = (page - 1) * limit;

    const where: {
      status?: UserStatus;
      OR?: ({ email: { contains: string; mode: 'insensitive' } } | { username: { contains: string; mode: 'insensitive' } })[];
    } = {};

    if (query.status) {
      where.status = query.status;
    }

    if (query.search) {
      where.OR = [
        { email: { contains: query.search, mode: 'insensitive' } },
        { username: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          username: true,
          status: true,
          totpEnabled: true,
          failedAttempts: true,
          lockedUntil: true,
          createdAt: true,
          updatedAt: true,
          roles: {
            include: {
              role: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: users.map((user) => ({
        ...user,
        roles: user.roles.map((ur) => ur.role),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        status: true,
        totpEnabled: true,
        failedAttempts: true,
        lockedUntil: true,
        createdAt: true,
        updatedAt: true,
        roles: {
          include: {
            role: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      ...user,
      roles: user.roles.map((ur) => ur.role),
    };
  }

  async create(dto: CreateUserDto) {
    // Validate role IDs if provided (outside tx — read-only check)
    if (dto.roleIds && dto.roleIds.length > 0) {
      const roles = await this.prisma.role.findMany({
        where: { id: { in: dto.roleIds } },
      });

      if (roles.length !== dto.roleIds.length) {
        throw new BadRequestException('One or more role IDs are invalid');
      }
    }

    // Validate password strength
    const passwordValidation = this.passwordService.validatePasswordStrength(dto.password);
    if (!passwordValidation.isValid) {
      throw new BadRequestException(passwordValidation.errors.join('. '));
    }

    // Hash password (expensive, do outside tx)
    const passwordHash = await this.passwordService.hashPassword(dto.password);
    const username = dto.username.trim();

    // Use transaction to prevent race conditions on unique fields
    const user = await this.prisma.$transaction(async (tx) => {
      // Check email uniqueness inside tx
      const existingUser = await tx.user.findUnique({
        where: { email: dto.email.toLowerCase() },
      });
      if (existingUser) {
        throw new ConflictException('User with this email already exists');
      }

      // Check username uniqueness inside tx
      const existingUsername = await tx.user.findUnique({
        where: { username },
      });
      if (existingUsername) {
        throw new ConflictException('Потребителското име вече е заето');
      }

      // Create user with roles
      return tx.user.create({
        data: {
          email: dto.email.toLowerCase(),
          username,
          passwordHash,
          status: UserStatus.ACTIVE,
          roles: dto.roleIds
            ? {
                create: dto.roleIds.map((roleId) => ({ roleId })),
              }
            : undefined,
        },
        select: {
          id: true,
          email: true,
          username: true,
          status: true,
          totpEnabled: true,
          createdAt: true,
          roles: {
            include: {
              role: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      });
    });

    return {
      ...user,
      roles: user.roles.map((ur) => ur.role),
    };
  }

  async update(id: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check email uniqueness if changing
    if (dto.email && dto.email.toLowerCase() !== user.email) {
      const existingUser = await this.prisma.user.findUnique({
        where: { email: dto.email.toLowerCase() },
      });

      if (existingUser) {
        throw new ConflictException('User with this email already exists');
      }
    }

    // Check username uniqueness if changing
    if (dto.username !== undefined && dto.username !== user.username) {
      const trimmedUsername = dto.username.trim();
      if (trimmedUsername) {
        const existingUsername = await this.prisma.user.findUnique({
          where: { username: trimmedUsername },
        });
        if (existingUsername) {
          throw new ConflictException('Потребителското име вече е заето');
        }
      }
    }

    // Validate role IDs if provided
    if (dto.roleIds) {
      const roles = await this.prisma.role.findMany({
        where: { id: { in: dto.roleIds } },
      });

      if (roles.length !== dto.roleIds.length) {
        throw new BadRequestException('One or more role IDs are invalid');
      }
    }

    // Prepare update data
    const updateData: {
      email?: string;
      username?: string | null;
      passwordHash?: string;
      status?: UserStatus;
      failedAttempts?: number;
      lockedUntil?: Date | null;
    } = {};

    if (dto.email) {
      updateData.email = dto.email.toLowerCase();
    }

    if (dto.username !== undefined) {
      updateData.username = dto.username.trim() || null;
    }

    if (dto.password) {
      updateData.passwordHash = await this.passwordService.hashPassword(dto.password);
    }

    if (dto.status) {
      updateData.status = dto.status;

      // Reset failed attempts and lock if activating (consolidated into single update)
      if (dto.status === UserStatus.ACTIVE) {
        updateData.failedAttempts = 0;
        updateData.lockedUntil = null;
      }
    }

    // Update user and roles atomically if roles are provided
    if (dto.roleIds !== undefined) {
      return this.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id },
          data: updateData,
        });

        // Remove all existing roles and add new ones
        await tx.userRole.deleteMany({ where: { userId: id } });

        if (dto.roleIds!.length > 0) {
          await tx.userRole.createMany({
            data: dto.roleIds!.map((roleId) => ({ userId: id, roleId })),
          });
        }

        // Refetch user with updated roles
        return this.findById(id);
      });
    }

    // No role changes — simple update
    const updatedUser = await this.prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        status: true,
        totpEnabled: true,
        failedAttempts: true,
        lockedUntil: true,
        createdAt: true,
        updatedAt: true,
        roles: {
          include: {
            role: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    return {
      ...updatedUser,
      roles: updatedUser.roles.map((ur) => ur.role),
    };
  }

  async delete(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Soft delete - set status to INACTIVE instead of deleting
    await this.prisma.user.update({
      where: { id },
      data: { status: UserStatus.INACTIVE },
    });

    return { deleted: true };
  }

  async resetTwoFactor(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.user.update({
      where: { id },
      data: {
        totpSecret: null,
        totpEnabled: false,
      },
    });

    return { reset: true };
  }

  async unlock(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.user.update({
      where: { id },
      data: {
        status: UserStatus.ACTIVE,
        failedAttempts: 0,
        lockedUntil: null,
      },
    });

    return { unlocked: true };
  }
}
