// Database interface. API shape mirrors Cloudflare D1's prepared-statement style
// so the eventual D1 adapter is a thin shim. Local adapter sits on @libsql/client.

export type DbValue = string | number | boolean | null | Uint8Array | bigint;

export interface PreparedStatement {
  /** Bind positional parameters (?, ?, ?). Returns a new statement. */
  bind(...values: DbValue[]): PreparedStatement;
  /** First row or null. */
  first<T = Record<string, unknown>>(): Promise<T | null>;
  /** All rows. */
  all<T = Record<string, unknown>>(): Promise<T[]>;
  /** INSERT / UPDATE / DELETE. */
  run(): Promise<{ rowsAffected: number; lastInsertRowId: bigint | null }>;
}

export interface Database {
  prepare(sql: string): PreparedStatement;
  /** Run multiple statements atomically. */
  batch(statements: PreparedStatement[]): Promise<void>;
  /** Run raw DDL. Used by migration runner. */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}
