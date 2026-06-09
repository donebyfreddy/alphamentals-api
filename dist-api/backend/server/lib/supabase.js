"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.supabase = void 0;
exports.getSupabase = getSupabase;
exports.isDatabaseConfigured = isDatabaseConfigured;
const supabase_js_1 = require("@supabase/supabase-js");
function getSupabaseConfig() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
    const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    return {
        url: url.trim(),
        key: key.trim(),
    };
}
let cachedClient = null;
let cachedSignature = '';
function buildSignature(url, key) {
    return `${url}::${key.slice(0, 8)}`;
}
function createSupabaseClient(url, key) {
    return (0, supabase_js_1.createClient)(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
}
function getSupabase() {
    const { url, key } = getSupabaseConfig();
    if (!url || !key) {
        throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY must be set');
    }
    const nextSignature = buildSignature(url, key);
    if (!cachedClient || cachedSignature !== nextSignature) {
        cachedClient = createSupabaseClient(url, key);
        cachedSignature = nextSignature;
    }
    return cachedClient;
}
exports.supabase = new Proxy({}, {
    get(_target, prop, receiver) {
        return Reflect.get(getSupabase(), prop, receiver);
    },
});
function isDatabaseConfigured() {
    const { url, key } = getSupabaseConfig();
    return Boolean(url && key);
}
