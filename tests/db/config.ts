// A separate database on the local dev stack's Postgres (dev-stack.sh, port 54322),
// rebuilt by `bun run test:db` from this checkout's migrations.
export const DEFAULT_TEST_DATABASE_URL = "postgres://postgres@127.0.0.1:54322/dausis_test";
