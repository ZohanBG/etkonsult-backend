import { SessionService } from './session.service';

describe('SessionService', () => {
  let service: SessionService;
  let mockPrisma: any;
  let mockConfig: any;

  beforeEach(() => {
    mockPrisma = {
      session: {
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    mockConfig = {
      get: jest.fn((key: string) => {
        if (key === 'JWT_EXPIRES_IN') return '1d';
        if (key === 'JWT_REFRESH_EXPIRES_IN') return '7d';
        return undefined;
      }),
    };
    service = new SessionService(mockPrisma, mockConfig);
  });

  describe('createSession', () => {
    it('creates session with tokens', async () => {
      const result = await service.createSession({
        userId: 'u1',
        fingerprint: 'fp-123',
        ipAddress: '127.0.0.1',
      });

      expect(result).toHaveProperty('token');
      expect(result).toHaveProperty('refreshToken');
      expect(result).toHaveProperty('expiresAt');
      expect(result).toHaveProperty('refreshExpiresAt');
      expect(result.token).toHaveLength(64); // 32 bytes hex
      expect(mockPrisma.session.create).toHaveBeenCalled();
    });
  });

  describe('validateSession', () => {
    it('returns userId for valid session', async () => {
      mockPrisma.session.findUnique.mockResolvedValue({
        id: 's1',
        userId: 'u1',
        fingerprint: 'fp-123',
        expiresAt: new Date(Date.now() + 100000),
        ipAddress: '127.0.0.1',
        user: { id: 'u1' },
      });

      const result = await service.validateSession('token', 'fp-123', '127.0.0.1');
      expect(result).toEqual({ userId: 'u1', sessionId: 's1' });
    });

    it('returns null for non-existent session', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(null);
      const result = await service.validateSession('bad', 'fp');
      expect(result).toBeNull();
    });

    it('returns null for expired session', async () => {
      mockPrisma.session.findUnique.mockResolvedValue({
        id: 's1',
        expiresAt: new Date(Date.now() - 1000),
        fingerprint: 'fp-123',
      });

      const result = await service.validateSession('token', 'fp-123');
      expect(result).toBeNull();
    });

    it('revokes session on fingerprint mismatch', async () => {
      mockPrisma.session.findUnique.mockResolvedValue({
        id: 's1',
        fingerprint: 'fp-original',
        expiresAt: new Date(Date.now() + 100000),
      });

      const result = await service.validateSession('token', 'fp-stolen');
      expect(result).toBeNull();
      expect(mockPrisma.session.delete).toHaveBeenCalledWith({ where: { id: 's1' } });
    });

    it('updates IP when changed', async () => {
      mockPrisma.session.findUnique.mockResolvedValue({
        id: 's1',
        userId: 'u1',
        fingerprint: 'fp-123',
        expiresAt: new Date(Date.now() + 100000),
        ipAddress: '1.1.1.1',
      });

      await service.validateSession('token', 'fp-123', '2.2.2.2');
      expect(mockPrisma.session.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { ipAddress: '2.2.2.2' },
      });
    });
  });

  describe('refreshSession', () => {
    it('returns new tokens on valid refresh', async () => {
      mockPrisma.session.findUnique.mockResolvedValue({
        id: 's1',
        userId: 'u1',
        fingerprint: 'fp-123',
        refreshExpiresAt: new Date(Date.now() + 100000),
      });

      const result = await service.refreshSession('refresh-token', 'fp-123');
      expect(result).toHaveProperty('token');
      expect(result).toHaveProperty('refreshToken');
      expect(mockPrisma.session.update).toHaveBeenCalled();
    });

    it('returns null for non-existent refresh token', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(null);
      const result = await service.refreshSession('bad', 'fp');
      expect(result).toBeNull();
    });

    it('revokes all sessions on fingerprint mismatch', async () => {
      mockPrisma.session.findUnique.mockResolvedValue({
        id: 's1',
        userId: 'u1',
        fingerprint: 'fp-original',
        refreshExpiresAt: new Date(Date.now() + 100000),
      });

      const result = await service.refreshSession('refresh', 'fp-stolen');
      expect(result).toBeNull();
      expect(mockPrisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    });

    it('revokes expired refresh session', async () => {
      mockPrisma.session.findUnique.mockResolvedValue({
        id: 's1',
        userId: 'u1',
        fingerprint: 'fp-123',
        refreshExpiresAt: new Date(Date.now() - 1000),
      });

      const result = await service.refreshSession('refresh', 'fp-123');
      expect(result).toBeNull();
      expect(mockPrisma.session.delete).toHaveBeenCalled();
    });
  });

  describe('revokeSession', () => {
    it('deletes session', async () => {
      await service.revokeSession('s1');
      expect(mockPrisma.session.delete).toHaveBeenCalledWith({ where: { id: 's1' } });
    });
  });

  describe('revokeAllUserSessions', () => {
    it('deletes all user sessions', async () => {
      await service.revokeAllUserSessions('u1');
      expect(mockPrisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    });
  });

  describe('cleanExpiredSessions', () => {
    it('deletes expired sessions', async () => {
      mockPrisma.session.deleteMany.mockResolvedValue({ count: 5 });
      const result = await service.cleanExpiredSessions();
      expect(result).toBe(5);
    });
  });

  describe('getUserSessions', () => {
    it('returns user sessions', async () => {
      mockPrisma.session.findMany.mockResolvedValue([{ id: 's1' }]);
      const result = await service.getUserSessions('u1');
      expect(result).toHaveLength(1);
    });
  });

  describe('findActiveSessionByFingerprint', () => {
    it('returns recent session', async () => {
      mockPrisma.session.findFirst.mockResolvedValue({
        token: 'tok',
        refreshToken: 'ref',
        expiresAt: new Date(),
        refreshExpiresAt: new Date(),
      });

      const result = await service.findActiveSessionByFingerprint('u1', 'fp-123');
      expect(result).toHaveProperty('token', 'tok');
    });

    it('returns null when no recent session', async () => {
      mockPrisma.session.findFirst.mockResolvedValue(null);
      const result = await service.findActiveSessionByFingerprint('u1', 'fp-123');
      expect(result).toBeNull();
    });
  });
});
