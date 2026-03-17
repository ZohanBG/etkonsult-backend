import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { UsersService } from './users.service.js';
import { CreateUserDto, UpdateUserDto, UserQueryDto } from './dto/user.dto.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { AuditInterceptor, Audit } from '../audit/audit.interceptor.js';

@Controller('users')
@UseGuards(AuthGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.USER_READ)
  async findAll(@Query() query: UserQueryDto) {
    return this.usersService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.USER_READ)
  async findById(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.USER_CREATE)
  @HttpCode(HttpStatus.CREATED)
  @Audit({ action: 'CREATE', entityType: 'User' })
  async create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.USER_UPDATE)
  @Audit({ action: 'UPDATE', entityType: 'User' })
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.USER_DELETE)
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'DELETE', entityType: 'User' })
  async delete(@Param('id') id: string) {
    return this.usersService.delete(id);
  }

  @Post(':id/reset-2fa')
  @RequirePermissions(PERMISSIONS.USER_RESET_2FA)
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'RESET_2FA', entityType: 'User' })
  async resetTwoFactor(@Param('id') id: string) {
    return this.usersService.resetTwoFactor(id);
  }

  @Post(':id/unlock')
  @RequirePermissions(PERMISSIONS.USER_UPDATE)
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'UNLOCK', entityType: 'User' })
  async unlock(@Param('id') id: string) {
    return this.usersService.unlock(id);
  }
}
