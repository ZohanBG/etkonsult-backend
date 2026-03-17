import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_GUARD, APP_FILTER } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { join } from 'path';
import { UploadsAuthMiddleware } from './shared/middleware/uploads-auth.middleware.js';
import { CsrfMiddleware } from './shared/middleware/csrf.middleware.js';
import { AppController } from './app.controller.js';
import { HttpExceptionFilter } from './shared/filters/http-exception.filter.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ConfigModule } from './config/config.module.js';
import { CacheModule } from './cache/cache.module.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './auth/auth.module.js';
import { EmailModule } from './email/email.module.js';
import { RbacModule } from './rbac/rbac.module.js';
import { UsersModule } from './users/users.module.js';
import { OwnersModule } from './owners/owners.module.js';
import { VehiclesModule } from './vehicles/vehicles.module.js';
import { UploadsModule } from './uploads/uploads.module.js';
import { AuditModule } from './audit/audit.module.js';
import { RequestsModule } from './requests/requests.module.js';
import { InsuranceModule } from './insurance/insurance.module.js';
import { ResourcesModule } from './resources/resources.module.js';
import { AdminNotificationsModule } from './admin-notifications/admin-notifications.module.js';
import { PushNotificationsModule } from './push-notifications/push-notifications.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { EventsModule } from './events/events.module.js';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    CacheModule,
    ScheduleModule.forRoot(),
    // Global rate limiting - generous default, strict limits applied per-endpoint
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000, // 1 minute
        limit: 300, // 300 requests per minute for normal usage
      },
    ]),
    HealthModule,
    AuthModule,
    EmailModule,
    RbacModule,
    UsersModule,
    OwnersModule,
    VehiclesModule,
    UploadsModule,
    AuditModule,
    RequestsModule,
    InsuranceModule,
    ResourcesModule,
    AdminNotificationsModule,
    PushNotificationsModule,
    NotificationsModule,
    EventsModule,
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads'),
      serveRoot: '/uploads',
    }),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(UploadsAuthMiddleware).forRoutes('/uploads');
    consumer.apply(CsrfMiddleware).forRoutes('*');
  }
}
