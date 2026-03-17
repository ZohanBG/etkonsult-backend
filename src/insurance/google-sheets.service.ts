import { Injectable, Logger } from '@nestjs/common';
import { google, type sheets_v4 } from 'googleapis';

export interface SheetRow {
  policyNumber: string | null;
  company: string | null;
  ownerName: string | null;
  registrationNumber: string;
  startDate: Date | null;
  agent: string | null;
  expiryDate: Date | null;
}

export interface SheetValidation {
  title: string;
  sheetNames: string[];
}

@Injectable()
export class GoogleSheetsService {
  private readonly logger = new Logger(GoogleSheetsService.name);
  private sheets: sheets_v4.Sheets | null = null;

  private getClient(): sheets_v4.Sheets {
    if (this.sheets) return this.sheets;

    const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
    const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;

    if (!clientEmail || !privateKey) {
      throw new Error('Google Sheets credentials not configured (GOOGLE_SHEETS_CLIENT_EMAIL, GOOGLE_SHEETS_PRIVATE_KEY)');
    }

    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    this.sheets = google.sheets({ version: 'v4', auth });
    return this.sheets;
  }

  /**
   * Validate a spreadsheet ID — returns title + sheet/tab names
   */
  async validateSpreadsheet(spreadsheetId: string): Promise<SheetValidation> {
    const client = this.getClient();
    const response = await client.spreadsheets.get({
      spreadsheetId,
      fields: 'properties.title,sheets.properties.title',
    });

    const title = response.data.properties?.title || 'Без име';
    const sheetNames = (response.data.sheets || [])
      .map(s => s.properties?.title || '')
      .filter(Boolean);

    return { title, sheetNames };
  }

  /**
   * Get available sheet/tab names for a spreadsheet
   */
  async getAvailableSheets(spreadsheetId: string): Promise<string[]> {
    const validation = await this.validateSpreadsheet(spreadsheetId);
    return validation.sheetNames;
  }

  /**
   * Fetch data from a single sheet tab
   */
  async getSheetData(spreadsheetId: string, sheetName: string): Promise<SheetRow[]> {
    const client = this.getClient();

    const response = await client.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A:J`,
    });

    const rows = response.data.values;
    if (!rows || rows.length <= 1) return []; // empty or header-only

    // Skip header row (index 0)
    const dataRows = rows.slice(1);
    const parsed: SheetRow[] = [];

    for (const row of dataRows) {
      // Column mapping: A=0(skip), B=1(polica), C=2(company), D=3(name),
      // E=4(regNumber), F=5(date), G=6(agent), H=7(skip), I=8(skip),
      // J=9(expiryDate)
      const regNumber = this.cleanString(row[4]);
      if (!regNumber) continue; // skip rows without reg number

      parsed.push({
        policyNumber: this.cleanString(row[1]),
        company: this.cleanString(row[2]),
        ownerName: this.cleanString(row[3]),
        registrationNumber: regNumber,
        startDate: this.parseDate(row[5]),
        agent: this.cleanNonDateString(row[6]),
        expiryDate: this.parseDate(row[9]),
      });
    }

    return parsed;
  }

  /**
   * Fetch all tabs from a spreadsheet in parallel
   */
  async getAllSheetData(spreadsheetId: string): Promise<Map<string, SheetRow[]>> {
    // Fetch all available tabs — no hardcoded names
    const tabsToFetch = await this.getAvailableSheets(spreadsheetId);

    this.logger.log(`Fetching ${tabsToFetch.length} tabs from spreadsheet ${spreadsheetId}`);

    const results = new Map<string, SheetRow[]>();

    // Fetch tabs in batches of 3 to avoid rate limiting
    for (let i = 0; i < tabsToFetch.length; i += 3) {
      const batch = tabsToFetch.slice(i, i + 3);
      const batchResults = await Promise.all(
        batch.map(async (tab) => {
          try {
            const data = await this.getSheetData(spreadsheetId, tab);
            return { tab, data };
          } catch (error) {
            this.logger.warn(`Failed to fetch tab ${tab}: ${error}`);
            return { tab, data: [] as SheetRow[] };
          }
        }),
      );

      for (const { tab, data } of batchResults) {
        results.set(tab, data);
      }
    }

    return results;
  }

  private cleanString(value: unknown): string | null {
    if (value === undefined || value === null || value === '') return null;
    return String(value).trim();
  }

  /**
   * Clean a string value and reject date-like patterns.
   * Used for agent names where dates sometimes leak from misaligned columns.
   */
  private cleanNonDateString(value: unknown): string | null {
    const str = this.cleanString(value);
    if (!str) return null;
    // Reject values that look like dates, numbers, or prices leaking from other columns
    if (/^\d{1,2}[.\/,]\d{1,2}[.\/,]\d{2,4}$/.test(str)) return null; // dates: 1/1/2025, 1.1.2025, 31,12,2026
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(str)) return null;             // ISO dates: 2025-01-01
    if (/^\d+$/.test(str)) return null;                                 // pure numbers: 0, 5, 33
    if (/^\d+\.\d+$/.test(str)) return null;                           // decimal numbers: 7.33, 10.51
    return str;
  }

  private parseDate(value: unknown): Date | null {
    if (!value) return null;
    const str = String(value).trim();
    if (!str) return null;

    // Try DD.MM.YYYY format
    const dotMatch = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (dotMatch) {
      const [, day, month, year] = dotMatch;
      const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      if (!isNaN(date.getTime())) return date;
    }

    // Try DD/MM/YYYY format
    const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
      const [, day, month, year] = slashMatch;
      const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      if (!isNaN(date.getTime())) return date;
    }

    return null;
  }

}
