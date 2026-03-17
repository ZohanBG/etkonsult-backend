import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EmailService } from '../../email/email.service.js';
import { randomInt, timingSafeEqual } from 'crypto';

@Injectable()
export class EmailVerificationService {
  private readonly codeExpiresIn = 15 * 60 * 1000; // 15 minutes
  private readonly maxAttempts = 5; // Invalidate code after 5 failed attempts

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  async sendVerificationEmail(userId: string, fingerprint: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    if (!user) {
      throw new Error('User not found');
    }

    // Generate 6-digit code
    const code = randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + this.codeExpiresIn);

    // Delete any existing verification codes for this user
    await this.prisma.emailVerification.deleteMany({
      where: { userId },
    });

    // Create new verification code
    await this.prisma.emailVerification.create({
      data: {
        userId,
        token: code,
        fingerprint,
        expiresAt,
        attempts: 0,
      },
    });

    // Send email with the code
    await this.emailService.sendLoginVerificationEmail(user.email, code);
  }

  async verifyCode(
    userId: string,
    code: string,
  ): Promise<{ fingerprint: string } | null> {
    // Find active (non-verified, non-expired) verification for this user
    const verification = await this.prisma.emailVerification.findFirst({
      where: {
        userId,
        verified: false,
        expiresAt: { gt: new Date() },
      },
    });

    if (!verification) {
      return null;
    }

    // Check if max attempts exceeded
    if (verification.attempts >= this.maxAttempts) {
      // Invalidate the code
      await this.prisma.emailVerification.deleteMany({ where: { userId } });
      return null;
    }

    // Increment attempt counter
    await this.prisma.emailVerification.update({
      where: { id: verification.id },
      data: { attempts: { increment: 1 } },
    });

    // Check if code matches (timing-safe comparison)
    const tokenBuf = Buffer.from(verification.token, 'utf8');
    const codeBuf = Buffer.from(code, 'utf8');
    if (tokenBuf.length !== codeBuf.length || !timingSafeEqual(tokenBuf, codeBuf)) {
      return null;
    }

    // Mark as verified
    await this.prisma.emailVerification.update({
      where: { id: verification.id },
      data: { verified: true },
    });

    return { fingerprint: verification.fingerprint };
  }

  async cleanupUsedToken(userId: string): Promise<void> {
    await this.prisma.emailVerification.deleteMany({
      where: { userId },
    });
  }
}
