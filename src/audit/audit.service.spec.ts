import { AuditService } from './audit.service';

describe('AuditService', () => {
  let service: AuditService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
      },
    };
    service = new AuditService(mockPrisma);
  });

  describe('log', () => {
    it('creates audit log entry', async () => {
      await service.log({
        userId: 'u1',
        action: 'CREATE',
        entityType: 'User',
        entityId: 'u2',
      });

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'CREATE',
          entityType: 'User',
        }),
      });
    });

    it('creates entry without userId (system action)', async () => {
      await service.log({
        action: 'SERVER_ERROR',
        entityType: 'Error',
      });

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: undefined,
          action: 'SERVER_ERROR',
        }),
      });
    });
  });

  describe('findAll', () => {
    it('returns paginated results', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([{ id: 'log1' }]);
      mockPrisma.auditLog.count.mockResolvedValue(1);

      const result = await service.findAll({ page: '1', limit: '10' });

      expect(result.data).toHaveLength(1);
      expect(result.totalPages).toBe(1);
    });

    it('applies filters', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.count.mockResolvedValue(0);

      await service.findAll({
        userId: 'u1',
        action: 'CREATE',
        entityType: 'User',
        startDate: '2025-01-01',
        endDate: '2025-12-31',
      });

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'u1',
            entityType: 'User',
          }),
        }),
      );
    });
  });

  describe('findOne', () => {
    it('returns audit log by id', async () => {
      mockPrisma.auditLog.findUnique.mockResolvedValue({ id: 'log1' });
      const result = await service.findOne('log1');
      expect(result?.id).toBe('log1');
    });
  });

  describe('getEntityTypes', () => {
    it('returns distinct entity types', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([
        { entityType: 'User' },
        { entityType: 'Vehicle' },
      ]);

      const result = await service.getEntityTypes();
      expect(result).toEqual(['User', 'Vehicle']);
    });
  });

  describe('getActions', () => {
    it('returns distinct actions', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([
        { action: 'CREATE' },
        { action: 'DELETE' },
      ]);

      const result = await service.getActions();
      expect(result).toEqual(['CREATE', 'DELETE']);
    });
  });
});
