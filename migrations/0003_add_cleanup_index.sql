CREATE INDEX IF NOT EXISTS idx_emails_read_received ON emails (read_at, received_at);
