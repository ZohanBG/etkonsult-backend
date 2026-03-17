import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';

// Cache key prefixes
export const CACHE_KEYS = {
  USER: 'user:',
  USER_PERMISSIONS: 'user:permissions:',
  SESSION: 'session:',
  ROLE: 'role:',
  ALL_ROLES: 'roles:all',
} as const;

// Cache TTL in milliseconds
export const CACHE_TTL = {
  USER: 300000, // 5 minutes
  PERMISSIONS: 300000, // 5 minutes
  SESSION: 60000, // 1 minute (sessions change more frequently)
  ROLE: 600000, // 10 minutes (roles rarely change)
} as const;

@Injectable()
export class CacheService {
  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

  async get<T>(key: string): Promise<T | undefined> {
    return this.cacheManager.get<T>(key);
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    await this.cacheManager.set(key, value, ttl);
  }

  async del(key: string): Promise<void> {
    await this.cacheManager.del(key);
  }

  // User-specific cache methods
  async getUser<T>(userId: string): Promise<T | undefined> {
    return this.get<T>(`${CACHE_KEYS.USER}${userId}`);
  }

  async setUser<T>(userId: string, user: T): Promise<void> {
    await this.set(`${CACHE_KEYS.USER}${userId}`, user, CACHE_TTL.USER);
  }

  async invalidateUser(userId: string): Promise<void> {
    await this.del(`${CACHE_KEYS.USER}${userId}`);
    await this.del(`${CACHE_KEYS.USER_PERMISSIONS}${userId}`);
  }

  // Permissions cache methods
  async getUserPermissions(userId: string): Promise<string[] | undefined> {
    return this.get<string[]>(`${CACHE_KEYS.USER_PERMISSIONS}${userId}`);
  }

  async setUserPermissions(userId: string, permissions: string[]): Promise<void> {
    await this.set(`${CACHE_KEYS.USER_PERMISSIONS}${userId}`, permissions, CACHE_TTL.PERMISSIONS);
  }

  async invalidateUserPermissions(userId: string): Promise<void> {
    await this.del(`${CACHE_KEYS.USER_PERMISSIONS}${userId}`);
  }

  // Role cache methods
  async getAllRoles<T>(): Promise<T | undefined> {
    return this.get<T>(CACHE_KEYS.ALL_ROLES);
  }

  async setAllRoles<T>(roles: T): Promise<void> {
    await this.set(CACHE_KEYS.ALL_ROLES, roles, CACHE_TTL.ROLE);
  }

  async invalidateRoles(): Promise<void> {
    await this.del(CACHE_KEYS.ALL_ROLES);
  }

  // Invalidate all cache for a user (on logout, role change, etc.)
  async invalidateAllUserCache(userId: string): Promise<void> {
    await Promise.all([
      this.del(`${CACHE_KEYS.USER}${userId}`),
      this.del(`${CACHE_KEYS.USER_PERMISSIONS}${userId}`),
    ]);
  }
}
