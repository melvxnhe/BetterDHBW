// The database: Neon Postgres in production (DATABASE_URL, set by Vercel's
// Neon integration). serve.mjs plugs in a local Postgres (PGlite) when no
// DATABASE_URL is set, through useDatabase(); the queries are the same.
//
// Every query is parameterised ($1, $2, …). Nothing a user sends is ever
// pasted into SQL text.

import { neon } from '@neondatabase/serverless';

let query = null; // (text, params) => Promise<rows[]>
let ready = null;

export function useDatabase(fn) {
  query = fn;
  ready = null;
}

export const configured = () => !!(query || process.env.DATABASE_URL);

function connect() {
  if (!query) {
    if (!process.env.DATABASE_URL) throw Object.assign(new Error('DATABASE_URL is not set'), { code: 'NO_DATABASE' });
    const sql = neon(process.env.DATABASE_URL);
    query = (text, params = []) => sql.query(text, params);
  }
  return query;
}

// One statement per call; several that must succeed together are written as
// a single statement with CTEs, which Postgres runs atomically.
export async function q(text, params = []) {
  const run = connect();
  if (!ready) ready = migrate(run).catch((err) => { ready = null; throw err; });
  await ready;
  return run(text, params);
}

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    settings jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    password_changed_at timestamptz NOT NULL DEFAULT now()
  )`,
  // only a hash of each session token is stored, so a leaked table logs nobody in
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id)`,
  // e-mail links: "verify" holds a pending sign-up (the account exists only
  // once the address is confirmed), "reset" a password reset
  `CREATE TABLE IF NOT EXISTS tokens (
    token_hash text PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('verify', 'reset')),
    email text NOT NULL,
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    password_hash text,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS tokens_email ON tokens (email)`,
  `CREATE TABLE IF NOT EXISTS notes (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course text NOT NULL,
    event_id text NOT NULL,
    event_name text NOT NULL DEFAULT '',
    event_start timestamptz,
    body text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, course, event_id)
  )`,
  `CREATE TABLE IF NOT EXISTS rate_limits (
    key text PRIMARY KEY,
    count integer NOT NULL,
    reset_at timestamptz NOT NULL
  )`,
];

// A cold start checks for the last table (one round trip) and only creates
// the schema when it's missing. `npm run db:migrate` runs it unconditionally.
export async function migrate(run = connect(), { force = false } = {}) {
  if (!force) {
    const [row] = await run(`SELECT to_regclass('public.rate_limits') IS NOT NULL AS ok`, []);
    if (row?.ok) return;
  }
  for (const statement of SCHEMA) await run(statement, []);
}
