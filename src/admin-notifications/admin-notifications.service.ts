import { Injectable } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';

export type AdminNotificationVariant = 'info' | 'success' | 'warning' | 'danger';

export interface AdminNotificationEvent {
  id: string;
  source: 'admin';
  title: string;
  body: string;
  variant: AdminNotificationVariant;
  // Targeting — resolved on the frontend:
  // 'all' | specific user IDs list (empty = all)
  targetUserIds: string[]; // empty means broadcast to everyone
}

@Injectable()
export class AdminNotificationsService {
  private readonly subject = new Subject<AdminNotificationEvent>();

  emit(event: AdminNotificationEvent): void {
    this.subject.next(event);
  }

  subscribe(): Observable<AdminNotificationEvent> {
    return this.subject.asObservable();
  }
}
