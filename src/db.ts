import type {
  EmailRecord,
  EmailListItem,
  AttachmentRecord,
  EmailDetail,
  PaginatedResponse,
} from "./types";

export async function insertEmail(
  db: D1Database,
  email: EmailRecord,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO emails (id, message_id, from_address, from_name, to_address, subject, text, html, received_at, raw_size, has_attachments, r2_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      email.id,
      email.message_id,
      email.from_address,
      email.from_name,
      email.to_address,
      email.subject,
      email.text,
      email.html,
      email.received_at,
      email.raw_size,
      email.has_attachments,
      email.r2_key,
    )
    .run();
}

export async function insertAttachments(
  db: D1Database,
  attachments: AttachmentRecord[],
): Promise<void> {
  if (attachments.length === 0) return;

  const stmt = db.prepare(
    `INSERT INTO attachments (id, email_id, filename, content_type, size, r2_key)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  await db.batch(
    attachments.map((a) =>
      stmt.bind(a.id, a.email_id, a.filename, a.content_type, a.size, a.r2_key),
    ),
  );
}

export async function listEmails(
  db: D1Database,
  page: number,
  size: number,
  toFilter?: string,
): Promise<PaginatedResponse<EmailListItem>> {
  const offset = (page - 1) * size;

  let countSql = "SELECT COUNT(*) as total FROM emails";
  let listSql = `SELECT id, message_id, from_address, from_name, to_address, subject, received_at, raw_size, has_attachments, read_at
                  FROM emails`;

  const bindings: unknown[] = [];

  if (toFilter) {
    const where = " WHERE to_address = ?";
    countSql += where;
    listSql += where;
    bindings.push(toFilter);
  }

  listSql += " ORDER BY id DESC LIMIT ? OFFSET ?";

  const [countResult, listResult] = await db.batch([
    db.prepare(countSql).bind(...bindings),
    db.prepare(listSql).bind(...bindings, size, offset),
  ]);

  const total = (countResult.results[0] as Record<string, number>).total;

  return {
    data: listResult.results as EmailListItem[],
    total,
    page,
    size,
  };
}

export async function getEmailById(
  db: D1Database,
  id: string,
): Promise<EmailDetail | null> {
  const email = await db
    .prepare("SELECT * FROM emails WHERE id = ?")
    .bind(id)
    .first<EmailRecord>();

  if (!email) return null;

  const { results: attachments } = await db
    .prepare("SELECT * FROM attachments WHERE email_id = ?")
    .bind(id)
    .all<AttachmentRecord>();

  return { ...email, attachments };
}

export async function deleteEmail(
  db: D1Database,
  id: string,
): Promise<{ r2Keys: string[] } | null> {
  const email = await db
    .prepare("SELECT r2_key FROM emails WHERE id = ?")
    .bind(id)
    .first<Pick<EmailRecord, "r2_key">>();

  if (!email) return null;

  const { results: attachments } = await db
    .prepare("SELECT r2_key FROM attachments WHERE email_id = ?")
    .bind(id)
    .all<Pick<AttachmentRecord, "r2_key">>();

  await db.batch([
    db.prepare("DELETE FROM attachments WHERE email_id = ?").bind(id),
    db.prepare("DELETE FROM emails WHERE id = ?").bind(id),
  ]);

  return {
    r2Keys: [email.r2_key, ...attachments.map((a) => a.r2_key)],
  };
}

export async function getAttachment(
  db: D1Database,
  emailId: string,
  attachmentId: string,
): Promise<AttachmentRecord | null> {
  return db
    .prepare("SELECT * FROM attachments WHERE id = ? AND email_id = ?")
    .bind(attachmentId, emailId)
    .first<AttachmentRecord>();
}

export async function markAsRead(
  db: D1Database,
  id: string,
): Promise<boolean> {
  const result = await db
    .prepare("UPDATE emails SET read_at = ? WHERE id = ? AND read_at IS NULL")
    .bind(new Date().toISOString(), id)
    .run();
  return result.meta.changes > 0;
}

const CLEANUP_BATCH_SIZE = 100;

export interface CleanupBatch {
  emailIds: string[];
  r2Keys: string[];
}

export async function getExpiredBatch(
  db: D1Database,
  unreadCutoff: string,
  readCutoff: string,
): Promise<CleanupBatch | null> {
  const { results: emails } = await db
    .prepare(
      `SELECT id, r2_key FROM emails
       WHERE (read_at IS NULL AND received_at < ?)
          OR (read_at IS NOT NULL AND received_at < ?)
       LIMIT ?`,
    )
    .bind(unreadCutoff, readCutoff, CLEANUP_BATCH_SIZE)
    .all<Pick<EmailRecord, "id" | "r2_key">>();

  if (emails.length === 0) return null;

  const emailIds = emails.map((e) => e.id);
  const placeholders = emailIds.map(() => "?").join(",");

  const { results: attachments } = await db
    .prepare(
      `SELECT r2_key FROM attachments WHERE email_id IN (${placeholders})`,
    )
    .bind(...emailIds)
    .all<Pick<AttachmentRecord, "r2_key">>();

  return {
    emailIds,
    r2Keys: [
      ...emails.map((e) => e.r2_key),
      ...attachments.map((a) => a.r2_key),
    ],
  };
}

export async function deleteEmailsByIds(
  db: D1Database,
  emailIds: string[],
): Promise<void> {
  const placeholders = emailIds.map(() => "?").join(",");
  await db.batch([
    db
      .prepare(`DELETE FROM attachments WHERE email_id IN (${placeholders})`)
      .bind(...emailIds),
    db
      .prepare(`DELETE FROM emails WHERE id IN (${placeholders})`)
      .bind(...emailIds),
  ]);
}
