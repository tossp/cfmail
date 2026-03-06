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
import { sendWebhook } from "./webhook";

const DEFAULT_MAX_EMAIL_SIZE = 25 * 1024 * 1024; // 25MB
const DEFAULT_MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10MB

export async function handleEmail(
  message: ForwardableEmailMessage,
  env: Env,
): Promise<void> {
  if (isBlacklisted(message.from, env)) {
    message.setReject("Sender is blacklisted");
    return;
  }

  const junk = checkJunkMail(message.headers);
  if (junk.isJunk) {
    message.setReject(junk.reason ?? "Junk mail rejected");
    return;
  }

  const rawArrayBuffer = await streamToArrayBuffer(message.raw);

  const maxEmailSize = parseSize(env.MAX_EMAIL_SIZE) || DEFAULT_MAX_EMAIL_SIZE;
  if (rawArrayBuffer.byteLength > maxEmailSize) {
    message.setReject("Message too large");
    return;
  }

  const parsed = await PostalMime.parse(rawArrayBuffer);

  const emailId = uuidv7();
  const now = new Date().toISOString();

  const maxAttSize = parseSize(env.MAX_ATTACHMENT_SIZE) || DEFAULT_MAX_ATTACHMENT_SIZE;
  const validAttachments = (parsed.attachments ?? []).filter((att) => {
    if (!(att.content instanceof ArrayBuffer)) return false;
    if (att.content.byteLength > maxAttSize) {
      console.log(
        `Stripped attachment "${att.filename}" (${att.content.byteLength} bytes > ${maxAttSize})`,
      );
      return false;
    }
    return true;
  });

  const attachmentRecords: AttachmentRecord[] = validAttachments.map((att) => {
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

  const emailRecord: EmailRecord = {
    id: emailId,
    message_id: parsed.messageId ?? null,
    from_address: message.from,
    from_name: parsed.from?.name ?? null,
    to_address: message.to,
    subject: parsed.subject ?? null,
    text: parsed.text ?? null,
    html: parsed.html ?? null,
    received_at: now,
    raw_size: rawArrayBuffer.byteLength,
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
    console.error("R2 upload failed, rolling back:", err);
    await deleteEmail(env.DB, emailId).catch(() => {});
    const r2Keys = [
      emailRecord.r2_key,
      ...attachmentRecords.map((a) => a.r2_key),
    ];
    await deleteObjects(env.BUCKET, r2Keys).catch(() => {});
    throw err;
  }

  await sendWebhook(env, emailRecord).catch((err) =>
    console.error("Webhook error:", err),
  );
}

function parseSize(value: string | undefined): number {
  if (!value) return 0;
  const num = parseInt(value, 10);
  return isNaN(num) ? 0 : num;
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
