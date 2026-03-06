import type { Env } from "./types";
import { handleEmail } from "./email-handler";
import app from "./api";
import { cleanupExpiredEmails } from "./db";
import { deleteObjects } from "./storage";

const DEFAULT_RETENTION_DAYS_UNREAD = 7;
const DEFAULT_RETENTION_DAYS_READ = 3;

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
        const r2Keys = await cleanupExpiredEmails(env.DB, unreadCutoff, readCutoff);
        if (r2Keys.length > 0) {
          await deleteObjects(env.BUCKET, r2Keys);
        }
        console.log(
          `Cleanup: removed ${r2Keys.length} objects (unread>${unreadDays}d, read>${readDays}d)`,
        );
      })(),
    );
  },
};
