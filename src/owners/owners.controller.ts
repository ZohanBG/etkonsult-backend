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
import { OwnersService } from './owners.service.js';
import { CreateOwnerDto, UpdateOwnerDto } from './dto/index.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { AuditInterceptor, Audit } from '../audit/audit.interceptor.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('owners')
@UseGuards(AuthGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
export class OwnersController {
  constructor(
    private readonly ownersService: OwnersService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.OWNER_READ)
  async findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.ownersService.findAll({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      search,
    });
  }

  @Get('search')
  @RequirePermissions(PERMISSIONS.OWNER_READ)
  async search(@Query('q') query: string, @Query('limit') limit?: string) {
    return this.ownersService.search(query, limit ? parseInt(limit, 10) : undefined);
  }

  @Get('lookup')
  @RequirePermissions(PERMISSIONS.OWNER_READ)
  async lookup(@Query('identifier') identifier?: string) {
    return this.ownersService.lookupByIdentifier(identifier || '');
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.OWNER_READ)
  async findOne(@Param('id') id: string) {
    return this.ownersService.findOne(id);
  }

  @Get(':id/vehicles')
  @RequirePermissions(PERMISSIONS.OWNER_READ)
  async getOwnerVehicles(@Param('id') id: string) {
    const owner = await this.ownersService.findOne(id);
    return owner.vehicles;
  }

  @Post()
  @RequirePermissions(PERMISSIONS.OWNER_CREATE)
  @HttpCode(HttpStatus.CREATED)
  @Audit({ action: 'CREATE', entityType: 'Owner' })
  async create(@Body() dto: CreateOwnerDto) {
    return this.ownersService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.OWNER_UPDATE)
  @Audit({ action: 'UPDATE', entityType: 'Owner' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateOwnerDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    // Check if user has full edit rights (OWNER_CREATE = staff/admin)
    const userWithRoles = await this.prisma.user.findUnique({
      where: { id: user.userId },
      include: { roles: { include: { role: true } } },
    });
    const permissions = new Set<string>(
      userWithRoles?.roles.flatMap((ur) => ur.role.permissions as string[]) ?? [],
    );
    const canEditAll = permissions.has(PERMISSIONS.OWNER_CREATE);

    // Agents may only update phone and email; strip all other owner fields
    const safeDto: UpdateOwnerDto = canEditAll
      ? dto
      : { phone: dto.phone, email: dto.email };

    return this.ownersService.update(id, safeDto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.OWNER_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'DELETE', entityType: 'Owner' })
  async delete(@Param('id') id: string) {
    await this.ownersService.delete(id);
  }
}
