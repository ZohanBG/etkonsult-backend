/**
 * One-time migration script: encrypt any legacy plaintext TOTP secrets.
 *
 * Usage:
 *   npx tsx prisma/encrypt-legacy-totp.ts
 *
 * Requires TOTP_ENCRYPTION_KEY to be set in .env (64-char hex = 32 bytes).
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createCipheriv, randomBytes } from 'crypto';

const prisma = new PrismaClient();

function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function isEncrypted(value: string): boolean {
  // Encrypted format is iv:tag:ciphertext (3 hex parts separated by colons)
  const parts = value.split(':');
  return parts.length === 3 && parts.every((p) => /^[0-9a-f]+$/i.test(p));
}

async function main() {
  const keyHex = process.env.TOTP_ENCRYPTION_KEY;
  if (!keyHex || keyHex.length !== 64) {
    console.error('ERROR: TOTP_ENCRYPTION_KEY must be a 64-character hex string');
    process.exit(1);
  }

  const key = Buffer.from(keyHex, 'hex');

  const users = await prisma.user.findMany({
    where: { totpSecret: { not: null } },
    select: { id: true, email: true, totpSecret: true },
  });

  let encrypted = 0;
  let skipped = 0;

  for (const user of users) {
    if (!user.totpSecret) continue;

    if (isEncrypted(user.totpSecret)) {
      skipped++;
      continue;
    }

    // This is a legacy plaintext base32 secret — encrypt it
    const encryptedSecret = encrypt(user.totpSecret, key);
    await prisma.user.update({
      where: { id: user.id },
      data: { totpSecret: encryptedSecret },
    });
    encrypted++;
    console.log(`  Encrypted TOTP secret for ${user.email}`);
  }

  console.log(`\nDone. Encrypted: ${encrypted}, Already encrypted: ${skipped}, Total with TOTP: ${users.length}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
