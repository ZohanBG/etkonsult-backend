import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service.js';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

export interface TotpSetupResult {
  secret: string;
  qrCodeUrl: string;
  otpauthUrl: string;
}

@Injectable()
export class TotpService {
  private readonly appName: string;
  private readonly encryptionKey: Buffer | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.appName = this.configService.get<string>('APP_NAME') || 'МПС System';

    const keyHex = this.configService.get<string>('TOTP_ENCRYPTION_KEY');
    if (keyHex && keyHex.length === 64) {
      this.encryptionKey = Buffer.from(keyHex, 'hex'); // 32 bytes for AES-256
    } else {
      this.encryptionKey = null;
      if (this.configService.get<string>('NODE_ENV') === 'production') {
        throw new Error('TOTP_ENCRYPTION_KEY must be a 64-char hex string in production');
      }
      console.warn('[TotpService] TOTP_ENCRYPTION_KEY is not set or invalid — secrets will NOT be encrypted at rest');
    }
  }

  /** Encrypt a string using AES-256-GCM */
  private encrypt(plaintext: string): string {
    if (!this.encryptionKey) return plaintext;

    const iv = randomBytes(12); // 96-bit IV for GCM
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    // Format: iv:tag:ciphertext (all hex)
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  /** Decrypt a string encrypted with AES-256-GCM */
  private decrypt(ciphertext: string): string {
    if (!this.encryptionKey) return ciphertext;

    // If no colons, it's a legacy unencrypted secret
    if (!ciphertext.includes(':')) return ciphertext;

    const parts = ciphertext.split(':');
    if (parts.length !== 3) return ciphertext; // Legacy format

    const iv = Buffer.from(parts[0], 'hex');
    const tag = Buffer.from(parts[1], 'hex');
    const encrypted = Buffer.from(parts[2], 'hex');

    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted) + decipher.final('utf8');
  }

  async generateSecret(userId: string): Promise<TotpSetupResult> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    if (!user) {
      throw new Error('User not found');
    }

    // Generate secret
    const secret = speakeasy.generateSecret({
      name: `${this.appName} (${user.email})`,
      length: 20,
    });

    // Encrypt and store the secret (not enabled yet)
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        totpSecret: this.encrypt(secret.base32),
        totpEnabled: false,
      },
    });

    // Generate QR code
    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url || '');

    return {
      secret: secret.base32,
      qrCodeUrl,
      otpauthUrl: secret.otpauth_url || '',
    };
  }

  async verifyAndEnable(userId: string, token: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { totpSecret: true, totpEnabled: true },
    });

    if (!user || !user.totpSecret) {
      return false;
    }

    // Decrypt the secret before verifying
    const decryptedSecret = this.decrypt(user.totpSecret);

    const isValid = speakeasy.totp.verify({
      secret: decryptedSecret,
      encoding: 'base32',
      token,
      window: 1,
    });

    if (isValid && !user.totpEnabled) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { totpEnabled: true },
      });
    }

    return isValid;
  }

  async verifyToken(userId: string, token: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { totpSecret: true, totpEnabled: true },
    });

    if (!user || !user.totpSecret || !user.totpEnabled) {
      return false;
    }

    // Decrypt the secret before verifying
    const decryptedSecret = this.decrypt(user.totpSecret);

    return speakeasy.totp.verify({
      secret: decryptedSecret,
      encoding: 'base32',
      token,
      window: 1,
    });
  }

  async disable(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        totpSecret: null,
        totpEnabled: false,
      },
    });
  }

  async isEnabled(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { totpEnabled: true },
    });

    return user?.totpEnabled ?? false;
  }
}
