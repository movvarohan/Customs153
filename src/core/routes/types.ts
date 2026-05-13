// Hono type variables — every request handler can read the AppContext that the
// entry point injected via middleware. Routes do not import Node or Cloudflare
// types; the entry point picks the runtime.

import type { AppContext } from "@/core/app-context";

export type HonoEnv = { Variables: { ctx: AppContext } };
