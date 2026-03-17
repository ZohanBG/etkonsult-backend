import { Injectable } from '@nestjs/common';

export interface BackoffResult {
  canAttempt: boolean;
  waitSeconds: number;
  isLocked: boolean;
  lockRemainingSeconds?: number;
}

@Injectable()
export class BackoffService {
  private readonly MAX_ATTEMPTS = 10;
  private readonly LOCK_DURATION_MINUTES = 30;

  /**
   * Calculate delay based on failed attempts (exponential backoff)
   * Attempts 1-2: no delay
   * Attempt 3: 2s, 4: 4s, 5: 8s, 6: 16s, 7: 32s, 8: 64s, 9: 128s
   * Attempt 10: account locked for 30 minutes
   */
  getDelaySeconds(failedAttempts: number): number {
    if (failedAttempts < 3) return 0;
    if (failedAttempts >= this.MAX_ATTEMPTS) return -1; // -1 means locked
    return Math.pow(2, failedAttempts - 2); // 2^1=2, 2^2=4, 2^3=8, etc.
  }

  /**
   * Check if user can attempt login based on backoff rules
   */
  checkBackoff(
    failedAttempts: number,
    lastFailedAttempt: Date | null,
    lockedUntil: Date | null,
  ): BackoffResult {
    const now = new Date();

    // Check if account is locked
    if (lockedUntil && lockedUntil > now) {
      const lockRemainingSeconds = Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000);
      return {
        canAttempt: false,
        waitSeconds: 0,
        isLocked: true,
        lockRemainingSeconds,
      };
    }

    // If was locked but lock expired, allow attempt (will reset on service level)
    if (lockedUntil && lockedUntil <= now) {
      return {
        canAttempt: true,
        waitSeconds: 0,
        isLocked: false,
      };
    }

    // No previous failures
    if (!lastFailedAttempt || failedAttempts === 0) {
      return {
        canAttempt: true,
        waitSeconds: 0,
        isLocked: false,
      };
    }

    const delaySeconds = this.getDelaySeconds(failedAttempts);

    // Check if should be locked (10+ attempts)
    if (delaySeconds === -1) {
      return {
        canAttempt: false,
        waitSeconds: 0,
        isLocked: true,
        lockRemainingSeconds: this.LOCK_DURATION_MINUTES * 60,
      };
    }

    // Check if enough time has passed since last failed attempt
    const timeSinceLastAttempt = (now.getTime() - lastFailedAttempt.getTime()) / 1000;
    const remainingWait = Math.ceil(delaySeconds - timeSinceLastAttempt);

    if (remainingWait > 0) {
      return {
        canAttempt: false,
        waitSeconds: remainingWait,
        isLocked: false,
      };
    }

    return {
      canAttempt: true,
      waitSeconds: 0,
      isLocked: false,
    };
  }

  /**
   * Calculate lock until timestamp
   */
  getLockUntil(): Date {
    return new Date(Date.now() + this.LOCK_DURATION_MINUTES * 60 * 1000);
  }

  get maxAttempts(): number {
    return this.MAX_ATTEMPTS;
  }
}
