import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
  UseInterceptors,
  Query,
  ForbiddenException,
} from '@nestjs/common';
import { InsuranceService } from './insurance.service.js';
import { RbacService } from '../rbac/rbac.service.js';
import { CreateSpreadsheetDto, ValidateSpreadsheetDto, ExpiryFilterDto, CreateAgentMappingDto, BulkAgentMappingDto } from './dto/index.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { AuditInterceptor, Audit } from '../audit/audit.interceptor.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator.js';

@Controller('insurance')
@UseGuards(AuthGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
export class InsuranceController {
  constructor(
    private readonly insuranceService: InsuranceService,
    private readonly rbac: RbacService,
  ) {}

  /**
   * Throws 403 if the caller is an agent-only user (has INSURANCE_AGENT_VIEW but not INSURANCE_MANAGE).
   * Prevents agents from accessing global endpoints even if they somehow have insurance:read.
   */
  private async assertNotAgentOnly(userId: string): Promise<void> {
    const canManage = await this.rbac.userHasPermission(userId, PERMISSIONS.INSURANCE_MANAGE);
    if (canManage) return;
    const isAgentView = await this.rbac.userHasPermission(userId, PERMISSIONS.INSURANCE_AGENT_VIEW);
    if (isAgentView) {
      throw new ForbiddenException('Агентите трябва да използват своите персонализирани крайни точки');
    }
  }

  // =================== Agent Mapping ===================

  @Get('agent-names')
  @RequirePermissions(PERMISSIONS.INSURANCE_MANAGE)
  async getUniqueAgentNames() {
    return this.insuranceService.getUniqueAgentNames();
  }

  @Get('agent-mappings')
  @RequirePermissions(PERMISSIONS.INSURANCE_MANAGE)
  async getAgentMappings() {
    return this.insuranceService.getAgentMappings();
  }

  @Get('agent-mappings/users')
  @RequirePermissions(PERMISSIONS.INSURANCE_READ)
  async getUsersForMapping() {
    return this.insuranceService.getUsersForMapping();
  }

  @Post('agent-mappings')
  @RequirePermissions(PERMISSIONS.INSURANCE_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @Audit({ action: 'CREATE', entityType: 'AgentMapping' })
  async createAgentMapping(@Body() dto: CreateAgentMappingDto) {
    return this.insuranceService.createAgentMapping(dto);
  }

  @Post('agent-mappings/bulk')
  @RequirePermissions(PERMISSIONS.INSURANCE_MANAGE)
  @Audit({ action: 'BULK_ASSIGN', entityType: 'AgentMapping' })
  async bulkAssignAgentNames(@Body() dto: BulkAgentMappingDto) {
    return this.insuranceService.bulkAssignAgentNames(dto);
  }

  @Delete('agent-mappings/:id')
  @RequirePermissions(PERMISSIONS.INSURANCE_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'DELETE', entityType: 'AgentMapping' })
  async removeAgentMapping(@Param('id') id: string) {
    await this.insuranceService.removeAgentMapping(id);
  }

  // =================== Per-Agent Expiry ===================

  @Get('by-agent/stats')
  @RequirePermissions(PERMISSIONS.INSURANCE_AGENT_VIEW)
  async getStatsByAgent(@CurrentUser() user: CurrentUserData) {
    return this.insuranceService.getExpiryStatsByAgent(user.userId);
  }

  @Get('by-agent/expiries')
  @RequirePermissions(PERMISSIONS.INSURANCE_AGENT_VIEW)
  async getExpiriesByAgent(@CurrentUser() user: CurrentUserData, @Query() filters: ExpiryFilterDto) {
    return this.insuranceService.getExpiriesByAgent(user.userId, filters);
  }

  @Get('by-agent/:userId/stats')
  @RequirePermissions(PERMISSIONS.INSURANCE_READ)
  async getStatsByAgentAdmin(@Param('userId') userId: string) {
    return this.insuranceService.getExpiryStatsByAgent(userId);
  }

  @Get('by-agent/:userId/expiries')
  @RequirePermissions(PERMISSIONS.INSURANCE_READ)
  async getExpiriesByAgentAdmin(@Param('userId') userId: string, @Query() filters: ExpiryFilterDto) {
    return this.insuranceService.getExpiriesByAgent(userId, filters);
  }

  // =================== Expiry Queries (Part 2) ===================

  @Get('stats')
  @RequirePermissions(PERMISSIONS.INSURANCE_READ)
  async getStats(@CurrentUser() user: CurrentUserData) {
    await this.assertNotAgentOnly(user.userId);
    return this.insuranceService.getExpiryStats();
  }

  @Get('expiries')
  @RequirePermissions(PERMISSIONS.INSURANCE_READ)
  async getExpiries(@CurrentUser() user: CurrentUserData, @Query() filters: ExpiryFilterDto) {
    await this.assertNotAgentOnly(user.userId);
    return this.insuranceService.getExpiries(filters);
  }

  @Get('vehicle/:regNumber/history')
  @RequirePermissions(PERMISSIONS.INSURANCE_READ)
  async getVehicleHistory(@CurrentUser() user: CurrentUserData, @Param('regNumber') regNumber: string) {
    await this.assertNotAgentOnly(user.userId);
    return this.insuranceService.getVehicleHistory(decodeURIComponent(regNumber));
  }

  // =================== Spreadsheet Management (Part 1) ===================

  @Get('spreadsheets')
  @RequirePermissions(PERMISSIONS.INSURANCE_MANAGE)
  async getSpreadsheets() {
    return this.insuranceService.getSpreadsheets();
  }

  @Post('spreadsheets')
  @RequirePermissions(PERMISSIONS.INSURANCE_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @Audit({ action: 'CREATE', entityType: 'InsuranceSpreadsheet' })
  async addSpreadsheet(@Body() dto: CreateSpreadsheetDto) {
    return this.insuranceService.addSpreadsheet(dto);
  }

  @Delete('spreadsheets/:id')
  @RequirePermissions(PERMISSIONS.INSURANCE_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'DELETE', entityType: 'InsuranceSpreadsheet' })
  async removeSpreadsheet(@Param('id') id: string) {
    await this.insuranceService.removeSpreadsheet(id);
  }

  @Post('spreadsheets/validate')
  @RequirePermissions(PERMISSIONS.INSURANCE_MANAGE)
  async validateSpreadsheet(@Body() dto: ValidateSpreadsheetDto) {
    return this.insuranceService.validateSpreadsheet(dto.spreadsheetId);
  }

  @Post('sync')
  @RequirePermissions(PERMISSIONS.INSURANCE_MANAGE)
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'FORCE_SYNC', entityType: 'InsuranceSpreadsheet' })
  async forceSync() {
    await this.insuranceService.forceSync();
    return { message: 'Синхронизацията завърши успешно' };
  }

  @Post('spreadsheets/:id/archive')
  @RequirePermissions(PERMISSIONS.INSURANCE_MANAGE)
  @Audit({ action: 'ARCHIVE', entityType: 'InsuranceSpreadsheet' })
  async archiveSpreadsheet(@Param('id') id: string) {
    const result = await this.insuranceService.archiveSpreadsheet(id);
    return { message: 'Таблицата е архивирана', rowCount: result.rowCount };
  }

  @Post('spreadsheets/:id/refresh')
  @RequirePermissions(PERMISSIONS.INSURANCE_MANAGE)
  @Audit({ action: 'REFRESH', entityType: 'InsuranceSpreadsheet' })
  async refreshArchive(@Param('id') id: string) {
    const result = await this.insuranceService.refreshArchive(id);
    return { message: 'Таблицата е обновена', rowCount: result.rowCount };
  }
}
