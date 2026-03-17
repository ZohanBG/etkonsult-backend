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

describe('Audit (integration)', () => {
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

  describe('GET /api/audit-logs', () => {
    it('admin can list audit logs', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).get('/api/audit-logs'),
        admin,
      );

      expect(res.status).toBe(200);
    });

    it('agent cannot list audit logs (403)', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).get('/api/audit-logs'),
        agent,
      );

      expect(res.status).toBe(403);
    });

    it('returns 401 without auth', async () => {
      const res = await request(app.getHttpServer()).get('/api/audit-logs');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/audit-logs/entity-types', () => {
    it('admin can get entity types', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).get('/api/audit-logs/entity-types'),
        admin,
      );

      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/audit-logs/actions', () => {
    it('admin can get actions', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).get('/api/audit-logs/actions'),
        admin,
      );

      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/audit-logs/client-error', () => {
    it('accepts client error log without auth', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/audit-logs/client-error')
        .send({
          message: 'Test error',
          source: 'test',
        });

      expect(res.status).toBe(204);
    });
  });

  describe('Audit interceptor creates entries', () => {
    it('creating a role produces an audit log', async () => {
      // Create a role (audited action)
      await withAuth(
        request(app.getHttpServer())
          .post('/api/roles')
          .send({ name: 'Audited Role', permissions: [] }),
        admin,
      );

      // Check audit logs
      const res = await withAuth(
        request(app.getHttpServer()).get('/api/audit-logs'),
        admin,
      );

      expect(res.status).toBe(200);
      const logs = Array.isArray(res.body) ? res.body : res.body.data;
      const createEntry = logs?.find(
        (l: { action: string; entityType: string }) =>
          l.action === 'CREATE' && l.entityType === 'Role',
      );
      expect(createEntry).toBeDefined();
    });
  });
});
