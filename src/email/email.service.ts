import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

@Injectable()
export class EmailService {
  private transporter: Transporter;
  private fromAddress: string;
  private appName: string;

  constructor(private readonly configService: ConfigService) {
    this.fromAddress = this.configService.get<string>('SMTP_FROM') || 'noreply@mps-system.bg';
    this.appName = this.configService.get<string>('APP_NAME') || 'etkonsult';

    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('SMTP_HOST'),
      port: this.configService.get<number>('SMTP_PORT') || 587,
      secure: this.configService.get<string>('SMTP_SECURE') === 'true',
      auth: {
        user: this.configService.get<string>('SMTP_USER'),
        pass: this.configService.get<string>('SMTP_PASS'),
      },
    });
  }

  async sendEmail(options: EmailOptions): Promise<void> {
    await this.transporter.sendMail({
      from: `"${this.appName}" <${this.fromAddress}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
  }

  async sendLoginVerificationEmail(email: string, code: string): Promise<void> {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { text-align: center; padding: 20px 0; }
          .logo { font-size: 24px; font-weight: bold; color: #2563eb; }
          .content { background: #f9fafb; padding: 30px; border-radius: 8px; }
          .code-box { text-align: center; margin: 24px 0; }
          .code { font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #1e293b; background: #fff; display: inline-block; padding: 16px 32px; border-radius: 8px; border: 2px solid #e2e8f0; }
          .footer { text-align: center; padding: 20px 0; font-size: 12px; color: #666; }
          .warning { font-size: 12px; color: #666; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">${this.appName}</div>
          </div>
          <div class="content">
            <h2>Потвърждение на вход</h2>
            <p>Получихме заявка за вход в акаунта ви. Вашият код за потвърждение е:</p>
            <div class="code-box">
              <div class="code">${code}</div>
            </div>
            <p style="text-align: center; font-size: 14px; color: #64748b;">Въведете този код в приложението, за да завършите входа.</p>
            <p class="warning">Този код е валиден 15 минути. Ако не сте поискали вход, моля игнорирайте този имейл.</p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} ${this.appName}. Всички права запазени.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const text = `
      Потвърждение на вход - ${this.appName}

      Получихме заявка за вход в акаунта ви.

      Вашият код за потвърждение е: ${code}

      Въведете този код в приложението, за да завършите входа.

      Този код е валиден 15 минути.
      Ако не сте поискали вход, моля игнорирайте този имейл.
    `;

    await this.sendEmail({
      to: email,
      subject: `${code} — Код за вход - ${this.appName}`,
      html,
      text,
    });
  }
}
