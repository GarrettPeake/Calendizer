export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  OPENROUTER_MODEL?: string;
  OPENROUTER_API_KEY?: string;
  AUTH_SECRET?: string;
  INVITE_CODE?: string;
}

/** Hono context variables set by middleware. */
export type Vars = {
  userId: string;
};
