import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { RequestsService } from './requests.service';

describe('RequestsService', () => {
  let service: RequestsService;
  let mockPrisma: any;

  const makeRequest = (overrides: Record<string, unknown> = {}) => ({
    id: 'req-1',
    requestType: 'NOVA_POLICA',
    status: 'ZAYAVENA',
    agentId: 'agent-1',
    registrationNumber: 'CA1234AB',
    images: [],
    ...overrides,
  });

  beforeEach(() => {
    mockPrisma = {
      request: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      requestImage: {
        count: jest.fn(),
        create: jest.fn(),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
      vehicle: {
        findFirst: jest.fn(),
      },
      vehicleImage: {
        findMany: jest.fn(),
        create: jest.fn(),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    service = new RequestsService(mockPrisma);
  });

  // ──────────────────────── create ────────────────────────

  describe('create', () => {
    it('creates NOVA_POLICA request', async () => {
      mockPrisma.request.create.mockResolvedValue(makeRequest());

      const result = await service.create(
        {
          requestType: 'NOVA_POLICA' as any,
          registrationNumber: 'CA1234AB',
          talonNumber: 'T-001',
        } as any,
        'agent-1',
      );

      expect(result.requestType).toBe('NOVA_POLICA');
    });

    it('throws for VNOSKA without insurance or reg+talon', async () => {
      await expect(
        service.create({ requestType: 'VNOSKA' as any } as any, 'agent-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows VNOSKA with insuranceNumber', async () => {
      mockPrisma.request.create.mockResolvedValue(makeRequest({ requestType: 'VNOSKA' }));

      await expect(
        service.create(
          { requestType: 'VNOSKA' as any, insuranceNumber: 'INS-123' } as any,
          'agent-1',
        ),
      ).resolves.toBeDefined();
    });

    it('allows VNOSKA with registrationNumber + talonNumber', async () => {
      mockPrisma.request.create.mockResolvedValue(makeRequest({ requestType: 'VNOSKA' }));

      await expect(
        service.create(
          { requestType: 'VNOSKA' as any, registrationNumber: 'CA1111AB', talonNumber: 'T-1' } as any,
          'agent-1',
        ),
      ).resolves.toBeDefined();
    });
  });

  // ──────────────────────── findOne ────────────────────────

  describe('findOne', () => {
    it('throws NotFoundException for missing request', async () => {
      mockPrisma.request.findUnique.mockResolvedValue(null);
      await expect(service.findOne('bad')).rejects.toThrow(NotFoundException);
    });

    it('returns request with includes', async () => {
      mockPrisma.request.findUnique.mockResolvedValue(makeRequest());
      const result = await service.findOne('req-1');
      expect(result.id).toBe('req-1');
    });
  });

  // ──────────────────────── updateStatus (state machine) ────────────────────────

  describe('updateStatus', () => {
    it('allows ZAYAVENA → OBRABOTENA for NOVA_POLICA', async () => {
      mockPrisma.request.findUnique.mockResolvedValue(makeRequest());
      mockPrisma.request.update.mockResolvedValue(makeRequest({ status: 'OBRABOTENA' }));

      const result = await service.updateStatus('req-1', 'OBRABOTENA' as any, 'staff-1');
      expect(result.status).toBe('OBRABOTENA');
    });

    it('allows ZAYAVENA → OTKAZANA for NOVA_POLICA', async () => {
      mockPrisma.request.findUnique.mockResolvedValue(makeRequest());
      mockPrisma.request.update.mockResolvedValue(makeRequest({ status: 'OTKAZANA' }));

      const result = await service.updateStatus('req-1', 'OTKAZANA' as any, 'staff-1');
      expect(result.status).toBe('OTKAZANA');
    });

    it('rejects ZAYAVENA → PRIETA_OFERTA for NOVA_POLICA', async () => {
      mockPrisma.request.findUnique.mockResolvedValue(makeRequest());

      await expect(
        service.updateStatus('req-1', 'PRIETA_OFERTA' as any, 'staff-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows ZAYAVENA → ZAVURSHENA for VNOSKA', async () => {
      mockPrisma.request.findUnique.mockResolvedValue(
        makeRequest({ requestType: 'VNOSKA' }),
      );
      mockPrisma.request.update.mockResolvedValue(makeRequest({ status: 'ZAVURSHENA' }));

      const result = await service.updateStatus('req-1', 'ZAVURSHENA' as any, 'staff-1');
      expect(result.status).toBe('ZAVURSHENA');
    });

    it('rejects ZAYAVENA → OBRABOTENA for VNOSKA', async () => {
      mockPrisma.request.findUnique.mockResolvedValue(
        makeRequest({ requestType: 'VNOSKA' }),
      );

      await expect(
        service.updateStatus('req-1', 'OBRABOTENA' as any, 'staff-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects transition from terminal state ZAVURSHENA', async () => {
      mockPrisma.request.findUnique.mockResolvedValue(
        makeRequest({ status: 'ZAVURSHENA' }),
      );

      await expect(
        service.updateStatus('req-1', 'ZAYAVENA' as any, 'staff-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('stores cancellation note when declining', async () => {
      mockPrisma.request.findUnique.mockResolvedValue(makeRequest());
      mockPrisma.request.update.mockResolvedValue(makeRequest({ status: 'OTKAZANA' }));

      await service.updateStatus('req-1', 'OTKAZANA' as any, 'staff-1', 'Reason');

      expect(mockPrisma.request.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ cancellationNote: 'Reason' }),
        }),
      );
    });
  });

  // ──────────────────────── cancelOwnRequest ────────────────────────

  describe('cancelOwnRequest', () => {
    it('allows agent to cancel own ZAYAVENA request', async () => {
      mockPrisma.request.findUnique.mockResolvedValue(makeRequest());
      mockPrisma.request.update.mockResolvedValue(
        makeRequest({ status: 'OTKAZANA_OT_AGENT' }),
      );

      const result = await service.cancelOwnRequest('req-1', 'agent-1');
      expect(result.status).toBe('OTKAZANA_OT_AGENT');
    });

    it('rejects cancel by different agent', async () => {
      mockPrisma.request.findUnique.mockResolvedValue(makeRequest());

      await expect(
        service.cancelOwnRequest('req-1', 'other-agent'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects cancel when not ZAYAVENA', async () => {
      mockPrisma.request.findUnique.mockResolvedValue(
        makeRequest({ status: 'OBRABOTENA' }),
      );

      await expect(
        service.cancelOwnRequest('req-1', 'agent-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ──────────────────────── respondToOffer ────────────────────────

  describe('respondToOffer', () => {
    it('allows agent to accept offer on OBRABOTENA request', async () => {
      mockPrisma.request.findUnique.mockResolvedValue(
        makeRequest({ status: 'OBRABOTENA' }),
      );
      mockPrisma.request.update.mockResolvedValue(
        makeRequest({ status: 'PRIETA_OFERTA' }),
      );

      const result = await service.respondToOffer(
        'req-1',
        { status: 'PRIETA_OFERTA' as any, stickerNumber: 'STK001' },
        'agent-1',
      );

      expect(result.status).toBe('PRIETA_OFERTA');
    });

    it('rejects respond by different agent', async () => {
      mockPrisma.request.findUnique.mockResolvedValue(
        makeRequest({ status: 'OBRABOTENA' }),
      );

      await expect(
        service.respondToOffer('req-1', { status: 'PRIETA_OFERTA' as any }, 'other'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects respond when not OBRABOTENA', async () => {
      mockPrisma.request.findUnique.mockResolvedValue(makeRequest());

      await expect(
        service.respondToOffer('req-1', { status: 'PRIETA_OFERTA' as any }, 'agent-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects invalid response status', async () => {
      mockPrisma.request.findUnique.mockResolvedValue(
        makeRequest({ status: 'OBRABOTENA' }),
      );

      await expect(
        service.respondToOffer('req-1', { status: 'ZAVURSHENA' as any }, 'agent-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ──────────────────────── checkActiveByRegs ────────────────────────

  describe('checkActiveByRegs', () => {
    it('returns empty object for empty input', async () => {
      const result = await service.checkActiveByRegs([]);
      expect(result).toEqual({});
    });

    it('returns latest active request per reg number', async () => {
      mockPrisma.request.findMany.mockResolvedValue([
        { registrationNumber: 'CA1111AB', status: 'ZAYAVENA', createdAt: new Date('2025-01-01') },
        { registrationNumber: 'CA1111AB', status: 'OBRABOTENA', createdAt: new Date('2024-01-01') },
      ]);

      const result = await service.checkActiveByRegs(['CA1111AB']);
      expect(result['CA1111AB'].status).toBe('ZAYAVENA');
    });
  });

  // ──────────────────────── copyPhotosToVehicle ────────────────────────

  describe('copyPhotosToVehicle', () => {
    it('throws when vehicle not found', async () => {
      mockPrisma.request.findUnique.mockResolvedValue(
        makeRequest({ images: [{ imageType: 'photo', path: '/a.jpg' }] }),
      );
      mockPrisma.vehicle.findFirst.mockResolvedValue(null);

      await expect(service.copyPhotosToVehicle('req-1')).rejects.toThrow(BadRequestException);
    });

    it('throws when no photos to copy', async () => {
      mockPrisma.request.findUnique.mockResolvedValue(makeRequest({ images: [] }));
      mockPrisma.vehicle.findFirst.mockResolvedValue({ id: 'v1' });

      await expect(service.copyPhotosToVehicle('req-1')).rejects.toThrow(BadRequestException);
    });

    it('throws when all photos already copied', async () => {
      mockPrisma.request.findUnique.mockResolvedValue(
        makeRequest({ images: [{ imageType: 'photo', path: '/a.jpg' }] }),
      );
      mockPrisma.vehicle.findFirst.mockResolvedValue({ id: 'v1' });
      mockPrisma.vehicleImage.findMany.mockResolvedValue([{ path: '/a.jpg' }]);

      await expect(service.copyPhotosToVehicle('req-1')).rejects.toThrow(BadRequestException);
    });

    it('throws when exceeding vehicle capacity of 10', async () => {
      const photos = Array.from({ length: 5 }, (_, i) => ({
        imageType: 'photo',
        path: `/new${i}.jpg`,
        originalName: `new${i}.jpg`,
        mimeType: 'image/jpeg',
        size: 1000,
      }));
      mockPrisma.request.findUnique.mockResolvedValue(makeRequest({ images: photos }));
      mockPrisma.vehicle.findFirst.mockResolvedValue({ id: 'v1' });
      mockPrisma.vehicleImage.findMany.mockResolvedValue(
        Array.from({ length: 7 }, (_, i) => ({ path: `/existing${i}.jpg` })),
      );

      await expect(service.copyPhotosToVehicle('req-1')).rejects.toThrow(BadRequestException);
    });

    it('copies new photos to vehicle', async () => {
      mockPrisma.request.findUnique.mockResolvedValue(
        makeRequest({
          images: [
            { imageType: 'photo', path: '/a.jpg', originalName: 'a.jpg', mimeType: 'image/jpeg', size: 100 },
          ],
        }),
      );
      mockPrisma.vehicle.findFirst.mockResolvedValue({ id: 'v1' });
      mockPrisma.vehicleImage.findMany.mockResolvedValue([]);
      mockPrisma.vehicleImage.createMany.mockResolvedValue({ count: 1 });

      const result = await service.copyPhotosToVehicle('req-1');
      expect(result.copiedCount).toBe(1);
      expect(mockPrisma.vehicleImage.createMany).toHaveBeenCalledTimes(1);
    });
  });
});
