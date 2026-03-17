import { plainToInstance } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, validateSync } from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment = Environment.Development;

  @IsNumber()
  PORT: number = 3001;

  // ── Database ──────────────────────────────────────────────────────────────
  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  // ── Auth ──────────────────────────────────────────────────────────────────
  @IsString()
  @IsNotEmpty()
  JWT_SECRET!: string;

  @IsString()
  JWT_EXPIRES_IN: string = '15m';

  @IsString()
  JWT_REFRESH_EXPIRES_IN: string = '7d';

  // ── CORS ──────────────────────────────────────────────────────────────────
  @IsString()
  CORS_ORIGIN: string = 'http://localhost:3000';

  @IsString()
  FRONTEND_URL: string = 'http://localhost:3000';

  // ── SMTP / Email ──────────────────────────────────────────────────────────
  @IsString()
  @IsNotEmpty()
  SMTP_HOST!: string;

  @IsNumber()
  SMTP_PORT: number = 587;

  @IsString()
  @IsNotEmpty()
  SMTP_USER!: string;

  @IsString()
  @IsNotEmpty()
  SMTP_PASS!: string;

  @IsString()
  SMTP_FROM: string = 'noreply@mps-system.bg';

  // ── Google Sheets ─────────────────────────────────────────────────────────
  @IsString()
  @IsNotEmpty()
  GOOGLE_SHEETS_CLIENT_EMAIL!: string;

  @IsString()
  @IsNotEmpty()
  GOOGLE_SHEETS_PRIVATE_KEY!: string;

  // ── App meta ──────────────────────────────────────────────────────────────
  @IsString()
  APP_NAME: string = 'МПС Система';

  // ── VAPID (Web Push) ──────────────────────────────────────────────────────
  @IsString()
  @IsNotEmpty()
  VAPID_PUBLIC_KEY!: string;

  @IsString()
  @IsNotEmpty()
  VAPID_PRIVATE_KEY!: string;

  @IsString()
  @IsNotEmpty()
  VAPID_SUBJECT!: string;

  // ── Security secrets ─────────────────────────────────────────────────────────
  // Generate: node -e "require('crypto').randomBytes(32).toString('hex')"
  @IsString()
  @IsNotEmpty()
  PASSWORD_PEPPER!: string;

  // 32-byte hex key for AES-256-GCM TOTP encryption
  // Generate: node -e "require('crypto').randomBytes(32).toString('hex')"
  @IsString()
  @IsNotEmpty()
  TOTP_ENCRYPTION_KEY!: string;

  // ── Admin seed credentials (optional — only used by seed script) ──────────
  @IsOptional()
  @IsString()
  ADMIN_EMAIL?: string;

  @IsOptional()
  @IsString()
  ADMIN_PASSWORD?: string;

  @IsOptional()
  @IsString()
  ADMIN_USERNAME?: string;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }

  return validatedConfig;
}
