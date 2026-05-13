// Applies migrations/*.sql to the local SQLite database, in lexical order.
// Tracks applied migrations in a _migrations table so reruns are idempotent.

import { promises as fs } from "node:fs";
import path from "node:path";
import { SqliteDatabase } from "@/adapters/local/sqlite-db";

async function main(): Promise<void> {
  const dataDir = process.env.DATA_DIR ?? ".data";
  await fs.mkdir(dataDir, { recursive: true });

  const db = await SqliteDatabase.open(`file:${path.join(dataDir, "customs.db")}`);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const dir = path.resolve("migrations");
  const files = (await fs.readdir(dir))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const applied = await db
      .prepare("SELECT name FROM _migrations WHERE name = ?")
      .bind(file)
      .first<{ name: string }>();
    if (applied) {
      console.log(`skip ${file} (already applied)`);
      continue;
    }
    const sql = await fs.readFile(path.join(dir, file), "utf8");
    console.log(`applying ${file}…`);
    await db.exec(sql);
    await db
      .prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)")
      .bind(file, new Date().toISOString())
      .run();
  }

  await db.close();
  console.log("migrations complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
