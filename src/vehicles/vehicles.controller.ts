import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { VehiclesService } from './vehicles.service.js';
import { CreateVehicleDto, UpdateVehicleDto, VehicleFilterDto } from './dto/index.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator.js';
import { AuditInterceptor, Audit } from '../audit/audit.interceptor.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('vehicles')
@UseGuards(AuthGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
export class VehiclesController {
  constructor(
    private readonly vehiclesService: VehiclesService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.VEHICLE_READ)
  async findAll(@Query() filters: VehicleFilterDto) {
    return this.vehiclesService.findAll(filters);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.VEHICLE_READ)
  async findOne(@Param('id') id: string) {
    return this.vehiclesService.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.VEHICLE_CREATE)
  @HttpCode(HttpStatus.CREATED)
  @Audit({ action: 'CREATE', entityType: 'Vehicle' })
  async create(
    @Body() dto: CreateVehicleDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.vehiclesService.create(dto, user.userId);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.VEHICLE_UPDATE)
  @Audit({ action: 'UPDATE', entityType: 'Vehicle' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateVehicleDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    // Check if user has full edit rights (VEHICLE_CREATE = staff/admin)
    const userWithRoles = await this.prisma.user.findUnique({
      where: { id: user.userId },
      include: { roles: { include: { role: true } } },
    });
    const permissions = new Set<string>(
      userWithRoles?.roles.flatMap((ur) => ur.role.permissions as string[]) ?? [],
    );
    const canEditAll = permissions.has(PERMISSIONS.VEHICLE_CREATE);

    // Agents may only update notes; strip all other vehicle fields
    const safeDto: UpdateVehicleDto = canEditAll
      ? dto
      : { notes: dto.notes };

    return this.vehiclesService.update(id, safeDto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.VEHICLE_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'DELETE', entityType: 'Vehicle' })
  async delete(@Param('id') id: string) {
    await this.vehiclesService.delete(id);
  }

  @Post('check-duplicates')
  @RequirePermissions(PERMISSIONS.VEHICLE_CREATE)
  @HttpCode(HttpStatus.OK)
  async checkDuplicates(
    @Body() dto: { vin?: string; registrationNumber?: string; talonNumber?: string },
  ) {
    return this.vehiclesService.checkDuplicates(dto);
  }
}
