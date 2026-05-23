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
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ClientDocumentsService } from './client-documents.service.js';
import {
  CreateClientDto,
  CreateDirectoryDto,
  UpdateDirectoryDto,
} from './dto/index.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { Audit, AuditInterceptor } from '../audit/audit.interceptor.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator.js';

@Controller('client-documents')
@UseGuards(AuthGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
export class ClientDocumentsController {
  constructor(private readonly service: ClientDocumentsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CLIENT_DOCUMENTS_READ)
  list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('withDocuments') withDocuments?: string,
    @Query('name') nameFilter?: string,
    @Query('identifier') identifierFilter?: string,
    @Query('phone') phoneFilter?: string,
    @Query('email') emailFilter?: string,
    @Query('address') addressFilter?: string,
  ) {
    const docFlag: 'all' | 'with' | 'without' =
      withDocuments === 'with' || withDocuments === 'without' ? withDocuments : 'all';
    return this.service.listClients({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      search,
      withDocuments: docFlag,
      nameFilter,
      identifierFilter,
      phoneFilter,
      emailFilter,
      addressFilter,
    });
  }

  @Get(':ownerId')
  @RequirePermissions(PERMISSIONS.CLIENT_DOCUMENTS_READ)
  getOne(@Param('ownerId') ownerId: string) {
    return this.service.getClient(ownerId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CLIENT_DOCUMENTS_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @Audit({ action: 'CREATE', entityType: 'ClientDocumentsClient' })
  create(@Body() dto: CreateClientDto) {
    return this.service.createClient(dto);
  }

  @Post(':ownerId/directories')
  @RequirePermissions(PERMISSIONS.CLIENT_DOCUMENTS_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @Audit({ action: 'CREATE', entityType: 'ClientDirectory' })
  createDirectory(
    @Param('ownerId') ownerId: string,
    @Body() dto: CreateDirectoryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.service.createDirectory(ownerId, dto, user.userId);
  }

  @Patch('directories/:directoryId')
  @RequirePermissions(PERMISSIONS.CLIENT_DOCUMENTS_MANAGE)
  @Audit({ action: 'UPDATE', entityType: 'ClientDirectory' })
  renameDirectory(
    @Param('directoryId') directoryId: string,
    @Body() dto: UpdateDirectoryDto,
  ) {
    return this.service.renameDirectory(directoryId, dto);
  }

  @Delete('directories/:directoryId')
  @RequirePermissions(PERMISSIONS.CLIENT_DOCUMENTS_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'DELETE', entityType: 'ClientDirectory' })
  async deleteDirectory(@Param('directoryId') directoryId: string) {
    await this.service.deleteDirectory(directoryId);
  }

  @Post('directories/:directoryId/files')
  @RequirePermissions(PERMISSIONS.CLIENT_DOCUMENTS_MANAGE)
  @UseInterceptors(FilesInterceptor('files', 20))
  @HttpCode(HttpStatus.CREATED)
  @Audit({ action: 'UPLOAD', entityType: 'ClientDocument' })
  uploadDocuments(
    @Param('directoryId') directoryId: string,
    @UploadedFiles() files: Express.Multer.File[],
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.service.uploadDocuments(directoryId, files, user.userId);
  }

  @Delete('files/:documentId')
  @RequirePermissions(PERMISSIONS.CLIENT_DOCUMENTS_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'DELETE', entityType: 'ClientDocument' })
  async deleteDocument(@Param('documentId') documentId: string) {
    await this.service.deleteDocument(documentId);
  }

  @Patch('files/:documentId/rotation')
  setDocumentRotation(
    @Param('documentId') documentId: string,
    @Body() body: { rotation: number },
  ) {
    return this.service.setDocumentRotation(documentId, body.rotation);
  }
}
