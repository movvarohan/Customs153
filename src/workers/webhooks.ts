// TODO(CLAUDE.md §1 "Document ingestion"):
//   Email-in webhook (e.g., SES / Postmark inbound) for importers who forward
//   shipping docs via email. Future: carrier integrations, broker filing callbacks.

import { Hono } from "hono";
import type { Env } from "@/types/env";

export const webhooksRoute = new Hono<{ Bindings: Env }>();

webhooksRoute.post("/email-in", (c) => c.json({ error: "not implemented" }, 501));
