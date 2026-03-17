import { EventsGateway } from './events.gateway';
import { Subject } from 'rxjs';

describe('EventsGateway', () => {
  let gateway: EventsGateway;
  let mockSessionService: any;
  let mockRequestsEventsService: any;
  let mockNotificationsSyncService: any;
  let requestEvents$: Subject<any>;
  let notificationSync$: Subject<any>;
  let mockServer: any;

  beforeEach(() => {
    requestEvents$ = new Subject();
    notificationSync$ = new Subject();

    mockSessionService = {
      validateSession: jest.fn(),
    };

    mockRequestsEventsService = {
      subscribe: jest.fn().mockReturnValue(requestEvents$.asObservable()),
    };

    mockNotificationsSyncService = {
      subscribe: jest.fn().mockReturnValue(notificationSync$.asObservable()),
    };

    mockServer = {
      emit: jest.fn(),
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    };

    gateway = new EventsGateway(
      mockSessionService,
      mockRequestsEventsService,
      mockNotificationsSyncService,
    );
    gateway.server = mockServer;
  });

  afterEach(() => {
    // Clean up subscriptions if onModuleInit was called
    gateway.onModuleDestroy();
  });

  describe('onModuleInit', () => {
    it('should subscribe to request events and broadcast them', () => {
      gateway.onModuleInit();

      const event = { type: 'created', requestId: 'req-1' };
      requestEvents$.next(event);

      expect(mockServer.emit).toHaveBeenCalledWith('request:event', event);
    });

    it('should subscribe to notification sync and emit to user room', () => {
      gateway.onModuleInit();

      const event = { userId: 'user-1', type: 'new', notificationId: 'n-1' };
      notificationSync$.next(event);

      expect(mockServer.to).toHaveBeenCalledWith('user:user-1');
      expect(mockServer.to('user:user-1').emit).toHaveBeenCalledWith('notification:sync', event);
    });
  });

  describe('onModuleDestroy', () => {
    it('should unsubscribe from all subscriptions', () => {
      gateway.onModuleInit();

      // Verify subscriptions are active by emitting an event
      requestEvents$.next({ type: 'test' });
      expect(mockServer.emit).toHaveBeenCalledTimes(1);

      gateway.onModuleDestroy();

      // After destroy, events should not trigger emit
      mockServer.emit.mockClear();
      requestEvents$.next({ type: 'test-after-destroy' });
      expect(mockServer.emit).not.toHaveBeenCalled();
    });
  });

  describe('handleConnection', () => {
    let mockClient: any;

    beforeEach(() => {
      mockClient = {
        id: 'socket-1',
        data: {},
        handshake: {
          auth: { token: 'valid-token', fingerprint: 'fp-123' },
          headers: {},
        },
        disconnect: jest.fn(),
        join: jest.fn(),
      };
    });

    it('should authenticate and join user room on valid session', async () => {
      mockSessionService.validateSession.mockResolvedValue({ userId: 'user-1' });

      await gateway.handleConnection(mockClient);

      expect(mockSessionService.validateSession).toHaveBeenCalledWith('valid-token', 'fp-123');
      expect(mockClient.data.userId).toBe('user-1');
      expect(mockClient.join).toHaveBeenCalledWith('user:user-1');
      expect(mockClient.disconnect).not.toHaveBeenCalled();
    });

    it('should disconnect client when token is missing', async () => {
      mockClient.handshake.auth = { fingerprint: 'fp-123' };

      await gateway.handleConnection(mockClient);

      expect(mockClient.disconnect).toHaveBeenCalled();
      expect(mockSessionService.validateSession).not.toHaveBeenCalled();
    });

    it('should disconnect client when fingerprint is missing', async () => {
      mockClient.handshake.auth = { token: 'valid-token' };

      await gateway.handleConnection(mockClient);

      expect(mockClient.disconnect).toHaveBeenCalled();
      expect(mockSessionService.validateSession).not.toHaveBeenCalled();
    });

    it('should disconnect client when session is invalid', async () => {
      mockSessionService.validateSession.mockResolvedValue(null);

      await gateway.handleConnection(mockClient);

      expect(mockClient.disconnect).toHaveBeenCalled();
      expect(mockClient.join).not.toHaveBeenCalled();
    });

    it('should disconnect client when session validation throws', async () => {
      mockSessionService.validateSession.mockRejectedValue(new Error('DB error'));

      await gateway.handleConnection(mockClient);

      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it('should extract token from cookie when auth token is absent', async () => {
      mockClient.handshake.auth = { fingerprint: 'fp-123' };
      mockClient.handshake.headers.cookie = 'other=val; auth_token=cookie-token-123; path=/';
      mockSessionService.validateSession.mockResolvedValue({ userId: 'user-2' });

      await gateway.handleConnection(mockClient);

      expect(mockSessionService.validateSession).toHaveBeenCalledWith('cookie-token-123', 'fp-123');
      expect(mockClient.join).toHaveBeenCalledWith('user:user-2');
    });

    it('should disconnect when cookie has no auth_token', async () => {
      mockClient.handshake.auth = { fingerprint: 'fp-123' };
      mockClient.handshake.headers.cookie = 'other=val; session=abc';

      await gateway.handleConnection(mockClient);

      expect(mockClient.disconnect).toHaveBeenCalled();
    });
  });

  describe('handleDisconnect', () => {
    it('should handle disconnect without errors', () => {
      const mockClient = { id: 'socket-1' };
      // Should not throw
      expect(() => gateway.handleDisconnect(mockClient as any)).not.toThrow();
    });
  });
});
