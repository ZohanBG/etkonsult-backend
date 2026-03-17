import 'dotenv/config';
import { PrismaClient, UserStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { createHmac } from 'crypto';

// Prisma 7 - requires driver adapter for PostgreSQL
const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

function applyPepper(password: string): string {
  const pepper = process.env.PASSWORD_PEPPER || '';
  if (!pepper) return password;
  return createHmac('sha256', pepper).update(password).digest('hex');
}

async function hashPassword(password: string): Promise<string> {
  const peppered = applyPepper(password);
  return argon2.hash(peppered, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });
}

async function main() {
  console.log('🌱 Starting seed...');

  // Delete old roles that are no longer needed
  const oldRoles = ['Мениджър', 'Наблюдател', 'Оператор'];
  for (const roleName of oldRoles) {
    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (role) {
      // First remove user-role assignments
      await prisma.userRole.deleteMany({ where: { roleId: role.id } });
      // Then delete the role
      await prisma.role.delete({ where: { id: role.id } });
      console.log(`🗑️ Deleted old role: ${roleName}`);
    }
  }

  // Create default roles
  const adminRole = await prisma.role.upsert({
    where: { name: 'Администратор' },
    update: {},
    create: {
      name: 'Администратор',
      description: 'Пълен достъп до всички функции на системата',
      permissions: [
        'vehicle:create', 'vehicle:read', 'vehicle:update', 'vehicle:delete', 'vehicle:export',
        'owner:create', 'owner:read', 'owner:update', 'owner:delete',
        'user:create', 'user:read', 'user:update', 'user:delete', 'user:reset_2fa',
        'role:create', 'role:read', 'role:update', 'role:delete',
        'audit:read', 'audit:export',
        'request:create', 'request:read_own', 'request:read_all', 'request:update_status',
        'request:respond_offer', 'request:upload_document',
        'insurance:read', 'insurance:manage',
        'resource:read', 'resource:manage',
        'menu:home', 'menu:vehicle_insert', 'menu:vehicle_list', 'menu:roles', 'menu:accounts', 'menu:audit_logs',
        'menu:request_create', 'menu:my_requests', 'menu:all_requests',
        'menu:insurance', 'menu:insurance_manage',
        'menu:resources', 'menu:notifications',
      ],
      isSystem: true,
    },
  });
  console.log('✅ Admin role created/updated');

  await prisma.role.upsert({
    where: { name: 'Служител' },
    update: {},
    create: {
      name: 'Служител',
      description: 'Въвеждане и преглед на МПС',
      permissions: [
        'vehicle:create', 'vehicle:read', 'vehicle:update', 'vehicle:delete', 'vehicle:export',
        'owner:create', 'owner:read', 'owner:update', 'owner:delete',
        'request:read_all', 'request:update_status', 'request:upload_document',
        'insurance:read',
        'resource:read',
        'menu:home', 'menu:vehicle_insert', 'menu:vehicle_list', 'menu:all_requests',
        'menu:insurance',
        'menu:resources',
      ],
      isSystem: true,
    },
  });
  console.log('✅ Служител role created/updated');

  await prisma.role.upsert({
    where: { name: 'Агент' },
    update: {},
    create: {
      name: 'Агент',
      description: 'Създаване на заявки и преглед на оферти',
      permissions: [
        'request:create', 'request:read_own', 'request:respond_offer',
        'insurance:read', 'insurance:agent_view',
        'menu:home', 'menu:request_create', 'menu:my_requests', 'menu:insurance',
      ],
      isSystem: true,
    },
  });
  console.log('✅ Агент role created/updated');

  // Create admin user from .env config
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@mps.bg';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin123!';
  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  const passwordHash = await hashPassword(adminPassword);

  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      passwordHash,
      status: UserStatus.ACTIVE,
      username: adminUsername,
    },
    create: {
      email: adminEmail,
      username: adminUsername,
      passwordHash,
      status: UserStatus.ACTIVE,
      totpEnabled: false,
    },
  });
  console.log('✅ Admin user created/updated');

  // Assign admin role to admin user
  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: adminUser.id,
        roleId: adminRole.id,
      },
    },
    update: {},
    create: {
      userId: adminUser.id,
      roleId: adminRole.id,
    },
  });
  console.log('✅ Admin role assigned to admin user');

  console.log('\n🎉 Seed completed successfully!');
  console.log('\n📋 Admin credentials:');
  console.log(`   Email: ${adminEmail}`);
  console.log(`   Username: ${adminUsername}`);
  console.log(`   Password: ${adminPassword}`);
  console.log('\n💡 Configure via .env: ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_USERNAME');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
