import { Request, Response, NextFunction } from 'express';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { WebSocketLikeConstructor } from '@supabase/realtime-js';
import ws from 'ws';

const wsTransport = ws as unknown as WebSocketLikeConstructor;

// Lazy init so env vars are read after dotenv.config() runs in server/index.ts
let _client: SupabaseClient | null = null;

function getAdminClient(): SupabaseClient {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error('Supabase URL and SUPABASE_SECRET_KEY must be set in .env');
    }
    _client = createClient(url, key, { realtime: { transport: wsTransport } });
  }
  return _client;
}

export interface AuthRequest extends Request {
  userId: string;
  userEmail: string;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization header' });
    return;
  }

  try {
    const token = authHeader.slice(7);
    const { data: { user }, error } = await getAdminClient().auth.getUser(token);
    if (error || !user) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }
    (req as AuthRequest).userId = user.id;
    (req as AuthRequest).userEmail = user.email ?? '';
    next();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Auth service unavailable';
    res.status(503).json({ error: message });
  }
}
