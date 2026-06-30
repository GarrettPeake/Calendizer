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
    throw new Error((data as any)?.error || `Request failed (${res.status})`);
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

  // config
  getConfig: () => req<GlobalConfig>('GET', '/config'),
  putConfig: (config: GlobalConfig) => req<GlobalConfig>('PUT', '/config', config),

  // intents
  listIntents: () => req<Intent[]>('GET', '/intents'),
  createIntent: (intent: Intent) => req<Intent>('POST', '/intents', intent),
  updateIntent: (id: string, intent: Intent) => req<Intent>('PUT', `/intents/${id}`, intent),
  deleteIntent: (id: string) => req<{ ok: boolean }>('DELETE', `/intents/${id}`),

  // modes
  listModes: () => req<ModeRecord[]>('GET', '/modes'),
  createMode: (mode: Mode) => req<ModeRecord>('POST', '/modes', mode),
  updateMode: (id: string, mode: Mode) => req<ModeRecord>('PUT', `/modes/${id}`, mode),
  deleteMode: (id: string) => req<{ ok: boolean }>('DELETE', `/modes/${id}`),

  // smart
  smart: (query: string) =>
    req<{ intent: Intent; mode: ModeRecord | null; explanation: string }>('POST', '/smart', { query }),
  smartEdit: (intent: Intent, instruction: string) =>
    req<{ intent: Intent; updates: string; issues: string[] }>('POST', '/smart/edit', { intent, instruction }),

  // geo (IP-based, no browser prompt)
  geo: () =>
    req<{ lat?: number; lon?: number; city?: string; region?: string; country?: string; timezone?: string }>('GET', '/geo'),

  // solve + metrics + feed
  solve: () => req<SolveResponse>('GET', '/solve'),
  metrics: () => req<MetricsResponse>('GET', '/metrics'),
  getFeed: () => req<FeedInfo>('GET', '/feed'),
  rotateFeed: () => req<FeedInfo>('POST', '/feed/rotate'),
};
