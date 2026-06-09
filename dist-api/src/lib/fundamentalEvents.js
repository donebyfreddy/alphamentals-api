"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.APP_EVENT_TIMEZONE = void 0;
exports.getWeekWindow = getWeekWindow;
exports.deriveFundamentalEventTiming = deriveFundamentalEventTiming;
exports.APP_EVENT_TIMEZONE = 'America/New_York';
function getWeekWindow(date, _timezone) {
    const d = date ?? new Date();
    const day = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((day + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    const from = monday.toISOString().split('T')[0];
    const to = sunday.toISOString().split('T')[0];
    return { from, to, weekKey: `${from}/${to}`, label: `Week of ${from}` };
}
function deriveFundamentalEventTiming(_event) {
    const raw = _event.rawDateTime
        ?? (_event.rawDate ? `${_event.rawDate}T${_event.rawTime ?? '00:00'}:00Z` : null)
        ?? (_event.date ? `${_event.date}T${_event.time ?? '00:00'}:00Z` : null);
    if (!raw)
        return null;
    const date = raw.split('T')[0] ?? raw.slice(0, 10);
    const time = raw.includes('T') ? raw.split('T')[1]?.slice(0, 5) ?? '00:00' : '00:00';
    const providerTimezone = _event.providerTimezone ?? 'UTC';
    const appTimezone = _event.appTimezone ?? exports.APP_EVENT_TIMEZONE;
    return {
        date,
        time,
        datetimeUtc: raw,
        datetimeLocal: raw,
        timezone: appTimezone,
        providerTimezone,
        dateLabel: date,
        dateTimeLabel: `${date} ${time}`,
        status: 'upcoming',
        isPast: false,
        isToday: false,
        isThisWeek: false,
        isUpcoming: true,
        isNext4Hours: false,
        rawDateTime: _event.rawDateTime ?? null,
        rawDate: _event.rawDate ?? null,
        rawTime: _event.rawTime ?? null,
    };
}
