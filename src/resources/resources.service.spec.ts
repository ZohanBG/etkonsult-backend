import { NotFoundException } from '@nestjs/common';
import { ResourcesService } from './resources.service';

// Mock archiver before importing service
jest.mock('archiver', () => {
  const mockArchive = {
    pipe: jest.fn(),
    directory: jest.fn(),
    finalize: jest.fn(),
    on: jest.fn(),
  };
  return jest.fn(() => mockArchive);
});

// Mock fs
jest.mock('fs', () => ({
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
  existsSync: jest.fn().mockReturnValue(true),
  createWriteStream: jest.fn().mockReturnValue({ on: jest.fn() }),
}));

describe('ResourcesService', () => {
  let service: ResourcesService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      resourceSection: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        aggregate: jest.fn(),
      },
      resourceItem: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        aggregate: jest.fn(),
      },
    };
    service = new ResourcesService(mockPrisma);
  });

  describe('getAllSections', () => {
    it('returns sections ordered by order', async () => {
      mockPrisma.resourceSection.findMany.mockResolvedValue([
        { id: 's1', name: 'Section 1', items: [] },
      ]);

      const result = await service.getAllSections();
      expect(result).toHaveLength(1);
    });
  });

  describe('createSection', () => {
    it('creates section with auto-order', async () => {
      mockPrisma.resourceSection.aggregate.mockResolvedValue({ _max: { order: 2 } });
      mockPrisma.resourceSection.create.mockResolvedValue({
        id: 's1',
        name: 'New',
        order: 3,
        items: [],
      });

      const result = await service.createSection({ name: 'New' } as any);
      expect(result.order).toBe(3);
    });

    it('starts order at 0 when no sections exist', async () => {
      mockPrisma.resourceSection.aggregate.mockResolvedValue({ _max: { order: null } });
      mockPrisma.resourceSection.create.mockResolvedValue({
        id: 's1',
        name: 'First',
        order: 0,
        items: [],
      });

      const result = await service.createSection({ name: 'First' } as any);
      expect(result.order).toBe(0);
    });
  });

  describe('updateSection', () => {
    it('throws NotFoundException when not found', async () => {
      mockPrisma.resourceSection.findUnique.mockResolvedValue(null);
      await expect(service.updateSection('bad', {} as any)).rejects.toThrow(NotFoundException);
    });

    it('updates section', async () => {
      mockPrisma.resourceSection.findUnique.mockResolvedValue({ id: 's1' });
      mockPrisma.resourceSection.update.mockResolvedValue({ id: 's1', name: 'Updated' });

      const result = await service.updateSection('s1', { name: 'Updated' } as any);
      expect(result.name).toBe('Updated');
    });
  });

  describe('deleteSection', () => {
    it('throws NotFoundException when not found', async () => {
      mockPrisma.resourceSection.findUnique.mockResolvedValue(null);
      await expect(service.deleteSection('bad')).rejects.toThrow(NotFoundException);
    });

    it('deletes section and cleans up files', async () => {
      mockPrisma.resourceSection.findUnique.mockResolvedValue({
        id: 's1',
        items: [
          { type: 'file', filePath: 'uploads/resources/s1/test.pdf' },
          { type: 'link', filePath: null },
        ],
      });
      mockPrisma.resourceSection.delete.mockResolvedValue({});

      await service.deleteSection('s1');
      expect(mockPrisma.resourceSection.delete).toHaveBeenCalled();
    });
  });

  describe('addLinkItem', () => {
    it('creates link item with auto-order', async () => {
      mockPrisma.resourceSection.findUnique.mockResolvedValue({ id: 's1' });
      mockPrisma.resourceItem.aggregate.mockResolvedValue({ _max: { order: 1 } });
      mockPrisma.resourceItem.create.mockResolvedValue({
        id: 'i1',
        type: 'link',
        title: 'Google',
        url: 'https://google.com',
      });

      const result = await service.addLinkItem('s1', { title: 'Google', url: 'https://google.com' } as any);
      expect(result.type).toBe('link');
    });

    it('throws NotFoundException when section not found', async () => {
      mockPrisma.resourceSection.findUnique.mockResolvedValue(null);
      await expect(
        service.addLinkItem('bad', { title: 'T', url: 'http://x.com' } as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateItem', () => {
    it('throws NotFoundException when item not found', async () => {
      mockPrisma.resourceItem.findUnique.mockResolvedValue(null);
      await expect(service.updateItem('bad', {} as any)).rejects.toThrow(NotFoundException);
    });

    it('updates item fields', async () => {
      mockPrisma.resourceItem.findUnique.mockResolvedValue({ id: 'i1' });
      mockPrisma.resourceItem.update.mockResolvedValue({ id: 'i1', title: 'Updated' });

      const result = await service.updateItem('i1', { title: 'Updated' } as any);
      expect(result.title).toBe('Updated');
    });
  });

  describe('deleteItem', () => {
    it('throws NotFoundException when item not found', async () => {
      mockPrisma.resourceItem.findUnique.mockResolvedValue(null);
      await expect(service.deleteItem('bad')).rejects.toThrow(NotFoundException);
    });

    it('deletes item and cleans up file', async () => {
      mockPrisma.resourceItem.findUnique.mockResolvedValue({
        id: 'i1',
        type: 'file',
        filePath: 'uploads/resources/s1/test.pdf',
      });
      mockPrisma.resourceItem.delete.mockResolvedValue({});

      await service.deleteItem('i1');
      expect(mockPrisma.resourceItem.delete).toHaveBeenCalled();
    });

    it('deletes link item without file cleanup', async () => {
      mockPrisma.resourceItem.findUnique.mockResolvedValue({
        id: 'i1',
        type: 'link',
        filePath: null,
      });
      mockPrisma.resourceItem.delete.mockResolvedValue({});

      await service.deleteItem('i1');
      expect(mockPrisma.resourceItem.delete).toHaveBeenCalled();
    });
  });
});
