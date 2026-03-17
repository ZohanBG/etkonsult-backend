import { PushNotificationsService } from './push-notifications.service';
import type { PushPayload } from './push-notifications.service';

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn().mockResolvedValue({}),
}));

import * as webpush from 'web-push';

describe('PushNotificationsService', () => {
  let service: PushNotificationsService;
  let mockPrisma: any;
  let mockConfigService: any;
  let mockNotificationsService: any;

  beforeEach(() => {
    mockPrisma = {
      pushSubscription: {
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };

    mockConfigService = {
      getOrThrow: jest.fn((key: string) => {
        const map: Record<string, string> = {
          VAPID_SUBJECT: 'mailto:test@example.com',
          VAPID_PUBLIC_KEY: 'test-public-key',
          VAPID_PRIVATE_KEY: 'test-private-key',
        };
        return map[key];
      }),
    };

    mockNotificationsService = {
      create: jest.fn().mockResolvedValue({}),
      createForUsers: jest.fn().mockResolvedValue({}),
    };

    service = new PushNotificationsService(
      mockPrisma,
      mockConfigService,
      mockNotificationsService,
    );

    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should call setVapidDetails with config values', () => {
      // Constructor was already called in beforeEach; re-create to capture mock calls
      jest.clearAllMocks();
      new PushNotificationsService(mockPrisma, mockConfigService, mockNotificationsService);
      expect(webpush.setVapidDetails).toHaveBeenCalledWith(
        'mailto:test@example.com',
        'test-public-key',
        'test-private-key',
      );
    });
  });

  describe('getVapidPublicKey', () => {
    it('should return the VAPID public key from config', () => {
      const key = service.getVapidPublicKey();
      expect(key).toBe('test-public-key');
      expect(mockConfigService.getOrThrow).toHaveBeenCalledWith('VAPID_PUBLIC_KEY');
    });
  });

  describe('saveSubscription', () => {
    it('should upsert a push subscription', async () => {
      const userId = 'user-1';
      const subscription = {
        endpoint: 'https://push.example.com/abc',
        keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
      };

      await service.saveSubscription(userId, subscription);

      expect(mockPrisma.pushSubscription.upsert).toHaveBeenCalledWith({
        where: { endpoint: 'https://push.example.com/abc' },
        update: { userId, p256dh: 'p256dh-key', auth: 'auth-key' },
        create: {
          userId,
          endpoint: 'https://push.example.com/abc',
          p256dh: 'p256dh-key',
          auth: 'auth-key',
        },
      });
    });
  });

  describe('deleteSubscription', () => {
    it('should delete subscriptions by endpoint', async () => {
      await service.deleteSubscription('https://push.example.com/abc');
      expect(mockPrisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
        where: { endpoint: 'https://push.example.com/abc' },
      });
    });
  });

  describe('sendToUser', () => {
    const payload: PushPayload = {
      title: 'Test',
      body: 'Test body',
      url: '/test',
      variant: 'info',
    };

    it('should do nothing if user has no subscriptions', async () => {
      mockPrisma.pushSubscription.findMany.mockResolvedValue([]);
      await service.sendToUser('user-1', payload);
      expect(webpush.sendNotification).not.toHaveBeenCalled();
    });

    it('should send push notification to all user subscriptions', async () => {
      const subs = [
        { id: 's1', endpoint: 'https://push.example.com/1', p256dh: 'key1', auth: 'auth1' },
        { id: 's2', endpoint: 'https://push.example.com/2', p256dh: 'key2', auth: 'auth2' },
      ];
      mockPrisma.pushSubscription.findMany.mockResolvedValue(subs);

      await service.sendToUser('user-1', payload);

      expect(webpush.sendNotification).toHaveBeenCalledTimes(2);
      expect(webpush.sendNotification).toHaveBeenCalledWith(
        { endpoint: 'https://push.example.com/1', keys: { p256dh: 'key1', auth: 'auth1' } },
        JSON.stringify(payload),
      );
      expect(webpush.sendNotification).toHaveBeenCalledWith(
        { endpoint: 'https://push.example.com/2', keys: { p256dh: 'key2', auth: 'auth2' } },
        JSON.stringify(payload),
      );
    });

    it('should delete subscription when push returns 410 (Gone)', async () => {
      const subs = [
        { id: 's1', endpoint: 'https://push.example.com/1', p256dh: 'key1', auth: 'auth1' },
      ];
      mockPrisma.pushSubscription.findMany.mockResolvedValue(subs);
      (webpush.sendNotification as jest.Mock).mockRejectedValueOnce({ statusCode: 410, message: 'Gone' });

      await service.sendToUser('user-1', payload);

      expect(mockPrisma.pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { id: 's1' } });
    });

    it('should delete subscription when push returns 404', async () => {
      const subs = [
        { id: 's1', endpoint: 'https://push.example.com/1', p256dh: 'key1', auth: 'auth1' },
      ];
      mockPrisma.pushSubscription.findMany.mockResolvedValue(subs);
      (webpush.sendNotification as jest.Mock).mockRejectedValueOnce({ statusCode: 404, message: 'Not Found' });

      await service.sendToUser('user-1', payload);

      expect(mockPrisma.pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { id: 's1' } });
    });

    it('should log warning for other push errors without deleting', async () => {
      const subs = [
        { id: 's1', endpoint: 'https://push.example.com/1', p256dh: 'key1', auth: 'auth1' },
      ];
      mockPrisma.pushSubscription.findMany.mockResolvedValue(subs);
      (webpush.sendNotification as jest.Mock).mockRejectedValueOnce({ statusCode: 500, message: 'Server Error' });

      await service.sendToUser('user-1', payload);

      expect(mockPrisma.pushSubscription.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('sendToUsers', () => {
    it('should call sendToUser for each userId', async () => {
      const payload: PushPayload = { title: 'Hi', body: 'Hello', url: '/', variant: 'info' };
      const spy = jest.spyOn(service, 'sendToUser').mockResolvedValue();

      await service.sendToUsers(['user-1', 'user-2', 'user-3'], payload);

      expect(spy).toHaveBeenCalledTimes(3);
      expect(spy).toHaveBeenCalledWith('user-1', payload);
      expect(spy).toHaveBeenCalledWith('user-2', payload);
      expect(spy).toHaveBeenCalledWith('user-3', payload);
    });
  });

  describe('sendToAll', () => {
    it('should fetch distinct userIds and send to all', async () => {
      mockPrisma.pushSubscription.findMany.mockResolvedValue([
        { userId: 'user-1' },
        { userId: 'user-2' },
      ]);
      const spy = jest.spyOn(service, 'sendToUsers').mockResolvedValue();
      const payload: PushPayload = { title: 'All', body: 'Broadcast', url: '/', variant: 'info' };

      await service.sendToAll(payload);

      expect(mockPrisma.pushSubscription.findMany).toHaveBeenCalledWith({
        select: { userId: true },
        distinct: ['userId'],
      });
      expect(spy).toHaveBeenCalledWith(['user-1', 'user-2'], payload);
    });
  });

  describe('sendRequestEvent', () => {
    const baseEvent = {
      requestId: 'req-1',
      registrationNumber: 'ABC-123',
      requestType: 'NOVA_POLICA' as const,
      agentId: 'agent-1',
    };

    describe('when actorRole is AGENT', () => {
      it('should send push to staff users on request created', async () => {
        mockPrisma.$queryRaw.mockResolvedValue([{ id: 'staff-1' }, { id: 'staff-2' }]);
        const sendToUsersSpy = jest.spyOn(service, 'sendToUsers').mockResolvedValue();

        await service.sendRequestEvent({
          ...baseEvent,
          actorRole: 'AGENT',
          type: 'created',
          newStatus: undefined as any,
        });

        expect(sendToUsersSpy).toHaveBeenCalledWith(
          ['staff-1', 'staff-2'],
          expect.objectContaining({
            title: 'Нова заявка за нова полица',
            body: 'рег. ABC-123',
            variant: 'info',
          }),
        );
        expect(mockNotificationsService.createForUsers).toHaveBeenCalledWith(
          ['staff-1', 'staff-2'],
          expect.objectContaining({ title: 'Нова заявка за нова полица' }),
        );
      });

      it('should send push to staff on PRIETA_OFERTA', async () => {
        mockPrisma.$queryRaw.mockResolvedValue([{ id: 'staff-1' }]);
        const sendToUsersSpy = jest.spyOn(service, 'sendToUsers').mockResolvedValue();

        await service.sendRequestEvent({
          ...baseEvent,
          actorRole: 'AGENT',
          type: 'status_changed',
          newStatus: 'PRIETA_OFERTA',
        });

        expect(sendToUsersSpy).toHaveBeenCalledWith(
          ['staff-1'],
          expect.objectContaining({ title: 'Агентът прие офертата', variant: 'success' }),
        );
      });

      it('should send push to staff on OTKAZANA_OFERTA', async () => {
        mockPrisma.$queryRaw.mockResolvedValue([{ id: 'staff-1' }]);
        const sendToUsersSpy = jest.spyOn(service, 'sendToUsers').mockResolvedValue();

        await service.sendRequestEvent({
          ...baseEvent,
          actorRole: 'AGENT',
          type: 'status_changed',
          newStatus: 'OTKAZANA_OFERTA',
        });

        expect(sendToUsersSpy).toHaveBeenCalledWith(
          ['staff-1'],
          expect.objectContaining({ title: 'Агентът отхвърли офертата', variant: 'danger' }),
        );
      });

      it('should send push to staff on OTKAZANA_OT_AGENT', async () => {
        mockPrisma.$queryRaw.mockResolvedValue([{ id: 'staff-1' }]);
        const sendToUsersSpy = jest.spyOn(service, 'sendToUsers').mockResolvedValue();

        await service.sendRequestEvent({
          ...baseEvent,
          actorRole: 'AGENT',
          type: 'status_changed',
          newStatus: 'OTKAZANA_OT_AGENT',
        });

        expect(sendToUsersSpy).toHaveBeenCalledWith(
          ['staff-1'],
          expect.objectContaining({ title: 'Агентът отказа заявката', variant: 'warning' }),
        );
      });

      it('should do nothing when no staff users found', async () => {
        mockPrisma.$queryRaw.mockResolvedValue([]);
        const sendToUsersSpy = jest.spyOn(service, 'sendToUsers').mockResolvedValue();

        await service.sendRequestEvent({
          ...baseEvent,
          actorRole: 'AGENT',
          type: 'created',
          newStatus: undefined as any,
        });

        expect(sendToUsersSpy).not.toHaveBeenCalled();
      });

      it('should use "вноска" label for VNOSKA request type', async () => {
        mockPrisma.$queryRaw.mockResolvedValue([{ id: 'staff-1' }]);
        const sendToUsersSpy = jest.spyOn(service, 'sendToUsers').mockResolvedValue();

        await service.sendRequestEvent({
          ...baseEvent,
          requestType: 'VNOSKA' as any,
          actorRole: 'AGENT',
          type: 'created',
          newStatus: undefined as any,
        });

        expect(sendToUsersSpy).toHaveBeenCalledWith(
          ['staff-1'],
          expect.objectContaining({ title: 'Нова заявка за вноска' }),
        );
      });
    });

    describe('when actorRole is STAFF', () => {
      it('should send push to agent on OBRABOTENA', async () => {
        const sendToUserSpy = jest.spyOn(service, 'sendToUser').mockResolvedValue();

        await service.sendRequestEvent({
          ...baseEvent,
          actorRole: 'STAFF',
          type: 'status_changed',
          newStatus: 'OBRABOTENA',
        });

        expect(sendToUserSpy).toHaveBeenCalledWith(
          'agent-1',
          expect.objectContaining({ title: 'Получихте оферта', variant: 'info' }),
        );
        expect(mockNotificationsService.create).toHaveBeenCalledWith(
          'agent-1',
          expect.objectContaining({ title: 'Получихте оферта' }),
        );
      });

      it('should send push to agent on ZAVURSHENA', async () => {
        const sendToUserSpy = jest.spyOn(service, 'sendToUser').mockResolvedValue();

        await service.sendRequestEvent({
          ...baseEvent,
          actorRole: 'STAFF',
          type: 'status_changed',
          newStatus: 'ZAVURSHENA',
        });

        expect(sendToUserSpy).toHaveBeenCalledWith(
          'agent-1',
          expect.objectContaining({ title: 'Заявката е завършена', variant: 'success' }),
        );
      });

      it('should send push to agent on OTKAZANA', async () => {
        const sendToUserSpy = jest.spyOn(service, 'sendToUser').mockResolvedValue();

        await service.sendRequestEvent({
          ...baseEvent,
          actorRole: 'STAFF',
          type: 'status_changed',
          newStatus: 'OTKAZANA',
        });

        expect(sendToUserSpy).toHaveBeenCalledWith(
          'agent-1',
          expect.objectContaining({ title: 'Заявката е отказана', variant: 'danger' }),
        );
      });

      it('should not send push for unhandled STAFF status', async () => {
        const sendToUserSpy = jest.spyOn(service, 'sendToUser').mockResolvedValue();

        await service.sendRequestEvent({
          ...baseEvent,
          actorRole: 'STAFF',
          type: 'status_changed',
          newStatus: 'SOME_UNKNOWN_STATUS' as any,
        });

        expect(sendToUserSpy).not.toHaveBeenCalled();
        expect(mockNotificationsService.create).not.toHaveBeenCalled();
      });
    });
  });
});
