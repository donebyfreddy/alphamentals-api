const FUNDAMENTALS_AI_TIMEZONE = 'Europe/Madrid';
const FUNDAMENTALS_AI_SCHEDULE_HOURS = [7, 13, 15] as const;

export type FundamentalsAiRunType = 'scheduled' | 'manual';

export interface FundamentalsAiScheduleStatus {
  allowed: boolean;
  reason: string | null;
  currentMadridIso: string;
  currentWeekday: number;
  matchedHour: number | null;
}

function zonedParts(date: Date, timeZone = FUNDAMENTALS_AI_TIMEZONE) {
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

  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');
  const weekdayLabel = parts.find((part) => part.type === 'weekday')?.value ?? 'Mon';
  const weekdayMap: Record<string, number> = {
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

function utcDateForZonedTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
  timeZone = FUNDAMENTALS_AI_TIMEZONE,
) {
  const approximateUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const local = zonedParts(approximateUtc, timeZone);
  const targetMinutes = hour * 60 + minute;
  const actualMinutes = local.hour * 60 + local.minute;
  return new Date(approximateUtc.getTime() + (targetMinutes - actualMinutes) * 60_000);
}

function advanceOneMadridDay(date: Date, timeZone = FUNDAMENTALS_AI_TIMEZONE) {
  const parts = zonedParts(date, timeZone);
  const anchor = utcDateForZonedTime(parts.year, parts.month, parts.day, 23, 59, 59, timeZone);
  return new Date(anchor.getTime() + 1_000);
}

export function getFundamentalsAiTimezone() {
  return FUNDAMENTALS_AI_TIMEZONE;
}

export function getFundamentalsAiScheduleHours() {
  return [...FUNDAMENTALS_AI_SCHEDULE_HOURS];
}

export function getNextFundamentalsAiRun(now = new Date()) {
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

export function getFundamentalsAiScheduleStatus(now = new Date()): FundamentalsAiScheduleStatus {
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

