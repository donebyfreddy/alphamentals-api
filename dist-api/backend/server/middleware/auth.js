"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
const supabase_js_1 = require("@supabase/supabase-js");
const ws_1 = __importDefault(require("ws"));
// Lazy init so env vars are read after dotenv.config() runs in server/index.ts
let _client = null;
function getAdminClient() {
    if (!_client) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
        const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!url || !key) {
            throw new Error('Supabase URL and SUPABASE_SECRET_KEY must be set in .env');
        }
        _client = (0, supabase_js_1.createClient)(url, key, { realtime: { transport: ws_1.default } });
    }
    return _client;
}
async function requireAuth(req, res, next) {
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
        req.userId = user.id;
        req.userEmail = user.email ?? '';
        next();
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Auth service unavailable';
        res.status(503).json({ error: message });
    }
}
