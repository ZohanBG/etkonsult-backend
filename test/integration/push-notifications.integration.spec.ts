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

describe('Push Notifications (integration)', () => {
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

  describe('GET /api/push/vapid-public-key', () => {
    it('returns VAPID public key with auth', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).get('/api/push/vapid-public-key'),
        admin,
      );

      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/push/subscribe', () => {
    it('authenticated user can subscribe', async () => {
      const res = await withAuth(
        request(app.getHttpServer())
          .post('/api/push/subscribe')
          .send({
            endpoint: 'https://fcm.googleapis.com/fcm/send/test-subscription',
            keys: {
              p256dh: 'test-p256dh-key',
              auth: 'test-auth-key',
            },
          }),
        admin,
      );

      expect(res.status).toBe(201);
    });

    it('returns 401 without auth', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/push/subscribe')
        .send({
          endpoint: 'https://fcm.googleapis.com/fcm/send/test',
          keys: { p256dh: 'x', auth: 'y' },
        });

      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /api/push/unsubscribe', () => {
    it('authenticated user can unsubscribe', async () => {
      const res = await withAuth(
        request(app.getHttpServer())
          .delete('/api/push/unsubscribe')
          .send({
            endpoint: 'https://fcm.googleapis.com/fcm/send/test-subscription',
          }),
        admin,
      );

      expect(res.status).toBe(200);
    });
  });
});
