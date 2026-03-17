import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateOwnerDto, UpdateOwnerDto } from './dto/index.js';

export interface OwnerWithVehicleCount {
  id: string;
  identifier: string;
  name: string;
  address: string;
  phone: string | null;
  email: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count: {
    vehicles: number;
  };
}

export interface PaginatedOwners {
  data: OwnerWithVehicleCount[];
  total: number;
  page: number;
  totalPages: number;
}

@Injectable()
export class OwnersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(params: {
    page?: number;
    limit?: number;
    search?: string;
  }): Promise<PaginatedOwners> {
    const { page = 1, limit = 20, search } = params;
    const skip = (page - 1) * limit;

    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { identifier: { contains: search } },
            { phone: { contains: search } },
            { email: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [owners, total] = await Promise.all([
      this.prisma.owner.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: { vehicles: true },
          },
        },
      }),
      this.prisma.owner.count({ where }),
    ]);

    return {
      data: owners,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async search(query: string, limit = 10) {
    if (!query || query.length < 2) {
      return [];
    }

    return this.prisma.owner.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { identifier: { contains: query } },
        ],
      },
      take: limit,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        identifier: true,
        address: true,
        phone: true,
        email: true,
      },
    });
  }

  async findOne(id: string) {
    const owner = await this.prisma.owner.findUnique({
      where: { id },
      include: {
        vehicles: {
          select: {
            id: true,
            registrationNumber: true,
            talonNumber: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        _count: {
          select: { vehicles: true },
        },
      },
    });

    if (!owner) {
      throw new NotFoundException('Собственикът не е намерен');
    }

    return owner;
  }

  async lookupByIdentifier(identifier: string) {
    if (!identifier) {
      return { found: false, owner: null };
    }

    const owner = await this.prisma.owner.findUnique({
      where: { identifier },
      select: {
        id: true,
        name: true,
        identifier: true,
        address: true,
        phone: true,
        email: true,
        _count: { select: { vehicles: true } },
      },
    });

    if (owner) {
      return { found: true, owner };
    }

    return { found: false, owner: null };
  }

  async create(dto: CreateOwnerDto) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.owner.findUnique({
        where: { identifier: dto.identifier },
      });
      if (existing) {
        throw new ConflictException('Собственик с този ЕГН/ЕИК/ЛНЧ вече съществува');
      }

      return tx.owner.create({
        data: dto,
      });
    });
  }

  async update(id: string, dto: UpdateOwnerDto) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.owner.findUnique({
        where: { id },
      });

      if (!existing) {
        throw new NotFoundException('Собственикът не е намерен');
      }

      if (dto.identifier && dto.identifier !== existing.identifier) {
        const existingByIdentifier = await tx.owner.findUnique({
          where: { identifier: dto.identifier },
        });
        if (existingByIdentifier) {
          throw new ConflictException('Собственик с този ЕГН/ЕИК/ЛНЧ вече съществува');
        }
      }

      return tx.owner.update({
        where: { id },
        data: dto,
      });
    });
  }

  async delete(id: string) {
    const owner = await this.prisma.owner.findUnique({
      where: { id },
      include: {
        _count: {
          select: { vehicles: true },
        },
      },
    });

    if (!owner) {
      throw new NotFoundException('Собственикът не е намерен');
    }

    if (owner._count.vehicles > 0) {
      throw new ConflictException(
        `Не може да изтриете собственик с ${owner._count.vehicles} превозни средства`,
      );
    }

    return this.prisma.owner.delete({
      where: { id },
    });
  }
}
