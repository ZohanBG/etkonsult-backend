import { EmailVerificationService } from './email-verification.service';

describe('EmailVerificationService', () => {
  let service: EmailVerificationService;
  let mockPrisma: any;
  let mockEmailService: any;

  beforeEach(() => {
    mockPrisma = {
      user: {
        findUnique: jest.fn(),
      },
      emailVerification: {
        deleteMany: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    mockEmailService = {
      sendLoginVerificationEmail: jest.fn().mockResolvedValue(undefined),
    };
    service = new EmailVerificationService(mockPrisma, mockEmailService);
  });

  describe('sendVerificationEmail', () => {
    it('generates code and sends email', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ email: 'test@test.com' });

      await service.sendVerificationEmail('u1', 'fp-123');

      expect(mockPrisma.emailVerification.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
      expect(mockPrisma.emailVerification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'u1',
            fingerprint: 'fp-123',
            attempts: 0,
          }),
        }),
      );
      expect(mockEmailService.sendLoginVerificationEmail).toHaveBeenCalledWith(
        'test@test.com',
        expect.any(String),
      );
    });

    it('throws when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.sendVerificationEmail('bad', 'fp')).rejects.toThrow('User not found');
    });
  });

  describe('verifyCode', () => {
    it('verifies valid code and returns fingerprint', async () => {
      mockPrisma.emailVerification.findFirst.mockResolvedValue({
        id: 'v1',
        token: '123456',
        fingerprint: 'fp-123',
        attempts: 0,
      });

      const result = await service.verifyCode('u1', '123456');

      expect(result).toEqual({ fingerprint: 'fp-123' });
      // Should increment attempts
      expect(mockPrisma.emailVerification.update).toHaveBeenCalledWith({
        where: { id: 'v1' },
        data: { attempts: { increment: 1 } },
      });
      // Should mark as verified
      expect(mockPrisma.emailVerification.update).toHaveBeenCalledWith({
        where: { id: 'v1' },
        data: { verified: true },
      });
    });

    it('returns null when no verification record found', async () => {
      mockPrisma.emailVerification.findFirst.mockResolvedValue(null);
      const result = await service.verifyCode('u1', 'bad');
      expect(result).toBeNull();
    });

    it('returns null for wrong code after incrementing attempts', async () => {
      mockPrisma.emailVerification.findFirst.mockResolvedValue({
        id: 'v1',
        token: '123456',
        fingerprint: 'fp-123',
        attempts: 0,
      });

      const result = await service.verifyCode('u1', '999999');
      expect(result).toBeNull();
      expect(mockPrisma.emailVerification.update).toHaveBeenCalledWith({
        where: { id: 'v1' },
        data: { attempts: { increment: 1 } },
      });
    });

    it('returns null and deletes when max attempts exceeded', async () => {
      mockPrisma.emailVerification.findFirst.mockResolvedValue({
        id: 'v1',
        token: '123456',
        fingerprint: 'fp-123',
        attempts: 5,
      });

      const result = await service.verifyCode('u1', '123456');
      expect(result).toBeNull();
      expect(mockPrisma.emailVerification.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    });
  });

  describe('cleanupUsedToken', () => {
    it('deletes all verification records for user', async () => {
      await service.cleanupUsedToken('u1');
      expect(mockPrisma.emailVerification.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    });
  });
});
