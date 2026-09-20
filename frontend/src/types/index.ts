export interface User {
  id: string;
  googleId: string;
  email: string;
  name: string | null;
  avatar: string | null;
}

export interface Sender {
  id: string;
  email: string;
  createdAt: string;
}

export interface Campaign {
  id: string;
  name: string;
  userId: string;
}

export type EmailStatus = 'SCHEDULED' | 'PROCESSING' | 'SENT' | 'FAILED';

export interface EmailAttachment {
  filename: string;
  size?: string;
  url?: string;
  previewUrl?: string;
  contentType?: string;
  data?: string;
}

export interface Email {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt?: string | null;
  messageId?: string | null;
  error?: string | null;
  campaignId?: string;
  senderId?: string;
  campaign?: Campaign;
  sender?: Sender;
  attachments?: EmailAttachment[];
  createdAt: string;
  updatedAt: string;
}

export interface EmailCounts {
  scheduled: number;
  sent: number;
}

export interface ListEmailsResponse {
  success: boolean;
  data: Email[];
  counts: EmailCounts;
  page: number;
  limit: number;
  total: number;
}

export interface SlackStatus {
  connected: boolean;
  teamName?: string;
  channel?: string;
  configuredAt?: string;
}

export interface SchedulePayload {
  recipient: string;
  subject: string;
  body: string;
  scheduledAt: string;
  senderId?: string;
  campaignId?: string;
  attachments?: EmailAttachment[];
}

export interface BatchSchedulePayload {
  emails: {
    recipient: string;
    subject: string;
    body: string;
    scheduledAt: string;
    senderId?: string;
    campaignId?: string;
    attachments?: EmailAttachment[];
  }[];
}
