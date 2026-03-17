import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface AuditLogEntry {
  userId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuditLogFilters {
  userId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  startDate?: string;
  endDate?: string;
  page?: string;
  limit?: string;
}

export interface PaginatedAuditLogs {
  data: AuditLogWithUser[];
  total: number;
  page: number;
  totalPages: number;
}

export interface AuditLogWithUser {
  id: string;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  oldValue: unknown;
  newValue: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  timestamp: Date;
  user: {
    id: string;
    email: string;
  } | null;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditLogEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        userId: entry.userId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        oldValue: entry.oldValue as object | undefined,
        newValue: entry.newValue as object | undefined,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
      },
    });
  }

  async findAll(filters: AuditLogFilters): Promise<PaginatedAuditLogs> {
    const page = filters.page ? parseInt(filters.page, 10) : 1;
    const limit = filters.limit ? parseInt(filters.limit, 10) : 50;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (filters.userId) {
      where.userId = filters.userId;
    }

    if (filters.action) {
      where.action = { contains: filters.action, mode: 'insensitive' };
    }

    if (filters.entityType) {
      where.entityType = filters.entityType;
    }

    if (filters.entityId) {
      where.entityId = filters.entityId;
    }

    if (filters.startDate || filters.endDate) {
      where.timestamp = {};
      if (filters.startDate) {
        (where.timestamp as Record<string, Date>).gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        (where.timestamp as Record<string, Date>).lte = new Date(filters.endDate);
      }
    }

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { timestamp: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              email: true,
            },
          },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data: logs,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string): Promise<AuditLogWithUser | null> {
    return this.prisma.auditLog.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
          },
        },
      },
    });
  }

  async getEntityTypes(): Promise<string[]> {
    const results = await this.prisma.auditLog.findMany({
      select: { entityType: true },
      distinct: ['entityType'],
    });
    return results.map((r) => r.entityType);
  }

  async getActions(): Promise<string[]> {
    const results = await this.prisma.auditLog.findMany({
      select: { action: true },
      distinct: ['action'],
    });
    return results.map((r) => r.action);
  }
}
