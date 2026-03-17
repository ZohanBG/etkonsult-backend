import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateVehicleDto, UpdateVehicleDto, VehicleFilterDto } from './dto/index.js';

export interface VehicleListItem {
  id: string;
  talonNumber: string;
  registrationNumber: string;
  engineCapacity: string;
  powerKW: string;
  purpose: string;
  rightHandDrive: boolean;
  createdAt: Date;
  owner: {
    id: string;
    name: string;
  } | null;
  _count: {
    images: number;
  };
}

export interface PaginatedVehicles {
  data: VehicleListItem[];
  total: number;
  page: number;
  totalPages: number;
}

@Injectable()
export class VehiclesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(filters: VehicleFilterDto): Promise<PaginatedVehicles> {
    const page = filters.page ? parseInt(filters.page, 10) : 1;
    const limit = filters.limit ? parseInt(filters.limit, 10) : 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    // General search across multiple fields
    if (filters.search) {
      where.OR = [
        { registrationNumber: { contains: filters.search, mode: 'insensitive' } },
        { talonNumber: { contains: filters.search, mode: 'insensitive' } },
        { owner: { name: { contains: filters.search, mode: 'insensitive' } } },
        { owner: { identifier: { contains: filters.search, mode: 'insensitive' } } },
      ];
    }

    // Specific filters
    if (filters.registrationNumber) {
      where.registrationNumber = { contains: filters.registrationNumber, mode: 'insensitive' };
    }
    if (filters.talonNumber) {
      where.talonNumber = { contains: filters.talonNumber, mode: 'insensitive' };
    }
    if (filters.purpose) {
      where.purpose = { contains: filters.purpose, mode: 'insensitive' };
    }
    if (filters.rightHandDrive !== undefined && filters.rightHandDrive !== '') {
      where.rightHandDrive = filters.rightHandDrive === 'true';
    }

    // Owner filters
    const ownerFilters: Record<string, unknown> = {};
    if (filters.ownerName) {
      ownerFilters.name = { contains: filters.ownerName, mode: 'insensitive' };
    }
    if (filters.ownerIdentifier) {
      ownerFilters.identifier = { contains: filters.ownerIdentifier, mode: 'insensitive' };
    }
    if (filters.ownerPhone) {
      ownerFilters.phone = { contains: filters.ownerPhone, mode: 'insensitive' };
    }
    if (Object.keys(ownerFilters).length > 0) {
      where.owner = ownerFilters;
    }

    // Date range filter
    if (filters.createdFrom || filters.createdTo) {
      where.createdAt = {};
      if (filters.createdFrom) {
        (where.createdAt as Record<string, Date>).gte = new Date(filters.createdFrom);
      }
      if (filters.createdTo) {
        (where.createdAt as Record<string, Date>).lte = new Date(filters.createdTo);
      }
    }

    // Sorting
    const sortBy = filters.sortBy || 'createdAt';
    const sortOrder = filters.sortOrder || 'desc';
    const orderBy = { [sortBy]: sortOrder };

    const [vehicles, total] = await Promise.all([
      this.prisma.vehicle.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        select: {
          id: true,
          talonNumber: true,
          registrationNumber: true,
          engineCapacity: true,
          powerKW: true,
          purpose: true,
          rightHandDrive: true,
          createdAt: true,
          owner: {
            select: {
              id: true,
              name: true,
              identifier: true,
              phone: true,
            },
          },
          images: {
            select: {
              id: true,
              path: true,
            },
            take: 4,
            orderBy: { uploadedAt: 'asc' },
          },
          _count: {
            select: { images: true },
          },
        },
      }),
      this.prisma.vehicle.count({ where }),
    ]);

    return {
      data: vehicles,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string) {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id },
      include: {
        owner: true,
        images: {
          orderBy: { uploadedAt: 'asc' },
        },
        createdBy: {
          select: {
            id: true,
            email: true,
            username: true,
          },
        },
      },
    });

    if (!vehicle) {
      throw new NotFoundException('Превозното средство не е намерено');
    }

    return vehicle;
  }

  async create(dto: CreateVehicleDto, userId: string) {
    // Use transaction to ensure atomicity (talon check + create must be atomic)
    return this.prisma.$transaction(async (tx) => {
      // Check for duplicate talon number inside transaction
      const existingByTalon = await tx.vehicle.findUnique({
        where: { talonNumber: dto.talonNumber },
      });
      if (existingByTalon) {
        throw new ConflictException('Превозно средство с този номер на талон вече съществува');
      }
      let ownerId = dto.ownerId;

      // If owner data is provided, create or find the owner within the transaction
      if (dto.owner) {
        // Try to find existing owner by identifier
        const existingOwner = await tx.owner.findUnique({
          where: { identifier: dto.owner.identifier },
        });

        if (existingOwner) {
          ownerId = existingOwner.id;
        } else {
          // Create new owner within transaction
          const newOwner = await tx.owner.create({
            data: {
              identifier: dto.owner.identifier,
              name: dto.owner.name,
              address: dto.owner.address,
              phone: dto.owner.phone,
              email: dto.owner.email,
            },
          });
          ownerId = newOwner.id;
        }
      }

      // Validate that we have an owner
      if (!ownerId) {
        throw new BadRequestException('Трябва да посочите собственик (ownerId или owner данни)');
      }

      // Verify owner exists if ownerId was provided directly
      if (dto.ownerId) {
        const ownerExists = await tx.owner.findUnique({
          where: { id: dto.ownerId },
        });
        if (!ownerExists) {
          throw new BadRequestException('Собственикът не е намерен');
        }
      }

      // Create vehicle within transaction
      return tx.vehicle.create({
        data: {
          talonNumber: dto.talonNumber,
          registrationNumber: dto.registrationNumber.toUpperCase(),
          engineCapacity: dto.engineCapacity,
          powerKW: dto.powerKW,
          purpose: dto.purpose || 'Лични нужди',
          rightHandDrive: dto.rightHandDrive ?? false,
          notes: dto.notes || null,
          ownerId,
          createdById: userId,
        },
        include: {
          owner: true,
          images: true,
        },
      });
    });
  }

  async update(id: string, dto: UpdateVehicleDto) {
    const existing = await this.prisma.vehicle.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('Превозното средство не е намерено');
    }

    // Check for duplicate talon number if changed
    if (dto.talonNumber && dto.talonNumber !== existing.talonNumber) {
      const existingByTalon = await this.prisma.vehicle.findUnique({
        where: { talonNumber: dto.talonNumber },
      });
      if (existingByTalon) {
        throw new ConflictException('Превозно средство с този номер на талон вече съществува');
      }
    }

    // Use transaction to ensure atomicity
    return this.prisma.$transaction(async (tx) => {
      let ownerId = dto.ownerId;

      // If new owner data is provided, create or find the owner within transaction
      if (dto.owner) {
        const existingOwner = await tx.owner.findUnique({
          where: { identifier: dto.owner.identifier },
        });

        if (existingOwner) {
          ownerId = existingOwner.id;
        } else {
          const newOwner = await tx.owner.create({
            data: {
              identifier: dto.owner.identifier,
              name: dto.owner.name,
              address: dto.owner.address,
              phone: dto.owner.phone,
              email: dto.owner.email,
            },
          });
          ownerId = newOwner.id;
        }
      }

      // Verify owner exists if ownerId was provided directly
      if (dto.ownerId) {
        const ownerExists = await tx.owner.findUnique({
          where: { id: dto.ownerId },
        });
        if (!ownerExists) {
          throw new BadRequestException('Собственикът не е намерен');
        }
      }

      // Build update data
      const updateData: Record<string, unknown> = {};

      if (dto.talonNumber !== undefined) updateData.talonNumber = dto.talonNumber;
      if (dto.registrationNumber) updateData.registrationNumber = dto.registrationNumber.toUpperCase();
      if (dto.engineCapacity !== undefined) updateData.engineCapacity = dto.engineCapacity;
      if (dto.powerKW !== undefined) updateData.powerKW = dto.powerKW;
      if (dto.purpose !== undefined) updateData.purpose = dto.purpose;
      if (dto.rightHandDrive !== undefined) updateData.rightHandDrive = dto.rightHandDrive;
      if (dto.notes !== undefined) updateData.notes = dto.notes;
      if (ownerId) updateData.ownerId = ownerId;

      return tx.vehicle.update({
        where: { id },
        data: updateData,
        include: {
          owner: true,
          images: true,
        },
      });
    });
  }

  async delete(id: string) {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id },
    });

    if (!vehicle) {
      throw new NotFoundException('Превозното средство не е намерено');
    }

    // Delete vehicle (images will cascade delete)
    return this.prisma.vehicle.delete({
      where: { id },
    });
  }

  async checkDuplicates(dto: { registrationNumber?: string; talonNumber?: string }) {
    const duplicates: {
      registrationNumber: { exists: boolean; vehicle?: { id: string; talonNumber: string } };
      talonNumber: { exists: boolean; vehicle?: { id: string; registrationNumber: string } };
    } = {
      registrationNumber: { exists: false },
      talonNumber: { exists: false },
    };

    // Check registration number
    if (dto.registrationNumber) {
      const existingByReg = await this.prisma.vehicle.findFirst({
        where: { registrationNumber: { equals: dto.registrationNumber.toUpperCase(), mode: 'insensitive' } },
        select: { id: true, talonNumber: true },
      });
      if (existingByReg) {
        duplicates.registrationNumber = { exists: true, vehicle: existingByReg };
      }
    }

    // Check talon number
    if (dto.talonNumber) {
      const existingByTalon = await this.prisma.vehicle.findUnique({
        where: { talonNumber: dto.talonNumber },
        select: { id: true, registrationNumber: true },
      });
      if (existingByTalon) {
        duplicates.talonNumber = { exists: true, vehicle: existingByTalon };
      }
    }

    return duplicates;
  }
}
