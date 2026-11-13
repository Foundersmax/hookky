// Postgres for accounts. Accounts switch on when DATABASE_URL is set; without it Rookker runs as
// before (open, or behind HOOKKY_PASSWORD).
import pg from "pg";

export const accountsEnabled = () => !!process.env.DATABASE_URL?.trim();

let pool: pg.Pool | null = null;

/** Render's internal URLs (host without dots) and local hosts don't use TLS; external hosts do. */
export function sslFor(url: string): false | { rejectUnauthorized: false } {
  const forced = process.env.DATABASE_SSL?.toLowerCase();
  if (forced === "off" || forced === "false") return false;
  if (forced === "on" || forced === "true") return { rejectUnauthorized: false };
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  if (!host || host === "localhost" || /^127\./.test(host) || !host.includes(".")) return false;
  return { rejectUnauthorized: false };
}

export function db(): pg.Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL!.trim();
    pool = new pg.Pool({ connectionString: url, ssl: sslFor(url), max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
    pool.on("error", (e) => console.error("Postgres pool error:", e.message));
  }
  return pool;
}

export async function closeDb() {
  await pool?.end();
  pool = null;
}

const SCHEMA = `
create table if not exists users (
  id bigserial primary key,
  email text not null unique,
  name text not null default '',
  password_hash text not null,
  role text not null default 'user' check (role in ('user', 'admin')),
  status text not null default 'unverified' check (status in ('unverified', 'pending', 'active', 'disabled')),
  daily_limit integer,
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  approved_at timestamptz,
  last_login_at timestamptz
);
create table if not exists sessions (
  token_hash text primary key,
  user_id bigint not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now()
);
create index if not exists sessions_user_idx on sessions(user_id);
create table if not exists auth_tokens (
  token_hash text primary key,
  user_id bigint not null references users(id) on delete cascade,
  kind text not null check (kind in ('verify', 'reset')),
  expires_at timestamptz not null,
  used_at timestamptz
);
create table if not exists settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists usage (
  user_id bigint not null references users(id) on delete cascade,
  day date not null,
  agent_turns integer not null default 0,
  primary key (user_id, day)
);
`;

/** Create or update the tables (idempotent; runs at startup). */
export async function migrate() {
  await db().query(SCHEMA);
  // Housekeeping: expired sessions and spent tokens.
  await db().query("delete from sessions where expires_at < now(); delete from auth_tokens where expires_at < now() - interval '7 days'");
}
