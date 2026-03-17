import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { EmailService } from '../../src/email/email.service.js';
import { GoogleSheetsService } from '../../src/insurance/google-sheets.service.js';
import { InsuranceSyncService } from '../../src/insurance/insurance-sync.service.js';
import { PushNotificationsService } from '../../src/push-notifications/push-notifications.service.js';
import { ThrottlerStorage } from '@nestjs/throttler';

/**
 * Bootstraps a full NestJS app for integration testing.
 * External services (email, Google Sheets, push, insurance sync) are mocked.
 * ThrottlerGuard is disabled to avoid rate limiting in tests.
 */
export async function createTestApp(): Promise<{
  app: INestApplication;
  module: TestingModule;
  prisma: PrismaService;
}> {
  const module = await Test.createTestingModule({
    imports: [AppModule],
  })
    // Mock EmailService — no real SMTP calls
    .overrideProvider(EmailService)
    .useValue({
      sendEmail: jest.fn().mockResolvedValue(undefined),
      sendLoginVerificationEmail: jest.fn().mockResolvedValue(undefined),
    })
    // Mock GoogleSheetsService — no real Google API calls
    .overrideProvider(GoogleSheetsService)
    .useValue({
      validateSpreadsheet: jest.fn().mockResolvedValue({ title: 'Test Sheet', sheetNames: ['Sheet1'] }),
      getAvailableSheets: jest.fn().mockResolvedValue(['Sheet1']),
      getSheetData: jest.fn().mockResolvedValue([]),
      getAllSheetData: jest.fn().mockResolvedValue(new Map()),
    })
    // Mock InsuranceSyncService — no startup sync or interval
    .overrideProvider(InsuranceSyncService)
    .useValue({
      onModuleInit: jest.fn(),
      syncActiveSheets: jest.fn().mockResolvedValue(undefined),
      initialSync: jest.fn().mockResolvedValue(undefined),
      syncAll: jest.fn().mockResolvedValue(undefined),
    })
    // Mock PushNotificationsService — no real web-push calls
    .overrideProvider(PushNotificationsService)
    .useValue({
      getVapidPublicKey: jest.fn().mockReturnValue('test-vapid-public-key'),
      saveSubscription: jest.fn().mockResolvedValue(undefined),
      deleteSubscription: jest.fn().mockResolvedValue(undefined),
      sendToUsers: jest.fn().mockResolvedValue(undefined),
      sendToAll: jest.fn().mockResolvedValue(undefined),
      sendRequestEvent: jest.fn().mockResolvedValue(undefined),
    })
    // Disable rate limiting: replace ThrottlerStorage with a no-op so the guard never blocks
    .overrideProvider(ThrottlerStorage)
    .useValue({
      increment: jest.fn().mockResolvedValue({ totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
      get: jest.fn().mockResolvedValue(undefined),
    })
    .compile();

  const app = module.createNestApplication();

  // Match main.ts configuration exactly
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.setGlobalPrefix('api');

  await app.init();

  const prisma = module.get(PrismaService);

  return { app, module, prisma };
}
