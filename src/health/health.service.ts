import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface HealthStatus {
  status: 'ok' | 'error';
  timestamp: string;
  uptime: number;
  database: {
    status: 'ok' | 'error';
    message?: string;
  };
}

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<HealthStatus> {
    const timestamp = new Date().toISOString();
    const uptime = process.uptime();

    let databaseStatus: HealthStatus['database'] = { status: 'ok' };

    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      databaseStatus = {
        status: 'error',
        message: error instanceof Error ? error.message : 'Database connection failed',
      };
    }

    return {
      status: databaseStatus.status === 'ok' ? 'ok' : 'error',
      timestamp,
      uptime,
      database: databaseStatus,
    };
  }
}
