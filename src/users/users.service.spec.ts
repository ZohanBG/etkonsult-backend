import {
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let mockPrisma: any;
  let mockPassword: any;

  beforeEach(() => {
    mockPrisma = {
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      role: {
        findMany: jest.fn(),
      },
      userRole: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      $transaction: jest.fn((cb: (tx: any) => Promise<any>) => cb(mockPrisma)),
    };
    mockPassword = {
      validatePasswordStrength: jest.fn().mockReturnValue({ isValid: true, errors: [] }),
      hashPassword: jest.fn().mockResolvedValue('hashed-pw'),
    };
    service = new UsersService(mockPrisma, mockPassword);
  });

  describe('findAll', () => {
    it('returns paginated users', async () => {
      const users = [{ id: 'u1', roles: [{ role: { id: 'r1', name: 'Admin' } }] }];
      mockPrisma.user.findMany.mockResolvedValue(users);
      mockPrisma.user.count.mockResolvedValue(1);

      const result = await service.findAll({ page: '1', limit: '10' });

      expect(result.data).toHaveLength(1);
      expect(result.pagination).toEqual({ page: 1, limit: 10, total: 1, totalPages: 1 });
    });

    it('applies status filter', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.count.mockResolvedValue(0);

      await service.findAll({ page: '1', limit: '10', status: 'ACTIVE' as any });

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'ACTIVE' }),
        }),
      );
    });

    it('applies search filter across email and username', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.count.mockResolvedValue(0);

      await service.findAll({ page: '1', limit: '10', search: 'john' });

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ OR: expect.any(Array) }),
        }),
      );
    });
  });

  describe('findById', () => {
    it('throws NotFoundException when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.findById('bad-id')).rejects.toThrow(NotFoundException);
    });

    it('returns user with flattened roles', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        roles: [{ role: { id: 'r1', name: 'Admin' } }],
      });

      const result = await service.findById('u1');
      expect(result.roles).toEqual([{ id: 'r1', name: 'Admin' }]);
    });
  });

  describe('create', () => {
    it('throws ConflictException for duplicate email', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(
        service.create({
          email: 'dup@test.com',
          username: 'user',
          password: 'Pass123!',
          roleIds: [],
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException for invalid role IDs', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null); // email not taken
      mockPrisma.role.findMany.mockResolvedValue([]); // no valid roles

      await expect(
        service.create({
          email: 'new@test.com',
          username: 'newuser',
          password: 'Pass123!',
          roleIds: ['bad-role-id'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for weak password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPassword.validatePasswordStrength.mockReturnValue({
        isValid: false,
        errors: ['Too short'],
      });

      await expect(
        service.create({
          email: 'new@test.com',
          username: 'user',
          password: 'bad',
          roleIds: [],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates user with hashed password', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null) // email check
        .mockResolvedValueOnce(null); // username check
      mockPrisma.user.create.mockResolvedValue({
        id: 'new-id',
        email: 'new@test.com',
        username: 'newuser',
        roles: [],
      });

      const result = await service.create({
        email: 'new@test.com',
        username: 'newuser',
        password: 'StrongPass123!',
        roleIds: [],
      });

      expect(result.id).toBe('new-id');
      expect(mockPassword.hashPassword).toHaveBeenCalledWith('StrongPass123!');
    });

    it('throws ConflictException for duplicate username', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null) // email check
        .mockResolvedValueOnce({ id: 'other' }); // username taken

      await expect(
        service.create({
          email: 'new@test.com',
          username: 'taken',
          password: 'Pass123!',
          roleIds: [],
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('delete', () => {
    it('throws NotFoundException when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.delete('bad')).rejects.toThrow(NotFoundException);
    });

    it('soft deletes by setting status to INACTIVE', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      mockPrisma.user.update.mockResolvedValue({});

      await service.delete('u1');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { status: 'INACTIVE' },
      });
    });
  });

  describe('resetTwoFactor', () => {
    it('throws NotFoundException when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.resetTwoFactor('bad')).rejects.toThrow(NotFoundException);
    });

    it('clears TOTP fields', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      mockPrisma.user.update.mockResolvedValue({});

      await service.resetTwoFactor('u1');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { totpSecret: null, totpEnabled: false },
      });
    });
  });

  describe('unlock', () => {
    it('throws NotFoundException when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.unlock('bad')).rejects.toThrow(NotFoundException);
    });

    it('resets lock fields and sets ACTIVE', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      mockPrisma.user.update.mockResolvedValue({});

      await service.unlock('u1');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { status: 'ACTIVE', failedAttempts: 0, lockedUntil: null },
      });
    });
  });
});
