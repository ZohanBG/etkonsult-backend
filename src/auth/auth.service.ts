import { Injectable, UnauthorizedException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { CacheService } from '../cache/cache.service.js';
import { PasswordService } from './services/password.service.js';
import { BackoffService } from './services/backoff.service.js';
import { LoginDto } from './dto/login.dto.js';
import { UserStatus } from '@prisma/client';

// Roles that require 2FA to be enabled
const ROLES_REQUIRING_2FA = ['Администратор', 'Служител'];

// Temp token version — increment to invalidate all existing temp tokens
const TEMP_TOKEN_VERSION = 1;

export interface LoginResult {
  requiresTwoFactor?: boolean;
  requiresEmailVerification?: boolean;
  requires2FASetup?: boolean;
  tempToken?: string;
}

export interface CachedUser {
  id: string;
  email: string;
  username: string | null;
  status: UserStatus;
  totpEnabled: boolean;
  createdAt: Date;
}

@Injectable()
export class AuthService {
  private readonly hmacSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
    private readonly passwordService: PasswordService,
    private readonly backoffService: BackoffService,
    private readonly configService: ConfigService,
  ) {
    const secret = this.configService.get<string>('JWT_SECRET');
    if (!secret) throw new Error('JWT_SECRET is required');
    // Use a domain-separated key so temp tokens can't be confused with sessions
    this.hmacSecret = `2fa-temp-token:${secret}`;
  }

  async login(dto: LoginDto): Promise<LoginResult> {
    // Find user by email
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (!user) {
      // Constant-time: run argon2 verify against dummy hash to equalize timing
      await this.passwordService.comparePassword(dto.password, this.passwordService.dummyHash);
      throw new UnauthorizedException('Invalid email or password');
    }

    // Check user status — use generic message to prevent user enumeration
    if (user.status === UserStatus.INACTIVE) {
      // Still run password check for constant timing
      await this.passwordService.comparePassword(dto.password, user.passwordHash);
      throw new UnauthorizedException('Invalid email or password');
    }

    // Verify password FIRST (before backoff check to avoid leaking account existence)
    const isPasswordValid = await this.passwordService.comparePassword(
      dto.password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      await this.handleFailedAttempt(user.id);
      throw new UnauthorizedException('Invalid email or password');
    }

    // Password is valid — NOW check backoff/lock status
    // (only reveal lock info after confirming the password is correct)
    const backoffResult = this.backoffService.checkBackoff(
      user.failedAttempts,
      user.lastFailedAttempt,
      user.lockedUntil,
    );

    if (backoffResult.isLocked) {
      const minutes = Math.ceil((backoffResult.lockRemainingSeconds || 0) / 60);
      throw new ForbiddenException(
        `Account is locked. Please try again in ${minutes} minutes.`,
      );
    }

    if (!backoffResult.canAttempt) {
      throw new ForbiddenException(
        `Too many failed attempts. Please wait ${backoffResult.waitSeconds} seconds.`,
      );
    }

    // Password is valid - reset failed attempts
    await this.resetFailedAttempts(user.id, user.status);

    // All flows now return tempToken instead of userId (IDOR protection)
    const tempToken = this.createTempToken(user.id, dto.fingerprint);

    // Check if 2FA is enabled
    if (user.totpEnabled && user.totpSecret) {
      return {
        requiresTwoFactor: true,
        tempToken,
      };
    }

    // 2FA not enabled - check if user's role requires 2FA
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId: user.id },
      include: { role: true },
    });

    const requiresMandatory2FA = userRoles.some((ur) =>
      ROLES_REQUIRING_2FA.includes(ur.role.name),
    );

    if (requiresMandatory2FA) {
      return {
        requires2FASetup: true,
        tempToken,
      };
    }

    // 2FA not required - email verification login
    return {
      requiresEmailVerification: true,
      tempToken,
    };
  }

  private async handleFailedAttempt(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;

    const newFailedAttempts = user.failedAttempts + 1;

    // Check if should lock account
    if (newFailedAttempts >= this.backoffService.maxAttempts) {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          failedAttempts: newFailedAttempts,
          lastFailedAttempt: new Date(),
          lockedUntil: this.backoffService.getLockUntil(),
          status: UserStatus.LOCKED,
        },
      });
    } else {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          failedAttempts: newFailedAttempts,
          lastFailedAttempt: new Date(),
        },
      });
    }
  }

  private async resetFailedAttempts(userId: string, currentStatus: UserStatus): Promise<void> {
    const data: Record<string, unknown> = {
      failedAttempts: 0,
      lastFailedAttempt: null,
      lockedUntil: null,
    };

    // Only change status to ACTIVE if currently LOCKED (don't override other statuses)
    if (currentStatus === UserStatus.LOCKED) {
      data.status = UserStatus.ACTIVE;
    }

    await this.prisma.user.update({
      where: { id: userId },
      data,
    });
  }

  /**
   * Create a short-lived HMAC-signed temp token for the 2FA/email verification step.
   * Format: base64url(payload).base64url(hmac)
   * The payload is NOT encrypted but IS authenticated — tampering is detectable.
   */
  createTempToken(userId: string, fingerprint: string): string {
    const nonce = randomBytes(16).toString('hex');
    const payload = Buffer.from(
      JSON.stringify({
        v: TEMP_TOKEN_VERSION,
        userId,
        fingerprint,
        exp: Date.now() + 5 * 60 * 1000, // 5 minutes
        nonce,
      }),
    ).toString('base64url');

    const sig = createHmac('sha256', this.hmacSecret).update(payload).digest('base64url');
    return `${payload}.${sig}`;
  }

  validateTempToken(
    tempToken: string,
    fingerprint: string,
  ): { userId: string } | null {
    try {
      const dotIndex = tempToken.lastIndexOf('.');
      if (dotIndex === -1) return null;

      const payload = tempToken.slice(0, dotIndex);
      const providedSig = tempToken.slice(dotIndex + 1);

      // Verify HMAC signature using timing-safe comparison
      const expectedSig = createHmac('sha256', this.hmacSecret).update(payload).digest('base64url');
      const sigBuf = Buffer.from(providedSig, 'base64url');
      const expectedBuf = Buffer.from(expectedSig, 'base64url');
      if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
        return null; // Signature mismatch — token was tampered with
      }

      const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());

      if (decoded.v !== TEMP_TOKEN_VERSION) {
        return null; // Wrong version
      }

      if (decoded.exp < Date.now()) {
        return null; // Token expired
      }

      if (decoded.fingerprint !== fingerprint) {
        return null; // Fingerprint mismatch
      }

      return { userId: decoded.userId };
    } catch {
      return null;
    }
  }

  async getUserById(userId: string): Promise<CachedUser | null> {
    // Try cache first
    const cached = await this.cacheService.getUser<CachedUser>(userId);
    if (cached) {
      return cached;
    }

    // Fetch from database
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        status: true,
        totpEnabled: true,
        createdAt: true,
      },
    });

    // Cache the result
    if (user) {
      await this.cacheService.setUser(userId, user);
    }

    return user;
  }

  // Invalidate user cache (call on user updates)
  async invalidateUserCache(userId: string): Promise<void> {
    await this.cacheService.invalidateUser(userId);
  }

  async updateProfile(
    userId: string,
    dto: { username?: string; currentPassword?: string; newPassword?: string },
  ): Promise<CachedUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Потребителят не е намерен');

    const updateData: { username?: string | null; passwordHash?: string } = {};

    if (dto.username !== undefined) {
      updateData.username = dto.username.trim() || null;
    }

    if (dto.newPassword) {
      if (!dto.currentPassword) {
        throw new ForbiddenException('Необходима е текущата парола за смяна');
      }
      const valid = await this.passwordService.comparePassword(dto.currentPassword, user.passwordHash);
      if (!valid) {
        throw new ForbiddenException('Грешна текуща парола');
      }

      // Validate password strength before hashing
      const validation = this.passwordService.validatePasswordStrength(dto.newPassword);
      if (!validation.isValid) {
        throw new BadRequestException(validation.errors.join('. '));
      }

      updateData.passwordHash = await this.passwordService.hashPassword(dto.newPassword);
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        email: true,
        username: true,
        status: true,
        totpEnabled: true,
        createdAt: true,
      },
    });

    await this.cacheService.invalidateUser(userId);
    return updated;
  }
}
