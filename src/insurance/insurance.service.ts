import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { GoogleSheetsService } from './google-sheets.service.js';
import { InsuranceSyncService } from './insurance-sync.service.js';
import { CreateSpreadsheetDto, ExpiryFilterDto, CreateAgentMappingDto, BulkAgentMappingDto } from './dto/index.js';

export type ExpiryStatusType = 'expired' | 'recently_expired' | 'expiring_soon' | 'active' | 'unknown';

export interface VehicleDocumentSnapshot {
  id: string | null;
  validFrom: Date | null;
  validTo: Date | null;
  status: ExpiryStatusType;
}

export interface ExpiryItem {
  registrationNumber: string;
  ownerName: string | null;
  policyNumber: string | null;
  company: string | null;
  startDate: Date | null;
  expiryDate: Date | null;
  agent: string | null;
  status: ExpiryStatusType;
  vehicleId: string | null;
  installmentHint: string | null;
  gtp: VehicleDocumentSnapshot | null;
  vignette: VehicleDocumentSnapshot | null;
}

function computeDocStatus(validTo: Date | null): ExpiryStatusType {
  if (!validTo) return 'unknown';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(validTo.getFullYear(), validTo.getMonth(), validTo.getDate());
  const msPerDay = 24 * 60 * 60 * 1000;
  const diffDays = Math.floor((target.getTime() - today.getTime()) / msPerDay);
  if (diffDays < -15) return 'expired';
  if (diffDays < 0) return 'recently_expired';
  if (diffDays <= 7) return 'expiring_soon';
  return 'active';
}

/**
 * Guess the total number of installments based on policy span in days.
 * Returns null if span doesn't match a known pattern.
 */
function guessInstallmentDenominator(spanDays: number | null): number | null {
  if (spanDays === null || spanDays <= 0) return null;
  if (spanDays >= 165 && spanDays <= 200) return 2;  // ~6 months → 2 installments
  if (spanDays >= 80 && spanDays <= 100) return 4;   // ~3 months → 4 installments
  if (spanDays >= 25 && spanDays <= 40) return 12;   // ~1 month → 12 installments
  return null;
}

/**
 * Build installment hint string from position within policy group and total count.
 * installmentPos: 1-based position of this row among rows with same policyNumber (by startDate)
 * installmentTotal: total rows sharing this policyNumber
 * spanDays: fallback to detect annual policies (skip display) when total=1
 */
function buildInstallmentHint(
  installmentPos: bigint | null,
  installmentTotal: bigint | null,
  spanDays: number | null,
): string | null {
  if (installmentPos === null || installmentTotal === null) return null;
  const total = Number(installmentTotal);
  const pos = Number(installmentPos);
  // Single-row policy — determine denominator from span
  if (total === 1) {
    if (spanDays === null) return null; // no dates at all → hide
    if (spanDays >= 330) return `1/1`; // annual
    const denom = guessInstallmentDenominator(spanDays);
    return denom ? `1/${denom}` : `1/?`; // use span-based guess or unknown
  }
  // Multi-row: check if span suggests a higher total than what we've seen so far
  // e.g. 2 rows with ~3-month span → real total is likely 4
  const guessedTotal = guessInstallmentDenominator(spanDays);
  if (guessedTotal !== null && guessedTotal > total) {
    return `${pos}/${guessedTotal}`;
  }
  return `${pos}/${total}`;
}

export interface ExpiryListResponse {
  data: ExpiryItem[];
  total: number;
  page: number;
  totalPages: number;
}

export interface ExpiryStats {
  total: number;
  expired: number;
  recentlyExpired: number;
  expiringSoon: number;
  active: number;
  unknown: number;
}

export interface PolicyHistoryItem {
  id: string;
  policyNumber: string | null;
  company: string | null;
  ownerName: string | null;
  startDate: Date | null;
  expiryDate: Date | null;
  agent: string | null;
  sheetMonth: string;
  spreadsheetLabel: string;
  spreadsheetYear: number;
}

export interface SpreadsheetWithCount {
  id: string;
  year: number;
  spreadsheetId: string;
  label: string;
  isArchived: boolean;
  lastSyncedAt: Date | null;
  createdAt: Date;
  _count: { policies: number };
}

@Injectable()
export class InsuranceService {
  private readonly logger = new Logger(InsuranceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly googleSheets: GoogleSheetsService,
    private readonly syncService: InsuranceSyncService,
  ) {}

  /**
   * List all configured spreadsheets with policy count
   */
  async getSpreadsheets(): Promise<SpreadsheetWithCount[]> {
    return this.prisma.insuranceSpreadsheet.findMany({
      include: { _count: { select: { policies: true } } },
      orderBy: [{ year: 'desc' }, { createdAt: 'asc' }],
    }) as unknown as SpreadsheetWithCount[];
  }

  /**
   * Add a new spreadsheet config + trigger initial sync
   */
  async addSpreadsheet(dto: CreateSpreadsheetDto): Promise<SpreadsheetWithCount> {
    // Extract spreadsheet ID from URL if needed
    const spreadsheetId = this.extractSpreadsheetId(dto.spreadsheetId);

    // Create config in DB
    const config = await this.prisma.insuranceSpreadsheet.create({
      data: {
        year: dto.year,
        spreadsheetId,
        label: dto.label,
      },
    });

    // Trigger initial sync in background (don't block the response)
    this.syncService.initialSync(config.id, spreadsheetId).catch((error) => {
      // Log but don't throw — the sync can be retried manually
      this.logger.error(`Initial sync failed for ${config.label}:`, error);
    });

    return {
      ...config,
      _count: { policies: 0 },
    };
  }

  /**
   * Remove a spreadsheet config + cascade delete policies + cleanup snapshot
   */
  async removeSpreadsheet(id: string): Promise<void> {
    const config = await this.prisma.insuranceSpreadsheet.findUnique({
      where: { id },
    });
    if (!config) throw new NotFoundException('Таблицата не е намерена');

    // Delete config (cascade deletes policies)
    await this.prisma.insuranceSpreadsheet.delete({ where: { id } });

    // Cleanup snapshot file
    this.syncService.deleteSnapshot(id);
  }

  /**
   * Validate a spreadsheet ID/URL — check access and return metadata
   */
  async validateSpreadsheet(spreadsheetIdOrUrl: string) {
    const spreadsheetId = this.extractSpreadsheetId(spreadsheetIdOrUrl);

    try {
      const validation = await this.googleSheets.validateSpreadsheet(spreadsheetId);
      return {
        valid: true,
        spreadsheetId,
        title: validation.title,
        sheetNames: validation.sheetNames,
        sheetCount: validation.sheetNames.length,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes('404') || message.includes('not found')) {
        throw new BadRequestException(`Таблицата не е намерена. Проверете ID-то.`);
      }
      if (message.includes('403') || message.includes('permission') || message.includes('forbidden')) {
        this.logger.warn(`Spreadsheet access denied: ${message}`);
        throw new BadRequestException(
          `Няма достъп до таблицата. Моля, споделете я с акаунта на приложението (вижте документацията).`,
        );
      }
      this.logger.error(`Spreadsheet validation error: ${message}`);
      throw new BadRequestException(`Грешка при достъп до таблицата.`);
    }
  }

  /**
   * Force sync all active sheets now
   */
  async forceSync(): Promise<void> {
    await this.syncService.forceSyncActiveSheets();
  }

  /**
   * Archive a spreadsheet
   */
  async archiveSpreadsheet(id: string): Promise<{ rowCount: number }> {
    const config = await this.prisma.insuranceSpreadsheet.findUnique({
      where: { id },
    });
    if (!config) throw new NotFoundException('Таблицата не е намерена');
    if (config.isArchived) throw new BadRequestException('Таблицата вече е архивирана');

    return this.syncService.archiveSpreadsheet(id);
  }

  /**
   * Refresh an archived spreadsheet
   */
  async refreshArchive(id: string): Promise<{ rowCount: number }> {
    const config = await this.prisma.insuranceSpreadsheet.findUnique({
      where: { id },
    });
    if (!config) throw new NotFoundException('Таблицата не е намерена');

    return this.syncService.refreshArchive(id);
  }

  // =================== Part 2: Expiry Queries ===================

  /**
   * Get paginated list of vehicles with their latest policy, categorized by expiry status
   */
  async getExpiries(filters: ExpiryFilterDto): Promise<ExpiryListResponse> {
    const currentYear = new Date().getFullYear();
    const cutoffYear = currentYear - 2;
    const page = Math.max(1, parseInt(filters.page || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(filters.limit || '20', 10) || 20));
    const offset = (page - 1) * limit;
    const status = filters.status || 'all';
    const search = filters.search?.trim() || '';
    const company = filters.company?.trim() || '';
    const agentName = filters.agentName?.trim() || '';
    const registrationNumber = filters.registrationNumber?.trim() || '';
    const policyNumber = filters.policyNumber?.trim() || '';
    const ownerName = filters.ownerName?.trim() || '';

    // Build dynamic WHERE conditions for the outer query
    const conditions: Prisma.Sql[] = [];

    if (status && status !== 'all') {
      conditions.push(Prisma.sql`AND lp.status = ${status}`);
    }

    if (search) {
      const searchPattern = `%${search.toLowerCase()}%`;
      conditions.push(
        Prisma.sql`AND (LOWER(lp."registrationNumber") LIKE ${searchPattern} OR LOWER(lp."ownerName") LIKE ${searchPattern})`,
      );
    }

    if (company) {
      const companyPattern = `%${company.toLowerCase()}%`;
      conditions.push(Prisma.sql`AND LOWER(lp.company) LIKE ${companyPattern}`);
    }

    if (agentName) {
      const agentPattern = `%${agentName.toLowerCase()}%`;
      conditions.push(Prisma.sql`AND LOWER(lp.agent) LIKE ${agentPattern}`);
    }

    if (filters.agentNames) {
      const list = filters.agentNames
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      if (list.length > 0) {
        conditions.push(Prisma.sql`AND LOWER(lp.agent) IN (${Prisma.join(list)})`);
      } else {
        conditions.push(Prisma.sql`AND FALSE`);
      }
    }

    if (registrationNumber) {
      const regPattern = `%${registrationNumber.toLowerCase()}%`;
      conditions.push(Prisma.sql`AND LOWER(lp."registrationNumber") LIKE ${regPattern}`);
    }

    if (policyNumber) {
      const policyPattern = `%${policyNumber.toLowerCase()}%`;
      conditions.push(Prisma.sql`AND LOWER(lp."policyNumber") LIKE ${policyPattern}`);
    }

    if (ownerName) {
      const ownerPattern = `%${ownerName.toLowerCase()}%`;
      conditions.push(Prisma.sql`AND LOWER(lp."ownerName") LIKE ${ownerPattern}`);
    }

    const whereClause = conditions.length > 0
      ? Prisma.sql`${Prisma.join(conditions, ' ')}`
      : Prisma.sql``;

    // Data query
    const rows = await this.prisma.$queryRaw<Array<{
      registrationNumber: string;
      ownerName: string | null;
      policyNumber: string | null;
      company: string | null;
      startDate: Date | null;
      expiryDate: Date | null;
      agent: string | null;
      status: string;
      vehicleId: string | null;
      spanDays: number | null;
      installmentPos: bigint | null;
      installmentTotal: bigint | null;
    }>>(Prisma.sql`
      WITH all_ranked AS (
        -- Rank every policy row within its policyNumber group by startDate
        SELECT
          ip."registrationNumber",
          ip."policyNumber",
          ip."startDate",
          ip."expiryDate",
          CASE
            WHEN ip."policyNumber" IS NOT NULL AND ip."startDate" IS NOT NULL
            THEN ROW_NUMBER() OVER (PARTITION BY ip."policyNumber" ORDER BY ip."startDate")
            ELSE NULL
          END AS "installmentPos",
          CASE
            WHEN ip."policyNumber" IS NOT NULL
            THEN COUNT(*) OVER (PARTITION BY ip."policyNumber")
            ELSE NULL
          END AS "installmentTotal"
        FROM insurance_policies ip
        INNER JOIN insurance_spreadsheets isp ON isp.id = ip."spreadsheetConfigId"
        WHERE isp.year >= ${cutoffYear}
      ),
      latest_policies AS (
        SELECT DISTINCT ON (ip."registrationNumber")
          ip."registrationNumber",
          ip."ownerName",
          ip."policyNumber",
          ip.company,
          ip."startDate",
          ip."expiryDate",
          ip.agent,
          CASE
            WHEN ip."expiryDate" IS NULL THEN 'unknown'
            WHEN ip."expiryDate" >= CURRENT_DATE - INTERVAL '15 days' AND ip."expiryDate" < CURRENT_DATE THEN 'recently_expired'
            WHEN ip."expiryDate" < CURRENT_DATE THEN 'expired'
            WHEN ip."expiryDate" <= CURRENT_DATE + INTERVAL '7 days' THEN 'expiring_soon'
            ELSE 'active'
          END AS status,
          CASE
            WHEN ip."startDate" IS NOT NULL AND ip."expiryDate" IS NOT NULL
            THEN (ip."expiryDate"::date - ip."startDate"::date)
            ELSE NULL
          END AS "spanDays"
        FROM insurance_policies ip
        INNER JOIN insurance_spreadsheets isp ON isp.id = ip."spreadsheetConfigId"
        WHERE isp.year >= ${cutoffYear}
        ORDER BY ip."registrationNumber", ip."expiryDate" DESC NULLS LAST, ip."createdAt" DESC
      )
      SELECT
        lp.*,
        v.id AS "vehicleId",
        ar."installmentPos",
        ar."installmentTotal"
      FROM latest_policies lp
      LEFT JOIN vehicles v ON LOWER(v."registrationNumber") = LOWER(lp."registrationNumber")
      LEFT JOIN all_ranked ar
        ON LOWER(TRIM(ar."registrationNumber")) = LOWER(TRIM(lp."registrationNumber"))
        AND ar."policyNumber" IS NOT DISTINCT FROM lp."policyNumber"
        AND ar."startDate" IS NOT DISTINCT FROM lp."startDate"
        AND ar."expiryDate" IS NOT DISTINCT FROM lp."expiryDate"
      WHERE 1=1 ${whereClause}
      ORDER BY lp."expiryDate" ASC NULLS LAST
      LIMIT ${limit} OFFSET ${offset}
    `);

    // Count query — must include any column referenced by whereClause
    const countResult = await this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      WITH latest_policies AS (
        SELECT DISTINCT ON (ip."registrationNumber")
          ip."registrationNumber",
          ip."ownerName",
          ip."policyNumber",
          ip.company,
          ip.agent,
          ip."expiryDate",
          CASE
            WHEN ip."expiryDate" IS NULL THEN 'unknown'
            WHEN ip."expiryDate" >= CURRENT_DATE - INTERVAL '15 days' AND ip."expiryDate" < CURRENT_DATE THEN 'recently_expired'
            WHEN ip."expiryDate" < CURRENT_DATE THEN 'expired'
            WHEN ip."expiryDate" <= CURRENT_DATE + INTERVAL '7 days' THEN 'expiring_soon'
            ELSE 'active'
          END AS status
        FROM insurance_policies ip
        INNER JOIN insurance_spreadsheets isp ON isp.id = ip."spreadsheetConfigId"
        WHERE isp.year >= ${cutoffYear}
        ORDER BY ip."registrationNumber", ip."expiryDate" DESC NULLS LAST, ip."createdAt" DESC
      )
      SELECT COUNT(*) as count
      FROM latest_policies lp
      WHERE 1=1 ${whereClause}
    `);

    const total = Number(countResult[0]?.count ?? 0);

    return {
      data: rows.map((row) => ({
        registrationNumber: row.registrationNumber,
        ownerName: row.ownerName,
        policyNumber: row.policyNumber,
        company: row.company,
        startDate: row.startDate,
        expiryDate: row.expiryDate,
        agent: row.agent,
        status: row.status as ExpiryStatusType,
        vehicleId: row.vehicleId,
        installmentHint: buildInstallmentHint(row.installmentPos, row.installmentTotal, row.spanDays),
        gtp: null as VehicleDocumentSnapshot | null,
        vignette: null as VehicleDocumentSnapshot | null,
      })),
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Get expiry stats — count per status category
   */
  async getExpiryStats(): Promise<ExpiryStats> {
    const currentYear = new Date().getFullYear();
    const cutoffYear = currentYear - 2;

    const result = await this.prisma.$queryRaw<Array<{
      total: bigint;
      expired: bigint;
      recently_expired: bigint;
      expiring_soon: bigint;
      active: bigint;
      unknown: bigint;
    }>>(Prisma.sql`
      WITH latest_policies AS (
        SELECT DISTINCT ON (ip."registrationNumber")
          ip."registrationNumber",
          ip."expiryDate",
          CASE
            WHEN ip."expiryDate" IS NULL THEN 'unknown'
            WHEN ip."expiryDate" >= CURRENT_DATE - INTERVAL '15 days' AND ip."expiryDate" < CURRENT_DATE THEN 'recently_expired'
            WHEN ip."expiryDate" < CURRENT_DATE THEN 'expired'
            WHEN ip."expiryDate" <= CURRENT_DATE + INTERVAL '7 days' THEN 'expiring_soon'
            ELSE 'active'
          END AS status
        FROM insurance_policies ip
        INNER JOIN insurance_spreadsheets isp ON isp.id = ip."spreadsheetConfigId"
        WHERE isp.year >= ${cutoffYear}
        ORDER BY ip."registrationNumber", ip."expiryDate" DESC NULLS LAST, ip."createdAt" DESC
      )
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'expired') AS expired,
        COUNT(*) FILTER (WHERE status = 'recently_expired') AS recently_expired,
        COUNT(*) FILTER (WHERE status = 'expiring_soon') AS expiring_soon,
        COUNT(*) FILTER (WHERE status = 'active') AS active,
        COUNT(*) FILTER (WHERE status = 'unknown') AS unknown
      FROM latest_policies
    `);

    const row = result[0];
    return {
      total: Number(row?.total ?? 0),
      expired: Number(row?.expired ?? 0),
      recentlyExpired: Number(row?.recently_expired ?? 0),
      expiringSoon: Number(row?.expiring_soon ?? 0),
      active: Number(row?.active ?? 0),
      unknown: Number(row?.unknown ?? 0),
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // ГТП / Винетка: docType-aware listing and stats
  // ────────────────────────────────────────────────────────────────────────

  /** Latest GTP record per registration number, case-insensitive lookup */
  private async getLatestGtpForRegs(
    regs: string[],
  ): Promise<Map<string, VehicleDocumentSnapshot>> {
    if (regs.length === 0) return new Map();
    const upperRegs = Array.from(new Set(regs.map((r) => r.toUpperCase())));
    const items = await this.prisma.technicalInspection.findMany({
      where: { registrationNumber: { in: upperRegs } },
      orderBy: [{ registrationNumber: 'asc' }, { validTo: 'desc' }],
      select: { id: true, registrationNumber: true, validFrom: true, validTo: true },
    });
    const out = new Map<string, VehicleDocumentSnapshot>();
    for (const it of items) {
      const key = it.registrationNumber.toUpperCase();
      if (!out.has(key)) {
        out.set(key, {
          id: it.id,
          validFrom: it.validFrom,
          validTo: it.validTo,
          status: computeDocStatus(it.validTo),
        });
      }
    }
    return out;
  }

  /** Latest Vignette record per registration number, case-insensitive lookup */
  private async getLatestVignetteForRegs(
    regs: string[],
  ): Promise<Map<string, VehicleDocumentSnapshot>> {
    if (regs.length === 0) return new Map();
    const upperRegs = Array.from(new Set(regs.map((r) => r.toUpperCase())));
    const items = await this.prisma.vignette.findMany({
      where: { registrationNumber: { in: upperRegs } },
      orderBy: [{ registrationNumber: 'asc' }, { validTo: 'desc' }],
      select: { id: true, registrationNumber: true, validFrom: true, validTo: true },
    });
    const out = new Map<string, VehicleDocumentSnapshot>();
    for (const it of items) {
      const key = it.registrationNumber.toUpperCase();
      if (!out.has(key)) {
        out.set(key, {
          id: it.id,
          validFrom: it.validFrom,
          validTo: it.validTo,
          status: computeDocStatus(it.validTo),
        });
      }
    }
    return out;
  }

  /**
   * List expiries driven by GTP or Vignette records.
   * Latest record per reg is the "primary" row; insurance/the-other-type are looked up for display columns.
   */
  private async getExpiriesByDoc(
    kind: 'GTP' | 'VIGNETTE',
    filters: ExpiryFilterDto,
  ): Promise<ExpiryListResponse> {
    const page = Math.max(1, parseInt(filters.page || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(filters.limit || '20', 10) || 20));
    const offset = (page - 1) * limit;
    const status = filters.status || 'all';
    const search = filters.search?.trim().toUpperCase() || '';
    const reg = filters.registrationNumber?.trim().toUpperCase() || '';
    const owner = filters.ownerName?.trim() || '';

    const table = kind === 'GTP' ? 'technical_inspections' : 'vignettes';

    // Special case: status='unknown' for GTP/Винетка means "no record set"
    // → switch to a different query that lists insurance regs WITHOUT this doc
    if (status === 'unknown') {
      return this.getMissingDocsList(kind, filters);
    }

    // Status filter expressed as a SQL condition on validTo
    let statusCondition = Prisma.sql``;
    if (status === 'expired') {
      statusCondition = Prisma.sql`AND lp."validTo" < CURRENT_DATE - INTERVAL '15 days'`;
    } else if (status === 'recently_expired') {
      statusCondition = Prisma.sql`AND lp."validTo" >= CURRENT_DATE - INTERVAL '15 days' AND lp."validTo" < CURRENT_DATE`;
    } else if (status === 'expiring_soon') {
      statusCondition = Prisma.sql`AND lp."validTo" >= CURRENT_DATE AND lp."validTo" <= CURRENT_DATE + INTERVAL '7 days'`;
    } else if (status === 'active') {
      statusCondition = Prisma.sql`AND lp."validTo" > CURRENT_DATE + INTERVAL '7 days'`;
    }

    const searchCondition = search
      ? Prisma.sql`AND UPPER(lp."registrationNumber") LIKE ${'%' + search + '%'}`
      : Prisma.sql``;
    const regCondition = reg
      ? Prisma.sql`AND UPPER(lp."registrationNumber") LIKE ${'%' + reg + '%'}`
      : Prisma.sql``;

    // CTE: latest doc per registrationNumber, then filter
    const tableIdent = Prisma.raw(`"${table}"`);
    const rows = await this.prisma.$queryRaw<Array<{
      id: string;
      registrationNumber: string;
      validFrom: Date;
      validTo: Date;
    }>>(Prisma.sql`
      WITH latest_docs AS (
        SELECT DISTINCT ON ("registrationNumber")
          id, "registrationNumber", "validFrom", "validTo"
        FROM ${tableIdent}
        ORDER BY "registrationNumber", "validTo" DESC
      )
      SELECT lp.*
      FROM latest_docs lp
      WHERE 1=1 ${statusCondition} ${searchCondition} ${regCondition}
      ORDER BY lp."validTo" ASC NULLS LAST
      LIMIT ${limit} OFFSET ${offset}
    `);

    const countResult = await this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      WITH latest_docs AS (
        SELECT DISTINCT ON ("registrationNumber")
          "registrationNumber", "validTo"
        FROM ${tableIdent}
        ORDER BY "registrationNumber", "validTo" DESC
      )
      SELECT COUNT(*) AS count
      FROM latest_docs lp
      WHERE 1=1 ${statusCondition} ${searchCondition} ${regCondition}
    `);
    const total = Number(countResult[0]?.count ?? 0);

    // Enrich with latest insurance + the other type
    const regs = rows.map((r) => r.registrationNumber);
    const upperRegs = Array.from(new Set(regs.map((r) => r.toUpperCase())));

    const [insuranceRows, vehicleRows, gtpMap, vignetteMap] = await Promise.all([
      upperRegs.length === 0
        ? []
        : this.prisma.$queryRaw<Array<{
            registrationNumber: string;
            ownerName: string | null;
            policyNumber: string | null;
            company: string | null;
            startDate: Date | null;
            expiryDate: Date | null;
            agent: string | null;
          }>>(Prisma.sql`
            SELECT DISTINCT ON ("registrationNumber")
              "registrationNumber", "ownerName", "policyNumber", company,
              "startDate", "expiryDate", agent
            FROM insurance_policies
            WHERE UPPER("registrationNumber") IN (${Prisma.join(upperRegs)})
            ORDER BY "registrationNumber", "expiryDate" DESC NULLS LAST, "createdAt" DESC
          `),
      upperRegs.length === 0
        ? []
        : this.prisma.vehicle.findMany({
            where: { registrationNumber: { in: upperRegs } },
            select: { id: true, registrationNumber: true },
          }),
      kind === 'GTP' ? Promise.resolve(new Map<string, VehicleDocumentSnapshot>()) : this.getLatestGtpForRegs(regs),
      kind === 'VIGNETTE' ? Promise.resolve(new Map<string, VehicleDocumentSnapshot>()) : this.getLatestVignetteForRegs(regs),
    ]);

    const insuranceByReg = new Map<string, typeof insuranceRows[number]>();
    for (const ir of insuranceRows) {
      insuranceByReg.set(ir.registrationNumber.toUpperCase(), ir);
    }
    const vehicleByReg = new Map<string, string>();
    for (const v of vehicleRows) vehicleByReg.set(v.registrationNumber.toUpperCase(), v.id);

    let data: ExpiryItem[] = rows.map((row) => {
      const upper = row.registrationNumber.toUpperCase();
      const ins = insuranceByReg.get(upper);
      const primarySnap: VehicleDocumentSnapshot = {
        id: row.id,
        validFrom: row.validFrom,
        validTo: row.validTo,
        status: computeDocStatus(row.validTo),
      };
      const gtp = kind === 'GTP' ? primarySnap : gtpMap.get(upper) ?? null;
      const vignette = kind === 'VIGNETTE' ? primarySnap : vignetteMap.get(upper) ?? null;
      return {
        registrationNumber: row.registrationNumber,
        ownerName: ins?.ownerName ?? null,
        policyNumber: ins?.policyNumber ?? null,
        company: ins?.company ?? null,
        startDate: row.validFrom,
        expiryDate: row.validTo,
        agent: ins?.agent ?? null,
        status: primarySnap.status,
        vehicleId: vehicleByReg.get(upper) ?? null,
        installmentHint: null,
        gtp,
        vignette,
      };
    });

    if (owner) {
      const ownerLower = owner.toLowerCase();
      data = data.filter((r) => (r.ownerName ?? '').toLowerCase().includes(ownerLower));
    }

    return { data, total, page, totalPages: Math.ceil(total / limit) || 1 };
  }

  /**
   * List insurance-known registrations that DON'T have a GTP/Винетка record yet.
   * Used when the user selects status='unknown' on the GTP/Винетка tab.
   */
  private async getMissingDocsList(
    kind: 'GTP' | 'VIGNETTE',
    filters: ExpiryFilterDto,
  ): Promise<ExpiryListResponse> {
    const currentYear = new Date().getFullYear();
    const cutoffYear = currentYear - 2;
    const page = Math.max(1, parseInt(filters.page || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(filters.limit || '20', 10) || 20));
    const offset = (page - 1) * limit;
    const search = filters.search?.trim().toUpperCase() || '';
    const reg = filters.registrationNumber?.trim().toUpperCase() || '';
    const owner = filters.ownerName?.trim() || '';

    const table = kind === 'GTP' ? 'technical_inspections' : 'vignettes';
    const tableIdent = Prisma.raw(`"${table}"`);

    const searchCondition = search
      ? Prisma.sql`AND (UPPER(lp."registrationNumber") LIKE ${'%' + search + '%'} OR UPPER(lp."ownerName") LIKE ${'%' + search + '%'})`
      : Prisma.sql``;
    const regCondition = reg
      ? Prisma.sql`AND UPPER(lp."registrationNumber") LIKE ${'%' + reg + '%'}`
      : Prisma.sql``;
    const ownerCondition = owner
      ? Prisma.sql`AND LOWER(lp."ownerName") LIKE ${'%' + owner.toLowerCase() + '%'}`
      : Prisma.sql``;

    const rows = await this.prisma.$queryRaw<Array<{
      registrationNumber: string;
      ownerName: string | null;
      policyNumber: string | null;
      company: string | null;
      startDate: Date | null;
      expiryDate: Date | null;
      agent: string | null;
    }>>(Prisma.sql`
      WITH latest_policies AS (
        SELECT DISTINCT ON (ip."registrationNumber")
          ip."registrationNumber",
          ip."ownerName",
          ip."policyNumber",
          ip.company,
          ip."startDate",
          ip."expiryDate",
          ip.agent
        FROM insurance_policies ip
        INNER JOIN insurance_spreadsheets isp ON isp.id = ip."spreadsheetConfigId"
        WHERE isp.year >= ${cutoffYear}
        ORDER BY ip."registrationNumber", ip."expiryDate" DESC NULLS LAST, ip."createdAt" DESC
      ),
      have_doc AS (
        SELECT DISTINCT UPPER("registrationNumber") AS reg_upper FROM ${tableIdent}
      )
      SELECT lp.*
      FROM latest_policies lp
      LEFT JOIN have_doc h ON h.reg_upper = UPPER(lp."registrationNumber")
      WHERE h.reg_upper IS NULL ${searchCondition} ${regCondition} ${ownerCondition}
      ORDER BY lp."registrationNumber"
      LIMIT ${limit} OFFSET ${offset}
    `);

    const countResult = await this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      WITH latest_policies AS (
        SELECT DISTINCT ON (ip."registrationNumber")
          ip."registrationNumber",
          ip."ownerName"
        FROM insurance_policies ip
        INNER JOIN insurance_spreadsheets isp ON isp.id = ip."spreadsheetConfigId"
        WHERE isp.year >= ${cutoffYear}
        ORDER BY ip."registrationNumber", ip."expiryDate" DESC NULLS LAST, ip."createdAt" DESC
      ),
      have_doc AS (
        SELECT DISTINCT UPPER("registrationNumber") AS reg_upper FROM ${tableIdent}
      )
      SELECT COUNT(*) AS count
      FROM latest_policies lp
      LEFT JOIN have_doc h ON h.reg_upper = UPPER(lp."registrationNumber")
      WHERE h.reg_upper IS NULL ${searchCondition} ${regCondition} ${ownerCondition}
    `);
    const total = Number(countResult[0]?.count ?? 0);

    // Enrich with vehicleId + the OTHER doc snapshot
    const regs = rows.map((r) => r.registrationNumber);
    const upperRegs = Array.from(new Set(regs.map((r) => r.toUpperCase())));
    const [vehicleRows, otherDocMap] = await Promise.all([
      upperRegs.length === 0
        ? []
        : this.prisma.vehicle.findMany({
            where: { registrationNumber: { in: upperRegs } },
            select: { id: true, registrationNumber: true },
          }),
      kind === 'GTP' ? this.getLatestVignetteForRegs(regs) : this.getLatestGtpForRegs(regs),
    ]);
    const vehicleByReg = new Map<string, string>();
    for (const v of vehicleRows) vehicleByReg.set(v.registrationNumber.toUpperCase(), v.id);

    const data: ExpiryItem[] = rows.map((row) => {
      const upper = row.registrationNumber.toUpperCase();
      const missingSnap: VehicleDocumentSnapshot = {
        id: null, validFrom: null, validTo: null, status: 'unknown',
      };
      return {
        registrationNumber: row.registrationNumber,
        ownerName: row.ownerName,
        policyNumber: row.policyNumber,
        company: row.company,
        startDate: null,
        expiryDate: null,
        agent: row.agent,
        status: 'unknown',
        vehicleId: vehicleByReg.get(upper) ?? null,
        installmentHint: null,
        gtp: kind === 'GTP' ? missingSnap : otherDocMap.get(upper) ?? null,
        vignette: kind === 'VIGNETTE' ? missingSnap : otherDocMap.get(upper) ?? null,
      };
    });

    return { data, total, page, totalPages: Math.ceil(total / limit) || 1 };
  }

  /** Stats counter for GTP/Vignette docs (latest per reg) */
  private async getDocStats(kind: 'GTP' | 'VIGNETTE'): Promise<ExpiryStats> {
    const currentYear = new Date().getFullYear();
    const cutoffYear = currentYear - 2;
    const table = kind === 'GTP' ? 'technical_inspections' : 'vignettes';
    const tableIdent = Prisma.raw(`"${table}"`);
    const result = await this.prisma.$queryRaw<Array<{
      total: bigint;
      expired: bigint;
      recently_expired: bigint;
      expiring_soon: bigint;
      active: bigint;
      missing: bigint;
    }>>(Prisma.sql`
      WITH latest_docs AS (
        SELECT DISTINCT ON ("registrationNumber")
          "registrationNumber",
          "validTo",
          CASE
            WHEN "validTo" < CURRENT_DATE - INTERVAL '15 days' THEN 'expired'
            WHEN "validTo" < CURRENT_DATE THEN 'recently_expired'
            WHEN "validTo" <= CURRENT_DATE + INTERVAL '7 days' THEN 'expiring_soon'
            ELSE 'active'
          END AS status
        FROM ${tableIdent}
        ORDER BY "registrationNumber", "validTo" DESC
      ),
      insurance_regs AS (
        SELECT DISTINCT UPPER(ip."registrationNumber") AS reg_upper
        FROM insurance_policies ip
        INNER JOIN insurance_spreadsheets isp ON isp.id = ip."spreadsheetConfigId"
        WHERE isp.year >= ${cutoffYear}
      ),
      doc_regs AS (
        SELECT DISTINCT UPPER("registrationNumber") AS reg_upper FROM ${tableIdent}
      )
      SELECT
        (SELECT COUNT(*) FROM latest_docs)
          + (SELECT COUNT(*) FROM insurance_regs ir LEFT JOIN doc_regs dr ON dr.reg_upper = ir.reg_upper WHERE dr.reg_upper IS NULL) AS total,
        (SELECT COUNT(*) FROM latest_docs WHERE status = 'expired') AS expired,
        (SELECT COUNT(*) FROM latest_docs WHERE status = 'recently_expired') AS recently_expired,
        (SELECT COUNT(*) FROM latest_docs WHERE status = 'expiring_soon') AS expiring_soon,
        (SELECT COUNT(*) FROM latest_docs WHERE status = 'active') AS active,
        (SELECT COUNT(*) FROM insurance_regs ir LEFT JOIN doc_regs dr ON dr.reg_upper = ir.reg_upper WHERE dr.reg_upper IS NULL) AS missing
    `);
    const row = result[0];
    return {
      total: Number(row?.total ?? 0),
      expired: Number(row?.expired ?? 0),
      recentlyExpired: Number(row?.recently_expired ?? 0),
      expiringSoon: Number(row?.expiring_soon ?? 0),
      active: Number(row?.active ?? 0),
      unknown: Number(row?.missing ?? 0),
    };
  }

  /** Public dispatcher for the new toggle */
  async getExpiriesForDocType(filters: ExpiryFilterDto): Promise<ExpiryListResponse> {
    const docType = filters.docType || 'INSURANCE';
    if (docType === 'GTP') return this.getExpiriesByDoc('GTP', filters);
    if (docType === 'VIGNETTE') return this.getExpiriesByDoc('VIGNETTE', filters);
    // INSURANCE — call existing, then enrich with the other 2 doc types
    const base = await this.getExpiries(filters);
    const regs = base.data.map((r) => r.registrationNumber);
    const [gtpMap, vignetteMap] = await Promise.all([
      this.getLatestGtpForRegs(regs),
      this.getLatestVignetteForRegs(regs),
    ]);
    return {
      ...base,
      data: base.data.map((r) => ({
        ...r,
        gtp: gtpMap.get(r.registrationNumber.toUpperCase()) ?? null,
        vignette: vignetteMap.get(r.registrationNumber.toUpperCase()) ?? null,
      })),
    };
  }

  async getStatsForDocType(docType: 'INSURANCE' | 'GTP' | 'VIGNETTE'): Promise<ExpiryStats> {
    if (docType === 'GTP') return this.getDocStats('GTP');
    if (docType === 'VIGNETTE') return this.getDocStats('VIGNETTE');
    return this.getExpiryStats();
  }

  /**
   * Get all policies for a specific vehicle (by reg number) across all years
   */
  async getVehicleHistory(regNumber: string): Promise<PolicyHistoryItem[]> {
    const policies = await this.prisma.insurancePolicy.findMany({
      where: {
        registrationNumber: { equals: regNumber, mode: 'insensitive' },
      },
      include: {
        spreadsheet: { select: { label: true, year: true } },
      },
      orderBy: [{ expiryDate: 'desc' }, { createdAt: 'desc' }],
    });

    return policies.map((p) => ({
      id: p.id,
      policyNumber: p.policyNumber,
      company: p.company,
      ownerName: p.ownerName,
      startDate: p.startDate,
      expiryDate: p.expiryDate,
      agent: p.agent,
      sheetMonth: p.sheetMonth,
      spreadsheetLabel: p.spreadsheet.label,
      spreadsheetYear: p.spreadsheet.year,
    }));
  }

  // =================== Agent Mapping ===================

  /**
   * Get all unique agent names from policies (distinct, non-null, trimmed)
   */
  async getUniqueAgentNames(): Promise<string[]> {
    const result = await this.prisma.$queryRaw<Array<{ agent: string }>>(
      Prisma.sql`
        SELECT DISTINCT TRIM(agent) AS agent
        FROM insurance_policies
        WHERE agent IS NOT NULL AND TRIM(agent) != ''
        ORDER BY agent
      `,
    );
    return result.map((r) => r.agent);
  }

  /**
   * Get all agent mappings with user info
   */
  async getAgentMappings() {
    return this.prisma.agentMapping.findMany({
      include: {
        user: { select: { id: true, email: true, username: true } },
      },
      orderBy: { agentName: 'asc' },
    });
  }

  /**
   * Create a single agent mapping
   */
  async createAgentMapping(dto: CreateAgentMappingDto) {
    const user = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (!user) throw new NotFoundException('Потребителят не е намерен');

    return this.prisma.agentMapping.create({
      data: { agentName: dto.agentName, userId: dto.userId },
      include: {
        user: { select: { id: true, email: true, username: true } },
      },
    });
  }

  /**
   * Remove an agent mapping
   */
  async removeAgentMapping(id: string) {
    const mapping = await this.prisma.agentMapping.findUnique({ where: { id } });
    if (!mapping) throw new NotFoundException('Връзката не е намерена');
    await this.prisma.agentMapping.delete({ where: { id } });
  }

  /**
   * Bulk assign agent names to a user (replaces any existing mappings for those names)
   */
  async bulkAssignAgentNames(dto: BulkAgentMappingDto) {
    const user = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (!user) throw new NotFoundException('Потребителят не е намерен');

    await this.prisma.$transaction(async (tx) => {
      await tx.agentMapping.deleteMany({
        where: { agentName: { in: dto.agentNames } },
      });
      await tx.agentMapping.createMany({
        data: dto.agentNames.map((name) => ({ agentName: name, userId: dto.userId })),
      });
    });

    return this.getAgentMappings();
  }

  /**
   * Get active users for mapping targets
   */
  async getUsersForMapping() {
    return this.prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        roles: {
          some: {
            role: {
              permissions: { array_contains: ['insurance:agent_view'] },
            },
          },
        },
      },
      select: { id: true, email: true, username: true },
      orderBy: { username: 'asc' },
    });
  }

  /**
   * Get expiries filtered by agent (for per-agent page)
   */
  async getExpiriesByAgent(userId: string, filters: ExpiryFilterDto): Promise<ExpiryListResponse> {
    const mappings = await this.prisma.agentMapping.findMany({
      where: { userId },
      select: { agentName: true },
    });

    if (mappings.length === 0) {
      return { data: [], total: 0, page: 1, totalPages: 1 };
    }

    const agentNames = mappings.map((m) => m.agentName);
    const currentYear = new Date().getFullYear();
    const cutoffYear = currentYear - 2;
    const page = Math.max(1, parseInt(filters.page || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(filters.limit || '20', 10) || 20));
    const offset = (page - 1) * limit;
    const status = filters.status || 'all';
    const search = filters.search?.trim() || '';
    const company = filters.company?.trim() || '';
    const agentName = filters.agentName?.trim() || '';
    const registrationNumber = filters.registrationNumber?.trim() || '';
    const policyNumber = filters.policyNumber?.trim() || '';
    const ownerName = filters.ownerName?.trim() || '';

    const conditions: Prisma.Sql[] = [];

    if (status && status !== 'all') {
      conditions.push(Prisma.sql`AND lp.status = ${status}`);
    }

    if (search) {
      const searchPattern = `%${search.toLowerCase()}%`;
      conditions.push(
        Prisma.sql`AND (LOWER(lp."registrationNumber") LIKE ${searchPattern} OR LOWER(lp."ownerName") LIKE ${searchPattern})`,
      );
    }

    if (company) {
      const companyPattern = `%${company.toLowerCase()}%`;
      conditions.push(Prisma.sql`AND LOWER(lp.company) LIKE ${companyPattern}`);
    }

    if (agentName) {
      const agentPattern = `%${agentName.toLowerCase()}%`;
      conditions.push(Prisma.sql`AND LOWER(lp.agent) LIKE ${agentPattern}`);
    }

    if (filters.agentNames) {
      const list = filters.agentNames
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      if (list.length > 0) {
        conditions.push(Prisma.sql`AND LOWER(lp.agent) IN (${Prisma.join(list)})`);
      } else {
        conditions.push(Prisma.sql`AND FALSE`);
      }
    }

    if (registrationNumber) {
      const regPattern = `%${registrationNumber.toLowerCase()}%`;
      conditions.push(Prisma.sql`AND LOWER(lp."registrationNumber") LIKE ${regPattern}`);
    }

    if (policyNumber) {
      const policyPattern = `%${policyNumber.toLowerCase()}%`;
      conditions.push(Prisma.sql`AND LOWER(lp."policyNumber") LIKE ${policyPattern}`);
    }

    if (ownerName) {
      const ownerPattern = `%${ownerName.toLowerCase()}%`;
      conditions.push(Prisma.sql`AND LOWER(lp."ownerName") LIKE ${ownerPattern}`);
    }

    const whereClause = conditions.length > 0
      ? Prisma.sql`${Prisma.join(conditions, ' ')}`
      : Prisma.sql``;

    const agentFilter = Prisma.sql`AND TRIM(ip.agent) IN (${Prisma.join(agentNames)})`;

    const rows = await this.prisma.$queryRaw<Array<{
      registrationNumber: string;
      ownerName: string | null;
      policyNumber: string | null;
      company: string | null;
      startDate: Date | null;
      expiryDate: Date | null;
      agent: string | null;
      status: string;
      vehicleId: string | null;
      spanDays: number | null;
      installmentPos: bigint | null;
      installmentTotal: bigint | null;
    }>>(Prisma.sql`
      WITH all_ranked AS (
        SELECT
          ip."registrationNumber",
          ip."policyNumber",
          ip."startDate",
          ip."expiryDate",
          CASE
            WHEN ip."policyNumber" IS NOT NULL AND ip."startDate" IS NOT NULL
            THEN ROW_NUMBER() OVER (PARTITION BY ip."policyNumber" ORDER BY ip."startDate")
            ELSE NULL
          END AS "installmentPos",
          CASE
            WHEN ip."policyNumber" IS NOT NULL
            THEN COUNT(*) OVER (PARTITION BY ip."policyNumber")
            ELSE NULL
          END AS "installmentTotal"
        FROM insurance_policies ip
        INNER JOIN insurance_spreadsheets isp ON isp.id = ip."spreadsheetConfigId"
        WHERE isp.year >= ${cutoffYear}
      ),
      latest_policies AS (
        SELECT DISTINCT ON (ip."registrationNumber")
          ip."registrationNumber",
          ip."ownerName",
          ip."policyNumber",
          ip.company,
          ip."startDate",
          ip."expiryDate",
          ip.agent,
          CASE
            WHEN ip."expiryDate" IS NULL THEN 'unknown'
            WHEN ip."expiryDate" >= CURRENT_DATE - INTERVAL '15 days' AND ip."expiryDate" < CURRENT_DATE THEN 'recently_expired'
            WHEN ip."expiryDate" < CURRENT_DATE THEN 'expired'
            WHEN ip."expiryDate" <= CURRENT_DATE + INTERVAL '7 days' THEN 'expiring_soon'
            ELSE 'active'
          END AS status,
          CASE
            WHEN ip."startDate" IS NOT NULL AND ip."expiryDate" IS NOT NULL
            THEN (ip."expiryDate"::date - ip."startDate"::date)
            ELSE NULL
          END AS "spanDays"
        FROM insurance_policies ip
        INNER JOIN insurance_spreadsheets isp ON isp.id = ip."spreadsheetConfigId"
        WHERE isp.year >= ${cutoffYear} ${agentFilter}
        ORDER BY ip."registrationNumber", ip."expiryDate" DESC NULLS LAST, ip."createdAt" DESC
      )
      SELECT
        lp.*,
        v.id AS "vehicleId",
        ar."installmentPos",
        ar."installmentTotal"
      FROM latest_policies lp
      LEFT JOIN vehicles v ON LOWER(v."registrationNumber") = LOWER(lp."registrationNumber")
      LEFT JOIN all_ranked ar
        ON LOWER(TRIM(ar."registrationNumber")) = LOWER(TRIM(lp."registrationNumber"))
        AND ar."policyNumber" IS NOT DISTINCT FROM lp."policyNumber"
        AND ar."startDate" IS NOT DISTINCT FROM lp."startDate"
        AND ar."expiryDate" IS NOT DISTINCT FROM lp."expiryDate"
      WHERE 1=1 ${whereClause}
      ORDER BY lp."expiryDate" ASC NULLS LAST
      LIMIT ${limit} OFFSET ${offset}
    `);

    const countResult = await this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      WITH latest_policies AS (
        SELECT DISTINCT ON (ip."registrationNumber")
          ip."registrationNumber",
          ip."ownerName",
          ip."policyNumber",
          ip.company,
          ip.agent,
          ip."expiryDate",
          CASE
            WHEN ip."expiryDate" IS NULL THEN 'unknown'
            WHEN ip."expiryDate" >= CURRENT_DATE - INTERVAL '15 days' AND ip."expiryDate" < CURRENT_DATE THEN 'recently_expired'
            WHEN ip."expiryDate" < CURRENT_DATE THEN 'expired'
            WHEN ip."expiryDate" <= CURRENT_DATE + INTERVAL '7 days' THEN 'expiring_soon'
            ELSE 'active'
          END AS status
        FROM insurance_policies ip
        INNER JOIN insurance_spreadsheets isp ON isp.id = ip."spreadsheetConfigId"
        WHERE isp.year >= ${cutoffYear} ${agentFilter}
        ORDER BY ip."registrationNumber", ip."expiryDate" DESC NULLS LAST, ip."createdAt" DESC
      )
      SELECT COUNT(*) as count
      FROM latest_policies lp
      WHERE 1=1 ${whereClause}
    `);

    const total = Number(countResult[0]?.count ?? 0);

    return {
      data: rows.map((row) => ({
        registrationNumber: row.registrationNumber,
        ownerName: row.ownerName,
        policyNumber: row.policyNumber,
        company: row.company,
        startDate: row.startDate,
        expiryDate: row.expiryDate,
        agent: row.agent,
        status: row.status as ExpiryStatusType,
        vehicleId: row.vehicleId,
        installmentHint: buildInstallmentHint(row.installmentPos, row.installmentTotal, row.spanDays),
        gtp: null as VehicleDocumentSnapshot | null,
        vignette: null as VehicleDocumentSnapshot | null,
      })),
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Get stats filtered by agent
   */
  async getExpiryStatsByAgent(userId: string): Promise<ExpiryStats> {
    const mappings = await this.prisma.agentMapping.findMany({
      where: { userId },
      select: { agentName: true },
    });

    if (mappings.length === 0) {
      return { total: 0, expired: 0, recentlyExpired: 0, expiringSoon: 0, active: 0, unknown: 0 };
    }

    const agentNames = mappings.map((m) => m.agentName);
    const currentYear = new Date().getFullYear();
    const cutoffYear = currentYear - 2;

    const agentFilter = Prisma.sql`AND TRIM(ip.agent) IN (${Prisma.join(agentNames)})`;

    const result = await this.prisma.$queryRaw<Array<{
      total: bigint;
      expired: bigint;
      recently_expired: bigint;
      expiring_soon: bigint;
      active: bigint;
      unknown: bigint;
    }>>(Prisma.sql`
      WITH latest_policies AS (
        SELECT DISTINCT ON (ip."registrationNumber")
          ip."registrationNumber",
          ip."expiryDate",
          CASE
            WHEN ip."expiryDate" IS NULL THEN 'unknown'
            WHEN ip."expiryDate" >= CURRENT_DATE - INTERVAL '15 days' AND ip."expiryDate" < CURRENT_DATE THEN 'recently_expired'
            WHEN ip."expiryDate" < CURRENT_DATE THEN 'expired'
            WHEN ip."expiryDate" <= CURRENT_DATE + INTERVAL '7 days' THEN 'expiring_soon'
            ELSE 'active'
          END AS status
        FROM insurance_policies ip
        INNER JOIN insurance_spreadsheets isp ON isp.id = ip."spreadsheetConfigId"
        WHERE isp.year >= ${cutoffYear} ${agentFilter}
        ORDER BY ip."registrationNumber", ip."expiryDate" DESC NULLS LAST, ip."createdAt" DESC
      )
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'expired') AS expired,
        COUNT(*) FILTER (WHERE status = 'recently_expired') AS recently_expired,
        COUNT(*) FILTER (WHERE status = 'expiring_soon') AS expiring_soon,
        COUNT(*) FILTER (WHERE status = 'active') AS active,
        COUNT(*) FILTER (WHERE status = 'unknown') AS unknown
      FROM latest_policies
    `);

    const row = result[0];
    return {
      total: Number(row?.total ?? 0),
      expired: Number(row?.expired ?? 0),
      recentlyExpired: Number(row?.recently_expired ?? 0),
      expiringSoon: Number(row?.expiring_soon ?? 0),
      active: Number(row?.active ?? 0),
      unknown: Number(row?.unknown ?? 0),
    };
  }

  /**
   * Extract Google Sheets ID from URL or return as-is
   * Supports: full URL or just the ID string
   */
  private extractSpreadsheetId(input: string): string {
    const trimmed = input.trim();

    // Try to extract from URL
    const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (urlMatch) return urlMatch[1];

    // Check if it looks like a valid spreadsheet ID (alphanumeric + hyphens/underscores)
    if (/^[a-zA-Z0-9-_]+$/.test(trimmed) && trimmed.length > 10) {
      return trimmed;
    }

    throw new BadRequestException('Невалиден Spreadsheet ID или URL');
  }
}
