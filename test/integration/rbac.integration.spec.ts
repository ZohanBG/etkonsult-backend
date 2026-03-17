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

describe('RBAC (integration)', () => {
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

  // ──────────────────────── GET /api/roles ────────────────────────

  describe('GET /api/roles', () => {
    it('admin can list all roles', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).get('/api/roles'),
        admin,
      );

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(3);
    });

    it('returns 401 without auth', async () => {
      const res = await request(app.getHttpServer()).get('/api/roles');
      expect(res.status).toBe(401);
    });

    it('agent cannot list roles (403)', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).get('/api/roles'),
        agent,
      );

      expect(res.status).toBe(403);
    });
  });

  // ──────────────────────── GET /api/roles/permissions ────────────────────────

  describe('GET /api/roles/permissions', () => {
    it('admin can list available permissions', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).get('/api/roles/permissions'),
        admin,
      );

      expect(res.status).toBe(200);
    });
  });

  // ──────────────────────── GET /api/roles/my-permissions ────────────────────────

  describe('GET /api/roles/my-permissions', () => {
    it('returns permissions for the current user', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).get('/api/roles/my-permissions'),
        agent,
      );

      expect(res.status).toBe(200);
      expect(res.body.permissions).toBeDefined();
      expect(Array.isArray(res.body.permissions)).toBe(true);
    });

    it('admin has more permissions than agent', async () => {
      const adminRes = await withAuth(
        request(app.getHttpServer()).get('/api/roles/my-permissions'),
        admin,
      );
      const agentRes = await withAuth(
        request(app.getHttpServer()).get('/api/roles/my-permissions'),
        agent,
      );

      expect(adminRes.body.permissions.length).toBeGreaterThan(
        agentRes.body.permissions.length,
      );
    });

    it('returns 401 without auth', async () => {
      const res = await request(app.getHttpServer()).get('/api/roles/my-permissions');
      expect(res.status).toBe(401);
    });
  });

  // ──────────────────────── GET /api/roles/:id ────────────────────────

  describe('GET /api/roles/:id', () => {
    it('admin can get role by id', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).get(`/api/roles/${roles.adminRoleId}`),
        admin,
      );

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(roles.adminRoleId);
    });
  });

  // ──────────────────────── POST /api/roles ────────────────────────

  describe('POST /api/roles', () => {
    it('admin can create a custom role', async () => {
      const res = await withAuth(
        request(app.getHttpServer())
          .post('/api/roles')
          .send({
            name: 'Custom Role',
            description: 'A test custom role',
            permissions: ['vehicle:read'],
          }),
        admin,
      );

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Custom Role');
    });

    it('agent cannot create roles (403)', async () => {
      const res = await withAuth(
        request(app.getHttpServer())
          .post('/api/roles')
          .send({ name: 'Hack', permissions: [] }),
        agent,
      );

      expect(res.status).toBe(403);
    });

    it('returns 400 without name', async () => {
      const res = await withAuth(
        request(app.getHttpServer())
          .post('/api/roles')
          .send({ permissions: [] }),
        admin,
      );

      expect(res.status).toBe(400);
    });
  });

  // ──────────────────────── PATCH /api/roles/:id ────────────────────────

  describe('PATCH /api/roles/:id', () => {
    it('admin can update a role', async () => {
      const res = await withAuth(
        request(app.getHttpServer())
          .patch(`/api/roles/${roles.agentRoleId}`)
          .send({ description: 'Updated description' }),
        admin,
      );

      expect(res.status).toBe(200);
    });

    it('employee cannot update roles (403)', async () => {
      const res = await withAuth(
        request(app.getHttpServer())
          .patch(`/api/roles/${roles.agentRoleId}`)
          .send({ description: 'Hacked' }),
        employee,
      );

      expect(res.status).toBe(403);
    });
  });

  // ──────────────────────── DELETE /api/roles/:id ────────────────────────

  describe('DELETE /api/roles/:id', () => {
    it('admin can delete a non-system role', async () => {
      // Create a deletable role first
      const createRes = await withAuth(
        request(app.getHttpServer())
          .post('/api/roles')
          .send({ name: 'Deletable', permissions: [] }),
        admin,
      );

      const res = await withAuth(
        request(app.getHttpServer()).delete(`/api/roles/${createRes.body.id}`),
        admin,
      );

      expect(res.status).toBe(200);
    });

    it('agent cannot delete roles (403)', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).delete(`/api/roles/${roles.agentRoleId}`),
        agent,
      );

      expect(res.status).toBe(403);
    });
  });

  // ──────────────────────── POST /api/roles/assign ────────────────────────

  describe('POST /api/roles/assign', () => {
    it('admin can assign a role to a user', async () => {
      // Create a new role to assign
      const roleRes = await withAuth(
        request(app.getHttpServer())
          .post('/api/roles')
          .send({ name: 'Extra', permissions: ['vehicle:read'] }),
        admin,
      );

      const res = await withAuth(
        request(app.getHttpServer())
          .post('/api/roles/assign')
          .send({ userId: agent.id, roleId: roleRes.body.id }),
        admin,
      );

      expect(res.status).toBe(200);
    });

    it('agent cannot assign roles (403)', async () => {
      const res = await withAuth(
        request(app.getHttpServer())
          .post('/api/roles/assign')
          .send({ userId: agent.id, roleId: roles.employeeRoleId }),
        agent,
      );

      expect(res.status).toBe(403);
    });
  });

  // ──────────────────────── POST /api/roles/unassign ────────────────────────

  describe('POST /api/roles/unassign', () => {
    it('admin can unassign a role from a user', async () => {
      const res = await withAuth(
        request(app.getHttpServer())
          .post('/api/roles/unassign')
          .send({ userId: agent.id, roleId: roles.agentRoleId }),
        admin,
      );

      expect(res.status).toBe(200);
    });
  });

  // ──────────────────────── GET /api/roles/user/:userId ────────────────────────

  describe('GET /api/roles/user/:userId', () => {
    it('admin can view user roles', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).get(`/api/roles/user/${agent.id}`),
        admin,
      );

      expect(res.status).toBe(200);
    });

    it('agent cannot view user roles (403)', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).get(`/api/roles/user/${admin.id}`),
        agent,
      );

      expect(res.status).toBe(403);
    });
  });
});
