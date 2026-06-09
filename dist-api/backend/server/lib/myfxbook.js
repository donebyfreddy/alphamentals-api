"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchCalendar = fetchCalendar;
const cache = __importStar(require("./cache.js"));
const BASE = 'https://www.myfxbook.com/api';
let sessionToken = null;
let sessionExpiresAt = 0;
async function login() {
    if (sessionToken && Date.now() < sessionExpiresAt)
        return sessionToken;
    const email = process.env.MYFXBOOK_EMAIL;
    const password = process.env.MYFXBOOK_PASSWORD;
    if (!email || !password) {
        throw new Error('MYFXBOOK_EMAIL and MYFXBOOK_PASSWORD must be set in .env');
    }
    const url = `${BASE}/login.json?email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`;
    const res = await fetch(url);
    if (!res.ok)
        throw new Error(`Myfxbook login failed: ${res.status}`);
    const data = (await res.json());
    if (data.error || !data.session) {
        throw new Error(`Myfxbook login error: ${data.message ?? 'unknown'}`);
    }
    sessionToken = data.session;
    sessionExpiresAt = Date.now() + 3 * 60 * 60 * 1000; // 3 hours
    console.log('[myfxbook] Session acquired');
    return sessionToken;
}
async function fetchCalendar(start, end) {
    const cacheKey = `myfxbook:calendar:${start}:${end}`;
    const cached = cache.get(cacheKey);
    if (cached)
        return cached;
    const session = await login();
    const url = `${BASE}/get-economic-calendar.json?session=${session}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
    const res = await fetch(url);
    if (!res.ok)
        throw new Error(`Myfxbook calendar fetch failed: ${res.status}`);
    const data = (await res.json());
    if (data.error) {
        // Session may have expired — clear and retry once
        if (data.message?.toLowerCase().includes('session')) {
            sessionToken = null;
            sessionExpiresAt = 0;
        }
        throw new Error(`Myfxbook API error: ${data.message ?? 'unknown'}`);
    }
    const events = data.calendar ?? [];
    cache.set(cacheKey, events, 5 * 60 * 1000); // 5 min
    return events;
}
