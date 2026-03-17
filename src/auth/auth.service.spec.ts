import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { PasswordService } from './services/password.service';
import { BackoffService } from './services/backoff.service';
import { ConfigService } from '@nestjs/config';

describe('AuthService', () => {
  let service: AuthService;
  let mockPrisma: any;
  let mockCache: any;
  let mockPassword: any;
  let mockBackoff: any;

  beforeEach(async () => {
    mockPrisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      userRole: {
        findMany: jest.fn(),
      },
    };
    mockCache = {
      getUser: jest.fn().mockResolvedValue(null),
      setUser: jest.fn().mockResolvedValue(undefined),
      invalidateUser: jest.fn().mockResolvedValue(undefined),
    };
    mockPassword = {
      comparePassword: jest.fn(),
      hashPassword: jest.fn(),
      validatePasswordStrength: jest.fn().mockReturnValue({ isValid: true, errors: [] }),
      dummyHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhash',
    };
    mockBackoff = {
      checkBackoff: jest.fn(),
      getLockUntil: jest.fn(),
      maxAttempts: 10,
    };

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CacheService, useValue: mockCache },
        { provide: PasswordService, useValue: mockPassword },
        { provide: BackoffService, useValue: mockBackoff },
        { provide: ConfigService, useValue: { get: () => 'test-secret' } },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  describe('login', () => {
    const baseUser = {
      id: 'u1',
      email: 'test@test.com',
      status: 'ACTIVE',
      passwordHash: 'hashed',
      failedAttempts: 0,
      lastFailedAttempt: null,
      lockedUntil: null,
      totpEnabled: false,
      totpSecret: null,
    };

    it('throws UnauthorizedException for non-existent user (constant-time)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPassword.comparePassword.mockResolvedValue(false);

      await expect(
        service.login({ email: 'none@test.com', password: 'pw', fingerprint: 'fp' }),
      ).rejects.toThrow(UnauthorizedException);

      // Should still call comparePassword against dummyHash for constant timing
      expect(mockPassword.comparePassword).toHaveBeenCalledWith('pw', mockPassword.dummyHash);
    });

    it('throws UnauthorizedException for INACTIVE user (constant-time)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...baseUser, status: 'INACTIVE' });
      mockPassword.comparePassword.mockResolvedValue(false);

      await expect(
        service.login({ email: 'test@test.com', password: 'pw', fingerprint: 'fp' }),
      ).rejects.toThrow(UnauthorizedException);

      // Should still call comparePassword for constant timing
      expect(mockPassword.comparePassword).toHaveBeenCalled();
    });

    it('throws ForbiddenException when account is locked (after correct password)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(baseUser);
      mockPassword.comparePassword.mockResolvedValue(true);
      mockBackoff.checkBackoff.mockReturnValue({
        canAttempt: false,
        isLocked: true,
        lockRemainingSeconds: 600,
        waitSeconds: 0,
      });

      await expect(
        service.login({ email: 'test@test.com', password: 'pw', fingerprint: 'fp' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when backoff delay active (after correct password)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(baseUser);
      mockPassword.comparePassword.mockResolvedValue(true);
      mockBackoff.checkBackoff.mockReturnValue({
        canAttempt: false,
        isLocked: false,
        waitSeconds: 8,
      });

      await expect(
        service.login({ email: 'test@test.com', password: 'pw', fingerprint: 'fp' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('increments failed attempts on wrong password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(baseUser);
      mockPassword.comparePassword.mockResolvedValue(false);

      await expect(
        service.login({ email: 'test@test.com', password: 'wrong', fingerprint: 'fp' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockPrisma.user.update).toHaveBeenCalled();
    });

    it('returns requiresTwoFactor when TOTP enabled', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        totpEnabled: true,
        totpSecret: 'secret',
      });
      mockBackoff.checkBackoff.mockReturnValue({ canAttempt: true, isLocked: false, waitSeconds: 0 });
      mockPassword.comparePassword.mockResolvedValue(true);

      const result = await service.login({
        email: 'test@test.com',
        password: 'pass',
        fingerprint: 'fp',
      });

      expect(result.requiresTwoFactor).toBe(true);
      expect(result.tempToken).toBeDefined();
    });

    it('returns requires2FASetup for mandatory 2FA role', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(baseUser);
      mockBackoff.checkBackoff.mockReturnValue({ canAttempt: true, isLocked: false, waitSeconds: 0 });
      mockPassword.comparePassword.mockResolvedValue(true);
      mockPrisma.userRole.findMany.mockResolvedValue([
        { role: { name: 'Администратор' } },
      ]);

      const result = await service.login({
        email: 'test@test.com',
        password: 'pass',
        fingerprint: 'fp',
      });

      expect(result.requires2FASetup).toBe(true);
      expect(result.tempToken).toBeDefined();
    });

    it('returns requiresEmailVerification for regular user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(baseUser);
      mockBackoff.checkBackoff.mockReturnValue({ canAttempt: true, isLocked: false, waitSeconds: 0 });
      mockPassword.comparePassword.mockResolvedValue(true);
      mockPrisma.userRole.findMany.mockResolvedValue([
        { role: { name: 'Агент' } },
      ]);

      const result = await service.login({
        email: 'test@test.com',
        password: 'pass',
        fingerprint: 'fp',
      });

      expect(result.requiresEmailVerification).toBe(true);
    });

    it('resets failed attempts on successful login', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(baseUser);
      mockBackoff.checkBackoff.mockReturnValue({ canAttempt: true, isLocked: false, waitSeconds: 0 });
      mockPassword.comparePassword.mockResolvedValue(true);
      mockPrisma.userRole.findMany.mockResolvedValue([{ role: { name: 'Агент' } }]);

      await service.login({ email: 'test@test.com', password: 'pass', fingerprint: 'fp' });

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ failedAttempts: 0 }),
        }),
      );
    });
  });

  describe('validateTempToken', () => {
    it('returns null for malformed token', () => {
      expect(service.validateTempToken('no-dot-here', 'fp')).toBeNull();
    });

    it('returns null for tampered token', () => {
      expect(service.validateTempToken('abc.xyz', 'fp')).toBeNull();
    });

    it('validates a token created by createTempToken', async () => {
      // Login to create a temp token
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        status: 'ACTIVE',
        passwordHash: 'h',
        failedAttempts: 0,
        lastFailedAttempt: null,
        lockedUntil: null,
        totpEnabled: true,
        totpSecret: 'secret',
      });
      mockBackoff.checkBackoff.mockReturnValue({ canAttempt: true, isLocked: false, waitSeconds: 0 });
      mockPassword.comparePassword.mockResolvedValue(true);

      const result = await service.login({ email: 'a@b.com', password: 'p', fingerprint: 'fp123' });
      const validated = service.validateTempToken(result.tempToken!, 'fp123');

      expect(validated).toEqual({ userId: 'u1' });
    });

    it('rejects token with wrong fingerprint', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        status: 'ACTIVE',
        passwordHash: 'h',
        failedAttempts: 0,
        lastFailedAttempt: null,
        lockedUntil: null,
        totpEnabled: true,
        totpSecret: 'secret',
      });
      mockBackoff.checkBackoff.mockReturnValue({ canAttempt: true, isLocked: false, waitSeconds: 0 });
      mockPassword.comparePassword.mockResolvedValue(true);

      const result = await service.login({ email: 'a@b.com', password: 'p', fingerprint: 'fp1' });
      const validated = service.validateTempToken(result.tempToken!, 'wrong-fp');

      expect(validated).toBeNull();
    });
  });

  describe('getUserById', () => {
    it('returns cached user if available', async () => {
      const cachedUser = { id: 'u1', email: 'test@test.com' };
      mockCache.getUser.mockResolvedValue(cachedUser);

      const result = await service.getUserById('u1');
      expect(result).toEqual(cachedUser);
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('fetches from DB and caches on cache miss', async () => {
      const dbUser = { id: 'u1', email: 'test@test.com' };
      mockPrisma.user.findUnique.mockResolvedValue(dbUser);

      const result = await service.getUserById('u1');
      expect(result).toEqual(dbUser);
      expect(mockCache.setUser).toHaveBeenCalledWith('u1', dbUser);
    });
  });

  describe('updateProfile', () => {
    it('throws when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.updateProfile('u1', { username: 'new' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws when changing password without current password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', passwordHash: 'h' });

      await expect(
        service.updateProfile('u1', { newPassword: 'new123' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws when current password is wrong', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', passwordHash: 'h' });
      mockPassword.comparePassword.mockResolvedValue(false);

      await expect(
        service.updateProfile('u1', { currentPassword: 'wrong', newPassword: 'new' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
