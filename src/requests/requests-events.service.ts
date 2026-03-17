import { Injectable } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';

export interface RequestEvent {
  type: string;
  requestId: string;
  agentId: string;
  registrationNumber: string;
  requestType: 'NOVA_POLICA' | 'VNOSKA';
  newStatus: string;
  actorRole: 'AGENT' | 'STAFF';
}

@Injectable()
export class RequestsEventsService {
  private readonly subject = new Subject<RequestEvent>();

  emit(event: RequestEvent): void {
    this.subject.next(event);
  }

  subscribe(): Observable<RequestEvent> {
    return this.subject.asObservable();
  }
}
