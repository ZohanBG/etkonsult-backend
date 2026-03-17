import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { createTestApp } from '../helpers/test-app.js';
import { cleanDatabase } from '../helpers/db-cleanup.js';
import {
  seedDefaultRoles,
  createAuthenticatedUser,
  withAuth,
  SeededRoles,
  TestUser,
} from '../helpers/auth-helper.js';

describe('Auth (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let roles: SeededRoles;
  let admin: TestUser;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    roles = await seedDefaultRoles(prisma);
    admin = await createAuthenticatedUser(prisma, { roleId: roles.adminRoleId });
  });

  // ──────────────────────── POST /api/auth/login ────────────────────────

  describe('POST /api/auth/login', () => {
    it('returns requiresEmailVerification for agent (no 2FA required)', async () => {
      const agent = await createAuthenticatedUser(prisma, { roleId: roles.agentRoleId });

      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: agent.email, password: agent.password, fingerprint: agent.fingerprint });

      expect(res.status).toBe(200);
      expect(res.body.requiresEmailVerification).toBe(true);
      expect(res.body.userId).toBe(agent.id);
    });

    it('returns requires2FASetup for admin without 2FA', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: admin.email, password: admin.password, fingerprint: admin.fingerprint });

      expect(res.status).toBe(200);
      expect(res.body.requires2FASetup).toBe(true);
      expect(res.body.userId).toBe(admin.id);
    });

    it('returns 401 for wrong password', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: admin.email, password: 'WrongPass123!', fingerprint: 'fp' });

      expect(res.status).toBe(401);
    });

    it('returns 401 for non-existent email', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'nobody@test.com', password: 'Pass123!', fingerprint: 'fp' });

      expect(res.status).toBe(401);
    });

    it('returns 400 when email is missing', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ password: 'Pass123!', fingerprint: 'fp' });

      expect(res.status).toBe(400);
    });

    it('returns 401 for INACTIVE user', async () => {
      const inactive = await createAuthenticatedUser(prisma, {
        roleId: roles.agentRoleId,
        status: 'INACTIVE',
      });

      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: inactive.email, password: inactive.password, fingerprint: 'fp' });

      expect(res.status).toBe(401);
    });
  });

  // ──────────────────────── GET /api/auth/me ────────────────────────

  describe('GET /api/auth/me', () => {
    it('returns current user profile', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).get('/api/auth/me'),
        admin,
      );

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(admin.id);
      expect(res.body.email).toBe(admin.email);
    });

    it('returns 401 without auth', async () => {
      const res = await request(app.getHttpServer()).get('/api/auth/me');
      expect(res.status).toBe(401);
    });

    it('returns 401 with invalid token', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Cookie', ['auth_token=invalid-token'])
        .set('X-Fingerprint', 'some-fp');

      expect(res.status).toBe(401);
    });

    it('returns 401 with wrong fingerprint', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Cookie', admin.cookies)
        .set('X-Fingerprint', 'wrong-fingerprint');

      expect(res.status).toBe(401);
    });
  });

  // ──────────────────────── PATCH /api/auth/me ────────────────────────

  describe('PATCH /api/auth/me', () => {
    it('updates username', async () => {
      const res = await withAuth(
        request(app.getHttpServer())
          .patch('/api/auth/me')
          .send({ username: 'new-username' }),
        admin,
      );

      expect(res.status).toBe(200);
      expect(res.body.username).toBe('new-username');
    });

    it('updates password with correct current password', async () => {
      const res = await withAuth(
        request(app.getHttpServer())
          .patch('/api/auth/me')
          .send({ currentPassword: admin.password, newPassword: 'NewPass456!' }),
        admin,
      );

      expect(res.status).toBe(200);

      // Verify new password works for login
      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: admin.email, password: 'NewPass456!', fingerprint: 'fp' });

      expect(loginRes.status).toBe(200);
    });

    it('returns 403 when current password is wrong', async () => {
      const res = await withAuth(
        request(app.getHttpServer())
          .patch('/api/auth/me')
          .send({ currentPassword: 'WrongPass!', newPassword: 'NewPass456!' }),
        admin,
      );

      expect(res.status).toBe(403);
    });

    it('returns 401 without auth', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/auth/me')
        .send({ username: 'hacker' });

      expect(res.status).toBe(401);
    });
  });

  // ──────────────────────── POST /api/auth/refresh ────────────────────────

  describe('POST /api/auth/refresh', () => {
    it('returns new tokens with valid refresh token + fingerprint', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', [`refresh_token=${admin.refreshToken}`])
        .set('X-Fingerprint', admin.fingerprint);

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
      // Should set cookies
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
    });

    it('returns 400 without refresh token', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('X-Fingerprint', admin.fingerprint);

      expect(res.status).toBe(400);
    });

    it('returns 401 with invalid refresh token', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', ['refresh_token=invalid'])
        .set('X-Fingerprint', admin.fingerprint);

      expect(res.status).toBe(401);
    });

    it('returns 400 without fingerprint', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', [`refresh_token=${admin.refreshToken}`]);

      expect(res.status).toBe(400);
    });
  });

  // ──────────────────────── POST /api/auth/logout ────────────────────────

  describe('POST /api/auth/logout', () => {
    it('revokes session and clears cookies', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).post('/api/auth/logout'),
        admin,
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Session should be revoked — using old token should fail
      const meRes = await withAuth(
        request(app.getHttpServer()).get('/api/auth/me'),
        admin,
      );
      expect(meRes.status).toBe(401);
    });

    it('returns 401 without auth', async () => {
      const res = await request(app.getHttpServer()).post('/api/auth/logout');
      expect(res.status).toBe(401);
    });
  });

  // ──────────────────────── POST /api/auth/logout-all ────────────────────────

  describe('POST /api/auth/logout-all', () => {
    it('revokes all user sessions', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).post('/api/auth/logout-all'),
        admin,
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Session should be revoked
      const meRes = await withAuth(
        request(app.getHttpServer()).get('/api/auth/me'),
        admin,
      );
      expect(meRes.status).toBe(401);
    });
  });

  // ──────────────────────── 2FA Endpoints ────────────────────────

  describe('2FA endpoints', () => {
    it('GET /api/auth/2fa/status returns enabled: false by default', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).get('/api/auth/2fa/status'),
        admin,
      );

      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(false);
    });

    it('POST /api/auth/2fa/setup returns QR data', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).post('/api/auth/2fa/setup'),
        admin,
      );

      expect(res.status).toBe(200);
      expect(res.body.secret).toBeDefined();
      expect(res.body.qrCodeUrl).toBeDefined();
    });

    it('POST /api/auth/2fa/setup returns 401 without auth', async () => {
      const res = await request(app.getHttpServer()).post('/api/auth/2fa/setup');
      expect(res.status).toBe(401);
    });
  });

  // ──────────────────── Email Verification ────────────────────

  describe('POST /api/auth/email/send-verification', () => {
    it('sends verification email', async () => {
      const agent = await createAuthenticatedUser(prisma, { roleId: roles.agentRoleId });

      const res = await request(app.getHttpServer())
        .post('/api/auth/email/send-verification')
        .send({ userId: agent.id, fingerprint: agent.fingerprint });

      expect(res.status).toBe(200);
      expect(res.body.sent).toBe(true);
    });

    it('returns 400 without userId', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/email/send-verification')
        .send({ fingerprint: 'fp' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/auth/email/verify', () => {
    it('returns 400 with invalid code', async () => {
      const agent = await createAuthenticatedUser(prisma, { roleId: roles.agentRoleId });

      const res = await request(app.getHttpServer())
        .post('/api/auth/email/verify')
        .send({ userId: agent.id, code: '000000', fingerprint: agent.fingerprint });

      expect(res.status).toBe(400);
    });
  });
});
