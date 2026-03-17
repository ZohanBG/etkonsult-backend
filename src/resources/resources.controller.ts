import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ResourcesService } from './resources.service.js';
import { CreateSectionDto, UpdateSectionDto, CreateLinkItemDto, UpdateItemDto } from './dto/index.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { AuditInterceptor, Audit } from '../audit/audit.interceptor.js';

@Controller('resources')
@UseGuards(AuthGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
export class ResourcesController {
  constructor(private readonly resourcesService: ResourcesService) {}

  // =================== Sections ===================

  @Get()
  @RequirePermissions(PERMISSIONS.RESOURCE_READ)
  async getAllSections() {
    return this.resourcesService.getAllSections();
  }

  @Post('sections')
  @RequirePermissions(PERMISSIONS.RESOURCE_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @Audit({ action: 'CREATE', entityType: 'ResourceSection' })
  async createSection(@Body() dto: CreateSectionDto) {
    return this.resourcesService.createSection(dto);
  }

  @Patch('sections/:id')
  @RequirePermissions(PERMISSIONS.RESOURCE_MANAGE)
  @Audit({ action: 'UPDATE', entityType: 'ResourceSection' })
  async updateSection(@Param('id') id: string, @Body() dto: UpdateSectionDto) {
    return this.resourcesService.updateSection(id, dto);
  }

  @Delete('sections/:id')
  @RequirePermissions(PERMISSIONS.RESOURCE_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'DELETE', entityType: 'ResourceSection' })
  async deleteSection(@Param('id') id: string) {
    await this.resourcesService.deleteSection(id);
  }

  // =================== Items ===================

  @Post('sections/:sectionId/items/link')
  @RequirePermissions(PERMISSIONS.RESOURCE_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @Audit({ action: 'CREATE_LINK', entityType: 'ResourceItem' })
  async addLinkItem(
    @Param('sectionId') sectionId: string,
    @Body() dto: CreateLinkItemDto,
  ) {
    return this.resourcesService.addLinkItem(sectionId, dto);
  }

  @Post('sections/:sectionId/items/file')
  @RequirePermissions(PERMISSIONS.RESOURCE_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @Audit({ action: 'UPLOAD_FILE', entityType: 'ResourceItem' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
    }),
  )
  async addFileItem(
    @Param('sectionId') sectionId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('title') title: string,
    @Body('description') description?: string,
  ) {
    return this.resourcesService.addFileItem(sectionId, file, title, description);
  }

  @Post('sections/:sectionId/items/files')
  @RequirePermissions(PERMISSIONS.RESOURCE_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @Audit({ action: 'UPLOAD_FILES', entityType: 'ResourceItem' })
  @UseInterceptors(
    FilesInterceptor('files', 50, {
      storage: memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 }, // 50MB per file
    }),
  )
  async addFileItems(
    @Param('sectionId') sectionId: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body('description') description?: string,
    @Body('folderName') folderName?: string,
    @Body('relativePaths') relativePaths?: string | string[],
  ) {
    const paths = relativePaths
      ? (Array.isArray(relativePaths) ? relativePaths : [relativePaths])
      : undefined;
    return this.resourcesService.addFileItems(sectionId, files, description, folderName, paths);
  }

  @Post('upload-folder')
  @RequirePermissions(PERMISSIONS.RESOURCE_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @Audit({ action: 'UPLOAD_FOLDER', entityType: 'ResourceSection' })
  @UseInterceptors(
    FilesInterceptor('files', 100, {
      storage: memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 }, // 50MB per file
    }),
  )
  async uploadFolder(
    @UploadedFiles() files: Express.Multer.File[],
    @Body('folderName') folderName: string,
    @Body('description') description?: string,
    @Body('relativePaths') relativePaths?: string | string[],
  ) {
    const paths = relativePaths
      ? (Array.isArray(relativePaths) ? relativePaths : [relativePaths])
      : undefined;
    return this.resourcesService.uploadFolder(folderName, files, description, paths);
  }

  @Patch('items/:id')
  @RequirePermissions(PERMISSIONS.RESOURCE_MANAGE)
  @Audit({ action: 'UPDATE', entityType: 'ResourceItem' })
  async updateItem(@Param('id') id: string, @Body() dto: UpdateItemDto) {
    return this.resourcesService.updateItem(id, dto);
  }

  @Delete('items/:id')
  @RequirePermissions(PERMISSIONS.RESOURCE_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'DELETE', entityType: 'ResourceItem' })
  async deleteItem(@Param('id') id: string) {
    await this.resourcesService.deleteItem(id);
  }
}
