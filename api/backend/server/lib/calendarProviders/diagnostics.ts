export interface CalendarProviderDiagnostics {
  enabled: boolean;
  ok: boolean;
  error: string | null;
  lastStatus: number | null;
  lastCheckedAt: string | null;
  checkedUrl?: string | null;
  provider?: string;
  cooldownUntil?: string | null;
}

export class CalendarProviderError extends Error {
  code: string;
  status: number | null;
  checkedUrl: string | null;

  constructor(message: string, options: { code: string; status?: number | null; checkedUrl?: string | null }) {
    super(message);
    this.name = 'CalendarProviderError';
    this.code = options.code;
    this.status = options.status ?? null;
    this.checkedUrl = options.checkedUrl ?? null;
  }
}
