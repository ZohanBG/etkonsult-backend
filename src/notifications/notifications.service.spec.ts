import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let mockPrisma: any;
  let mockSyncService: any;

  beforeEach(() => {
    mockPrisma = {
      notification: {
        create: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    mockSyncService = {
      emit: jest.fn(),
    };
    service = new NotificationsService(mockPrisma, mockSyncService);
  });

  describe('create', () => {
    it('creates notification and emits event', async () => {
      const notification = {
        id: 'n1',
        title: 'Test',
        body: 'Body',
        variant: 'info',
        requestId: null,
        requestType: null,
        isAdminBroadcast: false,
        read: false,
        createdAt: new Date('2025-01-01'),
      };
      mockPrisma.notification.create.mockResolvedValue(notification);

      const result = await service.create('u1', { title: 'Test', body: 'Body', variant: 'info' });

      expect(result.id).toBe('n1');
      expect(mockSyncService.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'created', userId: 'u1' }),
      );
    });
  });

  describe('createForUsers', () => {
    it('creates notifications for multiple users', async () => {
      mockPrisma.notification.create.mockResolvedValue({
        id: 'n1', title: 'T', body: 'B', variant: 'info',
        requestId: null, requestType: null, isAdminBroadcast: false,
        read: false, createdAt: new Date(),
      });

      await service.createForUsers(['u1', 'u2'], { title: 'T', body: 'B', variant: 'info' });

      expect(mockPrisma.notification.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('findForUser', () => {
    it('returns notifications for user', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([{ id: 'n1' }]);
      const result = await service.findForUser('u1');
      expect(result).toHaveLength(1);
    });
  });

  describe('markRead', () => {
    it('marks notification as read and emits', async () => {
      await service.markRead('u1', 'n1');
      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
        where: { id: 'n1', userId: 'u1' },
        data: { read: true },
      });
      expect(mockSyncService.emit).toHaveBeenCalledWith({ type: 'read', userId: 'u1', notificationId: 'n1' });
    });
  });

  describe('markAllRead', () => {
    it('marks all as read and emits', async () => {
      await service.markAllRead('u1');
      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', read: false },
        data: { read: true },
      });
      expect(mockSyncService.emit).toHaveBeenCalledWith({ type: 'read_all', userId: 'u1' });
    });
  });

  describe('clearAll', () => {
    it('deletes all and emits', async () => {
      await service.clearAll('u1');
      expect(mockPrisma.notification.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
      expect(mockSyncService.emit).toHaveBeenCalledWith({ type: 'cleared', userId: 'u1' });
    });
  });
});
