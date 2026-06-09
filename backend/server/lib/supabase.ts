import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  return {
    url: url.trim(),
    key: key.trim(),
  };
}

let cachedClient: SupabaseClient | null = null;
let cachedSignature = '';

function buildSignature(url: string, key: string) {
  return `${url}::${key.slice(0, 8)}`;
}

function createSupabaseClient(url: string, key: string) {
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function getSupabase() {
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

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getSupabase(), prop, receiver);
  },
});

export function isDatabaseConfigured() {
  const { url, key } = getSupabaseConfig();
  return Boolean(url && key);
}
