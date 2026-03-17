import { NotFoundException, BadRequestException } from '@nestjs/common';
import { RbacService } from './rbac.service';

describe('RbacService', () => {
  let service: RbacService;
  let mockPrisma: any;
  let mockCache: any;

  beforeEach(() => {
    mockPrisma = {
      role: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
      },
      userRole: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
      },
    };
    mockCache = {
      getUserPermissions: jest.fn().mockResolvedValue(null),
      setUserPermissions: jest.fn().mockResolvedValue(undefined),
      invalidateUserPermissions: jest.fn().mockResolvedValue(undefined),
    };
    service = new RbacService(mockPrisma, mockCache);
  });

  describe('getRoleById', () => {
    it('throws NotFoundException when role not found', async () => {
      mockPrisma.role.findUnique.mockResolvedValue(null);
      await expect(service.getRoleById('bad')).rejects.toThrow(NotFoundException);
    });

    it('returns role with user count', async () => {
      mockPrisma.role.findUnique.mockResolvedValue({ id: 'r1', _count: { users: 5 } });
      const result = await service.getRoleById('r1');
      expect(result._count.users).toBe(5);
    });
  });

  describe('createRole', () => {
    it('throws for invalid permissions', async () => {
      await expect(
        service.createRole({ name: 'Test', permissions: ['invalid:perm'], description: '' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws for duplicate name', async () => {
      mockPrisma.role.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(
        service.createRole({ name: 'Existing', permissions: [], description: '' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates role with valid data', async () => {
      mockPrisma.role.findUnique.mockResolvedValue(null);
      mockPrisma.role.create.mockResolvedValue({ id: 'new', name: 'Test' });

      const result = await service.createRole({ name: 'Test', permissions: [], description: '' });
      expect(result.name).toBe('Test');
    });
  });

  describe('updateRole', () => {
    it('throws NotFoundException when not found', async () => {
      mockPrisma.role.findUnique.mockResolvedValue(null);
      await expect(service.updateRole('bad', {})).rejects.toThrow(NotFoundException);
    });

    it('prevents renaming system roles', async () => {
      mockPrisma.role.findUnique.mockResolvedValue({ id: 'r1', isSystem: true, name: 'Admin' });

      await expect(
        service.updateRole('r1', { name: 'Renamed' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('invalidates cache when permissions change', async () => {
      mockPrisma.role.findUnique.mockResolvedValue({ id: 'r1', isSystem: false, name: 'Custom' });
      mockPrisma.role.update.mockResolvedValue({ id: 'r1' });
      mockPrisma.userRole.findMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]);

      await service.updateRole('r1', { permissions: [] });

      expect(mockCache.invalidateUserPermissions).toHaveBeenCalledTimes(2);
    });
  });

  describe('deleteRole', () => {
    it('throws NotFoundException when not found', async () => {
      mockPrisma.role.findUnique.mockResolvedValue(null);
      await expect(service.deleteRole('bad')).rejects.toThrow(NotFoundException);
    });

    it('prevents deleting system roles', async () => {
      mockPrisma.role.findUnique.mockResolvedValue({ id: 'r1', isSystem: true, _count: { users: 0 } });
      await expect(service.deleteRole('r1')).rejects.toThrow(BadRequestException);
    });

    it('prevents deleting roles with assigned users', async () => {
      mockPrisma.role.findUnique.mockResolvedValue({ id: 'r1', isSystem: false, _count: { users: 3 } });
      await expect(service.deleteRole('r1')).rejects.toThrow(BadRequestException);
    });

    it('deletes role with no users', async () => {
      mockPrisma.role.findUnique.mockResolvedValue({ id: 'r1', isSystem: false, _count: { users: 0 } });
      mockPrisma.role.delete.mockResolvedValue({});

      const result = await service.deleteRole('r1');
      expect(result).toEqual({ deleted: true });
    });
  });

  describe('getUserPermissions', () => {
    it('returns cached permissions when available', async () => {
      mockCache.getUserPermissions.mockResolvedValue(['perm1', 'perm2']);

      const result = await service.getUserPermissions('u1');
      expect(result).toEqual(['perm1', 'perm2']);
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('fetches from DB and caches on miss', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        roles: [
          { role: { permissions: ['perm1'] } },
          { role: { permissions: ['perm2', 'perm1'] } }, // duplicate
        ],
      });

      const result = await service.getUserPermissions('u1');
      expect(result).toContain('perm1');
      expect(result).toContain('perm2');
      expect(result).toHaveLength(2); // deduped
      expect(mockCache.setUserPermissions).toHaveBeenCalled();
    });

    it('returns empty array for unknown user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const result = await service.getUserPermissions('bad');
      expect(result).toEqual([]);
    });
  });

  describe('assignRoleToUser', () => {
    it('throws when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.assignRoleToUser('bad', 'r1')).rejects.toThrow(NotFoundException);
    });

    it('throws when role not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      mockPrisma.role.findUnique.mockResolvedValue(null);
      await expect(service.assignRoleToUser('u1', 'bad')).rejects.toThrow(NotFoundException);
    });

    it('returns existing if already assigned', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      mockPrisma.role.findUnique.mockResolvedValue({ id: 'r1' });
      mockPrisma.userRole.findUnique.mockResolvedValue({ userId: 'u1', roleId: 'r1' });

      const result = await service.assignRoleToUser('u1', 'r1');
      expect(result).toEqual({ userId: 'u1', roleId: 'r1' });
      expect(mockPrisma.userRole.create).not.toHaveBeenCalled();
    });

    it('creates assignment and invalidates cache', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      mockPrisma.role.findUnique.mockResolvedValue({ id: 'r1' });
      mockPrisma.userRole.findUnique.mockResolvedValue(null);
      mockPrisma.userRole.create.mockResolvedValue({ userId: 'u1', roleId: 'r1' });

      await service.assignRoleToUser('u1', 'r1');

      expect(mockPrisma.userRole.create).toHaveBeenCalled();
      expect(mockCache.invalidateUserPermissions).toHaveBeenCalledWith('u1');
    });
  });

  describe('removeRoleFromUser', () => {
    it('invalidates cache after removal', async () => {
      mockPrisma.userRole.delete.mockResolvedValue({});

      await service.removeRoleFromUser('u1', 'r1');
      expect(mockCache.invalidateUserPermissions).toHaveBeenCalledWith('u1');
    });
  });
});
