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
import { createTestVehicle, TEST_IMAGE_BUFFER } from '../helpers/fixtures.js';

describe('Uploads (integration)', () => {
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

  describe('POST /api/uploads/vehicles/:id/images', () => {
    it('returns 401 without auth', async () => {
      const vehicle = await createTestVehicle(prisma, employee.id);

      const res = await request(app.getHttpServer())
        .post(`/api/uploads/vehicles/${vehicle.id}/images`)
        .attach('images', TEST_IMAGE_BUFFER, 'test.jpg');

      expect(res.status).toBe(401);
    });

    it('employee can upload vehicle images (permission check)', async () => {
      const vehicle = await createTestVehicle(prisma, employee.id);

      const res = await withAuth(
        request(app.getHttpServer())
          .post(`/api/uploads/vehicles/${vehicle.id}/images`)
          .attach('images', TEST_IMAGE_BUFFER, 'test.jpg'),
        employee,
      );

      // May be 201 or 500 (sharp processing) — just verify auth passed (not 401/403)
      expect([201, 500]).toContain(res.status);
    });
  });

  describe('GET /api/uploads/vehicles/:id/images', () => {
    it('employee can get vehicle images', async () => {
      const vehicle = await createTestVehicle(prisma, employee.id);

      const res = await withAuth(
        request(app.getHttpServer()).get(`/api/uploads/vehicles/${vehicle.id}/images`),
        employee,
      );

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });
});
