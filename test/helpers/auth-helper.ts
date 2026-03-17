import { PrismaService } from '../../src/prisma/prisma.service.js';
import { DEFAULT_ROLES } from '../../src/rbac/permissions.js';
import { randomBytes } from 'crypto';
import bcrypt from 'bcrypt';

export interface TestUser {
  id: string;
  email: string;
  username: string;
  password: string;
  token: string;
  refreshToken: string;
  fingerprint: string;
  /** Cookie string for supertest: .set('Cookie', user.cookies) */
  cookies: string[];
}

export interface SeededRoles {
  adminRoleId: string;
  employeeRoleId: string;
  agentRoleId: string;
}

/**
 * Create the 3 default roles (Admin, Employee, Agent) in the test DB.
 * Returns their IDs for use in createAuthenticatedUser.
 */
export async function seedDefaultRoles(prisma: PrismaService): Promise<SeededRoles> {
  const admin = await prisma.role.create({
    data: {
      name: DEFAULT_ROLES.ADMIN.name,
      description: DEFAULT_ROLES.ADMIN.description,
      permissions: [...DEFAULT_ROLES.ADMIN.permissions],
      isSystem: true,
    },
  });

  const employee = await prisma.role.create({
    data: {
      name: DEFAULT_ROLES.EMPLOYEE.name,
      description: DEFAULT_ROLES.EMPLOYEE.description,
      permissions: [...DEFAULT_ROLES.EMPLOYEE.permissions],
      isSystem: true,
    },
  });

  const agent = await prisma.role.create({
    data: {
      name: DEFAULT_ROLES.AGENT.name,
      description: DEFAULT_ROLES.AGENT.description,
      permissions: [...DEFAULT_ROLES.AGENT.permissions],
      isSystem: true,
    },
  });

  return {
    adminRoleId: admin.id,
    employeeRoleId: employee.id,
    agentRoleId: agent.id,
  };
}

/**
 * Create a user with a valid session directly in the DB.
 * Bypasses the login flow for fast, reliable test setup.
 */
export async function createAuthenticatedUser(
  prisma: PrismaService,
  options: {
    roleId: string;
    email?: string;
    username?: string;
    password?: string;
    status?: string;
  },
): Promise<TestUser> {
  const password = options.password || 'TestPass123!';
  const fingerprint = 'test-fp-' + randomBytes(8).toString('hex');
  const token = randomBytes(32).toString('hex');
  const refreshToken = randomBytes(32).toString('hex');
  const suffix = randomBytes(4).toString('hex');

  // Low rounds for speed in tests
  const passwordHash = await bcrypt.hash(password, 4);

  const user = await prisma.user.create({
    data: {
      email: options.email || `test-${suffix}@test.com`,
      username: options.username || `user-${suffix}`,
      passwordHash,
      status: (options.status as 'ACTIVE') || 'ACTIVE',
      roles: {
        create: { roleId: options.roleId },
      },
    },
  });

  await prisma.session.create({
    data: {
      userId: user.id,
      token,
      refreshToken,
      fingerprint,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      refreshExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  return {
    id: user.id,
    email: user.email,
    username: user.username,
    password,
    token,
    refreshToken,
    fingerprint,
    cookies: [`auth_token=${token}`],
  };
}

/**
 * Helper to set auth headers on a supertest request.
 */
export function withAuth(request: any, user: TestUser) {
  return request
    .set('Cookie', user.cookies)
    .set('X-Fingerprint', user.fingerprint);
}
