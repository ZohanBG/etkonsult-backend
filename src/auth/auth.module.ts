import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './services/password.service.js';
import { BackoffService } from './services/backoff.service.js';
import { SessionService } from './services/session.service.js';
import { TotpService } from './services/totp.service.js';
import { EmailVerificationService } from './services/email-verification.service.js';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    BackoffService,
    SessionService,
    TotpService,
    EmailVerificationService,
  ],
  exports: [AuthService, PasswordService, SessionService, TotpService, EmailVerificationService],
})
export class AuthModule {}
