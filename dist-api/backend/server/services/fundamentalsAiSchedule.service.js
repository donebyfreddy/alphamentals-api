"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFundamentalsAiTimezone = getFundamentalsAiTimezone;
exports.getFundamentalsAiScheduleHours = getFundamentalsAiScheduleHours;
exports.getNextFundamentalsAiRun = getNextFundamentalsAiRun;
exports.getFundamentalsAiScheduleStatus = getFundamentalsAiScheduleStatus;
const FUNDAMENTALS_AI_TIMEZONE = 'Europe/Madrid';
const FUNDAMENTALS_AI_SCHEDULE_HOURS = [7, 13, 15];
function zonedParts(date, timeZone = FUNDAMENTALS_AI_TIMEZONE) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        weekday: 'short',
        hourCycle: 'h23',
    }).formatToParts(date);
    const get = (type) => Number(parts.find((part) => part.type === type)?.value ?? '0');
    const weekdayLabel = parts.find((part) => part.type === 'weekday')?.value ?? 'Mon';
    const weekdayMap = {
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
        Sun: 7,
    };
    return {
        year: get('year'),
        month: get('month'),
        day: get('day'),
        hour: get('hour'),
        minute: get('minute'),
        second: get('second'),
        weekday: weekdayMap[weekdayLabel] ?? 1,
    };
}
function utcDateForZonedTime(year, month, day, hour, minute, second = 0, timeZone = FUNDAMENTALS_AI_TIMEZONE) {
    const approximateUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    const local = zonedParts(approximateUtc, timeZone);
    const targetMinutes = hour * 60 + minute;
    const actualMinutes = local.hour * 60 + local.minute;
    return new Date(approximateUtc.getTime() + (targetMinutes - actualMinutes) * 60_000);
}
function advanceOneMadridDay(date, timeZone = FUNDAMENTALS_AI_TIMEZONE) {
    const parts = zonedParts(date, timeZone);
    const anchor = utcDateForZonedTime(parts.year, parts.month, parts.day, 23, 59, 59, timeZone);
    return new Date(anchor.getTime() + 1_000);
}
function getFundamentalsAiTimezone() {
    return FUNDAMENTALS_AI_TIMEZONE;
}
function getFundamentalsAiScheduleHours() {
    return [...FUNDAMENTALS_AI_SCHEDULE_HOURS];
}
function getNextFundamentalsAiRun(now = new Date()) {
    let cursor = now;
    for (let dayOffset = 0; dayOffset < 8; dayOffset += 1) {
        const parts = zonedParts(cursor);
        const isWeekday = parts.weekday >= 1 && parts.weekday <= 5;
        if (isWeekday) {
            for (const hour of FUNDAMENTALS_AI_SCHEDULE_HOURS) {
                const candidate = utcDateForZonedTime(parts.year, parts.month, parts.day, hour, 0);
                if (candidate.getTime() > now.getTime()) {
                    return candidate;
                }
            }
        }
        cursor = advanceOneMadridDay(cursor);
    }
    return advanceOneMadridDay(now);
}
function getFundamentalsAiScheduleStatus(now = new Date()) {
    const parts = zonedParts(now);
    const madridIso = utcDateForZonedTime(parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second).toISOString();
    const isWeekday = parts.weekday >= 1 && parts.weekday <= 5;
    const matchedHour = FUNDAMENTALS_AI_SCHEDULE_HOURS.find((hour) => hour === parts.hour) ?? null;
    const matchedMinute = parts.minute === 0;
    if (!isWeekday) {
        return {
            allowed: false,
            reason: 'Scheduled AI analysis only runs Monday to Friday in Europe/Madrid.',
            currentMadridIso: madridIso,
            currentWeekday: parts.weekday,
            matchedHour: null,
        };
    }
    if (matchedHour == null || !matchedMinute) {
        return {
            allowed: false,
            reason: 'Scheduled AI analysis only runs at 07:00, 13:00, and 15:00 Europe/Madrid.',
            currentMadridIso: madridIso,
            currentWeekday: parts.weekday,
            matchedHour,
        };
    }
    return {
        allowed: true,
        reason: null,
        currentMadridIso: madridIso,
        currentWeekday: parts.weekday,
        matchedHour,
    };
}
