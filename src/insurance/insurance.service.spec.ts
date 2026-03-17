import { NotFoundException, BadRequestException } from '@nestjs/common';
import { InsuranceService } from './insurance.service';

describe('InsuranceService', () => {
  let service: InsuranceService;
  let mockPrisma: any;
  let mockGoogleSheets: any;
  let mockSyncService: any;

  beforeEach(() => {
    mockPrisma = {
      insuranceSpreadsheet: {
        findMany: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
      insurancePolicy: {
        deleteMany: jest.fn(),
        findMany: jest.fn(),
      },
      agentMapping: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      $queryRaw: jest.fn(),
    };
    mockGoogleSheets = {
      getAvailableSheets: jest.fn(),
    };
    mockSyncService = {
      initialSync: jest.fn().mockResolvedValue({ rowCount: 0 }),
      syncActiveSheets: jest.fn().mockResolvedValue(undefined),
      archiveSpreadsheet: jest.fn().mockResolvedValue({ rowCount: 10 }),
      refreshArchive: jest.fn().mockResolvedValue({ rowCount: 10 }),
      deleteSnapshot: jest.fn(),
    };
    service = new InsuranceService(mockPrisma, mockGoogleSheets, mockSyncService);
  });

  describe('getSpreadsheets', () => {
    it('returns spreadsheets with policy count', async () => {
      mockPrisma.insuranceSpreadsheet.findMany.mockResolvedValue([
        { id: 's1', label: 'Test', _count: { policies: 5 } },
      ]);

      const result = await service.getSpreadsheets();
      expect(result).toHaveLength(1);
    });
  });

  describe('addSpreadsheet', () => {
    it('creates spreadsheet and triggers background sync', async () => {
      mockPrisma.insuranceSpreadsheet.create.mockResolvedValue({
        id: 's1',
        spreadsheetId: 'sheet-123-valid-id',
        _count: { policies: 0 },
      });

      const result = await service.addSpreadsheet({
        spreadsheetId: 'sheet-123-valid-id',
        label: 'Test',
        year: 2025,
      } as any);

      expect(result.id).toBe('s1');
    });

    it('extracts spreadsheet ID from full URL', async () => {
      mockPrisma.insuranceSpreadsheet.create.mockResolvedValue({
        id: 's1',
        spreadsheetId: 'extracted-id-long-enough',
        _count: { policies: 0 },
      });

      await service.addSpreadsheet({
        spreadsheetId: 'https://docs.google.com/spreadsheets/d/extracted-id-long-enough/edit',
        label: 'From URL',
        year: 2025,
      } as any);

      expect(mockPrisma.insuranceSpreadsheet.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ spreadsheetId: 'extracted-id-long-enough' }),
        }),
      );
    });
  });

  describe('removeSpreadsheet', () => {
    it('throws NotFoundException when not found', async () => {
      mockPrisma.insuranceSpreadsheet.findUnique.mockResolvedValue(null);
      await expect(service.removeSpreadsheet('bad')).rejects.toThrow(NotFoundException);
    });

    it('deletes config (cascade) and cleans up snapshot', async () => {
      mockPrisma.insuranceSpreadsheet.findUnique.mockResolvedValue({ id: 's1' });
      mockPrisma.insuranceSpreadsheet.delete.mockResolvedValue({});

      await service.removeSpreadsheet('s1');

      expect(mockPrisma.insuranceSpreadsheet.delete).toHaveBeenCalledWith({ where: { id: 's1' } });
      expect(mockSyncService.deleteSnapshot).toHaveBeenCalledWith('s1');
    });
  });

  describe('forceSync', () => {
    it('delegates to sync service', async () => {
      await service.forceSync();
      expect(mockSyncService.syncActiveSheets).toHaveBeenCalled();
    });
  });

  describe('archiveSpreadsheet', () => {
    it('throws NotFoundException when not found', async () => {
      mockPrisma.insuranceSpreadsheet.findUnique.mockResolvedValue(null);
      await expect(service.archiveSpreadsheet('bad')).rejects.toThrow(NotFoundException);
    });

    it('delegates to sync service', async () => {
      mockPrisma.insuranceSpreadsheet.findUnique.mockResolvedValue({ id: 's1' });
      const result = await service.archiveSpreadsheet('s1');
      expect(result.rowCount).toBe(10);
    });
  });

  describe('getUniqueAgentNames', () => {
    it('returns distinct agent names', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        { agent: 'Agent A' },
        { agent: 'Agent B' },
      ]);

      const result = await service.getUniqueAgentNames();
      expect(result).toEqual(['Agent A', 'Agent B']);
    });
  });

  describe('getAgentMappings', () => {
    it('returns mappings with user info', async () => {
      mockPrisma.agentMapping.findMany.mockResolvedValue([
        { id: 'm1', agentName: 'Agent A', user: { id: 'u1', email: 'a@b.com' } },
      ]);

      const result = await service.getAgentMappings();
      expect(result).toHaveLength(1);
    });
  });

  describe('createAgentMapping', () => {
    it('creates mapping', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      mockPrisma.agentMapping.create.mockResolvedValue({ id: 'm1' });

      const result = await service.createAgentMapping({ userId: 'u1', agentName: 'Agent A' } as any);
      expect(result.id).toBe('m1');
    });
  });

  describe('removeAgentMapping', () => {
    it('deletes mapping', async () => {
      mockPrisma.agentMapping.findUnique.mockResolvedValue({ id: 'm1' });
      mockPrisma.agentMapping.delete.mockResolvedValue({});
      await service.removeAgentMapping('m1');
      expect(mockPrisma.agentMapping.delete).toHaveBeenCalled();
    });
  });

  describe('getUsersForMapping', () => {
    it('returns active users', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'u1', email: 'a@b.com', username: 'agent1' },
      ]);

      const result = await service.getUsersForMapping();
      expect(result).toHaveLength(1);
    });
  });

  describe('getExpiryStats', () => {
    it('returns stats from raw query', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        { status: 'expired', count: BigInt(5) },
        { status: 'active', count: BigInt(10) },
      ]);

      const result = await service.getExpiryStats();
      expect(result).toBeDefined();
    });
  });

  describe('getVehicleHistory', () => {
    it('returns policies for reg number', async () => {
      mockPrisma.insurancePolicy.findMany.mockResolvedValue([
        {
          id: 'p1',
          policyNumber: 'P-1',
          registrationNumber: 'CA1111AB',
          company: 'DZI',
          ownerName: 'Test',
          startDate: new Date(),
          expiryDate: new Date(),
          agent: 'Agent A',
          sheetMonth: 'Jan',
          spreadsheet: { label: 'Sheet 2025', year: 2025 },
        },
      ]);

      const result = await service.getVehicleHistory('CA1111AB');
      expect(result).toHaveLength(1);
      expect(result[0].policyNumber).toBe('P-1');
    });
  });
});
