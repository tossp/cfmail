import PostalMime from "postal-mime";
import { uuidv7 } from "uuidv7";
import type { Env, EmailRecord, AttachmentRecord } from "./types";
import { insertEmail, insertAttachments } from "./db";
import { putRawEmail, putAttachment, emailRawKey, attachmentKey } from "./storage";

export async function handleEmail(
  message: ForwardableEmailMessage,
  env: Env,
): Promise<void> {
  const rawStream = message.raw;
  const rawArrayBuffer = await streamToArrayBuffer(rawStream);

  const parsed = await PostalMime.parse(rawArrayBuffer);

  const emailId = uuidv7();
  const now = new Date().toISOString();

  const attachmentRecords: AttachmentRecord[] = (parsed.attachments ?? []).map(
    (att) => {
      const attId = uuidv7();
      return {
        id: attId,
        email_id: emailId,
        filename: att.filename ?? null,
        content_type: att.mimeType ?? null,
        size: att.content instanceof ArrayBuffer ? att.content.byteLength : 0,
        r2_key: attachmentKey(emailId, attId),
      };
    },
  );

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
    r2_key: emailRawKey(emailId),
  };

  await putRawEmail(env.BUCKET, emailId, rawArrayBuffer);

  const rawAttachments = parsed.attachments ?? [];
  for (let i = 0; i < rawAttachments.length; i++) {
    const att = rawAttachments[i];
    const record = attachmentRecords[i];
    if (att.content instanceof ArrayBuffer) {
      await putAttachment(
        env.BUCKET,
        emailId,
        record.id,
        new Uint8Array(att.content),
        att.mimeType ?? "application/octet-stream",
      );
    }
  }

  await insertEmail(env.DB, emailRecord);
  await insertAttachments(env.DB, attachmentRecords);
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
