import { Module, OnModuleInit, forwardRef } from '@nestjs/common';
import { RbacController } from './rbac.controller.js';
import { RbacService } from './rbac.service.js';
import { PermissionsGuard } from './guards/permissions.guard.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [RbacController],
  providers: [RbacService, PermissionsGuard],
  exports: [RbacService, PermissionsGuard],
})
export class RbacModule implements OnModuleInit {
  constructor(private readonly rbacService: RbacService) {}

  async onModuleInit() {
    // Seed default roles on startup
    await this.rbacService.seedDefaultRoles();
  }
}
