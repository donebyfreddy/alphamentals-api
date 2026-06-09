import dotenv from 'dotenv';
import { Pool, type QueryResultRow } from 'pg';

dotenv.config();

function isUsableConnectionString(value: string | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('[YOUR-PASSWORD]')) return false;
  return trimmed.startsWith('postgresql://') || trimmed.startsWith('postgres://');
}

function buildConnectionStringFromParts(): string | null {
  const host = process.env.DB_HOST ?? process.env.POSTGRES_HOST ?? process.env.PGHOST;
  const port = process.env.DB_PORT ?? process.env.POSTGRES_PORT ?? process.env.PGPORT ?? '5432';
  const user = process.env.DB_USER ?? process.env.POSTGRES_USER ?? process.env.PGUSER ?? 'postgres';
  const password = process.env.DB_PASSWORD ?? process.env.POSTGRES_PASSWORD ?? process.env.PGPASSWORD ?? process.env.SUPABASE_DB_PASSWORD;
  const database = process.env.DB_NAME ?? process.env.POSTGRES_DB ?? process.env.PGDATABASE ?? 'postgres';
  const sslMode = process.env.DB_SSLMODE ?? process.env.PGSSLMODE ?? 'require';

  if (!host || !password || password.includes('[YOUR-PASSWORD]')) return null;

  const encodedUser = encodeURIComponent(user);
  const encodedPassword = encodeURIComponent(password);
  const encodedDatabase = encodeURIComponent(database);

  return `postgresql://${encodedUser}:${encodedPassword}@${host}:${port}/${encodedDatabase}?sslmode=${encodeURIComponent(sslMode)}`;
}

function resolveDatabaseUrl(): string | null {
  if (isUsableConnectionString(process.env.SUPABASE_DATABASE_URL)) {
    return process.env.SUPABASE_DATABASE_URL.trim();
  }
  if (isUsableConnectionString(process.env.DATABASE_URL)) {
    return process.env.DATABASE_URL.trim();
  }
  if (isUsableConnectionString(process.env.DIRECT_URL)) {
    return process.env.DIRECT_URL.trim();
  }
  return buildConnectionStringFromParts();
}

const resolvedDatabaseUrl = resolveDatabaseUrl();
const globalForDb = globalThis as unknown as { dbPool?: Pool };

function createPool() {
  if (!resolvedDatabaseUrl) {
    console.warn('[db] DATABASE_URL not configured');
    return null;
  }

  console.log('[db] DATABASE_URL configured');
  return new Pool({
    connectionString: resolvedDatabaseUrl,
    ssl: resolvedDatabaseUrl.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
    max: 5,
  });
}

export const db = globalForDb.dbPool ?? createPool();

if (process.env.NODE_ENV !== 'production' && db) {
  globalForDb.dbPool = db;
}

export function isDatabaseConfigured() {
  return Boolean(resolvedDatabaseUrl && db);
}

/** Hostname the pool is configured to connect to (for diagnostics). */
export function getDatabaseHost(): string | null {
  if (!resolvedDatabaseUrl) return null;
  try {
    return new URL(resolvedDatabaseUrl).hostname;
  } catch {
    return null;
  }
}

const CONNECTION_ERROR_CODES = ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH'];

export function isDatabaseConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  if (code && CONNECTION_ERROR_CODES.includes(code)) return true;
  const message = error.message ?? '';
  return (
    CONNECTION_ERROR_CODES.some((c) => message.includes(c)) ||
    message.includes('getaddrinfo') ||
    message.includes("Can't reach database server") ||
    message.includes('timeout')
  );
}

export interface DatabaseHealth {
  ok: boolean;
  configured: boolean;
  host: string | null;
  code: string | null;
  message: string | null;
}

/** Probe the database once with a short timeout. Used to fail fast before bulk writes. */
export async function checkDatabaseConnection(timeoutMs = 5_000): Promise<DatabaseHealth> {
  const host = getDatabaseHost();
  if (!db) {
    return { ok: false, configured: false, host, code: 'NOT_CONFIGURED', message: 'Database is not configured.' };
  }

  try {
    const probe = db.query('SELECT 1');
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(Object.assign(new Error(`Database health check timed out after ${timeoutMs}ms`), { code: 'ETIMEDOUT' })), timeoutMs);
    });
    await Promise.race([probe, timeout]);
    return { ok: true, configured: true, host, code: null, message: null };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    return {
      ok: false,
      configured: true,
      host,
      code: err.code ?? 'DB_ERROR',
      message: err.message ?? 'Database connection failed',
    };
  }
}

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) {
  if (!db) throw new Error('Database is not configured.');
  return db.query<T>(text, values);
}

export async function execute(text: string, values: unknown[] = []) {
  await query(text, values);
}
