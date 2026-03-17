import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { InsuranceController } from './insurance.controller.js';
import { InsuranceService } from './insurance.service.js';
import { InsuranceSyncService } from './insurance-sync.service.js';
import { GoogleSheetsService } from './google-sheets.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { RbacModule } from '../rbac/rbac.module.js';

@Module({
  imports: [PrismaModule, AuthModule, RbacModule, ScheduleModule.forRoot()],
  controllers: [InsuranceController],
  providers: [InsuranceService, InsuranceSyncService, GoogleSheetsService],
  exports: [InsuranceService],
})
export class InsuranceModule {}
