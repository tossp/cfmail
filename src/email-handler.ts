import PostalMime from "postal-mime";
import { uuidv7 } from "uuidv7";
import type { Env, EmailRecord, AttachmentRecord } from "./types";
import { insertEmail, insertAttachments, deleteEmail } from "./db";
import {
  putRawEmail,
  putAttachment,
  deleteObjects,
  emailRawKey,
  attachmentKey,
} from "./storage";
import { isBlacklisted, checkJunkMail } from "./spam-filter";
import { log } from "./log";

const DEFAULT_MAX_EMAIL_SIZE = 25 * 1024 * 1024; // 25MB
const DEFAULT_MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10MB
const D1_TEXT_MAX_BYTES = 64 * 1024; // 64KB per text/html field in D1

export async function handleEmail(
  message: ForwardableEmailMessage,
  env: Env,
): Promise<EmailRecord | void> {
  const from = message.from;
  const to = message.to;

  if (isBlacklisted(from, env)) {
    log.warn("email.blacklisted", { from, to });
    message.setReject("Sender is blacklisted");
    return;
  }

  const junk = checkJunkMail(message.headers);
  if (junk.isJunk) {
    log.warn("email.junk_rejected", { from, to, reason: junk.reason });
    message.setReject(junk.reason ?? "Junk mail rejected");
    return;
  }

  const rawArrayBuffer = await streamToArrayBuffer(message.raw);
  const rawSize = rawArrayBuffer.byteLength;

  const maxEmailSize = parseSize(env.MAX_EMAIL_SIZE) || DEFAULT_MAX_EMAIL_SIZE;
  if (rawSize > maxEmailSize) {
    log.warn("email.oversized", { from, to, size: rawSize, limit: maxEmailSize });
    message.setReject("Message too large");
    return;
  }

  const emailId = uuidv7();
  const now = new Date().toISOString();

  let parsed: Awaited<ReturnType<typeof PostalMime.parse>> | null = null;
  try {
    parsed = await PostalMime.parse(rawArrayBuffer);
  } catch (err) {
    log.error("email.parse_failed", {
      id: emailId, from, to, size: rawSize,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  let attachmentRecords: AttachmentRecord[] = [];
  let validAttachments: typeof parsed extends null ? never[] : NonNullable<typeof parsed>["attachments"] = [];

  if (parsed) {
    const maxAttSize = parseSize(env.MAX_ATTACHMENT_SIZE) || DEFAULT_MAX_ATTACHMENT_SIZE;
    validAttachments = (parsed.attachments ?? []).filter((att) => {
      if (!(att.content instanceof ArrayBuffer)) return false;
      if (att.content.byteLength > maxAttSize) {
        log.warn("email.attachment_stripped", {
          id: emailId, filename: att.filename,
          size: att.content.byteLength, limit: maxAttSize,
        });
        return false;
      }
      return true;
    });

    attachmentRecords = validAttachments.map((att) => {
      const attId = uuidv7();
      return {
        id: attId,
        email_id: emailId,
        filename: att.filename ?? null,
        content_type: att.mimeType ?? null,
        size: (att.content as ArrayBuffer).byteLength,
        r2_key: attachmentKey(emailId, attId),
      };
    });
  }

  const subjectFromHeaders = !parsed
    ? (message.headers.get("subject") ?? "[Parse failed]")
    : null;

  const emailRecord: EmailRecord = {
    id: emailId,
    message_id: parsed?.messageId ?? message.headers.get("message-id") ?? null,
    from_address: from,
    from_name: parsed?.from?.name ?? null,
    to_address: to,
    subject: parsed?.subject ?? subjectFromHeaders,
    text: truncate(parsed?.text, D1_TEXT_MAX_BYTES),
    html: truncate(parsed?.html, D1_TEXT_MAX_BYTES),
    received_at: now,
    raw_size: rawSize,
    has_attachments: attachmentRecords.length > 0 ? 1 : 0,
    read_at: null,
    r2_key: emailRawKey(emailId),
  };

  await insertEmail(env.DB, emailRecord);
  await insertAttachments(env.DB, attachmentRecords);

  try {
    const uploads: Promise<void>[] = [
      putRawEmail(env.BUCKET, emailId, rawArrayBuffer),
    ];
    for (let i = 0; i < validAttachments.length; i++) {
      const att = validAttachments[i];
      const record = attachmentRecords[i];
      uploads.push(
        putAttachment(
          env.BUCKET,
          emailId,
          record.id,
          new Uint8Array(att.content as ArrayBuffer),
          att.mimeType ?? "application/octet-stream",
        ),
      );
    }
    await Promise.all(uploads);
  } catch (err) {
    log.error("email.r2_upload_failed", {
      id: emailId, error: err instanceof Error ? err.message : String(err),
    });
    await deleteEmail(env.DB, emailId).catch(() => {});
    const r2Keys = [
      emailRecord.r2_key,
      ...attachmentRecords.map((a) => a.r2_key),
    ];
    await deleteObjects(env.BUCKET, r2Keys).catch(() => {});
    throw err;
  }

  log.info("email.stored", {
    id: emailId, from, to, size: rawSize,
    subject: emailRecord.subject,
    attachments: attachmentRecords.length,
    parsed: parsed !== null,
  });

  return emailRecord;
}

function parseSize(value: string | undefined): number {
  if (!value) return 0;
  const num = parseInt(value, 10);
  return isNaN(num) ? 0 : num;
}

function truncate(value: string | undefined | null, maxBytes: number): string | null {
  if (!value) return null;
  const encoder = new TextEncoder();
  const encoded = encoder.encode(value);
  if (encoded.byteLength <= maxBytes) return value;
  const decoder = new TextDecoder();
  return decoder.decode(encoded.slice(0, maxBytes));
}

async function streamToArrayBuffer(stream: ReadableStream): Promise<ArrayBuffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLength += value.byteLength;
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return result.buffer;
}
