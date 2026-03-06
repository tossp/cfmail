import { timingSafeEqual } from "node:crypto";

if (!crypto.subtle.timingSafeEqual) {
  (crypto.subtle as Record<string, unknown>).timingSafeEqual = (
    a: ArrayBuffer,
    b: ArrayBuffer,
  ): boolean => {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  };
}
