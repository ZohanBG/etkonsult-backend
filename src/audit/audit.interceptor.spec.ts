import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { AuditInterceptor, AUDIT_ACTION_KEY } from './audit.interceptor';

describe('AuditInterceptor', () => {
  let interceptor: AuditInterceptor;
  let mockAuditService: { log: jest.Mock };
  let mockReflector: { get: jest.Mock };

  beforeEach(() => {
    mockAuditService = { log: jest.fn().mockResolvedValue(undefined) };
    mockReflector = { get: jest.fn() };
    interceptor = new AuditInterceptor(mockAuditService as any, mockReflector as any);
  });

  function createContext(overrides: {
    user?: { userId: string };
    params?: Record<string, string>;
    ip?: string;
    userAgent?: string;
  } = {}): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          user: overrides.user,
          params: overrides.params || {},
          ip: overrides.ip || '127.0.0.1',
          socket: { remoteAddress: '127.0.0.1' },
          headers: { 'user-agent': overrides.userAgent || 'test-agent' },
        }),
      }),
      getHandler: () => ({}),
    } as unknown as ExecutionContext;
  }

  const nextHandler: CallHandler = {
    handle: () => of({ id: 'entity-1', name: 'test' }),
  };

  it('passes through without auditing when no metadata', (done) => {
    mockReflector.get.mockReturnValue(undefined);
    const ctx = createContext();

    interceptor.intercept(ctx, nextHandler).subscribe((result) => {
      expect(result).toEqual({ id: 'entity-1', name: 'test' });
      // Wait a tick for the tap to complete
      setTimeout(() => {
        expect(mockAuditService.log).not.toHaveBeenCalled();
        done();
      }, 10);
    });
  });

  it('logs audit entry when metadata is present', (done) => {
    mockReflector.get.mockReturnValue({
      action: 'CREATE',
      entityType: 'Vehicle',
    });
    const ctx = createContext({
      user: { userId: 'user-1' },
      params: { id: 'v-123' },
    });

    interceptor.intercept(ctx, nextHandler).subscribe(() => {
      setTimeout(() => {
        expect(mockAuditService.log).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: 'user-1',
            action: 'CREATE',
            entityType: 'Vehicle',
            entityId: 'v-123',
          }),
        );
        done();
      }, 10);
    });
  });

  it('uses response.id as entityId when no params.id', (done) => {
    mockReflector.get.mockReturnValue({
      action: 'CREATE',
      entityType: 'User',
    });
    const ctx = createContext({ user: { userId: 'u1' } });

    interceptor.intercept(ctx, nextHandler).subscribe(() => {
      setTimeout(() => {
        expect(mockAuditService.log).toHaveBeenCalledWith(
          expect.objectContaining({ entityId: 'entity-1' }),
        );
        done();
      }, 10);
    });
  });

  it('uses custom getEntityId when provided', (done) => {
    mockReflector.get.mockReturnValue({
      action: 'UPDATE',
      entityType: 'Request',
      getEntityId: (_req: any, res: any) => res.name,
    });
    const ctx = createContext({ user: { userId: 'u1' } });

    interceptor.intercept(ctx, nextHandler).subscribe(() => {
      setTimeout(() => {
        expect(mockAuditService.log).toHaveBeenCalledWith(
          expect.objectContaining({ entityId: 'test' }),
        );
        done();
      }, 10);
    });
  });

  it('does not fail request when audit logging throws', (done) => {
    mockAuditService.log.mockRejectedValue(new Error('DB error'));
    mockReflector.get.mockReturnValue({
      action: 'DELETE',
      entityType: 'Item',
    });
    const ctx = createContext({ user: { userId: 'u1' } });

    interceptor.intercept(ctx, nextHandler).subscribe((result) => {
      expect(result).toEqual({ id: 'entity-1', name: 'test' });
      done();
    });
  });
});
