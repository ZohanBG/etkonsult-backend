import { AdminNotificationsService } from './admin-notifications.service';

describe('AdminNotificationsService', () => {
  let service: AdminNotificationsService;

  beforeEach(() => {
    service = new AdminNotificationsService();
  });

  it('emits events to subscribers', (done) => {
    const event = {
      id: '1',
      source: 'admin' as const,
      title: 'Test',
      body: 'Body',
      variant: 'info' as const,
      targetUserIds: [],
    };

    service.subscribe().subscribe((received) => {
      expect(received).toEqual(event);
      done();
    });

    service.emit(event);
  });

  it('emits to targeted users', (done) => {
    const event = {
      id: '2',
      source: 'admin' as const,
      title: 'Targeted',
      body: 'For user',
      variant: 'warning' as const,
      targetUserIds: ['u1', 'u2'],
    };

    service.subscribe().subscribe((received) => {
      expect(received.targetUserIds).toEqual(['u1', 'u2']);
      done();
    });

    service.emit(event);
  });
});
