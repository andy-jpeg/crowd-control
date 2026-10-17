import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";

async function migrate() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL must be set before running migrations");
  }

  const pool = new Pool({ connectionString });
  let client: PoolClient | undefined;
  let transactionOpen = false;
  try {
    client = await pool.connect();
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const migrationFiles = (await readdir(resolve(process.cwd(), "db")))
      .filter((filename) => /^\d+_[a-z0-9_-]+\.sql$/.test(filename))
      .sort();
    for (const filename of migrationFiles) {
      const migrationVersion = filename.replace(/\.sql$/, "");
      const applied = await client.query(
        "SELECT 1 FROM schema_migrations WHERE version = $1",
        [migrationVersion]
      );
      if (applied.rowCount !== 0) continue;

      await client.query("BEGIN");
      transactionOpen = true;
      const sql = await readFile(resolve(process.cwd(), "db", filename), "utf8");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (version) VALUES ($1)",
        [migrationVersion]
      );
      await client.query("COMMIT");
      transactionOpen = false;
      console.log(`Applied database migration ${migrationVersion}`);
    }
    console.log("Database migrations are up to date");
  } catch (error) {
    if (client && transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("[backend] migration rollback failed", rollbackError);
      }
    }
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
}

void migrate().catch((error: unknown) => {
  console.error("[backend] migration failed", error);
  process.exitCode = 1;
});
