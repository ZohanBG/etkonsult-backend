import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  NotFoundException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { IsString, IsOptional, MaxLength } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuditService } from './audit.service.js';
import type { AuditLogFilters } from './audit.service.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator.js';
import { PERMISSIONS } from '../rbac/permissions.js';

class ClientErrorDto {
  @IsString()
  @MaxLength(200)
  message!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  stack?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  url?: string;
}

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  // Public endpoint — no auth required, strict rate limit (20/min per IP)
  @Post('client-error')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async logClientError(@Body() dto: ClientErrorDto, @Req() req: Request) {
    const ipAddress =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.ip ||
      req.socket?.remoteAddress;

    await this.auditService.log({
      action: 'CLIENT_ERROR',
      entityType: 'Error',
      newValue: {
        message: dto.message,
        source: dto.source,
        stack: dto.stack,
        url: dto.url,
      },
      ipAddress,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get()
  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.AUDIT_READ)
  async findAll(@Query() filters: AuditLogFilters) {
    return this.auditService.findAll(filters);
  }

  @Get('entity-types')
  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.AUDIT_READ)
  async getEntityTypes() {
    return this.auditService.getEntityTypes();
  }

  @Get('actions')
  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.AUDIT_READ)
  async getActions() {
    return this.auditService.getActions();
  }

  @Get(':id')
  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.AUDIT_READ)
  async findOne(@Param('id') id: string) {
    const log = await this.auditService.findOne(id);
    if (!log) {
      throw new NotFoundException('Записът не е намерен');
    }
    return log;
  }
}
