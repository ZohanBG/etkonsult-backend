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
import { createTestOwner, createTestVehicle } from '../helpers/fixtures.js';

describe('Owners (integration)', () => {
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

  // ──────────────────────── POST /api/owners ────────────────────────

  describe('POST /api/owners', () => {
    it('employee can create an owner', async () => {
      const res = await withAuth(
        request(app.getHttpServer())
          .post('/api/owners')
          .send({
            identifier: 'EGN1234567890',
            name: 'Иван Иванов',
            address: 'ул. Тестова 1',
          }),
        employee,
      );

      expect(res.status).toBe(201);
      expect(res.body.identifier).toBe('EGN1234567890');
      expect(res.body.name).toBe('Иван Иванов');
    });

    it('returns 401 without auth', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/owners')
        .send({ identifier: 'EGN123', name: 'Test', address: 'Addr' });

      expect(res.status).toBe(401);
    });

    it('agent cannot create owners (403)', async () => {
      const res = await withAuth(
        request(app.getHttpServer())
          .post('/api/owners')
          .send({ identifier: 'EGN999', name: 'Agent Owner', address: 'Addr' }),
        agent,
      );

      expect(res.status).toBe(403);
    });

    it('returns 400 without required fields', async () => {
      const res = await withAuth(
        request(app.getHttpServer())
          .post('/api/owners')
          .send({ identifier: 'EGN123' }),
        employee,
      );

      expect(res.status).toBe(400);
    });
  });

  // ──────────────────────── GET /api/owners ────────────────────────

  describe('GET /api/owners', () => {
    it('employee can list owners', async () => {
      await createTestOwner(prisma);
      await createTestOwner(prisma);

      const res = await withAuth(
        request(app.getHttpServer()).get('/api/owners'),
        employee,
      );

      expect(res.status).toBe(200);
    });

    it('returns 401 without auth', async () => {
      const res = await request(app.getHttpServer()).get('/api/owners');
      expect(res.status).toBe(401);
    });

    it('agent can also list owners (has OWNER_READ)', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).get('/api/owners'),
        agent,
      );

      expect(res.status).toBe(200);
    });
  });

  // ──────────────────────── GET /api/owners/search ────────────────────────

  describe('GET /api/owners/search', () => {
    it('employee can search owners by query', async () => {
      await createTestOwner(prisma, { name: 'Петър Петров' });

      const res = await withAuth(
        request(app.getHttpServer()).get('/api/owners/search?q=Петър'),
        employee,
      );

      expect(res.status).toBe(200);
    });
  });

  // ──────────────────────── GET /api/owners/lookup ────────────────────────

  describe('GET /api/owners/lookup', () => {
    it('employee can lookup owner by identifier', async () => {
      const owner = await createTestOwner(prisma, { identifier: 'LOOKUP123' });

      const res = await withAuth(
        request(app.getHttpServer()).get('/api/owners/lookup?identifier=LOOKUP123'),
        employee,
      );

      expect(res.status).toBe(200);
    });
  });

  // ──────────────────────── GET /api/owners/:id ────────────────────────

  describe('GET /api/owners/:id', () => {
    it('employee can get owner by id', async () => {
      const owner = await createTestOwner(prisma);

      const res = await withAuth(
        request(app.getHttpServer()).get(`/api/owners/${owner.id}`),
        employee,
      );

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(owner.id);
    });

    it('returns 404 for non-existent owner', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).get('/api/owners/non-existent-id'),
        employee,
      );

      expect(res.status).toBe(404);
    });
  });

  // ──────────────────────── GET /api/owners/:id/vehicles ────────────────────────

  describe('GET /api/owners/:id/vehicles', () => {
    it('returns vehicles for an owner', async () => {
      const owner = await createTestOwner(prisma);
      await createTestVehicle(prisma, employee.id, { ownerId: owner.id });

      const res = await withAuth(
        request(app.getHttpServer()).get(`/api/owners/${owner.id}/vehicles`),
        employee,
      );

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
    });
  });

  // ──────────────────────── PATCH /api/owners/:id ────────────────────────

  describe('PATCH /api/owners/:id', () => {
    it('employee can update owner', async () => {
      const owner = await createTestOwner(prisma);

      const res = await withAuth(
        request(app.getHttpServer())
          .patch(`/api/owners/${owner.id}`)
          .send({ name: 'Updated Name' }),
        employee,
      );

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated Name');
    });

    it('returns 401 without auth', async () => {
      const owner = await createTestOwner(prisma);

      const res = await request(app.getHttpServer())
        .patch(`/api/owners/${owner.id}`)
        .send({ name: 'Hack' });

      expect(res.status).toBe(401);
    });
  });

  // ──────────────────────── DELETE /api/owners/:id ────────────────────────

  describe('DELETE /api/owners/:id', () => {
    it('admin can delete an owner', async () => {
      const owner = await createTestOwner(prisma);

      const res = await withAuth(
        request(app.getHttpServer()).delete(`/api/owners/${owner.id}`),
        admin,
      );

      expect(res.status).toBe(204);
    });

    it('agent cannot delete owners (403)', async () => {
      const owner = await createTestOwner(prisma);

      const res = await withAuth(
        request(app.getHttpServer()).delete(`/api/owners/${owner.id}`),
        agent,
      );

      expect(res.status).toBe(403);
    });
  });
});
