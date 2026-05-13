// TODO(CLAUDE.md §2 "HTS classification agent"):
//   Synchronous classification endpoint for a single line item. Bulk
//   classification goes through ctx.classificationQueue.

import { Hono } from "hono";
import type { HonoEnv } from "./types";

export const classifyRoute = new Hono<HonoEnv>();

classifyRoute.post("/line-item", (c) => c.json({ error: "not implemented" }, 501));
