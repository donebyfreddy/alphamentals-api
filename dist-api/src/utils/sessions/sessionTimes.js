"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getActiveSession = getActiveSession;
exports.getNextSession = getNextSession;
const SESSIONS = [
    { name: 'ASIA', displayName: 'Asia', start: '00:00', end: '09:00', timezone: 'UTC' },
    { name: 'LONDON', displayName: 'London', start: '08:00', end: '17:00', timezone: 'UTC' },
    { name: 'NEW_YORK', displayName: 'New York', start: '13:00', end: '22:00', timezone: 'UTC' },
    { name: 'LONDON_NY_OVERLAP', displayName: 'London/NY', start: '13:00', end: '17:00', timezone: 'UTC' },
];
function getActiveSession(_now) {
    return null;
}
function getNextSession(_now) {
    const next = SESSIONS[1];
    if (!next)
        return null;
    return { session: next, opensInMinutes: 0, closesInMinutes: 60 };
}
