import { UnauthorizedException, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from './auth.guard';

describe('AuthGuard', () => {
  let guard: AuthGuard;
  let mockSessionService: { validateSession: jest.Mock };

  beforeEach(() => {
    mockSessionService = {
      validateSession: jest.fn(),
    };
    guard = new AuthGuard(mockSessionService as any);
  });

  function createMockContext(overrides: {
    headers?: Record<string, string>;
    cookies?: Record<string, string>;
    method?: string;
    query?: Record<string, string>;
    ip?: string;
    socket?: { remoteAddress?: string };
  } = {}): ExecutionContext {
    const request = {
      headers: overrides.headers || {},
      cookies: overrides.cookies || {},
      method: overrides.method || 'POST',
      query: overrides.query || {},
      ip: overrides.ip || '127.0.0.1',
      socket: overrides.socket || { remoteAddress: '127.0.0.1' },
    };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  }

  it('throws UnauthorizedException when no token provided', async () => {
    const ctx = createMockContext({ headers: { 'x-fingerprint': 'fp' } });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when no fingerprint provided', async () => {
    const ctx = createMockContext({
      headers: { authorization: 'Bearer token123' },
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('extracts token from Authorization header', async () => {
    mockSessionService.validateSession.mockResolvedValue({
      userId: 'u1',
      sessionId: 's1',
    });
    const ctx = createMockContext({
      headers: { authorization: 'Bearer mytoken', 'x-fingerprint': 'fp' },
    });

    await guard.canActivate(ctx);

    expect(mockSessionService.validateSession).toHaveBeenCalledWith(
      'mytoken',
      'fp',
      '127.0.0.1',
    );
  });

  it('extracts token from cookie when no Authorization header', async () => {
    mockSessionService.validateSession.mockResolvedValue({
      userId: 'u1',
      sessionId: 's1',
    });
    const ctx = createMockContext({
      cookies: { auth_token: 'cookietoken' },
      headers: { 'x-fingerprint': 'fp' },
    });

    await guard.canActivate(ctx);

    expect(mockSessionService.validateSession).toHaveBeenCalledWith(
      'cookietoken',
      'fp',
      '127.0.0.1',
    );
  });

  it('extracts fingerprint from query param for GET requests', async () => {
    mockSessionService.validateSession.mockResolvedValue({
      userId: 'u1',
      sessionId: 's1',
    });
    const ctx = createMockContext({
      headers: { authorization: 'Bearer token' },
      method: 'GET',
      query: { fingerprint: 'query-fp' },
    });

    await guard.canActivate(ctx);

    expect(mockSessionService.validateSession).toHaveBeenCalledWith(
      'token',
      'query-fp',
      '127.0.0.1',
    );
  });

  it('throws when session is invalid', async () => {
    mockSessionService.validateSession.mockResolvedValue(null);
    const ctx = createMockContext({
      headers: { authorization: 'Bearer bad', 'x-fingerprint': 'fp' },
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('attaches user info to request on valid session', async () => {
    mockSessionService.validateSession.mockResolvedValue({
      userId: 'user-123',
      sessionId: 'sess-456',
    });
    const request: any = {
      headers: { authorization: 'Bearer tok', 'x-fingerprint': 'fp' },
      cookies: {},
      method: 'POST',
      query: {},
      ip: '1.2.3.4',
      socket: { remoteAddress: '1.2.3.4' },
    };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(request.user).toEqual({ userId: 'user-123', sessionId: 'sess-456' });
  });

  it('extracts IP from x-forwarded-for header', async () => {
    mockSessionService.validateSession.mockResolvedValue({
      userId: 'u1',
      sessionId: 's1',
    });
    const ctx = createMockContext({
      headers: {
        authorization: 'Bearer tok',
        'x-fingerprint': 'fp',
        'x-forwarded-for': '10.0.0.1, 10.0.0.2',
      },
    });

    await guard.canActivate(ctx);

    expect(mockSessionService.validateSession).toHaveBeenCalledWith(
      'tok',
      'fp',
      '10.0.0.1',
    );
  });
});
