import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { createHmac } from 'crypto';

export interface PasswordValidationResult {
  isValid: boolean;
  errors: string[];
}

@Injectable()
export class PasswordService {
  private readonly MIN_LENGTH = 8;
  private readonly MAX_LENGTH = 128;
  private readonly pepper: string;

  /** Pre-computed dummy hash for constant-time login when user doesn't exist */
  public dummyHash: string = '';

  constructor(private readonly configService: ConfigService) {
    this.pepper = this.configService.get<string>('PASSWORD_PEPPER') || '';
    if (!this.pepper && this.configService.get<string>('NODE_ENV') === 'production') {
      throw new Error('PASSWORD_PEPPER must be set in production');
    }
    if (!this.pepper) {
      console.warn('[PasswordService] PASSWORD_PEPPER is not set — passwords will NOT be peppered');
    }
    // Generate a dummy hash on startup for constant-time user-not-found paths
    this.initDummyHash();
  }

  private async initDummyHash(): Promise<void> {
    this.dummyHash = await argon2.hash(this.applyPepper('dummy-password-for-timing'), {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });
  }

  private applyPepper(password: string): string {
    if (!this.pepper) return password;
    return createHmac('sha256', this.pepper).update(password).digest('hex');
  }

  async hashPassword(password: string): Promise<string> {
    const peppered = this.applyPepper(password);
    return argon2.hash(peppered, {
      type: argon2.argon2id,
      memoryCost: 65536, // 64 MB
      timeCost: 3,
      parallelism: 4,
    });
  }

  async comparePassword(password: string, hash: string): Promise<boolean> {
    const peppered = this.applyPepper(password);
    try {
      return await argon2.verify(hash, peppered);
    } catch {
      // Invalid hash format (e.g. old bcrypt hash) — return false
      return false;
    }
  }

  validatePasswordStrength(password: string): PasswordValidationResult {
    const errors: string[] = [];

    if (password.length < this.MIN_LENGTH) {
      errors.push(`Password must be at least ${this.MIN_LENGTH} characters long`);
    }

    if (password.length > this.MAX_LENGTH) {
      errors.push(`Password must not exceed ${this.MAX_LENGTH} characters`);
    }

    if (!/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }

    if (!/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }

    if (!/\d/.test(password)) {
      errors.push('Password must contain at least one number');
    }

    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      errors.push('Password must contain at least one special character');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}
