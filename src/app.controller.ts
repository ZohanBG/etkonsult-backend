import { Controller, Get, Query, UseGuards, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AppService } from './app.service.js';
import { AuthGuard } from './auth/guards/auth.guard.js';
import { PrismaService } from './prisma/prisma.service.js';
import { RbacService } from './rbac/rbac.service.js';
import { PERMISSIONS } from './rbac/permissions.js';
import { Prisma } from '@prisma/client';
import type { CurrentUserData } from './auth/decorators/current-user.decorator.js';

interface MonthDataRow {
  year: number;
  month: number;
  count: bigint;
}

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('stats')
  @UseGuards(AuthGuard)
  async getStats() {
    const [vehicles, owners, users, auditLogs] = await Promise.all([
      this.prisma.vehicle.count(),
      this.prisma.owner.count(),
      this.prisma.user.count(),
      this.prisma.auditLog.count(),
    ]);

    return { vehicles, owners, users, auditLogs };
  }

  /**
   * GET /stats/charts?agentId=xxx
   * Returns monthly policy + request counts for current year and previous year.
   * - Admin/staff: agentId param is respected; omit for global data
   * - Agent: always filtered to their own data (agentId param ignored)
   */
  @Get('stats/charts')
  @UseGuards(AuthGuard)
  async getCharts(
    @Req() req: Request & { user: CurrentUserData },
    @Query('agentId') agentId?: string,
  ) {
    const userId = req.user.userId;
    const currentYear = new Date().getFullYear();
    const prevYear = currentYear - 1;

    const canManage = await this.rbac.userHasPermission(userId, PERMISSIONS.INSURANCE_MANAGE);
    const isAgentView = await this.rbac.userHasPermission(userId, PERMISSIONS.INSURANCE_AGENT_VIEW);

    // Determine effective agent filter
    const isAgentOnly = isAgentView && !canManage;
    const effectiveAgentId = isAgentOnly ? userId : (canManage && agentId ? agentId : null);

    // ---- Policies chart ----
    let policies: { year: number; month: number; count: number }[] = [];

    const hasInsuranceAccess = isAgentView || canManage ||
      await this.rbac.userHasPermission(userId, PERMISSIONS.INSURANCE_READ);

    if (hasInsuranceAccess) {
      if (effectiveAgentId) {
        // Filter by agent name mappings
        const mappings = await this.prisma.agentMapping.findMany({
          where: { userId: effectiveAgentId },
          select: { agentName: true },
        });
        const agentNames = mappings.map((m) => m.agentName);

        if (agentNames.length > 0) {
          const rows = await this.prisma.$queryRaw<MonthDataRow[]>(
            Prisma.sql`
              SELECT
                EXTRACT(YEAR FROM "startDate")::int AS year,
                EXTRACT(MONTH FROM "startDate")::int AS month,
                COUNT(*)::bigint AS count
              FROM insurance_policies
              WHERE "startDate" IS NOT NULL
                AND EXTRACT(YEAR FROM "startDate") IN (${prevYear}, ${currentYear})
                AND TRIM(agent) IN (${Prisma.join(agentNames)})
              GROUP BY year, month
              ORDER BY year, month
            `,
          );
          policies = rows.map((r) => ({ year: r.year, month: r.month, count: Number(r.count) }));
        }
      } else {
        const rows = await this.prisma.$queryRaw<MonthDataRow[]>(
          Prisma.sql`
            SELECT
              EXTRACT(YEAR FROM "startDate")::int AS year,
              EXTRACT(MONTH FROM "startDate")::int AS month,
              COUNT(*)::bigint AS count
            FROM insurance_policies
            WHERE "startDate" IS NOT NULL
              AND EXTRACT(YEAR FROM "startDate") IN (${prevYear}, ${currentYear})
            GROUP BY year, month
            ORDER BY year, month
          `,
        );
        policies = rows.map((r) => ({ year: r.year, month: r.month, count: Number(r.count) }));
      }
    }

    // ---- Requests chart ----
    let requests: { year: number; month: number; count: number }[] = [];

    const canReadRequests = await this.rbac.userHasPermission(userId, PERMISSIONS.REQUEST_READ_ALL) ||
      await this.rbac.userHasPermission(userId, PERMISSIONS.REQUEST_READ_OWN);

    if (canReadRequests) {
      const canReadAll = await this.rbac.userHasPermission(userId, PERMISSIONS.REQUEST_READ_ALL);
      const filterUserId = (!canReadAll || effectiveAgentId) ? (effectiveAgentId || userId) : null;

      let rows: MonthDataRow[];
      if (filterUserId) {
        rows = await this.prisma.$queryRaw<MonthDataRow[]>(
          Prisma.sql`
            SELECT
              EXTRACT(YEAR FROM "createdAt")::int AS year,
              EXTRACT(MONTH FROM "createdAt")::int AS month,
              COUNT(*)::bigint AS count
            FROM requests
            WHERE EXTRACT(YEAR FROM "createdAt") IN (${prevYear}, ${currentYear})
              AND "agentId" = ${filterUserId}
            GROUP BY year, month
            ORDER BY year, month
          `,
        );
      } else {
        rows = await this.prisma.$queryRaw<MonthDataRow[]>(
          Prisma.sql`
            SELECT
              EXTRACT(YEAR FROM "createdAt")::int AS year,
              EXTRACT(MONTH FROM "createdAt")::int AS month,
              COUNT(*)::bigint AS count
            FROM requests
            WHERE EXTRACT(YEAR FROM "createdAt") IN (${prevYear}, ${currentYear})
            GROUP BY year, month
            ORDER BY year, month
          `,
        );
      }
      requests = rows.map((r) => ({ year: r.year, month: r.month, count: Number(r.count) }));
    }

    return {
      years: { current: currentYear, previous: prevYear },
      policies,
      requests,
    };
  }
}
