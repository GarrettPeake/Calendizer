/**
 * Thin client for the Calendizer Worker API. Same-origin in production (the Worker
 * serves this SPA); in dev, Vite proxies /api and /feed to `wrangler dev`.
 */
import type { GlobalConfig, Intent, Mode, Instance, ConflictReport } from 'calendizer';

export type ModeRecord = Mode & { id: string };

export interface SolveResponse {
  instances: Instance[];
  conflicts: ConflictReport[];
  horizon: { start: string; end: string };
  solveMs: number;
  computedAt: string;
  cached: boolean;
}
/** The stored calendar; `horizon` is null before the first publish. */
export interface StoredCalendar {
  instances: Instance[];
  conflicts: ConflictReport[];
  horizon: { start: string; end: string } | null;
  solveMs?: number;
  computedAt: string | null;
  cached: boolean;
}
/** The full desired input state — publish replaces the stored set wholesale. */
export interface PublishState {
  config: GlobalConfig;
  intents: Intent[];
  modes: ModeRecord[];
}
export interface CalendarPayload {
  instances: Instance[];
  conflicts: ConflictReport[];
  horizon: { start: string; end: string };
  computedAt?: string;
  solveMs?: number;
}
export interface User {
  id: string;
  username: string;
}
export interface FeedInfo {
  url: string;
  rotatedAt: string | null;
}
export interface MetricsResponse {
  recent: { solve_ms: number; instance_count: number; intent_count: number; computed_at: string }[];
  lastMs: number | null;
  avgMs: number | null;
}

/** Error carrying the HTTP status so callers can map codes to friendly messages. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const TOKEN_KEY = 'calendizer_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) setToken(null);
    throw new ApiError(res.status, (data as any)?.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  // auth
  register: (username: string, password: string, invite: string) =>
    req<{ token: string; user: User }>('POST', '/auth/register', { username, password, invite }),
  login: (username: string, password: string) =>
    req<{ token: string; user: User }>('POST', '/auth/login', { username, password }),
  me: () => req<{ user: User }>('GET', '/auth/me'),

  // reads (initial load)
  getConfig: () => req<GlobalConfig>('GET', '/config'),
  listIntents: () => req<Intent[]>('GET', '/intents'),
  listModes: () => req<ModeRecord[]>('GET', '/modes'),
  getCalendar: () => req<StoredCalendar>('GET', '/calendar'),

  // atomic write: the full input state + the client-recomputed calendar in one request
  publish: (state: PublishState, calendar: CalendarPayload) =>
    req<SolveResponse>('POST', '/publish', { state, calendar }),

  // smart — parse only; the client adds the result to state and publishes
  smart: (query: string) =>
    req<{ intent: Intent; mode: { name: string; span: [string, string] } | null; explanation: string }>(
      'POST',
      '/smart',
      { query }
    ),
  smartEdit: (intent: Intent, instruction: string) =>
    req<{ intent: Intent; updates: string; issues: string[] }>('POST', '/smart/edit', { intent, instruction }),

  // geo (IP-based, no browser prompt)
  geo: () =>
    req<{ lat?: number; lon?: number; city?: string; region?: string; country?: string; timezone?: string }>('GET', '/geo'),

  // bug reports
  reportBug: (payload: {
    description: string;
    clientDatetime: string;
    timezone: string;
    config: GlobalConfig | null;
    weekStart: string;
    weekEnd: string;
    schedule: Instance[];
  }) => req<{ ok: boolean; id: string }>('POST', '/bugs', payload),

  // metrics + feed
  metrics: () => req<MetricsResponse>('GET', '/metrics'),
  getFeed: () => req<FeedInfo>('GET', '/feed'),
  rotateFeed: () => req<FeedInfo>('POST', '/feed/rotate'),
};
