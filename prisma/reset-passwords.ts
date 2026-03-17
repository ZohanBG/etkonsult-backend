import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { createHmac } from 'crypto';

const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

function applyPepper(password: string): string {
  const pepper = process.env.PASSWORD_PEPPER || '';
  if (!pepper) return password;
  return createHmac('sha256', pepper).update(password).digest('hex');
}

async function main() {
  const newPassword = 'Admin123!';
  const peppered = applyPepper(newPassword);
  const hash = await argon2.hash(peppered, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  console.log(`Found ${users.length} users. Resetting all passwords to: ${newPassword}`);

  for (const user of users) {
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hash, failedAttempts: 0, lastFailedAttempt: null },
    });
    console.log(`  Reset: ${user.email}`);
  }

  console.log('\nDone! All passwords set to: ' + newPassword);
}

main()
  .catch((e) => {
    console.error('Failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
