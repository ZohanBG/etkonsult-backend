import { TotpService } from './totp.service';

jest.mock('speakeasy', () => ({
  generateSecret: jest.fn().mockReturnValue({
    base32: 'JBSWY3DPEHPK3PXP',
    otpauth_url: 'otpauth://totp/MPS?secret=JBSWY3DPEHPK3PXP',
  }),
  totp: {
    verify: jest.fn().mockReturnValue(true),
  },
}));

jest.mock('qrcode', () => ({
  toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,qr-code'),
}));

import speakeasy from 'speakeasy';

describe('TotpService', () => {
  let service: TotpService;
  let mockPrisma: any;
  let mockConfig: any;

  beforeEach(() => {
    mockPrisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    mockConfig = {
      get: jest.fn().mockReturnValue('МПС System'),
    };
    service = new TotpService(mockPrisma, mockConfig);
  });

  describe('generateSecret', () => {
    it('generates secret and QR code for user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ email: 'test@test.com' });
      mockPrisma.user.update.mockResolvedValue({});

      const result = await service.generateSecret('u1');

      expect(result.secret).toBe('JBSWY3DPEHPK3PXP');
      expect(result.qrCodeUrl).toContain('data:image/png');
      expect(result.otpauthUrl).toContain('otpauth://');
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ totpSecret: 'JBSWY3DPEHPK3PXP', totpEnabled: false }),
        }),
      );
    });

    it('throws when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.generateSecret('bad')).rejects.toThrow('User not found');
    });
  });

  describe('verifyAndEnable', () => {
    it('verifies token and enables 2FA', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ totpSecret: 'secret', totpEnabled: false });
      mockPrisma.user.update.mockResolvedValue({});
      (speakeasy.totp.verify as jest.Mock).mockReturnValue(true);

      const result = await service.verifyAndEnable('u1', '123456');

      expect(result).toBe(true);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { totpEnabled: true } }),
      );
    });

    it('returns false for invalid token', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ totpSecret: 'secret', totpEnabled: false });
      (speakeasy.totp.verify as jest.Mock).mockReturnValue(false);

      const result = await service.verifyAndEnable('u1', 'bad');
      expect(result).toBe(false);
    });

    it('returns false when no secret', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ totpSecret: null });
      const result = await service.verifyAndEnable('u1', '123456');
      expect(result).toBe(false);
    });

    it('does not re-enable if already enabled', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ totpSecret: 'secret', totpEnabled: true });
      (speakeasy.totp.verify as jest.Mock).mockReturnValue(true);

      const result = await service.verifyAndEnable('u1', '123456');
      expect(result).toBe(true);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('verifyToken', () => {
    it('verifies token for enabled user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ totpSecret: 'secret', totpEnabled: true });
      (speakeasy.totp.verify as jest.Mock).mockReturnValue(true);

      const result = await service.verifyToken('u1', '123456');
      expect(result).toBe(true);
    });

    it('returns false when 2FA not enabled', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ totpSecret: 'secret', totpEnabled: false });
      const result = await service.verifyToken('u1', '123456');
      expect(result).toBe(false);
    });
  });

  describe('disable', () => {
    it('clears secret and disables', async () => {
      mockPrisma.user.update.mockResolvedValue({});
      await service.disable('u1');
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { totpSecret: null, totpEnabled: false },
      });
    });
  });

  describe('isEnabled', () => {
    it('returns true when enabled', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ totpEnabled: true });
      expect(await service.isEnabled('u1')).toBe(true);
    });

    it('returns false when not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      expect(await service.isEnabled('u1')).toBe(false);
    });
  });
});
