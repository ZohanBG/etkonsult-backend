import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Reflector } from '@nestjs/core';
import { AuditService } from './audit.service.js';

export const AUDIT_ACTION_KEY = 'audit_action';
export const AUDIT_ENTITY_KEY = 'audit_entity';

export interface AuditMetadata {
  action: string;
  entityType: string;
  getEntityId?: (request: Request, response: unknown) => string | undefined;
  getOldValue?: (request: Request) => Promise<Record<string, unknown> | undefined>;
  getNewValue?: (request: Request, response: unknown) => Record<string, unknown> | undefined;
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly auditService: AuditService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const auditMetadata = this.reflector.get<AuditMetadata>(
      AUDIT_ACTION_KEY,
      context.getHandler(),
    );

    // If no audit metadata, just proceed
    if (!auditMetadata) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const ipAddress = request.ip || request.socket?.remoteAddress;
    const userAgent = request.headers['user-agent'];

    return next.handle().pipe(
      tap(async (response) => {
        try {
          const entityId = auditMetadata.getEntityId
            ? auditMetadata.getEntityId(request, response)
            : request.params?.id || (response as { id?: string })?.id;

          let oldValue: Record<string, unknown> | undefined;
          if (auditMetadata.getOldValue) {
            oldValue = await auditMetadata.getOldValue(request);
          }

          const newValue = auditMetadata.getNewValue
            ? auditMetadata.getNewValue(request, response)
            : (response as Record<string, unknown>);

          await this.auditService.log({
            userId: user?.userId,
            action: auditMetadata.action,
            entityType: auditMetadata.entityType,
            entityId,
            oldValue,
            newValue,
            ipAddress,
            userAgent,
          });
        } catch (error) {
          // Log error but don't fail the request
          this.logger.error('Failed to create audit log:', error);
        }
      }),
    );
  }
}

// Decorator for marking methods for auditing
import { SetMetadata } from '@nestjs/common';

export const Audit = (metadata: AuditMetadata) =>
  SetMetadata(AUDIT_ACTION_KEY, metadata);
