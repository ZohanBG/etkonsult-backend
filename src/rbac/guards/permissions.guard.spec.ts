import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let mockReflector: { getAllAndOverride: jest.Mock };
  let mockPrisma: { user: { findUnique: jest.Mock } };

  beforeEach(() => {
    mockReflector = { getAllAndOverride: jest.fn() };
    mockPrisma = { user: { findUnique: jest.fn() } };
    guard = new PermissionsGuard(mockReflector as any, mockPrisma as any);
  });

  function createContext(user?: { userId: string; sessionId: string }): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  }

  it('allows access when no permissions required', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(undefined);
    const result = await guard.canActivate(createContext());
    expect(result).toBe(true);
  });

  it('allows access when permissions array is empty', async () => {
    mockReflector.getAllAndOverride.mockReturnValue([]);
    const result = await guard.canActivate(createContext());
    expect(result).toBe(true);
  });

  it('throws ForbiddenException when user is not on request', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(['user:read']);
    await expect(guard.canActivate(createContext(undefined))).rejects.toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when user not found in DB', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(['user:read']);
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const ctx = createContext({ userId: 'u1', sessionId: 's1' });

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when user has no matching permissions', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(['user:delete']);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      roles: [{ role: { permissions: ['user:read', 'user:update'] } }],
    });
    const ctx = createContext({ userId: 'u1', sessionId: 's1' });

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('allows when user has one of the required permissions', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(['user:read', 'user:delete']);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      roles: [{ role: { permissions: ['user:read'] } }],
    });
    const ctx = createContext({ userId: 'u1', sessionId: 's1' });

    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('aggregates permissions across multiple roles', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(['vehicle:delete']);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      roles: [
        { role: { permissions: ['user:read'] } },
        { role: { permissions: ['vehicle:delete'] } },
      ],
    });
    const ctx = createContext({ userId: 'u1', sessionId: 's1' });

    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });
});
