import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter;
  private readonly from: string;

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.getOrThrow<string>('SMTP_HOST');
    const port = this.configService.getOrThrow<number>('SMTP_PORT');
    const user = this.configService.getOrThrow<string>('SMTP_USER');
    const pass = this.configService.getOrThrow<string>('SMTP_PASS');

    this.from = this.configService.getOrThrow<string>('MAIL_FROM');

    this.transporter = nodemailer.createTransport({
      host,
      port: Number(port),
      secure: Number(port) === 465,
      auth: { user, pass },
    });
  }

  async sendVerificationOtp(
    email: string,
    name: string,
    otp: string,
  ): Promise<void> {
    const safeName = this.escapeHtml(name);

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: email,
        subject: 'Verify your Acendra account',
        text: [
          `Hello ${name},`,
          '',
          `Your Acendra email verification code is: ${otp}`,
          '',
          'This code expires in 5 minutes.',
          'If you did not request this, you can ignore this email.',
        ].join('\n'),
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 520px; margin: auto;">
            <h2>Verify your Acendra account</h2>
            <p>Hello ${safeName},</p>
            <p>Use the following code to verify your email address:</p>
            <div style="font-size: 30px; font-weight: bold; letter-spacing: 8px;">
              ${otp}
            </div>
            <p>This code expires in <strong>5 minutes</strong>.</p>
            <p>If you did not request this, you can ignore this email.</p>
          </div>
        `,
      });
    } catch (error) {
      // Do not log the OTP, SMTP credentials, or message contents.
      this.logger.error(
        `Unable to send verification email to ${this.maskEmail(email)}`,
      );

      throw new ServiceUnavailableException(
        'Unable to send the verification email right now. Please try again later.',
      );
    }
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => {
      const entities: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      };

      return entities[character];
    });
  }

  private maskEmail(email: string): string {
    const [localPart, domain] = email.split('@');

    if (!localPart || !domain) {
      return '[invalid-email]';
    }

    return `${localPart.slice(0, 2)}***@${domain}`;
  }
}