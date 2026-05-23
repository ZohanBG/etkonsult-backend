import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { VehicleDocumentsService, DocKind } from './vehicle-documents.service.js';
import { UpsertVehicleDocumentDto } from './dto/index.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { Audit, AuditInterceptor } from '../audit/audit.interceptor.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator.js';

function parseKind(kind: string): DocKind {
  const upper = kind.toUpperCase();
  if (upper === 'GTP' || upper === 'VIGNETTE') return upper;
  throw new BadRequestException('Невалиден тип документ');
}

@Controller('vehicle-documents')
@UseGuards(AuthGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
export class VehicleDocumentsController {
  constructor(private readonly service: VehicleDocumentsService) {}

  @Get(':kind')
  @RequirePermissions(PERMISSIONS.INSURANCE_READ)
  list(
    @Param('kind') kind: string,
    @Query('registrationNumber') registrationNumber?: string,
  ) {
    if (!registrationNumber) throw new BadRequestException('registrationNumber е задължителен');
    return this.service.listByRegistrationNumber(parseKind(kind), registrationNumber);
  }

  @Post(':kind')
  @RequirePermissions(PERMISSIONS.VEHICLE_DOCUMENTS_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @Audit({ action: 'CREATE', entityType: 'VehicleDocument' })
  create(
    @Param('kind') kind: string,
    @Body() dto: UpsertVehicleDocumentDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.service.create(parseKind(kind), dto, user.userId);
  }

  @Patch(':kind/:id')
  @RequirePermissions(PERMISSIONS.VEHICLE_DOCUMENTS_MANAGE)
  @Audit({ action: 'UPDATE', entityType: 'VehicleDocument' })
  update(
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body() dto: UpsertVehicleDocumentDto,
  ) {
    return this.service.update(parseKind(kind), id, dto);
  }

  @Delete(':kind/:id')
  @RequirePermissions(PERMISSIONS.VEHICLE_DOCUMENTS_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'DELETE', entityType: 'VehicleDocument' })
  async delete(@Param('kind') kind: string, @Param('id') id: string) {
    await this.service.delete(parseKind(kind), id);
  }
}
