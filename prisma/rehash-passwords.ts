import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { createHmac } from 'crypto';

const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const DEFAULT_PASSWORD = 'Admin123!';

function applyPepper(password: string): string {
  const pepper = process.env.PASSWORD_PEPPER || '';
  if (!pepper) {
    console.warn('WARNING: PASSWORD_PEPPER is not set in .env');
    return password;
  }
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
  console.log('Rehashing all user passwords with argon2id + pepper...');
  console.log(`Default password: ${DEFAULT_PASSWORD}`);

  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  console.log(`Found ${users.length} users to update.`);

  const newHash = await hashPassword(DEFAULT_PASSWORD);

  for (const user of users) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: newHash,
        failedLoginAttempts: 0,
        lastFailedLoginAt: null,
      },
    });
    console.log(`Updated: ${user.email}`);
  }

  console.log('\nAll passwords have been reset to Admin123! with argon2id + pepper.');
}

main()
  .catch((e) => {
    console.error('Rehash failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
