import {
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { VehiclesService } from './vehicles.service';

describe('VehiclesService', () => {
  let service: VehiclesService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      vehicle: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
      owner: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      $transaction: jest.fn((fn: any) => fn(mockPrisma)),
    };
    service = new VehiclesService(mockPrisma);
  });

  describe('findAll', () => {
    it('should return paginated results with defaults', async () => {
      const vehicles = [{ id: '1', talonNumber: 'T001' }];
      mockPrisma.vehicle.findMany.mockResolvedValue(vehicles);
      mockPrisma.vehicle.count.mockResolvedValue(1);

      const result = await service.findAll({});

      expect(result).toEqual({
        data: vehicles,
        total: 1,
        page: 1,
        totalPages: 1,
      });
      expect(mockPrisma.vehicle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
          orderBy: { createdAt: 'desc' },
        }),
      );
      expect(mockPrisma.vehicle.count).toHaveBeenCalledWith({ where: {} });
    });

    it('should apply search filter', async () => {
      mockPrisma.vehicle.findMany.mockResolvedValue([]);
      mockPrisma.vehicle.count.mockResolvedValue(0);

      await service.findAll({ search: 'test' });

      expect(mockPrisma.vehicle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { registrationNumber: { contains: 'test', mode: 'insensitive' } },
              { talonNumber: { contains: 'test', mode: 'insensitive' } },
              { owner: { name: { contains: 'test', mode: 'insensitive' } } },
              { owner: { identifier: { contains: 'test', mode: 'insensitive' } } },
            ],
          },
        }),
      );
    });

    it('should apply specific filters (registrationNumber, purpose, rightHandDrive)', async () => {
      mockPrisma.vehicle.findMany.mockResolvedValue([]);
      mockPrisma.vehicle.count.mockResolvedValue(0);

      await service.findAll({
        registrationNumber: 'AB1234',
        purpose: 'Лични нужди',
        rightHandDrive: 'true',
      });

      expect(mockPrisma.vehicle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            registrationNumber: { contains: 'AB1234', mode: 'insensitive' },
            purpose: { contains: 'Лични нужди', mode: 'insensitive' },
            rightHandDrive: true,
          },
        }),
      );
    });

    it('should apply owner filters', async () => {
      mockPrisma.vehicle.findMany.mockResolvedValue([]);
      mockPrisma.vehicle.count.mockResolvedValue(0);

      await service.findAll({
        ownerName: 'Иван',
        ownerIdentifier: '1234567890',
        ownerPhone: '0888',
      });

      expect(mockPrisma.vehicle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            owner: {
              name: { contains: 'Иван', mode: 'insensitive' },
              identifier: { contains: '1234567890', mode: 'insensitive' },
              phone: { contains: '0888', mode: 'insensitive' },
            },
          },
        }),
      );
    });

    it('should apply date range filter', async () => {
      mockPrisma.vehicle.findMany.mockResolvedValue([]);
      mockPrisma.vehicle.count.mockResolvedValue(0);

      await service.findAll({
        createdFrom: '2025-01-01',
        createdTo: '2025-12-31',
      });

      expect(mockPrisma.vehicle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            createdAt: {
              gte: new Date('2025-01-01'),
              lte: new Date('2025-12-31'),
            },
          },
        }),
      );
    });
  });

  describe('findOne', () => {
    it('should return a vehicle', async () => {
      const vehicle = { id: '1', talonNumber: 'T001', owner: {}, images: [] };
      mockPrisma.vehicle.findUnique.mockResolvedValue(vehicle);

      const result = await service.findOne('1');

      expect(result).toEqual(vehicle);
      expect(mockPrisma.vehicle.findUnique).toHaveBeenCalledWith({
        where: { id: '1' },
        include: {
          owner: true,
          images: { orderBy: { uploadedAt: 'asc' } },
          createdBy: { select: { id: true, email: true, username: true } },
        },
      });
    });

    it('should throw NotFoundException when vehicle not found', async () => {
      mockPrisma.vehicle.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    const userId = 'user-1';

    it('should create vehicle with ownerId', async () => {
      const dto = {
        talonNumber: 'T001',
        registrationNumber: 'ab1234cd',
        engineCapacity: '2000',
        powerKW: '110',
        ownerId: 'owner-1',
      };
      const created = { id: 'v1', ...dto, registrationNumber: 'AB1234CD' };

      mockPrisma.vehicle.findUnique.mockResolvedValue(null); // no duplicate talon
      mockPrisma.owner.findUnique.mockResolvedValue({ id: 'owner-1' }); // owner exists
      mockPrisma.vehicle.create.mockResolvedValue(created);

      const result = await service.create(dto as any, userId);

      expect(result).toEqual(created);
      expect(mockPrisma.vehicle.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            talonNumber: 'T001',
            registrationNumber: 'AB1234CD',
            ownerId: 'owner-1',
            createdById: userId,
          }),
        }),
      );
    });

    it('should create vehicle with inline owner data (new owner)', async () => {
      const dto = {
        talonNumber: 'T002',
        registrationNumber: 'XY5678ZZ',
        engineCapacity: '1600',
        powerKW: '90',
        owner: {
          identifier: '9901011234',
          name: 'Иван Иванов',
          address: 'ул. Тестова 1',
          phone: '0888123456',
          email: 'ivan@test.bg',
        },
      };

      mockPrisma.vehicle.findUnique.mockResolvedValue(null); // no duplicate talon
      mockPrisma.owner.findUnique.mockResolvedValue(null); // owner does not exist
      mockPrisma.owner.create.mockResolvedValue({ id: 'new-owner-1' });
      mockPrisma.vehicle.create.mockResolvedValue({ id: 'v2', ownerId: 'new-owner-1' });

      const result = await service.create(dto as any, userId);

      expect(mockPrisma.owner.create).toHaveBeenCalledWith({
        data: {
          identifier: '9901011234',
          name: 'Иван Иванов',
          address: 'ул. Тестова 1',
          phone: '0888123456',
          email: 'ivan@test.bg',
        },
      });
      expect(result.ownerId).toBe('new-owner-1');
    });

    it('should create vehicle with inline owner data (existing owner)', async () => {
      const dto = {
        talonNumber: 'T003',
        registrationNumber: 'ZZ0000AA',
        engineCapacity: '1400',
        powerKW: '75',
        owner: {
          identifier: '8801011234',
          name: 'Петър Петров',
        },
      };

      mockPrisma.vehicle.findUnique.mockResolvedValue(null); // no duplicate talon
      mockPrisma.owner.findUnique.mockResolvedValue({ id: 'existing-owner-1' });
      mockPrisma.vehicle.create.mockResolvedValue({ id: 'v3', ownerId: 'existing-owner-1' });

      const result = await service.create(dto as any, userId);

      expect(mockPrisma.owner.create).not.toHaveBeenCalled();
      expect(result.ownerId).toBe('existing-owner-1');
    });

    it('should throw ConflictException on duplicate talon', async () => {
      const dto = {
        talonNumber: 'T001',
        registrationNumber: 'AB1234CD',
        engineCapacity: '2000',
        powerKW: '110',
        ownerId: 'owner-1',
      };

      mockPrisma.vehicle.findUnique.mockResolvedValue({ id: 'existing-v1' });

      await expect(service.create(dto as any, userId)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw BadRequestException when no ownerId and no owner data', async () => {
      const dto = {
        talonNumber: 'T004',
        registrationNumber: 'NO0000OW',
        engineCapacity: '1000',
        powerKW: '50',
      };

      mockPrisma.vehicle.findUnique.mockResolvedValue(null); // no duplicate talon

      await expect(service.create(dto as any, userId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('update', () => {
    it('should update vehicle', async () => {
      const existing = { id: 'v1', talonNumber: 'T001' };
      const dto = { registrationNumber: 'new1234ab' };
      const updated = { ...existing, registrationNumber: 'NEW1234AB' };

      mockPrisma.vehicle.findUnique.mockResolvedValue(existing);
      mockPrisma.vehicle.update.mockResolvedValue(updated);

      const result = await service.update('v1', dto as any);

      expect(result).toEqual(updated);
      expect(mockPrisma.vehicle.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'v1' },
          data: { registrationNumber: 'NEW1234AB' },
        }),
      );
    });

    it('should throw NotFoundException when vehicle not found', async () => {
      mockPrisma.vehicle.findUnique.mockResolvedValue(null);

      await expect(service.update('nonexistent', {} as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ConflictException on duplicate talon change', async () => {
      const existing = { id: 'v1', talonNumber: 'T001' };
      mockPrisma.vehicle.findUnique
        .mockResolvedValueOnce(existing) // first call: find existing vehicle
        .mockResolvedValueOnce({ id: 'v2', talonNumber: 'T002' }); // second call: duplicate check

      await expect(
        service.update('v1', { talonNumber: 'T002' } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('should create new owner inline during update', async () => {
      const existing = { id: 'v1', talonNumber: 'T001' };
      const dto = {
        owner: {
          identifier: '7701011234',
          name: 'Нов Собственик',
          address: 'ул. Нова 5',
        },
      };

      mockPrisma.vehicle.findUnique.mockResolvedValue(existing);
      mockPrisma.owner.findUnique.mockResolvedValue(null); // owner does not exist
      mockPrisma.owner.create.mockResolvedValue({ id: 'new-owner-2' });
      mockPrisma.vehicle.update.mockResolvedValue({ id: 'v1', ownerId: 'new-owner-2' });

      const result = await service.update('v1', dto as any);

      expect(mockPrisma.owner.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          identifier: '7701011234',
          name: 'Нов Собственик',
          address: 'ул. Нова 5',
        }),
      });
      expect(result.ownerId).toBe('new-owner-2');
    });
  });

  describe('delete', () => {
    it('should delete vehicle', async () => {
      const vehicle = { id: 'v1', talonNumber: 'T001' };
      mockPrisma.vehicle.findUnique.mockResolvedValue(vehicle);
      mockPrisma.vehicle.delete.mockResolvedValue(vehicle);

      const result = await service.delete('v1');

      expect(result).toEqual(vehicle);
      expect(mockPrisma.vehicle.delete).toHaveBeenCalledWith({
        where: { id: 'v1' },
      });
    });

    it('should throw NotFoundException when vehicle not found', async () => {
      mockPrisma.vehicle.findUnique.mockResolvedValue(null);

      await expect(service.delete('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('checkDuplicates', () => {
    it('should find registration duplicate', async () => {
      mockPrisma.vehicle.findFirst.mockResolvedValue({
        id: 'v1',
        talonNumber: 'T001',
      });
      mockPrisma.vehicle.findUnique.mockResolvedValue(null);

      const result = await service.checkDuplicates({
        registrationNumber: 'AB1234CD',
      });

      expect(result.registrationNumber).toEqual({
        exists: true,
        vehicle: { id: 'v1', talonNumber: 'T001' },
      });
      expect(result.talonNumber).toEqual({ exists: false });
    });

    it('should find talon duplicate', async () => {
      mockPrisma.vehicle.findFirst.mockResolvedValue(null);
      mockPrisma.vehicle.findUnique.mockResolvedValue({
        id: 'v2',
        registrationNumber: 'XY5678ZZ',
      });

      const result = await service.checkDuplicates({
        talonNumber: 'T002',
      });

      expect(result.talonNumber).toEqual({
        exists: true,
        vehicle: { id: 'v2', registrationNumber: 'XY5678ZZ' },
      });
      expect(result.registrationNumber).toEqual({ exists: false });
    });

    it('should return no duplicates', async () => {
      mockPrisma.vehicle.findFirst.mockResolvedValue(null);
      mockPrisma.vehicle.findUnique.mockResolvedValue(null);

      const result = await service.checkDuplicates({
        registrationNumber: 'UNIQUE00',
        talonNumber: 'TUNIQUE',
      });

      expect(result.registrationNumber).toEqual({ exists: false });
      expect(result.talonNumber).toEqual({ exists: false });
    });
  });
});
