import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Prisma } from '@prisma/client';
import { randomBytes, createHash, timingSafeEqual } from 'crypto';

export interface SessionTokens {
  token: string;
  refreshToken: string;
  expiresAt: Date;
  refreshExpiresAt: Date;
}

export interface CreateSessionParams {
  userId: string;
  fingerprint: string;
  deviceInfo?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private readonly tokenExpiresMs: number;
  private readonly refreshExpiresMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const tokenExpiry = this.configService.get<string>('JWT_EXPIRES_IN') || '1d';
    this.tokenExpiresMs = this.parseDuration(tokenExpiry, 24 * 60 * 60 * 1000); // default 1 day

    const refreshExpiry = this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '7d';
    this.refreshExpiresMs = this.parseDuration(refreshExpiry, 7 * 24 * 60 * 60 * 1000); // default 7 days
  }

  private parseDuration(value: string, fallbackMs: number): number {
    const match = value.match(/^(\d+)([mhd])$/);
    if (!match) return fallbackMs;
    const num = parseInt(match[1]);
    switch (match[2]) {
      case 'm': return num * 60 * 1000;
      case 'h': return num * 60 * 60 * 1000;
      case 'd': return num * 24 * 60 * 60 * 1000;
      default: return fallbackMs;
    }
  }

  async createSession(params: CreateSessionParams): Promise<SessionTokens> {
    const { userId, fingerprint, deviceInfo, ipAddress, userAgent } = params;

    const token = this.generateToken();
    const refreshToken = this.generateToken();

    const expiresAt = new Date(Date.now() + this.tokenExpiresMs);
    const refreshExpiresAt = new Date(Date.now() + this.refreshExpiresMs);

    // Store hashed tokens in DB (raw tokens only exist in memory/cookies)
    await this.prisma.session.create({
      data: {
        userId,
        token: this.hashToken(token),
        refreshToken: this.hashToken(refreshToken),
        fingerprint,
        deviceInfo: (deviceInfo || {}) as Prisma.InputJsonValue,
        ipAddress,
        userAgent,
        expiresAt,
        refreshExpiresAt,
      },
    });

    return {
      token,
      refreshToken,
      expiresAt,
      refreshExpiresAt,
    };
  }

  async validateSession(
    token: string,
    fingerprint: string,
    currentIpAddress?: string,
  ): Promise<{ userId: string; sessionId: string; ipMismatch?: boolean } | null> {
    // Hash the incoming token before lookup (tokens are stored hashed)
    const hashedToken = this.hashToken(token);
    const session = await this.prisma.session.findUnique({
      where: { token: hashedToken },
      include: { user: true },
    });

    if (!session) {
      return null;
    }

    // Check if token is expired
    if (session.expiresAt < new Date()) {
      return null;
    }

    // Timing-safe fingerprint comparison
    if (!this.safeCompare(session.fingerprint, fingerprint)) {
      // Fingerprint mismatch - potential token theft, revoke session
      this.logger.warn(`Session revoked: fingerprint mismatch for session ${session.id}`);
      await this.revokeSession(session.id);
      return null;
    }

    // If IP changed, update the stored IP (user switched network)
    // Fingerprint validation above is sufficient for device identity
    if (currentIpAddress && session.ipAddress && session.ipAddress !== currentIpAddress) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { ipAddress: currentIpAddress },
      });
    }

    return {
      userId: session.userId,
      sessionId: session.id,
    };
  }

  async refreshSession(
    refreshToken: string,
    fingerprint: string,
    ipAddress?: string,
  ): Promise<SessionTokens | null> {
    // Hash the incoming refresh token before lookup
    const hashedRefreshToken = this.hashToken(refreshToken);
    const session = await this.prisma.session.findUnique({
      where: { refreshToken: hashedRefreshToken },
    });

    if (!session) {
      return null;
    }

    // Check if refresh token is expired
    if (session.refreshExpiresAt < new Date()) {
      await this.revokeSession(session.id);
      return null;
    }

    // Timing-safe fingerprint comparison
    if (!this.safeCompare(session.fingerprint, fingerprint)) {
      // Fingerprint mismatch - potential token theft
      // Revoke all user sessions for security
      await this.revokeAllUserSessions(session.userId);
      return null;
    }

    // Generate new tokens
    const newToken = this.generateToken();
    const newRefreshToken = this.generateToken();
    const expiresAt = new Date(Date.now() + this.tokenExpiresMs);
    const refreshExpiresAt = new Date(Date.now() + this.refreshExpiresMs);

    // Store hashed tokens in DB
    await this.prisma.session.update({
      where: { id: session.id },
      data: {
        token: this.hashToken(newToken),
        refreshToken: this.hashToken(newRefreshToken),
        expiresAt,
        refreshExpiresAt,
        ...(ipAddress ? { ipAddress } : {}),
      },
    });

    return {
      token: newToken,
      refreshToken: newRefreshToken,
      expiresAt,
      refreshExpiresAt,
    };
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.prisma.session.delete({
      where: { id: sessionId },
    }).catch(() => {
      // Session might already be deleted
    });
  }

  async revokeAllUserSessions(userId: string): Promise<void> {
    await this.prisma.session.deleteMany({
      where: { userId },
    });
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async cleanExpiredSessions(): Promise<number> {
    const result = await this.prisma.session.deleteMany({
      where: {
        refreshExpiresAt: {
          lt: new Date(),
        },
      },
    });

    if (result.count > 0) {
      this.logger.log(`Cleaned up ${result.count} expired sessions`);
    }
    return result.count;
  }

  async getUserSessions(userId: string) {
    return this.prisma.session.findMany({
      where: { userId },
      select: {
        id: true,
        deviceInfo: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        expiresAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findActiveSessionByFingerprint(
    userId: string,
    fingerprint: string,
  ): Promise<SessionTokens | null> {
    // Find a recently created session (within last 10 seconds) for this user+fingerprint
    // This handles duplicate requests from React StrictMode
    const recentSession = await this.prisma.session.findFirst({
      where: {
        userId,
        fingerprint,
        createdAt: { gt: new Date(Date.now() - 10000) }, // Created within last 10 seconds
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!recentSession) {
      return null;
    }

    return {
      token: recentSession.token,
      refreshToken: recentSession.refreshToken,
      expiresAt: recentSession.expiresAt,
      refreshExpiresAt: recentSession.refreshExpiresAt,
    };
  }

  private generateToken(): string {
    return randomBytes(32).toString('hex');
  }

  /** Hash a token with SHA-256 for secure storage in the database */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Timing-safe string comparison */
  private safeCompare(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }
}
