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

describe('Notifications (integration)', () => {
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

  describe('GET /api/notifications', () => {
    it('returns notifications for current user', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).get('/api/notifications'),
        admin,
      );

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('returns 401 without auth', async () => {
      const res = await request(app.getHttpServer()).get('/api/notifications');
      expect(res.status).toBe(401);
    });
  });

  describe('PATCH /api/notifications/read-all', () => {
    it('marks all notifications as read', async () => {
      // Create a notification first
      await prisma.notification.create({
        data: {
          userId: admin.id,
          title: 'Test',
          body: 'Test notification',
        },
      });

      const res = await withAuth(
        request(app.getHttpServer()).patch('/api/notifications/read-all'),
        admin,
      );

      expect(res.status).toBe(204);
    });
  });

  describe('DELETE /api/notifications', () => {
    it('clears all notifications for current user', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).delete('/api/notifications'),
        admin,
      );

      expect(res.status).toBe(204);
    });
  });

  describe('PATCH /api/notifications/:id/read', () => {
    it('marks a single notification as read', async () => {
      const notif = await prisma.notification.create({
        data: {
          userId: admin.id,
          title: 'Single',
          body: 'Read me',
        },
      });

      const res = await withAuth(
        request(app.getHttpServer()).patch(`/api/notifications/${notif.id}/read`),
        admin,
      );

      expect(res.status).toBe(204);
    });
  });
});
