import { config } from 'dotenv';
import { resolve } from 'path';

// Load test environment BEFORE any module imports
// (PrismaService reads DATABASE_URL at module scope)
config({ path: resolve(__dirname, '..', '.env.test'), override: true });
