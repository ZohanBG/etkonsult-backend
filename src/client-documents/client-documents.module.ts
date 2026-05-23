import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ClientDocumentsController } from './client-documents.controller.js';
import { ClientDocumentsService } from './client-documents.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    MulterModule.register({ storage: memoryStorage() }),
  ],
  controllers: [ClientDocumentsController],
  providers: [ClientDocumentsService],
})
export class ClientDocumentsModule {}
