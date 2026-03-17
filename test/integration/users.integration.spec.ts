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

describe('Users (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let roles: SeededRoles;
  let admin: TestUser;
  let employee: TestUser;
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
    employee = await createAuthenticatedUser(prisma, { roleId: roles.employeeRoleId });
    agent = await createAuthenticatedUser(prisma, { roleId: roles.agentRoleId });
  });

  // ──────────────────────── GET /api/users ────────────────────────

  describe('GET /api/users', () => {
    it('admin can list all users', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).get('/api/users'),
        admin,
      );

      expect(res.status).toBe(200);
      // Should contain the 3 users we created
      const users = Array.isArray(res.body) ? res.body : res.body.data;
      expect(users.length).toBeGreaterThanOrEqual(3);
    });

    it('returns 401 without auth', async () => {
      const res = await request(app.getHttpServer()).get('/api/users');
      expect(res.status).toBe(401);
    });

    it('agent cannot list users (403)', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).get('/api/users'),
        agent,
      );

      expect(res.status).toBe(403);
    });
  });

  // ──────────────────────── GET /api/users/:id ────────────────────────

  describe('GET /api/users/:id', () => {
    it('admin can get user by id', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).get(`/api/users/${agent.id}`),
        admin,
      );

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(agent.id);
    });

    it('returns 404 for non-existent user', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).get('/api/users/non-existent-id'),
        admin,
      );

      expect(res.status).toBe(404);
    });
  });

  // ──────────────────────── POST /api/users ────────────────────────

  describe('POST /api/users', () => {
    it('admin can create a user', async () => {
      const res = await withAuth(
        request(app.getHttpServer())
          .post('/api/users')
          .send({
            email: 'newuser@test.com',
            username: 'newuser',
            password: 'StrongPass123!',
            roleIds: [roles.agentRoleId],
          }),
        admin,
      );

      expect(res.status).toBe(201);
      expect(res.body.email).toBe('newuser@test.com');
      expect(res.body.username).toBe('newuser');
    });

    it('agent cannot create users (403)', async () => {
      const res = await withAuth(
        request(app.getHttpServer())
          .post('/api/users')
          .send({
            email: 'hack@test.com',
            username: 'hacker',
            password: 'Pass123!',
            roleIds: [roles.agentRoleId],
          }),
        agent,
      );

      expect(res.status).toBe(403);
    });

    it('returns 400 without required fields', async () => {
      const res = await withAuth(
        request(app.getHttpServer())
          .post('/api/users')
          .send({ email: 'incomplete@test.com' }),
        admin,
      );

      expect(res.status).toBe(400);
    });
  });

  // ──────────────────────── PATCH /api/users/:id ────────────────────────

  describe('PATCH /api/users/:id', () => {
    it('admin can update a user', async () => {
      const res = await withAuth(
        request(app.getHttpServer())
          .patch(`/api/users/${agent.id}`)
          .send({ username: 'updated-agent' }),
        admin,
      );

      expect(res.status).toBe(200);
    });

    it('agent cannot update users (403)', async () => {
      const res = await withAuth(
        request(app.getHttpServer())
          .patch(`/api/users/${employee.id}`)
          .send({ username: 'hacked' }),
        agent,
      );

      expect(res.status).toBe(403);
    });
  });

  // ──────────────────────── DELETE /api/users/:id ────────────────────────

  describe('DELETE /api/users/:id', () => {
    it('admin can delete a user', async () => {
      // Create a user to delete
      const createRes = await withAuth(
        request(app.getHttpServer())
          .post('/api/users')
          .send({
            email: 'todelete@test.com',
            username: 'todelete',
            password: 'Pass123!',
            roleIds: [roles.agentRoleId],
          }),
        admin,
      );

      const res = await withAuth(
        request(app.getHttpServer()).delete(`/api/users/${createRes.body.id}`),
        admin,
      );

      expect(res.status).toBe(200);
    });

    it('agent cannot delete users (403)', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).delete(`/api/users/${employee.id}`),
        agent,
      );

      expect(res.status).toBe(403);
    });
  });

  // ──────────────────────── POST /api/users/:id/unlock ────────────────────────

  describe('POST /api/users/:id/unlock', () => {
    it('admin can unlock a locked user', async () => {
      // Lock the agent
      await prisma.user.update({
        where: { id: agent.id },
        data: { status: 'LOCKED', lockedUntil: new Date(Date.now() + 3600000) },
      });

      const res = await withAuth(
        request(app.getHttpServer()).post(`/api/users/${agent.id}/unlock`),
        admin,
      );

      expect(res.status).toBe(200);
    });

    it('agent cannot unlock users (403)', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).post(`/api/users/${admin.id}/unlock`),
        agent,
      );

      expect(res.status).toBe(403);
    });
  });

  // ──────────────────────── POST /api/users/:id/reset-2fa ────────────────────────

  describe('POST /api/users/:id/reset-2fa', () => {
    it('admin can reset 2FA for a user', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).post(`/api/users/${agent.id}/reset-2fa`),
        admin,
      );

      expect(res.status).toBe(200);
    });

    it('employee cannot reset 2FA (403)', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).post(`/api/users/${agent.id}/reset-2fa`),
        employee,
      );

      expect(res.status).toBe(403);
    });
  });
});
