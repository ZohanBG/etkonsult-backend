import { EmailService } from './email.service';

// Mock nodemailer
jest.mock('nodemailer', () => ({
  createTransport: jest.fn().mockReturnValue({
    sendMail: jest.fn().mockResolvedValue({ messageId: 'test-id' }),
  }),
}));

describe('EmailService', () => {
  let service: EmailService;
  let mockConfig: any;

  beforeEach(() => {
    mockConfig = {
      get: jest.fn((key: string) => {
        const config: Record<string, string> = {
          SMTP_HOST: 'smtp.test.com',
          SMTP_PORT: '587',
          SMTP_SECURE: 'false',
          SMTP_USER: 'user@test.com',
          SMTP_PASS: 'password',
          SMTP_FROM: 'noreply@test.com',
          APP_NAME: 'TestApp',
        };
        return config[key];
      }),
    };
    service = new EmailService(mockConfig);
  });

  describe('sendEmail', () => {
    it('sends email via transporter', async () => {
      await expect(
        service.sendEmail({
          to: 'recipient@test.com',
          subject: 'Test',
          html: '<p>Hello</p>',
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('sendLoginVerificationEmail', () => {
    it('sends verification code email', async () => {
      await expect(
        service.sendLoginVerificationEmail('user@test.com', '123456'),
      ).resolves.not.toThrow();
    });
  });
});
