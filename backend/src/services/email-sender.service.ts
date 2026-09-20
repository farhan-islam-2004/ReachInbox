import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env';

export interface SendEmailOptions {
  from: string;
  to: string;
  subject: string;
  body: string;
  auth?: {
    user: string;
    pass: string;
  };
  attachments?: Array<{
    filename: string;
    content?: string | Buffer;
    data?: string;
    path?: string;
    contentType?: string;
  }>;
}

export interface SendEmailResult {
  messageId: string;
  previewUrl?: string;
}

/**
 * Strips credentials or sensitive connection tokens from SMTP errors.
 */
export const sanitizeSmtpError = (err: unknown): string => {
  if (!err) return 'Unknown SMTP error';
  let message = err instanceof Error ? err.message : String(err);

  if (env.ETHEREAL_PASSWORD) {
    message = message.split(env.ETHEREAL_PASSWORD).join('[REDACTED]');
  }

  return message;
};

export class EmailSenderService {
  private transporters = new Map<string, Transporter>();

  /**
   * Returns a cached reusable Nodemailer transporter keyed by host and username.
   */
  public getTransporter(auth?: { user: string; pass: string }): Transporter {
    const user = auth?.user || process.env.ETHEREAL_USER || env.ETHEREAL_USER;
    const pass = auth?.pass || process.env.ETHEREAL_PASSWORD || env.ETHEREAL_PASSWORD;

    const cacheKey = `${env.ETHEREAL_HOST}:${env.ETHEREAL_PORT}:${user}`;

    let transporter = this.transporters.get(cacheKey);
    if (!transporter) {
      transporter = nodemailer.createTransport({
        host: env.ETHEREAL_HOST,
        port: env.ETHEREAL_PORT,
        secure: env.ETHEREAL_SECURE,
        auth: user && pass ? { user, pass } : undefined,
        tls: {
          rejectUnauthorized: false,
          servername: 'smtp.ethereal.email',
        },
      });

      this.transporters.set(cacheKey, transporter);
    }

    return transporter;
  }

  /**
   * Verifies connection to the SMTP server.
   */
  public async verifyConnection(auth?: { user: string; pass: string }): Promise<boolean> {
    const transporter = this.getTransporter(auth);
    try {
      await transporter.verify();
      return true;
    } catch (error) {
      console.error('[SMTP] Verification error:', sanitizeSmtpError(error));
      return false;
    }
  }

  /**
   * Sends an email through Nodemailer and returns SMTP metadata including messageId.
   */
  public async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    const transporter = this.getTransporter(options.auth);

    const nodemailerAttachments = options.attachments?.map((att) => {
      let content: Buffer | string | undefined = att.content;
      if (!content && att.data) {
        if (att.data.includes('base64,')) {
          content = Buffer.from(att.data.split('base64,')[1], 'base64');
        } else {
          content = Buffer.from(att.data, 'base64');
        }
      }
      return {
        filename: att.filename,
        content,
        path: att.path,
        contentType: att.contentType,
      };
    });

    try {
      const info = await transporter.sendMail({
        from: options.from,
        to: options.to,
        subject: options.subject,
        text: options.body,
        html: options.body.includes('<') && options.body.includes('>') ? options.body : undefined,
        attachments: nodemailerAttachments,
      });

      const previewUrl = nodemailer.getTestMessageUrl(info);

      return {
        messageId: info.messageId,
        previewUrl: previewUrl ? previewUrl.toString() : undefined,
      };
    } catch (error) {
      const sanitized = sanitizeSmtpError(error);
      throw new Error(sanitized);
    }
  }
}

export const emailSenderService = new EmailSenderService();
