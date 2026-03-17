import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { GoogleSheetsService, type SheetRow } from './google-sheets.service.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

interface SnapshotData {
  [sheetMonth: string]: SheetRow[];
}

@Injectable()
export class InsuranceSyncService implements OnModuleInit {
  private readonly logger = new Logger(InsuranceSyncService.name);
  private readonly snapshotsDir = join(process.cwd(), 'data', 'snapshots');

  constructor(
    private readonly prisma: PrismaService,
    private readonly googleSheets: GoogleSheetsService,
  ) {
    // Ensure snapshots directory exists
    if (!existsSync(this.snapshotsDir)) {
      mkdirSync(this.snapshotsDir, { recursive: true });
    }
  }

  async onModuleInit() {
    // On startup, sync all active sheets
    try {
      await this.syncActiveSheets();
    } catch (error) {
      this.logger.error(`Initial sync failed: ${error}`);
    }
  }

  /**
   * Auto-sync active sheets every 5 minutes
   */
  @Interval(300000)
  async handleInterval() {
    try {
      await this.syncActiveSheets();
    } catch (error) {
      this.logger.error(`Scheduled sync failed: ${error}`);
    }
  }

  /**
   * Force sync all active spreadsheets — deletes snapshots to bypass diff and do full replace
   */
  async forceSyncActiveSheets(): Promise<void> {
    const activeSheets = await this.prisma.insuranceSpreadsheet.findMany({
      where: { isArchived: false },
    });

    // Delete all snapshots to force full replace
    for (const sheet of activeSheets) {
      this.deleteSnapshot(sheet.id);
    }

    // Now sync normally — without snapshots it will do full replace
    await this.syncActiveSheets();
  }

  /**
   * Sync all active (non-archived) spreadsheets
   */
  async syncActiveSheets(): Promise<void> {
    const activeSheets = await this.prisma.insuranceSpreadsheet.findMany({
      where: { isArchived: false },
    });

    if (activeSheets.length === 0) {
      this.logger.debug('No active spreadsheets to sync');
      return;
    }

    this.logger.log(`Syncing ${activeSheets.length} active spreadsheet(s)...`);

    for (const sheet of activeSheets) {
      try {
        await this.syncSpreadsheet(sheet.id, sheet.spreadsheetId);
      } catch (error) {
        this.logger.error(`Failed to sync spreadsheet ${sheet.label}: ${error}`);
      }
    }
  }

  /**
   * Sync a single spreadsheet — smart diff with snapshot
   */
  async syncSpreadsheet(configId: string, googleSpreadsheetId: string): Promise<{ action: string; rowCount: number }> {
    // Fetch fresh data from Google
    const freshData = await this.googleSheets.getAllSheetData(googleSpreadsheetId);

    // Convert Map to plain object for comparison
    const freshSnapshot: SnapshotData = {};
    let totalRows = 0;
    for (const [month, rows] of freshData) {
      freshSnapshot[month] = rows;
      totalRows += rows.length;
    }

    // Load previous snapshot from file
    const snapshotPath = this.getSnapshotPath(configId);
    const previousSnapshot = this.loadSnapshot(snapshotPath);

    // Compare snapshots
    const diff = this.compareSnapshots(previousSnapshot, freshSnapshot);

    let action: string;

    if (diff.type === 'no_change') {
      action = 'no_change';
      this.logger.debug(`No changes detected for ${configId}`);
    } else if (diff.type === 'append_only') {
      // Only new rows — insert them
      action = 'append';
      this.logger.log(`Appending ${diff.newRows.length} new rows for ${configId}`);
      await this.insertRows(configId, diff.newRows);

      // Update lastSyncedAt
      await this.prisma.insuranceSpreadsheet.update({
        where: { id: configId },
        data: { lastSyncedAt: new Date() },
      });
    } else {
      // Modified or deleted rows — full wipe & replace
      action = 'full_replace';
      this.logger.log(`Full replace for ${configId}: ${totalRows} rows`);
      await this.fullReplace(configId, freshSnapshot);

      // Update lastSyncedAt
      await this.prisma.insuranceSpreadsheet.update({
        where: { id: configId },
        data: { lastSyncedAt: new Date() },
      });
    }

    // Save new snapshot
    this.saveSnapshot(snapshotPath, freshSnapshot);

    return { action, rowCount: totalRows };
  }

  /**
   * Archive a spreadsheet — full download + save to DB + mark archived
   */
  async archiveSpreadsheet(configId: string): Promise<{ rowCount: number }> {
    const config = await this.prisma.insuranceSpreadsheet.findUniqueOrThrow({
      where: { id: configId },
    });

    // Full download
    const data = await this.googleSheets.getAllSheetData(config.spreadsheetId);
    const snapshot: SnapshotData = {};
    for (const [month, rows] of data) {
      snapshot[month] = rows;
    }

    // Full replace in DB
    const rowCount = await this.fullReplace(configId, snapshot);

    // Mark as archived
    await this.prisma.insuranceSpreadsheet.update({
      where: { id: configId },
      data: { isArchived: true, lastSyncedAt: new Date() },
    });

    // Delete snapshot file (no longer needed for archived)
    this.deleteSnapshot(configId);

    return { rowCount };
  }

  /**
   * Refresh an archived spreadsheet — re-download from Google
   */
  async refreshArchive(configId: string): Promise<{ rowCount: number }> {
    const config = await this.prisma.insuranceSpreadsheet.findUniqueOrThrow({
      where: { id: configId },
    });

    // Full download
    const data = await this.googleSheets.getAllSheetData(config.spreadsheetId);
    const snapshot: SnapshotData = {};
    for (const [month, rows] of data) {
      snapshot[month] = rows;
    }

    // Full replace in DB
    const rowCount = await this.fullReplace(configId, snapshot);

    // Update lastSyncedAt
    await this.prisma.insuranceSpreadsheet.update({
      where: { id: configId },
      data: { lastSyncedAt: new Date() },
    });

    return { rowCount };
  }

  /**
   * Initial sync for a newly added spreadsheet
   */
  async initialSync(configId: string, googleSpreadsheetId: string): Promise<{ rowCount: number }> {
    const data = await this.googleSheets.getAllSheetData(googleSpreadsheetId);
    const snapshot: SnapshotData = {};
    for (const [month, rows] of data) {
      snapshot[month] = rows;
    }

    // Insert all rows
    const rowCount = await this.fullReplace(configId, snapshot);

    // Save snapshot
    const snapshotPath = this.getSnapshotPath(configId);
    this.saveSnapshot(snapshotPath, snapshot);

    // Update lastSyncedAt
    await this.prisma.insuranceSpreadsheet.update({
      where: { id: configId },
      data: { lastSyncedAt: new Date() },
    });

    return { rowCount };
  }

  /**
   * Delete snapshot file for a spreadsheet
   */
  deleteSnapshot(configId: string): void {
    const path = this.getSnapshotPath(configId);
    try {
      if (existsSync(path)) {
        unlinkSync(path);
      }
    } catch (error) {
      this.logger.warn(`Failed to delete snapshot ${path}: ${error}`);
    }
  }

  // ===================== PRIVATE METHODS =====================

  private async fullReplace(configId: string, snapshot: SnapshotData): Promise<number> {
    const allRows: Array<{ month: string; row: SheetRow }> = [];
    for (const [month, rows] of Object.entries(snapshot)) {
      for (const row of rows) {
        allRows.push({ month, row });
      }
    }

    if (allRows.length === 0) {
      await this.prisma.insurancePolicy.deleteMany({
        where: { spreadsheetConfigId: configId },
      });
      return 0;
    }

    // Wrap delete + all inserts in a transaction to prevent data loss
    await this.prisma.$transaction(async (tx) => {
      await tx.insurancePolicy.deleteMany({
        where: { spreadsheetConfigId: configId },
      });

      const BATCH_SIZE = 500;
      for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
        const batch = allRows.slice(i, i + BATCH_SIZE);
        await tx.insurancePolicy.createMany({
          data: batch.map(({ month, row }) => ({
            spreadsheetConfigId: configId,
            sheetMonth: month,
            policyNumber: row.policyNumber,
            company: row.company,
            ownerName: row.ownerName,
            registrationNumber: row.registrationNumber,
            startDate: row.startDate,
            agent: row.agent,
            expiryDate: row.expiryDate,
          })),
        });
      }
    });

    return allRows.length;
  }

  private async insertRows(configId: string, rows: Array<{ month: string; row: SheetRow }>): Promise<void> {
    if (rows.length === 0) return;

    const BATCH_SIZE = 500;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      await this.prisma.insurancePolicy.createMany({
        data: batch.map(({ month, row }) => ({
          spreadsheetConfigId: configId,
          sheetMonth: month,
          policyNumber: row.policyNumber,
          company: row.company,
          ownerName: row.ownerName,
          registrationNumber: row.registrationNumber,
          startDate: row.startDate,
          agent: row.agent,
          expiryDate: row.expiryDate,
        })),
      });
    }
  }

  private compareSnapshots(
    previous: SnapshotData | null,
    current: SnapshotData,
  ): { type: 'no_change' } | { type: 'append_only'; newRows: Array<{ month: string; row: SheetRow }> } | { type: 'modified' } {
    if (!previous) {
      // No previous snapshot — treat as full replace
      return { type: 'modified' };
    }

    const newRows: Array<{ month: string; row: SheetRow }> = [];
    let hasModifications = false;

    // Check each month
    const allMonths = new Set([...Object.keys(previous), ...Object.keys(current)]);

    for (const month of allMonths) {
      const prevRows = previous[month] || [];
      const currRows = current[month] || [];

      if (currRows.length < prevRows.length) {
        // Rows were deleted
        hasModifications = true;
        break;
      }

      // Check if existing rows match
      for (let i = 0; i < prevRows.length; i++) {
        if (!this.rowsEqual(prevRows[i], currRows[i])) {
          hasModifications = true;
          break;
        }
      }

      if (hasModifications) break;

      // Collect new rows (appended at the end)
      if (currRows.length > prevRows.length) {
        for (let i = prevRows.length; i < currRows.length; i++) {
          newRows.push({ month, row: currRows[i] });
        }
      }
    }

    if (hasModifications) {
      return { type: 'modified' };
    }

    if (newRows.length === 0) {
      return { type: 'no_change' };
    }

    return { type: 'append_only', newRows };
  }

  private rowsEqual(a: SheetRow, b: SheetRow): boolean {
    if (!a || !b) return false;
    return (
      a.policyNumber === b.policyNumber &&
      a.company === b.company &&
      a.ownerName === b.ownerName &&
      a.registrationNumber === b.registrationNumber &&
      a.agent === b.agent &&
      this.datesEqual(a.startDate, b.startDate) &&
      this.datesEqual(a.expiryDate, b.expiryDate)
    );
  }

  private datesEqual(a: Date | null, b: Date | null): boolean {
    if (a === null && b === null) return true;
    if (a === null || b === null) return false;
    return a.getTime() === b.getTime();
  }

  private getSnapshotPath(configId: string): string {
    return join(this.snapshotsDir, `${configId}.json`);
  }

  private loadSnapshot(path: string): SnapshotData | null {
    try {
      if (!existsSync(path)) return null;
      const content = readFileSync(path, 'utf-8');
      const data = JSON.parse(content) as SnapshotData;

      // Revive Date objects from JSON strings
      for (const rows of Object.values(data)) {
        for (const row of rows) {
          row.startDate = row.startDate ? new Date(row.startDate) : null;
          row.expiryDate = row.expiryDate ? new Date(row.expiryDate) : null;
        }
      }

      return data;
    } catch (error) {
      this.logger.warn(`Failed to load snapshot ${path}: ${error}`);
      return null;
    }
  }

  private saveSnapshot(path: string, data: SnapshotData): void {
    try {
      writeFileSync(path, JSON.stringify(data), 'utf-8');
    } catch (error) {
      this.logger.error(`Failed to save snapshot ${path}: ${error}`);
    }
  }
}
