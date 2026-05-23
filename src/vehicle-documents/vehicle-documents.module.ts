import { Module } from '@nestjs/common';
import { VehicleDocumentsController } from './vehicle-documents.controller.js';
import { VehicleDocumentsService } from './vehicle-documents.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [VehicleDocumentsController],
  providers: [VehicleDocumentsService],
  exports: [VehicleDocumentsService],
})
export class VehicleDocumentsModule {}
