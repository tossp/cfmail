import type { Env } from "./types";
import { handleEmail } from "./email-handler";
import { handleRequest } from "./api";

export default {
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleEmail(message, env));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};
