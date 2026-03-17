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
import { createTestRequest, TEST_IMAGE_BUFFER } from '../helpers/fixtures.js';

describe('Requests (integration)', () => {
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

  // ──────────────────────── POST /api/requests ────────────────────────

  describe('POST /api/requests', () => {
    it('agent can create a NOVA_POLICA request', async () => {
      const res = await withAuth(
        request(app.getHttpServer())
          .post('/api/requests')
          .send({
            requestType: 'NOVA_POLICA',
            registrationNumber: 'CA1234AB',
            talonNumber: 'T-001',
            engineCapacity: '1600',
            powerKW: '85',
            purpose: 'лично',
            rightHandDrive: false,
            ownerIdentifier: 'EGN123456',
            ownerName: 'Test Owner',
            ownerAddress: 'Test Address',
          }),
        agent,
      );

      expect(res.status).toBe(201);
      expect(res.body.requestType).toBe('NOVA_POLICA');
      expect(res.body.status).toBe('ZAYAVENA');
      expect(res.body.agentId).toBe(agent.id);
    });

    it('agent can create a VNOSKA request', async () => {
      const res = await withAuth(
        request(app.getHttpServer())
          .post('/api/requests')
          .send({
            requestType: 'VNOSKA',
            registrationNumber: 'CA5555AB',
            talonNumber: 'T-555',
            insuranceNumber: 'INS-12345',
          }),
        agent,
      );

      expect(res.status).toBe(201);
      expect(res.body.requestType).toBe('VNOSKA');
    });

    it('returns 401 without auth', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/requests')
        .send({ requestType: 'NOVA_POLICA' });

      expect(res.status).toBe(401);
    });

    it('employee cannot create requests (403)', async () => {
      const res = await withAuth(
        request(app.getHttpServer())
          .post('/api/requests')
          .send({
            requestType: 'NOVA_POLICA',
            registrationNumber: 'CA0000AB',
            talonNumber: 'T-000',
            engineCapacity: '1600',
            powerKW: '85',
            purpose: 'лично',
            rightHandDrive: false,
            ownerIdentifier: 'EGN000',
            ownerName: 'Emp Owner',
            ownerAddress: 'Emp Addr',
          }),
        employee,
      );

      expect(res.status).toBe(403);
    });
  });

  // ──────────────────────── GET /api/requests ────────────────────────

  describe('GET /api/requests', () => {
    it('employee can list all requests', async () => {
      await createTestRequest(prisma, agent.id);

      const res = await withAuth(
        request(app.getHttpServer()).get('/api/requests'),
        employee,
      );

      expect(res.status).toBe(200);
    });

    it('agent cannot list all requests (403)', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).get('/api/requests'),
        agent,
      );

      expect(res.status).toBe(403);
    });
  });

  // ──────────────────────── GET /api/requests/my ────────────────────────

  describe('GET /api/requests/my', () => {
    it('agent can list own requests', async () => {
      await createTestRequest(prisma, agent.id);

      const res = await withAuth(
        request(app.getHttpServer()).get('/api/requests/my'),
        agent,
      );

      expect(res.status).toBe(200);
    });

    it('returns 401 without auth', async () => {
      const res = await request(app.getHttpServer()).get('/api/requests/my');
      expect(res.status).toBe(401);
    });
  });

  // ──────────────────────── GET /api/requests/:id ────────────────────────

  describe('GET /api/requests/:id', () => {
    it('agent can get own request', async () => {
      const req = await createTestRequest(prisma, agent.id);

      const res = await withAuth(
        request(app.getHttpServer()).get(`/api/requests/${req.id}`),
        agent,
      );

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(req.id);
    });
  });

  // ──────────────────────── Status Transitions ────────────────────────

  describe('PATCH /api/requests/:id/status', () => {
    it('ZAYAVENA → OTKAZANA (staff declines)', async () => {
      const req = await createTestRequest(prisma, agent.id);

      const res = await withAuth(
        request(app.getHttpServer())
          .patch(`/api/requests/${req.id}/status`)
          .send({ status: 'OTKAZANA' }),
        employee,
      );

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('OTKAZANA');
    });

    it('invalid transition: ZAYAVENA → PRIETA_OFERTA fails', async () => {
      const req = await createTestRequest(prisma, agent.id);

      const res = await withAuth(
        request(app.getHttpServer())
          .patch(`/api/requests/${req.id}/status`)
          .send({ status: 'PRIETA_OFERTA' }),
        employee,
      );

      expect(res.status).toBe(400);
    });
  });

  // ──────────────────────── Respond to Offer ────────────────────────

  describe('PATCH /api/requests/:id/respond', () => {
    it('OBRABOTENA → PRIETA_OFERTA (agent accepts offer)', async () => {
      const req = await createTestRequest(prisma, agent.id, { status: 'OBRABOTENA' });

      const res = await withAuth(
        request(app.getHttpServer())
          .patch(`/api/requests/${req.id}/respond`)
          .send({ status: 'PRIETA_OFERTA', stickerNumber: 'STK001' }),
        agent,
      );

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('PRIETA_OFERTA');
    });

    it('OBRABOTENA → OTKAZANA_OFERTA (agent rejects offer)', async () => {
      const req = await createTestRequest(prisma, agent.id, { status: 'OBRABOTENA' });

      const res = await withAuth(
        request(app.getHttpServer())
          .patch(`/api/requests/${req.id}/respond`)
          .send({ status: 'OTKAZANA_OFERTA' }),
        agent,
      );

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('OTKAZANA_OFERTA');
    });
  });

  // ──────────────────────── VNOSKA Lifecycle ────────────────────────

  describe('VNOSKA lifecycle', () => {
    it('ZAYAVENA → OTKAZANA (staff declines)', async () => {
      const req = await createTestRequest(prisma, agent.id, { requestType: 'VNOSKA' });

      const res = await withAuth(
        request(app.getHttpServer())
          .patch(`/api/requests/${req.id}/status`)
          .send({ status: 'OTKAZANA' }),
        employee,
      );

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('OTKAZANA');
    });
  });

  // ──────────────────────── Agent Cancel ────────────────────────

  describe('PATCH /api/requests/:id/cancel', () => {
    it('agent can cancel own ZAYAVENA request', async () => {
      const req = await createTestRequest(prisma, agent.id);

      const res = await withAuth(
        request(app.getHttpServer()).patch(`/api/requests/${req.id}/cancel`),
        agent,
      );

      expect(res.status).toBe(200);
    });

    it('agent cannot cancel OBRABOTENA request', async () => {
      const req = await createTestRequest(prisma, agent.id, { status: 'OBRABOTENA' });

      const res = await withAuth(
        request(app.getHttpServer()).patch(`/api/requests/${req.id}/cancel`),
        agent,
      );

      expect(res.status).toBe(400);
    });

    it('employee cannot use agent cancel endpoint (403)', async () => {
      const req = await createTestRequest(prisma, agent.id);

      const res = await withAuth(
        request(app.getHttpServer()).patch(`/api/requests/${req.id}/cancel`),
        employee,
      );

      expect(res.status).toBe(403);
    });
  });

  // ──────────────────────── Check by registration ────────────────────────

  describe('GET /api/requests/check-by-reg', () => {
    it('agent can check recent requests by registration', async () => {
      await createTestRequest(prisma, agent.id, { registrationNumber: 'CA9999AB' });

      const res = await withAuth(
        request(app.getHttpServer()).get('/api/requests/check-by-reg?regs=CA9999AB'),
        agent,
      );

      expect(res.status).toBe(200);
    });
  });
});
