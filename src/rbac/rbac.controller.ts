import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { RbacService } from './rbac.service.js';
import { CreateRoleDto, UpdateRoleDto, AssignRoleDto } from './dto/role.dto.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { PermissionsGuard } from './guards/permissions.guard.js';
import { RequirePermissions } from './decorators/require-permissions.decorator.js';
import { PERMISSIONS } from './permissions.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator.js';
import { AuditInterceptor, Audit } from '../audit/audit.interceptor.js';

@Controller('roles')
@UseGuards(AuthGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
export class RbacController {
  constructor(private readonly rbacService: RbacService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ROLE_READ)
  async getAllRoles() {
    return this.rbacService.getAllRoles();
  }

  @Get('permissions')
  @RequirePermissions(PERMISSIONS.ROLE_READ)
  getAvailablePermissions() {
    return this.rbacService.getAvailablePermissions();
  }

  @Get('my-permissions')
  @SkipThrottle() // Called frequently on every page load, already protected by auth
  async getMyPermissions(@CurrentUser() user: CurrentUserData) {
    const permissions = await this.rbacService.getUserPermissions(user.userId);
    return { permissions };
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.ROLE_READ)
  async getRoleById(@Param('id') id: string) {
    return this.rbacService.getRoleById(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ROLE_CREATE)
  @HttpCode(HttpStatus.CREATED)
  @Audit({ action: 'CREATE', entityType: 'Role' })
  async createRole(@Body() dto: CreateRoleDto) {
    return this.rbacService.createRole(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.ROLE_UPDATE)
  @Audit({ action: 'UPDATE', entityType: 'Role' })
  async updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.rbacService.updateRole(id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.ROLE_DELETE)
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'DELETE', entityType: 'Role' })
  async deleteRole(@Param('id') id: string) {
    return this.rbacService.deleteRole(id);
  }

  @Post('assign')
  @RequirePermissions(PERMISSIONS.USER_UPDATE)
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'ASSIGN_ROLE', entityType: 'User' })
  async assignRole(@Body() dto: AssignRoleDto) {
    return this.rbacService.assignRoleToUser(dto.userId, dto.roleId);
  }

  @Post('unassign')
  @RequirePermissions(PERMISSIONS.USER_UPDATE)
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'UNASSIGN_ROLE', entityType: 'User' })
  async unassignRole(@Body() dto: AssignRoleDto) {
    return this.rbacService.removeRoleFromUser(dto.userId, dto.roleId);
  }

  @Get('user/:userId')
  @RequirePermissions(PERMISSIONS.USER_READ)
  async getUserRoles(@Param('userId') userId: string) {
    return this.rbacService.getUserRoles(userId);
  }
}
