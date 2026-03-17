import { PasswordService } from './password.service';

describe('PasswordService', () => {
  let service: PasswordService;

  beforeEach(async () => {
    const mockConfig = {
      get: jest.fn((key: string) => {
        if (key === 'PASSWORD_PEPPER') return 'test-pepper-secret-key';
        return undefined;
      }),
    };
    service = new PasswordService(mockConfig as any);
    // Wait for dummyHash to be initialized
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  describe('hashPassword', () => {
    it('hashes password with argon2id', async () => {
      const hash = await service.hashPassword('TestPass1!');
      expect(hash).toBeDefined();
      expect(hash).not.toBe('TestPass1!');
      expect(hash).toContain('$argon2id$');
    });
  });

  describe('comparePassword', () => {
    it('returns true for matching password', async () => {
      const hash = await service.hashPassword('TestPass1!');
      expect(await service.comparePassword('TestPass1!', hash)).toBe(true);
    });

    it('returns false for wrong password', async () => {
      const hash = await service.hashPassword('TestPass1!');
      expect(await service.comparePassword('WrongPass1!', hash)).toBe(false);
    });

    it('returns false for invalid hash format', async () => {
      expect(await service.comparePassword('TestPass1!', 'not-a-valid-hash')).toBe(false);
    });
  });

  describe('dummyHash', () => {
    it('initializes a dummy hash for constant-time paths', () => {
      expect(service.dummyHash).toBeDefined();
      expect(service.dummyHash).toContain('$argon2id$');
    });
  });

  describe('validatePasswordStrength', () => {
    it('accepts strong password', () => {
      const result = service.validatePasswordStrength('StrongPass1!');
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects short password', () => {
      const result = service.validatePasswordStrength('Sh1!');
      expect(result.isValid).toBe(false);
      expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('at least 8')]));
    });

    it('rejects password without lowercase', () => {
      const result = service.validatePasswordStrength('UPPERCASE1!');
      expect(result.isValid).toBe(false);
      expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('lowercase')]));
    });

    it('rejects password without uppercase', () => {
      const result = service.validatePasswordStrength('lowercase1!');
      expect(result.isValid).toBe(false);
      expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('uppercase')]));
    });

    it('rejects password without number', () => {
      const result = service.validatePasswordStrength('NoNumbers!a');
      expect(result.isValid).toBe(false);
      expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('number')]));
    });

    it('rejects password without special char', () => {
      const result = service.validatePasswordStrength('NoSpecial1a');
      expect(result.isValid).toBe(false);
      expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('special')]));
    });
  });
});
