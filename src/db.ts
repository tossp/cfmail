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
  let listSql = `SELECT id, message_id, from_address, from_name, to_address, subject, received_at, raw_size, has_attachments
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
