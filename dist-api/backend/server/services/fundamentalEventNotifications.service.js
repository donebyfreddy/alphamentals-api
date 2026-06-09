"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendDailyFundamentalEventsEmail = sendDailyFundamentalEventsEmail;
exports.sendWeeklyFundamentalEventsEmail = sendWeeklyFundamentalEventsEmail;
exports.runFundamentalEventEmailScheduler = runFundamentalEventEmailScheduler;
const supabase_js_1 = require("../lib/supabase.js");
const mailer_js_1 = require("../lib/mailer.js");
const notification_service_js_1 = require("./notification.service.js");
const fundamentals_service_js_1 = require("./fundamentals.service.js");
const fundamentalEvents_js_1 = require("../../../src/lib/fundamentalEvents.js");
const notificationLogMemory = new Set();
async function sendDailyFundamentalEventsEmail(force = false) {
    const now = new Date();
    const events = await ensureFreshEvents();
    const dateKey = localDateKey(now);
    const todayEvents = events.filter((event) => event.date === dateKey && event.status !== 'past');
    return sendFundamentalEventsEmail('daily', todayEvents, { now, dateKey, force });
}
async function sendWeeklyFundamentalEventsEmail(force = false) {
    const now = new Date();
    const events = await ensureFreshEvents();
    const week = (0, fundamentalEvents_js_1.getWeekWindow)(now, fundamentalEvents_js_1.APP_EVENT_TIMEZONE);
    const weeklyEvents = events.filter((event) => event.debug.classification.isThisWeek && event.impact !== 'low');
    return sendFundamentalEventsEmail('weekly', weeklyEvents, { now, weekKey: week.weekKey, weekLabel: week.label, force });
}
async function runFundamentalEventEmailScheduler() {
    const now = new Date();
    const hour = Number(new Intl.DateTimeFormat('en-GB', {
        timeZone: fundamentalEvents_js_1.APP_EVENT_TIMEZONE,
        hour: '2-digit',
        hourCycle: 'h23',
    }).format(now));
    const daily = hour >= 7
        ? await sendDailyFundamentalEventsEmail(false)
        : { ok: true, sent: false, type: 'daily', reason: 'Waiting for 07:00 Europe/Madrid window.', eventCount: 0 };
    const weekday = new Intl.DateTimeFormat('en-GB', {
        timeZone: fundamentalEvents_js_1.APP_EVENT_TIMEZONE,
        weekday: 'short',
    }).format(now);
    const weekly = hour >= 7 && weekday === 'Mon'
        ? await sendWeeklyFundamentalEventsEmail(false)
        : undefined;
    return { daily, weekly };
}
async function sendFundamentalEventsEmail(type, events, options) {
    const userId = process.env.DEFAULT_USER_ID ?? '';
    const prefs = await (0, notification_service_js_1.getPreferences)(userId);
    if (!prefs.notificationsEnabled || !prefs.emailEnabled || !prefs.emailRecipient) {
        return { ok: true, sent: false, type, reason: 'Email notifications are not enabled for the configured user.', eventCount: events.length, dateKey: options.dateKey, weekKey: options.weekKey };
    }
    if (!(0, mailer_js_1.isEmailConfigured)()) {
        return { ok: false, sent: false, type, reason: 'Server email is not configured.', eventCount: events.length, dateKey: options.dateKey, weekKey: options.weekKey };
    }
    if (type === 'daily' && !prefs.dailyFundamentalEventsEmail) {
        return { ok: true, sent: false, type, reason: 'Daily fundamental events email is disabled.', eventCount: events.length, dateKey: options.dateKey };
    }
    if (type === 'weekly' && !prefs.weeklyFundamentalEventsEmail) {
        return { ok: true, sent: false, type, reason: 'Weekly fundamental events email is disabled.', eventCount: events.length, weekKey: options.weekKey };
    }
    if (!events.length) {
        return { ok: true, sent: false, type, reason: `No ${type === 'daily' ? 'today' : 'this week'} fundamental events to send.`, eventCount: 0, dateKey: options.dateKey, weekKey: options.weekKey };
    }
    const dedupeKey = `${userId}:${type}:${options.dateKey ?? options.weekKey ?? 'none'}`;
    if (!options.force && await hasNotificationBeenSent(dedupeKey, type, options.dateKey ?? null, options.weekKey ?? null)) {
        return { ok: true, sent: false, type, reason: `${type} email already sent for this period.`, eventCount: events.length, dateKey: options.dateKey, weekKey: options.weekKey };
    }
    const subject = type === 'weekly'
        ? `AlphaMentals Weekly Fundamental Events — ${options.weekLabel ?? ''}`
        : `AlphaMentals Alert — Today's Fundamental Events`;
    const body = type === 'weekly'
        ? buildWeeklyEmail(events, options.weekLabel ?? '', options.now)
        : buildDailyEmail(events, options.now);
    const result = await (0, mailer_js_1.sendMail)({
        to: prefs.emailRecipient,
        cc: prefs.emailCc ?? undefined,
        fromName: prefs.emailSenderName,
        subject,
        html: body.html,
        text: body.text,
    });
    await writeNotificationLog({
        user_id: userId,
        notification_type: type,
        event_ids: events.map((event) => event.id),
        date_key: options.dateKey ?? null,
        week_key: options.weekKey ?? null,
        subject,
        status: result.ok ? 'sent' : 'failed',
        error: result.ok ? null : (result.error ?? 'Unknown email error'),
        sent_at: new Date().toISOString(),
    });
    return {
        ok: result.ok,
        sent: result.ok,
        type,
        reason: result.ok ? undefined : result.error,
        emailId: result.ok ? (result.emailId ?? null) : null,
        eventCount: events.length,
        dateKey: options.dateKey,
        weekKey: options.weekKey,
    };
}
async function ensureFreshEvents() {
    const events = (0, fundamentals_service_js_1.getFundamentalsEvents)();
    const lastUpcoming = events.find((event) => event.status !== 'past');
    if (!lastUpcoming) {
        const overview = await (0, fundamentals_service_js_1.refreshFundamentalsData)({ triggeredBy: 'cron' });
        return overview.upcomingEvents;
    }
    return events;
}
async function hasNotificationBeenSent(dedupeKey, type, dateKey, weekKey) {
    if (notificationLogMemory.has(dedupeKey))
        return true;
    try {
        const { data } = await supabase_js_1.supabase
            .from('fundamental_event_notifications')
            .select('id')
            .eq('user_id', process.env.DEFAULT_USER_ID ?? '')
            .eq('notification_type', type)
            .eq(type === 'daily' ? 'date_key' : 'week_key', type === 'daily' ? dateKey : weekKey)
            .eq('status', 'sent')
            .limit(1);
        const exists = Boolean(data && data.length > 0);
        if (exists)
            notificationLogMemory.add(dedupeKey);
        return exists;
    }
    catch {
        return false;
    }
}
async function writeNotificationLog(row) {
    const dedupeKey = `${row.user_id}:${row.notification_type}:${row.date_key ?? row.week_key ?? 'none'}`;
    if (row.status === 'sent')
        notificationLogMemory.add(dedupeKey);
    try {
        await supabase_js_1.supabase.from('fundamental_event_notifications').insert(row);
    }
    catch (error) {
        console.warn('[fundamental-events] Failed to persist notification log:', error instanceof Error ? error.message : String(error));
    }
}
function buildDailyEmail(events, now) {
    const items = events
        .sort((a, b) => a.datetimeUtc.localeCompare(b.datetimeUtc))
        .map((event) => renderEventLine(event, true))
        .join('');
    const today = formatLocalDate(now);
    return {
        html: `
      <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;padding:24px;color:#111827;">
        <h2 style="margin:0 0 8px;">AlphaMentals Alert — Today's Fundamental Events</h2>
        <p style="margin:0 0 20px;color:#6b7280;">Today (${today}) important events in ${fundamentalEvents_js_1.APP_EVENT_TIMEZONE}.</p>
        ${items}
      </div>
    `,
        text: [
            `Today's important events (${today})`,
            '',
            ...events.sort((a, b) => a.datetimeUtc.localeCompare(b.datetimeUtc)).map((event) => renderEventText(event, true)),
        ].join('\n'),
    };
}
function buildWeeklyEmail(events, weekLabel, now) {
    const grouped = groupByDate(events);
    const sections = Object.entries(grouped).map(([date, dayEvents]) => `
    <h3 style="margin:20px 0 8px;">${dayEvents[0]?.dateLabel ?? date}</h3>
    ${dayEvents.map((event) => renderEventLine(event, false)).join('')}
  `).join('');
    return {
        html: `
      <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;padding:24px;color:#111827;">
        <h2 style="margin:0 0 8px;">AlphaMentals Weekly Fundamental Events — ${weekLabel}</h2>
        <p style="margin:0 0 20px;color:#6b7280;">This week's important market events. Generated ${formatLocalDateTime(now)} (${fundamentalEvents_js_1.APP_EVENT_TIMEZONE}).</p>
        ${sections}
      </div>
    `,
        text: [
            `AlphaMentals Weekly Fundamental Events — ${weekLabel}`,
            '',
            ...Object.entries(grouped).flatMap(([date, dayEvents]) => [
                `${dayEvents[0]?.dateLabel ?? date}:`,
                ...dayEvents.map((event) => renderEventText(event, false)),
                '',
            ]),
        ].join('\n'),
    };
}
function renderEventLine(event, includeWatchlist) {
    const watchlist = includeWatchlist ? `<p style="margin:6px 0 0;color:#374151;"><strong>Watchlist impact:</strong> ${formatSymbols(event.affectedSymbols)}</p>` : '';
    const ai = event.aiInterpretation ? `<p style="margin:6px 0 0;color:#374151;"><strong>Potential impact:</strong> ${event.aiInterpretation}</p>` : '';
    return `
    <div style="padding:12px 0;border-top:1px solid #e5e7eb;">
      <p style="margin:0;font-weight:700;">${event.dateTimeLabel} — ${event.currency ?? '—'} — ${event.eventName} — ${capitalize(event.impact)}</p>
      <p style="margin:6px 0 0;color:#4b5563;">Forecast: ${event.forecast ?? '—'} · Previous: ${event.previous ?? '—'} · Actual: ${event.actual ?? '—'}</p>
      ${watchlist}
      ${ai}
    </div>
  `;
}
function renderEventText(event, includeWatchlist) {
    return [
        `- ${event.dateTimeLabel} — ${event.currency ?? '—'} — ${event.eventName} — ${capitalize(event.impact)}`,
        `  Forecast: ${event.forecast ?? '—'}`,
        `  Previous: ${event.previous ?? '—'}`,
        `  Actual: ${event.actual ?? '—'}`,
        includeWatchlist ? `  Watchlist impact: ${formatSymbols(event.affectedSymbols)}` : null,
        event.aiInterpretation ? `  Potential impact: ${event.aiInterpretation}` : null,
    ].filter(Boolean).join('\n');
}
function groupByDate(events) {
    return events.reduce((acc, event) => {
        if (!acc[event.date])
            acc[event.date] = [];
        acc[event.date].push(event);
        return acc;
    }, {});
}
function formatSymbols(symbols) {
    if (!symbols.length)
        return 'XAUUSD, EURUSD, GBPUSD';
    return symbols.map((symbol) => symbol.replace('/', '')).join(', ');
}
function localDateKey(date) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: fundamentalEvents_js_1.APP_EVENT_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
    const month = parts.find((part) => part.type === 'month')?.value ?? '00';
    const day = parts.find((part) => part.type === 'day')?.value ?? '00';
    return `${year}-${month}-${day}`;
}
function formatLocalDate(date) {
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: fundamentalEvents_js_1.APP_EVENT_TIMEZONE,
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    }).format(date);
}
function formatLocalDateTime(date) {
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: fundamentalEvents_js_1.APP_EVENT_TIMEZONE,
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(date);
}
function capitalize(value) {
    return value.charAt(0).toUpperCase() + value.slice(1);
}
