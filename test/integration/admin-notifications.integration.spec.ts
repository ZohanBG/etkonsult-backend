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

describe('Admin Notifications (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let roles: SeededRoles;
  let admin: TestUser;
  let agent: TestUser;

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
    agent = await createAuthenticatedUser(prisma, { roleId: roles.agentRoleId });
  });

  describe('POST /api/admin-notifications/broadcast', () => {
    it('admin can broadcast to all users', async () => {
      const res = await withAuth(
        request(app.getHttpServer())
          .post('/api/admin-notifications/broadcast')
          .send({
            title: 'Test Broadcast',
            body: 'Hello everyone',
            variant: 'info',
            targetType: 'all',
          }),
        admin,
      );

      expect(res.status).toBe(204);
    });

    it('admin can broadcast to specific role', async () => {
      const res = await withAuth(
        request(app.getHttpServer())
          .post('/api/admin-notifications/broadcast')
          .send({
            title: 'Role Broadcast',
            body: 'Hello agents',
            variant: 'warning',
            targetType: 'role',
            targetRoles: ['Агент'],
          }),
        admin,
      );

      expect(res.status).toBe(204);
    });

    it('admin can broadcast to specific users', async () => {
      const res = await withAuth(
        request(app.getHttpServer())
          .post('/api/admin-notifications/broadcast')
          .send({
            title: 'User Broadcast',
            body: 'Just for you',
            variant: 'success',
            targetType: 'users',
            targetUserIds: [agent.id],
          }),
        admin,
      );

      expect(res.status).toBe(204);
    });

    it('agent cannot broadcast (403)', async () => {
      const res = await withAuth(
        request(app.getHttpServer())
          .post('/api/admin-notifications/broadcast')
          .send({
            title: 'Hack',
            body: 'Hacked',
            variant: 'danger',
            targetType: 'all',
          }),
        agent,
      );

      expect(res.status).toBe(403);
    });

    it('returns 401 without auth', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/admin-notifications/broadcast')
        .send({ title: 'x', body: 'x', variant: 'info', targetType: 'all' });

      expect(res.status).toBe(401);
    });

    it('returns 400 with invalid variant', async () => {
      const res = await withAuth(
        request(app.getHttpServer())
          .post('/api/admin-notifications/broadcast')
          .send({
            title: 'Bad',
            body: 'Bad variant',
            variant: 'invalid',
            targetType: 'all',
          }),
        admin,
      );

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/admin-notifications/roles-list', () => {
    it('admin can list roles for targeting', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).post('/api/admin-notifications/roles-list'),
        admin,
      );

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('POST /api/admin-notifications/users-list', () => {
    it('admin can list users for targeting', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).post('/api/admin-notifications/users-list'),
        admin,
      );

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });
});
