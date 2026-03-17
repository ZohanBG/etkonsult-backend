import { Injectable } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';

export interface NotificationSyncEvent {
  type: 'created' | 'read' | 'read_all' | 'cleared';
  userId: string;
  notificationId?: string;
  notification?: {
    id: string;
    title: string;
    body: string;
    variant: string;
    requestId: string | null;
    requestType: string | null;
    isAdminBroadcast: boolean;
    read: boolean;
    createdAt: string;
  };
}

@Injectable()
export class NotificationsSyncService {
  private readonly subject = new Subject<NotificationSyncEvent>();

  emit(event: NotificationSyncEvent): void {
    this.subject.next(event);
  }

  subscribe(): Observable<NotificationSyncEvent> {
    return this.subject.asObservable();
  }
}
