import {
  Controller,
  Post,
  Patch,
  Delete,
  Get,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { UploadsService } from './uploads.service.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { PermissionsGuard } from '../rbac/guards/permissions.guard.js';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { AuditInterceptor, Audit } from '../audit/audit.interceptor.js';

@Controller('uploads')
@UseGuards(AuthGuard, PermissionsGuard)
@UseInterceptors(AuditInterceptor)
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post('vehicles/:vehicleId/images')
  @RequirePermissions(PERMISSIONS.VEHICLE_UPDATE)
  @Audit({ action: 'UPLOAD_IMAGES', entityType: 'Vehicle' })
  @UseInterceptors(
    FilesInterceptor('images', 10, {
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
      },
    }),
  )
  async uploadVehicleImages(
    @Param('vehicleId') vehicleId: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files uploaded');
    }

    // Enforce 10 image limit per vehicle
    const existingCount = await this.uploadsService.getVehicleImageCount(vehicleId);
    if (existingCount + files.length > 10) {
      throw new BadRequestException(
        `Максимум 10 снимки на МПС. Текущи: ${existingCount}, нови: ${files.length}`,
      );
    }

    const images = await this.uploadsService.uploadVehicleImagesWithTransaction(files, vehicleId);
    return {
      uploaded: images.length,
      images,
    };
  }

  @Get('vehicles/:vehicleId/images')
  @RequirePermissions(PERMISSIONS.VEHICLE_READ)
  async getVehicleImages(@Param('vehicleId') vehicleId: string) {
    return this.uploadsService.getVehicleImages(vehicleId);
  }

  @Delete('images/:imageId')
  @RequirePermissions(PERMISSIONS.VEHICLE_UPDATE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'DELETE_IMAGE', entityType: 'Vehicle' })
  async deleteImage(@Param('imageId') imageId: string) {
    await this.uploadsService.deleteVehicleImage(imageId);
  }

  @Patch('images/:imageId/rotation')
  async setImageRotation(
    @Param('imageId') imageId: string,
    @Body() body: { rotation: number },
  ) {
    return this.uploadsService.setVehicleImageRotation(imageId, body.rotation);
  }
}
