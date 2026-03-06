import type { Env } from "./types";
import { handleEmail } from "./email-handler";
import app from "./api";
import { getExpiredBatch, deleteEmailsByIds } from "./db";
import { deleteObjects } from "./storage";
import { log } from "./log";

const DEFAULT_RETENTION_DAYS_UNREAD = 30;
const DEFAULT_RETENTION_DAYS_READ = 3;
const R2_DELETE_RETRIES = 2;

export default {
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleEmail(message, env));
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx);
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const unreadDays = parseInt(env.RETENTION_DAYS_UNREAD, 10) || DEFAULT_RETENTION_DAYS_UNREAD;
    const readDays = parseInt(env.RETENTION_DAYS_READ, 10) || DEFAULT_RETENTION_DAYS_READ;
    const now = Date.now();
    const unreadCutoff = new Date(now - unreadDays * 86400_000).toISOString();
    const readCutoff = new Date(now - readDays * 86400_000).toISOString();

    ctx.waitUntil(
      (async () => {
        let totalDeleted = 0;

        while (true) {
          const batch = await getExpiredBatch(env.DB, unreadCutoff, readCutoff);
          if (!batch) break;

          if (batch.r2Keys.length > 0) {
            await deleteR2WithRetry(env.BUCKET, batch.r2Keys);
          }

          await deleteEmailsByIds(env.DB, batch.emailIds);
          totalDeleted += batch.emailIds.length;
        }

        log.info("cleanup.completed", {
          deleted: totalDeleted,
          unread_cutoff: unreadCutoff,
          read_cutoff: readCutoff,
        });
      })(),
    );
  },
};

async function deleteR2WithRetry(bucket: R2Bucket, keys: string[]): Promise<void> {
  for (let attempt = 0; attempt <= R2_DELETE_RETRIES; attempt++) {
    try {
      await deleteObjects(bucket, keys);
      return;
    } catch (err) {
      if (attempt === R2_DELETE_RETRIES) {
        log.error("cleanup.r2_failed", {
          keys: keys.length,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
      log.warn("cleanup.r2_retry", { attempt: attempt + 1, keys: keys.length });
    }
  }
}
