CREATE TABLE IF NOT EXISTS emails (
  id TEXT PRIMARY KEY,
  message_id TEXT,
  from_address TEXT NOT NULL,
  from_name TEXT,
  to_address TEXT NOT NULL,
  subject TEXT,
  text TEXT,
  html TEXT,
  received_at TEXT NOT NULL,
  raw_size INTEGER,
  has_attachments INTEGER DEFAULT 0,
  r2_key TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  email_id TEXT NOT NULL,
  filename TEXT,
  content_type TEXT,
  size INTEGER,
  r2_key TEXT NOT NULL,
  FOREIGN KEY (email_id) REFERENCES emails(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_emails_received_at ON emails(received_at);
CREATE INDEX IF NOT EXISTS idx_emails_to_address ON emails(to_address);
CREATE INDEX IF NOT EXISTS idx_attachments_email_id ON attachments(email_id);
