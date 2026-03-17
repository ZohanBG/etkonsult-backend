import { BadRequestException } from '@nestjs/common';
import { UploadsService } from './uploads.service';

// Mock dependencies
jest.mock('sharp', () => {
  return jest.fn().mockReturnValue({
    webp: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('webp-data')),
  });
});

// file-type is ESM-only; use manual mock from src/__mocks__/file-type.ts

jest.mock('pdf-poppler', () => ({
  convert: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
  readdir: jest.fn().mockResolvedValue([]),
}));

describe('UploadsService', () => {
  let service: UploadsService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      vehicleImage: {
        count: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      $transaction: jest.fn((fn: any) => fn(mockPrisma)),
    };
    service = new UploadsService(mockPrisma);
  });

  describe('processAndSaveImage', () => {
    const mockFile = {
      buffer: Buffer.from('test-image-data'),
      originalname: 'photo.jpg',
      size: 5000,
      mimetype: 'image/jpeg',
    } as Express.Multer.File;

    it('processes and saves an image', async () => {
      const result = await service.processAndSaveImage(mockFile, 'entity-1', 0);

      expect(result).toHaveProperty('path');
      expect(result).toHaveProperty('originalName', 'photo.jpg');
      expect(result).toHaveProperty('mimeType', 'image/webp');
    });

    it('rejects files over 10MB', async () => {
      const bigFile = { ...mockFile, size: 11 * 1024 * 1024 };

      await expect(
        service.processAndSaveImage(bigFile as any, 'entity-1', 0),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('processAndSaveFiles', () => {
    it('processes multiple files', async () => {
      const files = [
        { buffer: Buffer.alloc(100, 0xff), originalname: 'a.jpg', size: 100, mimetype: 'image/jpeg' },
        { buffer: Buffer.alloc(100, 0xff), originalname: 'b.jpg', size: 200, mimetype: 'image/jpeg' },
      ] as Express.Multer.File[];

      const result = await service.processAndSaveFiles(files, 'entity-1');
      expect(result).toHaveLength(2);
    });
  });

  describe('cleanupFiles', () => {
    it('deletes files from filesystem', async () => {
      await expect(service.cleanupFiles(['vehicles/2024-01-01/a.jpg', 'vehicles/2024-01-01/b.jpg'])).resolves.not.toThrow();
    });
  });

  describe('getVehicleImages', () => {
    it('returns images for vehicle', async () => {
      mockPrisma.vehicleImage.findMany.mockResolvedValue([{ id: 'img1' }]);

      const result = await service.getVehicleImages('v1');
      expect(result).toHaveLength(1);
    });
  });

  describe('getVehicleImageCount', () => {
    it('returns count', async () => {
      mockPrisma.vehicleImage.count.mockResolvedValue(5);
      const result = await service.getVehicleImageCount('v1');
      expect(result).toBe(5);
    });
  });

  describe('deleteVehicleImage', () => {
    it('deletes image and file', async () => {
      mockPrisma.vehicleImage.findUnique.mockResolvedValue({
        id: 'img1',
        path: 'uploads/test.webp',
      });
      mockPrisma.vehicleImage.delete.mockResolvedValue({});

      await service.deleteVehicleImage('img1');
      expect(mockPrisma.vehicleImage.delete).toHaveBeenCalled();
    });

    it('throws when image not found', async () => {
      mockPrisma.vehicleImage.findUnique.mockResolvedValue(null);
      await expect(service.deleteVehicleImage('bad')).rejects.toThrow();
    });
  });

  describe('uploadVehicleImages', () => {
    it('processes files and creates DB records', async () => {
      const files = [
        { buffer: Buffer.alloc(100, 0xff), originalname: 'a.jpg', size: 100, mimetype: 'image/jpeg' },
      ] as Express.Multer.File[];

      mockPrisma.vehicleImage.count.mockResolvedValue(0);
      mockPrisma.vehicleImage.create.mockResolvedValue({ id: 'img1' });

      const result = await service.uploadVehicleImages(files, 'v1');
      expect(result).toHaveLength(1);
    });
  });
});
