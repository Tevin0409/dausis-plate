// Recreates the throwaway test database from this checkout's migrations and seed.
// Runs against TEST_DATABASE_URL (default: a `dausis_test` database on the local
// dev stack's Postgres). It never touches the stack's own `postgres` database.
import { SQL } from "bun";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_TEST_DATABASE_URL } from "../tests/db/config";

const url = new URL(process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL);
const dbName = decodeURIComponent(url.pathname.slice(1));
const local = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);

if (!/^[a-z0-9_]*test[a-z0-9_]*$/.test(dbName)) {
  throw new Error(`Refusing to recreate "${dbName}": the test database name must contain "test".`);
}
if (!local && process.env.CI !== "true") {
  throw new Error(`Refusing to recreate a database on ${url.hostname}: only local hosts (or CI) are allowed.`);
}

const root = join(import.meta.dir, "..");
const migrationsDir = join(root, "supabase/migrations");
const migrations = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

const adminUrl = new URL(url);
adminUrl.pathname = "/postgres";
const admin = new SQL(adminUrl.toString());
await admin.unsafe(`drop database if exists "${dbName}" with (force)`);
await admin.unsafe(`create database "${dbName}"`);
await admin.unsafe(`alter database "${dbName}" set search_path = public, extensions`);
await admin.close();

const db = new SQL(url.toString());
const run = async (label: string, path: string) => {
  try {
    await db.unsafe(await Bun.file(path).text());
  } catch (err) {
    throw new Error(`FAILED applying ${label}: ${(err as Error).message}`);
  }
};
// search_path from `alter database` applies to new sessions only; set it for this one.
await db.unsafe("set search_path = public, extensions");
await run("bootstrap.sql", join(root, "supabase/tests/bootstrap.sql"));
for (const f of migrations) await run(f, join(migrationsDir, f));
await run("seed.sql", join(root, "supabase/seed.sql"));
await db.close();

console.log(`test database "${dbName}" ready: bootstrap + ${migrations.length} migrations + seed`);
