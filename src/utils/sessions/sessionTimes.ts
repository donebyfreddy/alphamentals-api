export type SessionName = 'ASIA' | 'LONDON' | 'NEW_YORK' | 'LONDON_NY_OVERLAP' | 'OFF_HOURS';

export interface SessionInfo {
  name: SessionName;
  displayName: string;
  start: string;
  end: string;
  timezone: string;
}

const SESSIONS: SessionInfo[] = [
  { name: 'ASIA', displayName: 'Asia', start: '00:00', end: '09:00', timezone: 'UTC' },
  { name: 'LONDON', displayName: 'London', start: '08:00', end: '17:00', timezone: 'UTC' },
  { name: 'NEW_YORK', displayName: 'New York', start: '13:00', end: '22:00', timezone: 'UTC' },
  { name: 'LONDON_NY_OVERLAP', displayName: 'London/NY', start: '13:00', end: '17:00', timezone: 'UTC' },
];

export function getActiveSession(_now?: Date): SessionInfo | null {
  return null;
}

export function getNextSession(_now?: Date): SessionInfo | null {
  return SESSIONS[1];
}
