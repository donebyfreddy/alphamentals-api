"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
exports.isDatabaseConfigured = isDatabaseConfigured;
exports.getDatabaseHost = getDatabaseHost;
exports.isDatabaseConnectionError = isDatabaseConnectionError;
exports.checkDatabaseConnection = checkDatabaseConnection;
exports.query = query;
exports.execute = execute;
const dotenv_1 = __importDefault(require("dotenv"));
const pg_1 = require("pg");
dotenv_1.default.config();
function isUsableConnectionString(value) {
    if (!value)
        return false;
    const trimmed = value.trim();
    if (!trimmed || trimmed.includes('[YOUR-PASSWORD]'))
        return false;
    return trimmed.startsWith('postgresql://') || trimmed.startsWith('postgres://');
}
function buildConnectionStringFromParts() {
    const host = process.env.DB_HOST ?? process.env.POSTGRES_HOST ?? process.env.PGHOST;
    const port = process.env.DB_PORT ?? process.env.POSTGRES_PORT ?? process.env.PGPORT ?? '5432';
    const user = process.env.DB_USER ?? process.env.POSTGRES_USER ?? process.env.PGUSER ?? 'postgres';
    const password = process.env.DB_PASSWORD ?? process.env.POSTGRES_PASSWORD ?? process.env.PGPASSWORD ?? process.env.SUPABASE_DB_PASSWORD;
    const database = process.env.DB_NAME ?? process.env.POSTGRES_DB ?? process.env.PGDATABASE ?? 'postgres';
    const sslMode = process.env.DB_SSLMODE ?? process.env.PGSSLMODE ?? 'require';
    if (!host || !password || password.includes('[YOUR-PASSWORD]'))
        return null;
    const encodedUser = encodeURIComponent(user);
    const encodedPassword = encodeURIComponent(password);
    const encodedDatabase = encodeURIComponent(database);
    return `postgresql://${encodedUser}:${encodedPassword}@${host}:${port}/${encodedDatabase}?sslmode=${encodeURIComponent(sslMode)}`;
}
function resolveDatabaseUrl() {
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
const globalForDb = globalThis;
function createPool() {
    if (!resolvedDatabaseUrl) {
        console.warn('[db] DATABASE_URL not configured');
        return null;
    }
    console.log('[db] DATABASE_URL configured');
    return new pg_1.Pool({
        connectionString: resolvedDatabaseUrl,
        ssl: resolvedDatabaseUrl.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
        max: 5,
    });
}
exports.db = globalForDb.dbPool ?? createPool();
if (process.env.NODE_ENV !== 'production' && exports.db) {
    globalForDb.dbPool = exports.db;
}
function isDatabaseConfigured() {
    return Boolean(resolvedDatabaseUrl && exports.db);
}
/** Hostname the pool is configured to connect to (for diagnostics). */
function getDatabaseHost() {
    if (!resolvedDatabaseUrl)
        return null;
    try {
        return new URL(resolvedDatabaseUrl).hostname;
    }
    catch {
        return null;
    }
}
const CONNECTION_ERROR_CODES = ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH'];
function isDatabaseConnectionError(error) {
    if (!(error instanceof Error))
        return false;
    const code = error.code;
    if (code && CONNECTION_ERROR_CODES.includes(code))
        return true;
    const message = error.message ?? '';
    return (CONNECTION_ERROR_CODES.some((c) => message.includes(c)) ||
        message.includes('getaddrinfo') ||
        message.includes("Can't reach database server") ||
        message.includes('timeout'));
}
/** Probe the database once with a short timeout. Used to fail fast before bulk writes. */
async function checkDatabaseConnection(timeoutMs = 5_000) {
    const host = getDatabaseHost();
    if (!exports.db) {
        return { ok: false, configured: false, host, code: 'NOT_CONFIGURED', message: 'Database is not configured.' };
    }
    try {
        const probe = exports.db.query('SELECT 1');
        const timeout = new Promise((_, reject) => {
            setTimeout(() => reject(Object.assign(new Error(`Database health check timed out after ${timeoutMs}ms`), { code: 'ETIMEDOUT' })), timeoutMs);
        });
        await Promise.race([probe, timeout]);
        return { ok: true, configured: true, host, code: null, message: null };
    }
    catch (error) {
        const err = error;
        return {
            ok: false,
            configured: true,
            host,
            code: err.code ?? 'DB_ERROR',
            message: err.message ?? 'Database connection failed',
        };
    }
}
async function query(text, values = []) {
    if (!exports.db)
        throw new Error('Database is not configured.');
    return exports.db.query(text, values);
}
async function execute(text, values = []) {
    await query(text, values);
}
