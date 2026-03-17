import { Module, Global } from '@nestjs/common';
import { CacheModule as NestCacheModule } from '@nestjs/cache-manager';
import { CacheService } from './cache.service.js';

@Global()
@Module({
  imports: [
    // In-memory cache for simplicity (no Redis dependency)
    NestCacheModule.register({
      ttl: 300000, // 5 minutes default TTL in milliseconds
      max: 1000, // Maximum number of items in cache
    }),
  ],
  providers: [CacheService],
  exports: [NestCacheModule, CacheService],
})
export class CacheModule {}
