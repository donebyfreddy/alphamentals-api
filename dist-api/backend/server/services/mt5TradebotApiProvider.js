"use strict";
/**
 * MT5 TradeBot API provider — talks to the self-hosted FastAPI bridge
 * https://github.com/Itszeeshanrajput/mt5-tradebot-api
 * Default base URL: http://127.0.0.1:8001/api/v1
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.mt5HealthCheck = mt5HealthCheck;
exports.mt5TradebotConnect = mt5TradebotConnect;
exports.mt5TradebotDisconnect = mt5TradebotDisconnect;
exports.mt5GetAccountInfo = mt5GetAccountInfo;
exports.mt5GetPositions = mt5GetPositions;
exports.mt5GetHistory = mt5GetHistory;
exports.mt5GetSymbols = mt5GetSymbols;
exports.mt5GetTick = mt5GetTick;
exports.mt5GetHistoricalData = mt5GetHistoricalData;
exports.mt5PlaceOrder = mt5PlaceOrder;
exports.mt5ClosePosition = mt5ClosePosition;
const BASE_URL = () => (process.env.MT5_TRADEBOT_API_URL ?? 'http://127.0.0.1:8001/api/v1').replace(/\/$/, '');
const TIMEOUT_MS = () => Number(process.env.MT5_TRADEBOT_API_TIMEOUT ?? 30_000);
function sanitizeMt5Payload(body) {
    if (typeof body !== 'string')
        return body;
    try {
        const parsed = JSON.parse(body);
        if ('password' in parsed)
            parsed.password = '[REDACTED]';
        return parsed;
    }
    catch {
        return body;
    }
}
async function tradebotFetch(path, options = {}) {
    const url = `${BASE_URL()}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS());
    try {
        if (path === '/connect') {
            console.log('[MT5] Calling bridge endpoint:', url);
            console.log('[MT5] Request payload:', sanitizeMt5Payload(options.body));
        }
        const res = await fetch(url, {
            ...options,
            headers: { 'Content-Type': 'application/json', ...options.headers },
            signal: controller.signal,
        });
        clearTimeout(timer);
        const text = await res.text();
        const contentType = res.headers.get('content-type');
        const preview = text.slice(0, 500);
        console.log('[MT5] Response status:', res.status);
        console.log('[MT5] Response content-type:', contentType ?? 'unknown');
        console.log('[MT5] Response preview:', preview || '[empty]');
        let data;
        if (!contentType?.toLowerCase().includes('application/json')) {
            console.warn('[MT5] JSON parse skipped because response is not JSON');
            data = {
                success: false,
                error: 'MT5_BRIDGE_UNAVAILABLE',
                message: 'MT5 bridge returned HTML or is not reachable',
                details: {
                    status: res.status,
                    endpoint: url,
                    contentType,
                    responsePreview: preview,
                },
            };
            return { ok: false, status: res.status, data };
        }
        try {
            data = JSON.parse(text);
        }
        catch {
            data = {
                success: false,
                error: 'MT5_INVALID_JSON',
                message: 'MT5 bridge returned invalid JSON',
                details: {
                    status: res.status,
                    endpoint: url,
                    contentType,
                    responsePreview: preview,
                },
            };
            return { ok: false, status: res.status, data };
        }
        return { ok: res.ok, status: res.status, data };
    }
    catch (err) {
        clearTimeout(timer);
        const isAbort = err instanceof Error && err.name === 'AbortError';
        if (isAbort) {
            throw new Error(`MT5 API request timed out while calling ${url}`);
        }
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(`MT5 API unreachable at ${url}. ${reason}`);
    }
}
/* ─── Health ─────────────────────────────────────────────────── */
async function mt5HealthCheck() {
    try {
        const res = await tradebotFetch('/health');
        if (res.ok)
            return { healthy: true, message: res.data.message ?? 'MT5 API is healthy' };
        return { healthy: false, message: `MT5 API returned ${res.status}` };
    }
    catch (err) {
        return { healthy: false, message: err instanceof Error ? err.message : 'MT5 API unreachable' };
    }
}
/* ─── Connect ────────────────────────────────────────────────── */
async function mt5TradebotConnect(creds) {
    if (creds.passwordType !== 'investor') {
        return {
            success: false,
            status: 'failed',
            error: {
                code: 'READ_ONLY_REQUIRED',
                message: 'Use the investor read-only password. Trading passwords are not accepted by this dashboard.',
            },
        };
    }
    // Health check first
    const health = await mt5HealthCheck();
    if (!health.healthy) {
        return {
            success: false,
            status: 'failed',
            error: {
                code: 'CONNECTION_UNAVAILABLE',
                message: `MT5 TradeBot API is not running. Start it on Windows with 'python main.py' or 'python3 backend/main.py'. (${health.message})`,
            },
        };
    }
    const res = await tradebotFetch('/connect', {
        method: 'POST',
        body: JSON.stringify({
            version: creds.version,
            login: creds.login,
            password: creds.password,
            server: creds.server,
            accountType: creds.accountType,
            passwordType: creds.passwordType,
        }),
    });
    if (!res.ok) {
        const msg = String(res.data.detail ?? res.data.message ?? `HTTP ${res.status}`).toLowerCase();
        const diagnosticDetails = {
            ...(res.data.details ?? {}),
            account: creds.login,
            server: creds.server,
        };
        if (res.data.error === 'MT5_BRIDGE_UNAVAILABLE' || res.data.error === 'MT5_INVALID_JSON') {
            return {
                success: false,
                status: 'failed',
                error: {
                    code: 'CONNECTION_UNAVAILABLE',
                    message: 'MT5 bridge returned HTML or is not reachable',
                    details: diagnosticDetails,
                },
            };
        }
        if (msg.includes('password') || msg.includes('invalid')) {
            return { success: false, status: 'failed', error: { code: 'WRONG_PASSWORD', message: 'Invalid credentials. Check your login and password.' } };
        }
        if (msg.includes('server') || msg.includes('not found')) {
            return { success: false, status: 'failed', error: { code: 'WRONG_SERVER', message: 'Broker server not found. Check the server name.' } };
        }
        if (msg.includes('terminal path') || msg.includes('installed')) {
            return { success: false, status: 'failed', error: { code: 'TERMINAL_NOT_INSTALLED', message: 'MetaTrader 5 terminal is not installed or MT5_TERMINAL_PATH is wrong.' } };
        }
        if (msg.includes('ipc') || msg.includes('terminal is not running') || msg.includes('cannot be reached')) {
            return { success: false, status: 'failed', error: { code: 'TERMINAL_NOT_RUNNING', message: 'MetaTrader 5 terminal is not running on the Windows machine.' } };
        }
        if (msg.includes('terminal') || msg.includes('initialize')) {
            return { success: false, status: 'failed', error: { code: 'CONNECTION_UNAVAILABLE', message: 'MetaTrader 5 terminal is unavailable on the Windows machine.' } };
        }
        return {
            success: false,
            status: 'failed',
            error: {
                code: 'FAILED_TO_CONNECT',
                message: String(res.data.detail ?? res.data.message ?? 'Connection failed'),
                details: diagnosticDetails,
            },
        };
    }
    // Fetch account info, positions, and closed history after successful connect.
    const [accountResult, positionsResult, historyResult] = await Promise.all([
        mt5GetAccountInfo(),
        mt5GetPositions(),
        mt5GetHistory(),
    ]);
    if (!accountResult) {
        return { success: false, status: 'failed', error: { code: 'FAILED_TO_CONNECT', message: 'Connected but could not retrieve account info.' } };
    }
    return {
        success: true,
        status: 'connected',
        account: accountResult,
        positions: positionsResult,
        history: historyResult,
    };
}
/* ─── Disconnect ─────────────────────────────────────────────── */
async function mt5TradebotDisconnect() {
    try {
        await tradebotFetch('/disconnect', { method: 'POST' });
    }
    catch {
        // ignore errors on disconnect
    }
}
/* ─── Account info ───────────────────────────────────────────── */
async function mt5GetAccountInfo() {
    try {
        const res = await tradebotFetch('/account');
        if (!res.ok)
            return null;
        const d = res.data;
        return {
            login: String(d.login ?? ''),
            server: d.server ?? '',
            broker: d.company ?? '',
            name: d.name ?? '',
            balance: d.balance ?? 0,
            equity: d.equity ?? 0,
            currency: d.currency ?? 'USD',
            leverage: d.leverage ?? 0,
            tradeAllowed: d.trade_allowed,
        };
    }
    catch {
        return null;
    }
}
/* ─── Positions ──────────────────────────────────────────────── */
async function mt5GetPositions() {
    try {
        const res = await tradebotFetch('/positions');
        if (!res.ok || !Array.isArray(res.data))
            return [];
        return res.data.map(p => ({
            ticket: String(p.ticket ?? ''),
            symbol: p.symbol ?? '',
            type: (p.type === 0 || p.type === 'buy') ? 'buy' : 'sell',
            volume: p.volume ?? 0,
            profit: p.profit ?? 0,
            openPrice: p.price_open,
            currentPrice: p.price_current,
            openedAt: p.time ? new Date(typeof p.time === 'number' ? p.time * 1000 : p.time).toISOString() : null,
        }));
    }
    catch {
        return [];
    }
}
async function mt5GetHistory() {
    try {
        const res = await tradebotFetch('/history');
        if (!res.ok || !Array.isArray(res.data))
            return [];
        return res.data.map((deal) => ({
            ticket: String(deal.ticket ?? ''),
            order: String(deal.order ?? deal.ticket ?? ''),
            positionId: deal.positionId != null ? String(deal.positionId) : undefined,
            symbol: deal.symbol ?? '',
            type: (deal.type === 0 || deal.type === 'buy') ? 'buy' : 'sell',
            entryType: deal.entryType ?? null,
            volume: deal.volume ?? 0,
            price: deal.price ?? 0,
            profit: deal.profit ?? 0,
            commission: deal.commission ?? 0,
            swap: deal.swap ?? 0,
            time: deal.time ? new Date(typeof deal.time === 'number' ? deal.time * 1000 : deal.time).toISOString() : null,
            comment: deal.comment ?? null,
        }));
    }
    catch {
        return [];
    }
}
/* ─── Symbols ────────────────────────────────────────────────── */
async function mt5GetSymbols() {
    const res = await tradebotFetch('/symbols');
    if (!res.ok)
        throw new Error(`Failed to fetch symbols: HTTP ${res.status}`);
    return Array.isArray(res.data) ? res.data : (res.data.symbols ?? []);
}
/* ─── Tick ───────────────────────────────────────────────────── */
async function mt5GetTick(symbol) {
    const res = await tradebotFetch(`/symbol/${encodeURIComponent(symbol)}/tick`);
    if (!res.ok)
        throw new Error(`Symbol '${symbol}' not found or unavailable`);
    return res.data;
}
/* ─── Historical data ────────────────────────────────────────── */
async function mt5GetHistoricalData(symbol, timeframe, startDate, endDate) {
    const res = await tradebotFetch('/historical-data', {
        method: 'POST',
        body: JSON.stringify({ symbol, timeframe, start_date: startDate, end_date: endDate }),
    });
    if (!res.ok)
        throw new Error(`Historical data fetch failed: HTTP ${res.status}`);
    return Array.isArray(res.data) ? res.data : (res.data.data ?? []);
}
/* ─── Place order ────────────────────────────────────────────── */
async function mt5PlaceOrder(order) {
    const res = await tradebotFetch('/order/place', {
        method: 'POST',
        body: JSON.stringify(order),
    });
    if (!res.ok) {
        const msg = res.data.detail
            ?? res.data.message
            ?? `Order rejected (HTTP ${res.status})`;
        return { success: false, message: String(msg) };
    }
    return res.data;
}
/* ─── Close position ─────────────────────────────────────────── */
async function mt5ClosePosition(positionId) {
    const res = await tradebotFetch(`/position/close/${encodeURIComponent(positionId)}`, { method: 'POST' });
    if (!res.ok) {
        return { success: false, message: String(res.data.detail ?? res.data.message ?? `HTTP ${res.status}`) };
    }
    return { success: true, message: res.data.message };
}
