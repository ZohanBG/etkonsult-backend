import { PrismaService } from '../../src/prisma/prisma.service.js';

// Truncation order respects FK constraints (children first)
const TABLES = [
  'request_images',
  'vehicle_images',
  'requests',
  'vehicles',
  'owners',
  'insurance_policies',
  'insurance_spreadsheets',
  'agent_mappings',
  'resource_items',
  'resource_sections',
  'push_subscriptions',
  'notifications',
  'email_verifications',
  'audit_logs',
  'sessions',
  'user_roles',
  'users',
  'roles',
];

export async function cleanDatabase(prisma: PrismaService): Promise<void> {
  for (const table of TABLES) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`);
  }
}
