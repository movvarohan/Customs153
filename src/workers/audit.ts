// TODO(CLAUDE.md §7 "Duty refund / PSC finder — HERO FEATURE"):
//   Accepts an importer's historical entries (ACE export or broker handoff),
//   reclassifies each line, and returns a savings report.

import { Hono } from "hono";
import type { Env } from "@/types/env";

export const auditRoute = new Hono<{ Bindings: Env }>();

auditRoute.post("/historical-entries", (c) => c.json({ error: "not implemented" }, 501));
auditRoute.get("/report/:auditId", (c) => c.json({ error: "not implemented" }, 501));
