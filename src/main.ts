import 'dotenv/config';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module.js';

async function bootstrap() {
  // Enable HTTPS if cert files exist
  const certPath = resolve(process.cwd(), 'localhost+2.pem');
  const keyPath = resolve(process.cwd(), 'localhost+2-key.pem');
  let httpsOptions: { key: Buffer; cert: Buffer } | undefined;
  try {
    httpsOptions = {
      key: readFileSync(keyPath),
      cert: readFileSync(certPath),
    };
  } catch (err) {
    // No certs — run plain HTTP
    Logger.warn(`HTTPS certs not found (cwd: ${process.cwd()}), running HTTP. Error: ${(err as Error).message}`, 'Bootstrap');
  }

  const app = await NestFactory.create(AppModule, {
    ...(httpsOptions ? { httpsOptions } : {}),
  });
  const configService = app.get(ConfigService);

  // Trust proxy headers only from loopback (nginx/reverse proxy on same host)
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set('trust proxy', 'loopback');

  // Security headers with Helmet
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false, // Disable for image uploads
      crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow cross-origin for uploads
    }),
  );

  // Cookie parser for auth cookies
  app.use(cookieParser());

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // CORS
  app.enableCors({
    origin: configService.get<string>('CORS_ORIGIN'),
    credentials: true,
    exposedHeaders: ['set-cookie', 'x-csrf-token'],
  });

  // Global prefix
  app.setGlobalPrefix('api');

  const port = configService.get<number>('PORT') || 3001;
  await app.listen(port, '0.0.0.0');
  const protocol = httpsOptions ? 'https' : 'http';
  Logger.log(`Application running on: ${protocol}://localhost:${port}/api`, 'Bootstrap');
}
bootstrap();
