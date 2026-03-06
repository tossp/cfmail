export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  AUTH_TOKEN: string;
  RETENTION_DAYS_UNREAD: string;
  RETENTION_DAYS_READ: string;
  SENDER_BLACKLIST: string;
  MAX_ATTACHMENT_SIZE: string;
  MAX_EMAIL_SIZE: string;
  WEBHOOK_URL: string;
  WEBHOOK_SECRET: string;
}

export interface EmailRecord {
  id: string;
  message_id: string | null;
  from_address: string;
  from_name: string | null;
  to_address: string;
  subject: string | null;
  text: string | null;
  html: string | null;
  received_at: string;
  raw_size: number;
  has_attachments: number;
  read_at: string | null;
  r2_key: string;
}

export interface AttachmentRecord {
  id: string;
  email_id: string;
  filename: string | null;
  content_type: string | null;
  size: number;
  r2_key: string;
}

export interface EmailListItem {
  id: string;
  message_id: string | null;
  from_address: string;
  from_name: string | null;
  to_address: string;
  subject: string | null;
  received_at: string;
  raw_size: number;
  has_attachments: number;
  read_at: string | null;
}

export interface EmailDetail extends EmailRecord {
  attachments: AttachmentRecord[];
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  size: number;
}
