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

describe('Insurance (integration)', () => {
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

  // ──────────────────────── Spreadsheet Management ────────────────────────

  describe('POST /api/insurance/spreadsheets', () => {
    it('admin can create a spreadsheet config', async () => {
      const res = await withAuth(
        request(app.getHttpServer())
          .post('/api/insurance/spreadsheets')
          .send({
            spreadsheetId: 'test-sheet-id-123',
            label: 'Test Spreadsheet',
            year: 2025,
          }),
        admin,
      );

      expect(res.status).toBe(201);
    });

    it('agent cannot create spreadsheets (403)', async () => {
      const res = await withAuth(
        request(app.getHttpServer())
          .post('/api/insurance/spreadsheets')
          .send({ spreadsheetId: 'hack', label: 'Hack', year: 2025 }),
        agent,
      );

      expect(res.status).toBe(403);
    });

    it('returns 401 without auth', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/insurance/spreadsheets')
        .send({ spreadsheetId: 'x', label: 'x', year: 2025 });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/insurance/spreadsheets', () => {
    it('admin can list spreadsheets', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).get('/api/insurance/spreadsheets'),
        admin,
      );

      expect(res.status).toBe(200);
    });
  });

  // ──────────────────────── Agent Mappings ────────────────────────

  describe('POST /api/insurance/agent-mappings', () => {
    it('admin can create agent mapping', async () => {
      const res = await withAuth(
        request(app.getHttpServer())
          .post('/api/insurance/agent-mappings')
          .send({
            userId: agent.id,
            agentName: 'Agent Test Name',
          }),
        admin,
      );

      expect(res.status).toBe(201);
    });

    it('agent cannot create mappings (403)', async () => {
      const res = await withAuth(
        request(app.getHttpServer())
          .post('/api/insurance/agent-mappings')
          .send({ userId: agent.id, agentName: 'hack' }),
        agent,
      );

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/insurance/agent-mappings', () => {
    it('admin can list agent mappings', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).get('/api/insurance/agent-mappings'),
        admin,
      );

      expect(res.status).toBe(200);
    });
  });

  // ──────────────────────── Expiry Queries ────────────────────────

  describe('GET /api/insurance/expiries', () => {
    it('employee can query expiring policies', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).get('/api/insurance/expiries'),
        employee,
      );

      expect(res.status).toBe(200);
    });

    it('returns 401 without auth', async () => {
      const res = await request(app.getHttpServer()).get('/api/insurance/expiries');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/insurance/by-agent/expiries (own)', () => {
    it('agent can view own expiring policies', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).get('/api/insurance/by-agent/expiries'),
        agent,
      );

      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/insurance/by-agent/stats (own)', () => {
    it('agent can view own stats', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).get('/api/insurance/by-agent/stats'),
        agent,
      );

      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/insurance/stats', () => {
    it('employee can view global stats', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).get('/api/insurance/stats'),
        employee,
      );

      expect(res.status).toBe(200);
    });
  });

  // ──────────────────────── Force Sync ────────────────────────

  describe('POST /api/insurance/sync', () => {
    it('admin can trigger force sync', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).post('/api/insurance/sync'),
        admin,
      );

      expect(res.status).toBe(200);
    });

    it('agent cannot force sync (403)', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).post('/api/insurance/sync'),
        agent,
      );

      expect(res.status).toBe(403);
    });
  });
});
