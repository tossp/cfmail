export function emailRawKey(emailId: string): string {
  return `emails/${emailId}/raw.eml`;
}

export function attachmentKey(emailId: string, attachmentId: string): string {
  return `emails/${emailId}/attachments/${attachmentId}`;
}

export async function putRawEmail(
  bucket: R2Bucket,
  emailId: string,
  raw: ArrayBuffer,
): Promise<void> {
  await bucket.put(emailRawKey(emailId), raw, {
    httpMetadata: { contentType: "message/rfc822" },
  });
}

export async function putAttachment(
  bucket: R2Bucket,
  emailId: string,
  attachmentId: string,
  data: Uint8Array,
  contentType: string,
): Promise<void> {
  await bucket.put(attachmentKey(emailId, attachmentId), data, {
    httpMetadata: { contentType },
  });
}

export async function getObject(
  bucket: R2Bucket,
  key: string,
): Promise<R2ObjectBody | null> {
  return bucket.get(key);
}

export async function deleteObjects(
  bucket: R2Bucket,
  keys: string[],
): Promise<void> {
  if (keys.length === 0) return;
  await bucket.delete(keys);
}
