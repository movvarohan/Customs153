// TODO(CLAUDE.md §10 "Audit trail"):
//   Typed D1 query helpers. Every write to classifications / shipments / line_items
//   also writes to audit_log with model_version + reviewer identity.

import type { Env } from "@/types/env";

export function db(env: Env): D1Database {
  return env.DB;
}

// TODO: add typed prepared-statement helpers as we build out queries.
