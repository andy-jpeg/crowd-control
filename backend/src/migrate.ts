import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";

const migrationVersion = "001_initial";

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
    await client.query("BEGIN");
    transactionOpen = true;
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const applied = await client.query(
      "SELECT 1 FROM schema_migrations WHERE version = $1",
      [migrationVersion]
    );
    if (applied.rowCount === 0) {
      const sql = await readFile(resolve(process.cwd(), "db/001_initial.sql"), "utf8");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (version) VALUES ($1)",
        [migrationVersion]
      );
    }
    await client.query("COMMIT");
    transactionOpen = false;
    console.log(applied.rowCount === 0 ? "Database migration applied" : "Database already up to date");
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
