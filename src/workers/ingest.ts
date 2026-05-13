// TODO(CLAUDE.md §1 "Document ingestion"):
//   Accept commercial invoice / packing list / BOL uploads (PDF, image, email-in).
//   Store raw in R2 DOCS, kick off extractor agent, return shipment id.

import { Hono } from "hono";
import type { Env } from "@/types/env";

export const ingestRoute = new Hono<{ Bindings: Env }>();

ingestRoute.post("/", (c) => c.json({ error: "not implemented" }, 501));
