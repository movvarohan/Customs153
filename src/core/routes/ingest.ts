// TODO(CLAUDE.md §1 "Document ingestion"):
//   Accept commercial invoice / packing list / BOL uploads (PDF, image, email-in).
//   Store raw in ctx.docs, kick off extractor agent, return shipment id.

import { Hono } from "hono";
import type { HonoEnv } from "./types";

export const ingestRoute = new Hono<HonoEnv>();

ingestRoute.post("/", (c) => c.json({ error: "not implemented" }, 501));
