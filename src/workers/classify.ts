// TODO(CLAUDE.md §2 "HTS classification agent"):
//   Synchronous classification endpoint for a single line item — used by broker UI
//   for re-classification on demand. Bulk classification goes through CLASSIFICATION_QUEUE.

import { Hono } from "hono";
import type { Env } from "@/types/env";

export const classifyRoute = new Hono<{ Bindings: Env }>();

classifyRoute.post("/line-item", (c) => c.json({ error: "not implemented" }, 501));
