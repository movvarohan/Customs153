// Local Database adapter on @libsql/client. File-backed; mirrors D1's
// prepared-statement API closely so the future D1 adapter is a thin shim.

import { createClient, type Client, type InValue } from "@libsql/client";
import type { Database, DbValue, PreparedStatement } from "@/interfaces/database";

class LibsqlPreparedStatement implements PreparedStatement {
  constructor(
    private readonly client: Client,
    private readonly sql: string,
    private readonly args: InValue[] = [],
  ) {}

  bind(...values: DbValue[]): PreparedStatement {
    return new LibsqlPreparedStatement(this.client, this.sql, values as InValue[]);
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const result = await this.client.execute({ sql: this.sql, args: this.args });
    const row = result.rows[0];
    return row ? (rowToObject(row, result.columns) as T) : null;
  }

  async all<T = Record<string, unknown>>(): Promise<T[]> {
    const result = await this.client.execute({ sql: this.sql, args: this.args });
    return result.rows.map((r) => rowToObject(r, result.columns) as T);
  }

  async run(): Promise<{ rowsAffected: number; lastInsertRowId: bigint | null }> {
    const result = await this.client.execute({ sql: this.sql, args: this.args });
    return {
      rowsAffected: result.rowsAffected,
      lastInsertRowId: result.lastInsertRowid ?? null,
    };
  }

  toLibsqlStatement(): { sql: string; args: InValue[] } {
    return { sql: this.sql, args: this.args };
  }
}

function rowToObject(
  row: unknown,
  columns: readonly string[],
): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  const arr = row as unknown[];
  for (let i = 0; i < columns.length; i++) {
    obj[columns[i]!] = arr[i];
  }
  return obj;
}

export class SqliteDatabase implements Database {
  constructor(private readonly client: Client) {}

  static async open(url: string): Promise<SqliteDatabase> {
    const client = createClient({ url });
    // libsql enforces foreign keys by default (unlike raw sqlite3 / D1).
    // The schema uses REFERENCES to document intent, but the rest of the
    // codebase assumes non-enforcement — e.g. classifier.persistAuditLog
    // writes audit_log rows whose IDs are stored in sku_master.current_
    // classification_id without ever inserting the matching classifications
    // row. Match the documented-but-not-enforced behavior.
    await client.execute("PRAGMA foreign_keys = OFF");
    return new SqliteDatabase(client);
  }

  prepare(sql: string): PreparedStatement {
    return new LibsqlPreparedStatement(this.client, sql);
  }

  async batch(statements: PreparedStatement[]): Promise<void> {
    const libsqlStmts = statements.map((s) => {
      if (!(s instanceof LibsqlPreparedStatement)) {
        throw new Error("batch() requires statements created by this adapter");
      }
      return s.toLibsqlStatement();
    });
    await this.client.batch(libsqlStmts, "write");
  }

  async exec(sql: string): Promise<void> {
    await this.client.executeMultiple(sql);
  }

  async close(): Promise<void> {
    this.client.close();
  }
}
