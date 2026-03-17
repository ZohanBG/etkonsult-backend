import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  UseGuards,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { AuthService } from './auth.service.js';
import type { LoginResult, CachedUser } from './auth.service.js';
import { TotpService } from './services/totp.service.js';
import { SessionService } from './services/session.service.js';
import { EmailVerificationService } from './services/email-verification.service.js';
import { LoginDto } from './dto/login.dto.js';
import { TotpVerifyDto, TotpSetupResponseDto } from './dto/totp-setup.dto.js';
import { Verify2FADto } from './dto/verify-2fa.dto.js';
import { SendVerificationDto, VerifyEmailCodeDto } from './dto/email-verification.dto.js';
import type { SessionTokens } from './services/session.service.js';
import { AuthGuard } from './guards/auth.guard.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import type { CurrentUserData } from './decorators/current-user.decorator.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly totpService: TotpService,
    private readonly sessionService: SessionService,
    private readonly emailVerificationService: EmailVerificationService,
  ) {}

  private setAuthCookies(res: Response, tokens: SessionTokens): void {
    const isProduction = process.env.NODE_ENV === 'production';

    res.cookie('auth_token', tokens.token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'strict' : 'lax',
      expires: tokens.expiresAt,
      path: '/',
    });

    res.cookie('refresh_token', tokens.refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'strict' : 'lax',
      expires: tokens.refreshExpiresAt,
      path: '/',
    });
  }

  /** Timing-safe string comparison helper */
  private safeCompare(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: boolean; expiresAt: Date }> {
    const refreshToken = req.cookies?.['refresh_token'];
    const fingerprint = req.headers['x-fingerprint'] as string;

    if (!refreshToken || !fingerprint) {
      throw new BadRequestException('Refresh token and fingerprint are required');
    }

    const ipAddress = req.ip || req.socket.remoteAddress;
    const tokens = await this.sessionService.refreshSession(refreshToken, fingerprint, ipAddress);

    if (!tokens) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    this.setAuthCookies(res, tokens);
    return { success: true, expiresAt: tokens.expiresAt };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async login(@Body() dto: LoginDto): Promise<LoginResult> {
    return this.authService.login(dto);
  }

  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async verify2FA(
    @Body() dto: Verify2FADto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: boolean }> {
    const tokenData = this.authService.validateTempToken(dto.tempToken, dto.fingerprint);
    if (!tokenData) {
      throw new BadRequestException('Invalid or expired temporary token');
    }

    const isValid = await this.totpService.verifyToken(tokenData.userId, dto.totpCode);
    if (!isValid) {
      throw new BadRequestException('Invalid verification code');
    }

    const ipAddress = req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const tokens = await this.sessionService.createSession({
      userId: tokenData.userId,
      fingerprint: dto.fingerprint,
      ipAddress,
      userAgent,
    });

    this.setAuthCookies(res, tokens);
    return { success: true };
  }

  @Post('2fa/setup')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  async setup2FA(@CurrentUser() user: CurrentUserData): Promise<TotpSetupResponseDto> {
    const isEnabled = await this.totpService.isEnabled(user.userId);
    if (isEnabled) {
      throw new BadRequestException('2FA is already enabled. Disable it first to set up again.');
    }

    return this.totpService.generateSecret(user.userId);
  }

  @Post('2fa/verify-setup')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  async verifyAndEnable2FA(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: TotpVerifyDto,
  ): Promise<{ enabled: boolean }> {
    const isValid = await this.totpService.verifyAndEnable(user.userId, dto.token);
    if (!isValid) {
      throw new BadRequestException('Invalid verification code');
    }

    return { enabled: true };
  }

  @Post('2fa/disable')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  async disable2FA(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: TotpVerifyDto,
  ): Promise<{ disabled: boolean }> {
    const isValid = await this.totpService.verifyToken(user.userId, dto.token);
    if (!isValid) {
      throw new BadRequestException('Invalid verification code');
    }

    await this.totpService.disable(user.userId);
    return { disabled: true };
  }

  @Get('2fa/status')
  @UseGuards(AuthGuard)
  async get2FAStatus(@CurrentUser() user: CurrentUserData): Promise<{ enabled: boolean }> {
    const enabled = await this.totpService.isEnabled(user.userId);
    return { enabled };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @SkipThrottle()
  async getCurrentUser(@CurrentUser() user: CurrentUserData): Promise<CachedUser | null> {
    return this.authService.getUserById(user.userId);
  }

  @Patch('me')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  async updateProfile(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: { username?: string; currentPassword?: string; newPassword?: string },
  ) {
    return this.authService.updateProfile(user.userId, dto);
  }

  @Post('logout')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentUser() user: CurrentUserData,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: boolean }> {
    await this.sessionService.revokeSession(user.sessionId);
    res.clearCookie('auth_token', { path: '/' });
    res.clearCookie('refresh_token', { path: '/' });
    return { success: true };
  }

  @Post('logout-all')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  async logoutAll(
    @CurrentUser() user: CurrentUserData,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: boolean }> {
    await this.sessionService.revokeAllUserSessions(user.userId);
    res.clearCookie('auth_token', { path: '/' });
    res.clearCookie('refresh_token', { path: '/' });
    return { success: true };
  }

  // Email Verification — protected by tempToken (no raw userId)

  @Post('email/send-verification')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  async sendVerificationEmail(@Body() dto: SendVerificationDto): Promise<{ sent: boolean }> {
    const tokenData = this.authService.validateTempToken(dto.tempToken, dto.fingerprint);
    if (!tokenData) {
      throw new BadRequestException('Invalid or expired temporary token');
    }

    await this.emailVerificationService.sendVerificationEmail(tokenData.userId, dto.fingerprint);
    return { sent: true };
  }

  @Post('email/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async verifyEmailCode(
    @Body() dto: VerifyEmailCodeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: boolean }> {
    const tokenData = this.authService.validateTempToken(dto.tempToken, dto.fingerprint);
    if (!tokenData) {
      throw new BadRequestException('Invalid or expired temporary token');
    }

    const result = await this.emailVerificationService.verifyCode(tokenData.userId, dto.code);
    if (!result) {
      throw new BadRequestException('Невалиден или изтекъл код за потвърждение');
    }

    // Timing-safe fingerprint comparison
    if (!this.safeCompare(result.fingerprint, dto.fingerprint)) {
      throw new BadRequestException('Моля, потвърдете от същия браузър');
    }

    const ipAddress = req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const tokens = await this.sessionService.createSession({
      userId: tokenData.userId,
      fingerprint: dto.fingerprint,
      ipAddress,
      userAgent,
    });

    this.setAuthCookies(res, tokens);
    await this.emailVerificationService.cleanupUsedToken(tokenData.userId);
    return { success: true };
  }

  // Mandatory 2FA setup — protected by tempToken

  @Post('2fa/setup-mandatory')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  async setupMandatory2FA(
    @Body() dto: { tempToken: string; fingerprint: string },
  ): Promise<TotpSetupResponseDto> {
    if (!dto.tempToken || !dto.fingerprint) {
      throw new BadRequestException('tempToken and fingerprint are required');
    }

    const tokenData = this.authService.validateTempToken(dto.tempToken, dto.fingerprint);
    if (!tokenData) {
      throw new BadRequestException('Invalid or expired temporary token');
    }

    const alreadyEnabled = await this.totpService.isEnabled(tokenData.userId);
    if (alreadyEnabled) {
      throw new BadRequestException('2FA is already set up for this account');
    }

    return this.totpService.generateSecret(tokenData.userId);
  }

  @Post('2fa/verify-setup-and-login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async verifySetupAndLogin(
    @Body() dto: { tempToken: string; totpCode: string; fingerprint: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: boolean }> {
    if (!dto.tempToken || !dto.totpCode || !dto.fingerprint) {
      throw new BadRequestException('tempToken, totpCode, and fingerprint are required');
    }

    const tokenData = this.authService.validateTempToken(dto.tempToken, dto.fingerprint);
    if (!tokenData) {
      throw new BadRequestException('Invalid or expired temporary token');
    }

    const isValid = await this.totpService.verifyAndEnable(tokenData.userId, dto.totpCode);
    if (!isValid) {
      throw new BadRequestException('Invalid verification code');
    }

    const ipAddress = req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const tokens = await this.sessionService.createSession({
      userId: tokenData.userId,
      fingerprint: dto.fingerprint,
      ipAddress,
      userAgent,
    });

    this.setAuthCookies(res, tokens);
    return { success: true };
  }
}
