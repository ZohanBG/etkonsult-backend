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

describe('Vehicles (integration)', () => {
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

  // ──────────────────────── POST /api/vehicles ────────────────────────

  describe('POST /api/vehicles', () => {
    it('employee can create a vehicle', async () => {
      const owner = await createTestOwner(prisma);
      const res = await withAuth(
        request(app.getHttpServer())
          .post('/api/vehicles')
          .send({
            talonNumber: 'T-NEW-001',
            registrationNumber: 'CA1234AB',
            engineCapacity: '2000',
            powerKW: '110',
            purpose: 'лично',
            rightHandDrive: false,
            ownerId: owner.id,
          }),
        employee,
      );

      expect(res.status).toBe(201);
      expect(res.body.talonNumber).toBe('T-NEW-001');
      expect(res.body.registrationNumber).toBe('CA1234AB');
    });

    it('returns 401 without auth', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/vehicles')
        .send({ talonNumber: 'T1', registrationNumber: 'CA0000AB' });

      expect(res.status).toBe(401);
    });

    it('agent cannot create vehicles (403)', async () => {
      const owner = await createTestOwner(prisma);
      const res = await withAuth(
        request(app.getHttpServer())
          .post('/api/vehicles')
          .send({
            talonNumber: 'T-AGENT',
            registrationNumber: 'CA9999AB',
            engineCapacity: '1600',
            powerKW: '85',
            purpose: 'лично',
            rightHandDrive: false,
            ownerId: owner.id,
          }),
        agent,
      );

      expect(res.status).toBe(403);
    });

    it('returns 400 with missing required fields', async () => {
      const res = await withAuth(
        request(app.getHttpServer())
          .post('/api/vehicles')
          .send({ talonNumber: 'T-INCOMPLETE' }),
        employee,
      );

      expect(res.status).toBe(400);
    });
  });

  // ──────────────────────── GET /api/vehicles ────────────────────────

  describe('GET /api/vehicles', () => {
    it('employee can list vehicles', async () => {
      await createTestVehicle(prisma, employee.id);
      await createTestVehicle(prisma, employee.id);

      const res = await withAuth(
        request(app.getHttpServer()).get('/api/vehicles'),
        employee,
      );

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data || res.body)).toBe(true);
    });

    it('returns 401 without auth', async () => {
      const res = await request(app.getHttpServer()).get('/api/vehicles');
      expect(res.status).toBe(401);
    });

    it('agent can also list vehicles (has VEHICLE_READ)', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).get('/api/vehicles'),
        agent,
      );

      expect(res.status).toBe(200);
    });
  });

  // ──────────────────────── GET /api/vehicles/:id ────────────────────────

  describe('GET /api/vehicles/:id', () => {
    it('employee can get vehicle by id', async () => {
      const vehicle = await createTestVehicle(prisma, employee.id);

      const res = await withAuth(
        request(app.getHttpServer()).get(`/api/vehicles/${vehicle.id}`),
        employee,
      );

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(vehicle.id);
    });

    it('returns 404 for non-existent vehicle', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).get('/api/vehicles/non-existent-id'),
        employee,
      );

      expect(res.status).toBe(404);
    });
  });

  // ──────────────────────── PATCH /api/vehicles/:id ────────────────────────

  describe('PATCH /api/vehicles/:id', () => {
    it('employee can update vehicle fields', async () => {
      const vehicle = await createTestVehicle(prisma, employee.id);

      const res = await withAuth(
        request(app.getHttpServer())
          .patch(`/api/vehicles/${vehicle.id}`)
          .send({ engineCapacity: '2500' }),
        employee,
      );

      expect(res.status).toBe(200);
      expect(res.body.engineCapacity).toBe('2500');
    });

    it('returns 401 without auth', async () => {
      const vehicle = await createTestVehicle(prisma, employee.id);

      const res = await request(app.getHttpServer())
        .patch(`/api/vehicles/${vehicle.id}`)
        .send({ engineCapacity: '9999' });

      expect(res.status).toBe(401);
    });
  });

  // ──────────────────────── DELETE /api/vehicles/:id ────────────────────────

  describe('DELETE /api/vehicles/:id', () => {
    it('admin can delete a vehicle', async () => {
      const vehicle = await createTestVehicle(prisma, admin.id);

      const res = await withAuth(
        request(app.getHttpServer()).delete(`/api/vehicles/${vehicle.id}`),
        admin,
      );

      expect(res.status).toBe(204);
    });

    it('agent cannot delete vehicles (403)', async () => {
      const vehicle = await createTestVehicle(prisma, admin.id);

      const res = await withAuth(
        request(app.getHttpServer()).delete(`/api/vehicles/${vehicle.id}`),
        agent,
      );

      expect(res.status).toBe(403);
    });
  });

  // ──────────────────────── POST /api/vehicles/check-duplicates ────────────────────────

  describe('POST /api/vehicles/check-duplicates', () => {
    it('detects duplicate registration number', async () => {
      await createTestVehicle(prisma, employee.id, {
        registrationNumber: 'CA1111AB',
      });

      const res = await withAuth(
        request(app.getHttpServer())
          .post('/api/vehicles/check-duplicates')
          .send({ registrationNumber: 'CA1111AB' }),
        employee,
      );

      expect(res.status).toBe(200);
    });

    it('returns 401 without auth', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/vehicles/check-duplicates')
        .send({ registrationNumber: 'CA0000AB' });

      expect(res.status).toBe(401);
    });
  });
});
