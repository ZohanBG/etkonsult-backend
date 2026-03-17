import { BackoffService } from './backoff.service';

describe('BackoffService', () => {
  let service: BackoffService;

  beforeEach(() => {
    service = new BackoffService();
  });

  // ──────────────────────── getDelaySeconds ────────────────────────

  describe('getDelaySeconds', () => {
    it('returns 0 for attempts 0, 1, 2', () => {
      expect(service.getDelaySeconds(0)).toBe(0);
      expect(service.getDelaySeconds(1)).toBe(0);
      expect(service.getDelaySeconds(2)).toBe(0);
    });

    it('returns exponential backoff for attempts 3-9', () => {
      expect(service.getDelaySeconds(3)).toBe(2);   // 2^1
      expect(service.getDelaySeconds(4)).toBe(4);   // 2^2
      expect(service.getDelaySeconds(5)).toBe(8);   // 2^3
      expect(service.getDelaySeconds(6)).toBe(16);  // 2^4
      expect(service.getDelaySeconds(7)).toBe(32);  // 2^5
      expect(service.getDelaySeconds(8)).toBe(64);  // 2^6
      expect(service.getDelaySeconds(9)).toBe(128); // 2^7
    });

    it('returns -1 (locked) for 10+ attempts', () => {
      expect(service.getDelaySeconds(10)).toBe(-1);
      expect(service.getDelaySeconds(15)).toBe(-1);
    });
  });

  // ──────────────────────── checkBackoff ────────────────────────

  describe('checkBackoff', () => {
    it('allows attempt with no previous failures', () => {
      const result = service.checkBackoff(0, null, null);
      expect(result).toEqual({
        canAttempt: true,
        waitSeconds: 0,
        isLocked: false,
      });
    });

    it('allows attempt when failedAttempts is 0 even with lastFailedAttempt', () => {
      const result = service.checkBackoff(0, new Date(), null);
      expect(result).toEqual({
        canAttempt: true,
        waitSeconds: 0,
        isLocked: false,
      });
    });

    it('blocks when account is locked and lock not expired', () => {
      const lockedUntil = new Date(Date.now() + 60000); // 60s from now
      const result = service.checkBackoff(10, new Date(), lockedUntil);

      expect(result.canAttempt).toBe(false);
      expect(result.isLocked).toBe(true);
      expect(result.lockRemainingSeconds).toBeGreaterThan(0);
      expect(result.lockRemainingSeconds).toBeLessThanOrEqual(60);
    });

    it('allows attempt when lock has expired', () => {
      const lockedUntil = new Date(Date.now() - 1000); // 1s ago
      const result = service.checkBackoff(10, new Date(), lockedUntil);

      expect(result).toEqual({
        canAttempt: true,
        waitSeconds: 0,
        isLocked: false,
      });
    });

    it('locks account at 10+ attempts without lockedUntil', () => {
      const result = service.checkBackoff(10, new Date(), null);

      expect(result.canAttempt).toBe(false);
      expect(result.isLocked).toBe(true);
      expect(result.lockRemainingSeconds).toBe(30 * 60); // 30 minutes
    });

    it('requires wait when backoff delay has not elapsed', () => {
      const lastFailed = new Date(Date.now() - 1000); // 1s ago
      // 3 attempts = 2s delay, only 1s elapsed → need to wait 1s more
      const result = service.checkBackoff(3, lastFailed, null);

      expect(result.canAttempt).toBe(false);
      expect(result.isLocked).toBe(false);
      expect(result.waitSeconds).toBe(1);
    });

    it('allows attempt when backoff delay has fully elapsed', () => {
      const lastFailed = new Date(Date.now() - 5000); // 5s ago
      // 3 attempts = 2s delay, 5s elapsed → allowed
      const result = service.checkBackoff(3, lastFailed, null);

      expect(result).toEqual({
        canAttempt: true,
        waitSeconds: 0,
        isLocked: false,
      });
    });

    it('handles higher attempt counts with longer delays', () => {
      const lastFailed = new Date(Date.now() - 10000); // 10s ago
      // 5 attempts = 8s delay, 10s elapsed → allowed
      const result = service.checkBackoff(5, lastFailed, null);

      expect(result.canAttempt).toBe(true);
    });

    it('blocks when higher delay has not elapsed', () => {
      const lastFailed = new Date(Date.now() - 2000); // 2s ago
      // 5 attempts = 8s delay, 2s elapsed → need to wait 6s
      const result = service.checkBackoff(5, lastFailed, null);

      expect(result.canAttempt).toBe(false);
      expect(result.waitSeconds).toBe(6);
    });
  });

  // ──────────────────────── getLockUntil ────────────────────────

  describe('getLockUntil', () => {
    it('returns a date 30 minutes in the future', () => {
      const before = Date.now();
      const lockUntil = service.getLockUntil();
      const after = Date.now();

      const thirtyMinMs = 30 * 60 * 1000;
      expect(lockUntil.getTime()).toBeGreaterThanOrEqual(before + thirtyMinMs);
      expect(lockUntil.getTime()).toBeLessThanOrEqual(after + thirtyMinMs);
    });
  });

  // ──────────────────────── maxAttempts ────────────────────────

  describe('maxAttempts', () => {
    it('returns 10', () => {
      expect(service.maxAttempts).toBe(10);
    });
  });
});
