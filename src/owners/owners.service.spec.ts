import { NotFoundException, ConflictException } from '@nestjs/common';
import { OwnersService } from './owners.service';

describe('OwnersService', () => {
  let service: OwnersService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      owner: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn((cb: (tx: any) => Promise<any>) => cb(mockPrisma)),
    };
    service = new OwnersService(mockPrisma);
  });

  describe('findAll', () => {
    it('returns paginated owners', async () => {
      mockPrisma.owner.findMany.mockResolvedValue([{ id: 'o1' }]);
      mockPrisma.owner.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 10 });
      expect(result.data).toHaveLength(1);
      expect(result.totalPages).toBe(1);
    });

    it('applies search filter across multiple fields', async () => {
      mockPrisma.owner.findMany.mockResolvedValue([]);
      mockPrisma.owner.count.mockResolvedValue(0);

      await service.findAll({ search: 'john' });

      expect(mockPrisma.owner.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ OR: expect.any(Array) }),
        }),
      );
    });
  });

  describe('search', () => {
    it('returns empty for query shorter than 2 chars', async () => {
      const result = await service.search('a');
      expect(result).toEqual([]);
      expect(mockPrisma.owner.findMany).not.toHaveBeenCalled();
    });

    it('returns empty for empty query', async () => {
      const result = await service.search('');
      expect(result).toEqual([]);
    });

    it('searches by name and identifier', async () => {
      mockPrisma.owner.findMany.mockResolvedValue([{ id: 'o1' }]);

      const result = await service.search('John');
      expect(result).toHaveLength(1);
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when not found', async () => {
      mockPrisma.owner.findUnique.mockResolvedValue(null);
      await expect(service.findOne('bad')).rejects.toThrow(NotFoundException);
    });

    it('returns owner with vehicles', async () => {
      mockPrisma.owner.findUnique.mockResolvedValue({ id: 'o1', vehicles: [] });
      const result = await service.findOne('o1');
      expect(result.id).toBe('o1');
    });
  });

  describe('lookupByIdentifier', () => {
    it('returns found: false for empty identifier', async () => {
      const result = await service.lookupByIdentifier('');
      expect(result).toEqual({ found: false, owner: null });
    });

    it('returns found: true when owner exists', async () => {
      mockPrisma.owner.findUnique.mockResolvedValue({ id: 'o1', name: 'Test' });
      const result = await service.lookupByIdentifier('EGN123');
      expect(result.found).toBe(true);
    });

    it('returns found: false when owner does not exist', async () => {
      mockPrisma.owner.findUnique.mockResolvedValue(null);
      const result = await service.lookupByIdentifier('EGN999');
      expect(result.found).toBe(false);
    });
  });

  describe('create', () => {
    it('throws ConflictException for duplicate identifier', async () => {
      mockPrisma.owner.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(
        service.create({ identifier: 'dup', name: 'Test', address: 'Addr' } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('creates owner', async () => {
      mockPrisma.owner.findUnique.mockResolvedValue(null);
      mockPrisma.owner.create.mockResolvedValue({ id: 'new' });

      const result = await service.create({ identifier: 'EGN1', name: 'Test', address: 'Addr' } as any);
      expect(result.id).toBe('new');
    });
  });

  describe('update', () => {
    it('throws NotFoundException when not found', async () => {
      mockPrisma.owner.findUnique.mockResolvedValue(null);
      await expect(service.update('bad', {} as any)).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException for duplicate identifier', async () => {
      mockPrisma.owner.findUnique
        .mockResolvedValueOnce({ id: 'o1', identifier: 'EGN1' })
        .mockResolvedValueOnce({ id: 'other' }); // existing by new identifier

      await expect(
        service.update('o1', { identifier: 'EGN2' } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('updates owner', async () => {
      mockPrisma.owner.findUnique.mockResolvedValue({ id: 'o1', identifier: 'EGN1' });
      mockPrisma.owner.update.mockResolvedValue({ id: 'o1', name: 'Updated' });

      const result = await service.update('o1', { name: 'Updated' } as any);
      expect(result.name).toBe('Updated');
    });
  });

  describe('delete', () => {
    it('throws NotFoundException when not found', async () => {
      mockPrisma.owner.findUnique.mockResolvedValue(null);
      await expect(service.delete('bad')).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when owner has vehicles', async () => {
      mockPrisma.owner.findUnique.mockResolvedValue({
        id: 'o1',
        _count: { vehicles: 3 },
      });

      await expect(service.delete('o1')).rejects.toThrow(ConflictException);
    });

    it('deletes owner with no vehicles', async () => {
      mockPrisma.owner.findUnique.mockResolvedValue({
        id: 'o1',
        _count: { vehicles: 0 },
      });
      mockPrisma.owner.delete.mockResolvedValue({});

      await service.delete('o1');
      expect(mockPrisma.owner.delete).toHaveBeenCalledWith({ where: { id: 'o1' } });
    });
  });
});
