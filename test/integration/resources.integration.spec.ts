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

describe('Resources (integration)', () => {
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

  // ──────────────────────── Sections ────────────────────────

  describe('POST /api/resources/sections', () => {
    it('admin can create a section', async () => {
      const res = await withAuth(
        request(app.getHttpServer())
          .post('/api/resources/sections')
          .send({ name: 'Test Section' }),
        admin,
      );

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Test Section');
    });

    it('agent cannot create sections (403)', async () => {
      const res = await withAuth(
        request(app.getHttpServer())
          .post('/api/resources/sections')
          .send({ name: 'Hack' }),
        agent,
      );

      expect(res.status).toBe(403);
    });

    it('returns 401 without auth', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/resources/sections')
        .send({ name: 'Anon' });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/resources/sections', () => {
    it('employee can list sections', async () => {
      const res = await withAuth(
        request(app.getHttpServer()).get('/api/resources'),
        employee,
      );

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('PATCH /api/resources/sections/:id', () => {
    it('admin can update a section', async () => {
      const createRes = await withAuth(
        request(app.getHttpServer())
          .post('/api/resources/sections')
          .send({ name: 'Original' }),
        admin,
      );

      const res = await withAuth(
        request(app.getHttpServer())
          .patch(`/api/resources/sections/${createRes.body.id}`)
          .send({ name: 'Updated' }),
        admin,
      );

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated');
    });
  });

  describe('DELETE /api/resources/sections/:id', () => {
    it('admin can delete a section', async () => {
      const createRes = await withAuth(
        request(app.getHttpServer())
          .post('/api/resources/sections')
          .send({ name: 'To Delete' }),
        admin,
      );

      const res = await withAuth(
        request(app.getHttpServer()).delete(`/api/resources/sections/${createRes.body.id}`),
        admin,
      );

      expect(res.status).toBe(204);
    });
  });

  // ──────────────────────── Link Items ────────────────────────

  describe('POST /api/resources/sections/:id/links', () => {
    it('admin can create a link item', async () => {
      const section = await withAuth(
        request(app.getHttpServer())
          .post('/api/resources/sections')
          .send({ name: 'Links Section' }),
        admin,
      );

      const res = await withAuth(
        request(app.getHttpServer())
          .post(`/api/resources/sections/${section.body.id}/items/link`)
          .send({ title: 'Google', url: 'https://google.com' }),
        admin,
      );

      expect(res.status).toBe(201);
    });
  });

  // ──────────────────────── Item Operations ────────────────────────

  describe('DELETE /api/resources/items/:id', () => {
    it('admin can delete an item', async () => {
      const section = await withAuth(
        request(app.getHttpServer())
          .post('/api/resources/sections')
          .send({ name: 'Del Section' }),
        admin,
      );

      const link = await withAuth(
        request(app.getHttpServer())
          .post(`/api/resources/sections/${section.body.id}/items/link`)
          .send({ title: 'To Delete', url: 'https://example.com' }),
        admin,
      );

      const res = await withAuth(
        request(app.getHttpServer()).delete(`/api/resources/items/${link.body.id}`),
        admin,
      );

      expect(res.status).toBe(204);
    });
  });
});
