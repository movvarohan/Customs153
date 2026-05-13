// TODO(CLAUDE.md §1 "Document ingestion"):
//   Email-in webhook for importers who forward shipping docs via email.
//   Future: carrier integrations, broker filing callbacks.

import { Hono } from "hono";
import type { HonoEnv } from "./types";

export const webhooksRoute = new Hono<HonoEnv>();

webhooksRoute.post("/email-in", (c) => c.json({ error: "not implemented" }, 501));
