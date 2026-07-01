import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, Vars } from './env';
import type { GlobalConfig, Intent, Mode, ValidationResult } from '../../src/index';
import { validateIntent, validateMode, validateConfig, validateCredentials } from '../../src/index';
import { hashPassword, verifyPassword, signToken, verifyToken } from './auth';
import * as repo from './repo';
import { getSolved } from './solveService';
import { parseSmart, parseSmartEdit } from './smart';

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

app.use('/api/*', cors());

/* ------------------------------ auth middleware ------------------------------ */

const requireAuth = async (c: any, next: any) => {
  const secret = c.env.AUTH_SECRET;
  if (!secret) return c.json({ error: 'AUTH_SECRET not configured' }, 500);
  const header = c.req.header('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const userId = token ? await verifyToken(token, secret) : null;
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  c.set('userId', userId);
  await next();
};

function feedUrl(c: any, secret: string): string {
  return `${new URL(c.req.url).origin}/feed/${secret}.ics`;
}
function publicUser(u: repo.UserRow) {
  return { id: u.id, username: u.username };
}
async function invalidate(c: any) {
  await repo.invalidateCache(c.env.DB, c.get('userId'));
}
/** First blocking error message, or null. Server rejects on errors; warnings pass. */
function firstError(r: ValidationResult): string | null {
  return r.errors.length ? r.errors[0].message : null;
}

/* --------------------------------- auth --------------------------------- */

app.post('/api/auth/register', async (c) => {
  const secret = c.env.AUTH_SECRET;
  if (!secret) return c.json({ error: 'AUTH_SECRET not configured' }, 500);
  if (!c.env.INVITE_CODE) return c.json({ error: 'Registration is disabled (no INVITE_CODE)' }, 403);

  const body = (await c.req.json().catch(() => ({}))) as { username?: string; password?: string; invite?: string };
  const username = (body.username || '').trim();
  const password = body.password || '';
  if (body.invite !== c.env.INVITE_CODE) return c.json({ error: 'Invalid invite code' }, 403);
  // Mirror the client's username/password rules (invite handled above).
  const cred = validateCredentials('register', { username, password });
  const credErr = cred.errors.find((e) => e.field === 'username' || e.field === 'password');
  if (credErr) return c.json({ error: credErr.message }, 400);

  if (await repo.getUserByUsername(c.env.DB, username)) return c.json({ error: 'Username taken' }, 409);

  const { hash, salt } = await hashPassword(password);
  const user = await repo.createUser(c.env.DB, username, hash, salt);
  const token = await signToken(user.id, secret);
  return c.json({ token, user: publicUser(user) }, 201);
});

app.post('/api/auth/login', async (c) => {
  const secret = c.env.AUTH_SECRET;
  if (!secret) return c.json({ error: 'AUTH_SECRET not configured' }, 500);
  const body = (await c.req.json().catch(() => ({}))) as { username?: string; password?: string };
  const user = await repo.getUserByUsername(c.env.DB, (body.username || '').trim());
  if (!user || !(await verifyPassword(body.password || '', user.password_hash, user.password_salt)))
    return c.json({ error: 'Invalid username or password' }, 401);
  const token = await signToken(user.id, secret);
  return c.json({ token, user: publicUser(user) });
});

app.get('/api/auth/me', requireAuth, async (c) => {
  const user = await repo.getUserById(c.env.DB, c.get('userId'));
  if (!user) return c.json({ error: 'Not found' }, 404);
  return c.json({ user: publicUser(user) });
});

/* --------------------------------- config --------------------------------- */

app.get('/api/config', requireAuth, async (c) => c.json(await repo.getConfig(c.env.DB, c.get('userId'))));

app.put('/api/config', requireAuth, async (c) => {
  const cfg = await c.req.json<GlobalConfig>();
  const err = firstError(validateConfig(cfg));
  if (err) return c.json({ error: err }, 400);
  await repo.setConfig(c.env.DB, c.get('userId'), cfg);
  await invalidate(c);
  return c.json(cfg);
});

/* --------------------------------- intents --------------------------------- */

app.get('/api/intents', requireAuth, async (c) => c.json(await repo.listIntents(c.env.DB, c.get('userId'))));

app.post('/api/intents', requireAuth, async (c) => {
  const intent = await c.req.json<Intent>();
  const userId = c.get('userId');
  const [config, modes] = await Promise.all([repo.getConfig(c.env.DB, userId), repo.listModes(c.env.DB, userId)]);
  const err = firstError(validateIntent(intent, { config, modes }));
  if (err) return c.json({ error: err }, 400);
  const created = await repo.createIntent(c.env.DB, userId, intent);
  await invalidate(c);
  return c.json(created, 201);
});

app.get('/api/intents/:id', requireAuth, async (c) => {
  const intent = await repo.getIntent(c.env.DB, c.get('userId'), c.req.param('id'));
  return intent ? c.json(intent) : c.json({ error: 'Not found' }, 404);
});

app.put('/api/intents/:id', requireAuth, async (c) => {
  const intent = await c.req.json<Intent>();
  const userId = c.get('userId');
  const [config, modes] = await Promise.all([repo.getConfig(c.env.DB, userId), repo.listModes(c.env.DB, userId)]);
  const err = firstError(validateIntent(intent, { config, modes }));
  if (err) return c.json({ error: err }, 400);
  const updated = await repo.updateIntent(c.env.DB, userId, c.req.param('id'), intent);
  if (!updated) return c.json({ error: 'Not found' }, 404);
  await invalidate(c);
  return c.json(updated);
});

app.delete('/api/intents/:id', requireAuth, async (c) => {
  const ok = await repo.deleteIntent(c.env.DB, c.get('userId'), c.req.param('id'));
  if (!ok) return c.json({ error: 'Not found' }, 404);
  await invalidate(c);
  return c.json({ ok: true });
});

/* --------------------------------- modes --------------------------------- */

app.get('/api/modes', requireAuth, async (c) => c.json(await repo.listModes(c.env.DB, c.get('userId'))));

app.post('/api/modes', requireAuth, async (c) => {
  const mode = await c.req.json<Mode>();
  const userId = c.get('userId');
  const others = await repo.listModes(c.env.DB, userId);
  const err = firstError(validateMode(mode, { others }));
  if (err) return c.json({ error: err }, 400);
  const created = await repo.createMode(c.env.DB, userId, mode);
  await invalidate(c);
  return c.json(created, 201);
});

app.put('/api/modes/:id', requireAuth, async (c) => {
  const mode = await c.req.json<Mode>();
  const userId = c.get('userId');
  const id = c.req.param('id');
  const others = (await repo.listModes(c.env.DB, userId)).filter((m) => m.id !== id);
  const err = firstError(validateMode(mode, { others }));
  if (err) return c.json({ error: err }, 400);
  const updated = await repo.updateMode(c.env.DB, userId, id, mode);
  if (!updated) return c.json({ error: 'Not found' }, 404);
  await invalidate(c);
  return c.json(updated);
});

app.delete('/api/modes/:id', requireAuth, async (c) => {
  const ok = await repo.deleteMode(c.env.DB, c.get('userId'), c.req.param('id'));
  if (!ok) return c.json({ error: 'Not found' }, 404);
  await invalidate(c);
  return c.json({ ok: true });
});

/* --------------------------------- smart --------------------------------- */

app.post('/api/smart', requireAuth, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { query?: string };
  const query = (body.query || '').trim();
  if (!query) return c.json({ error: 'Empty query' }, 400);

  const userId = c.get('userId');
  const config = await repo.getConfig(c.env.DB, userId);
  const today = new Date(Date.now() + (config.utcOffsetMinutes ?? 0) * 60_000).toISOString().slice(0, 10);

  let parsed;
  try {
    parsed = await parseSmart(c.env, query, {
      today,
      wakeup: String(config.wakeup),
      sleep: String(config.sleep),
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }

  // The model returns mode as a NAME (or "default"/"all"); resolve it to a stored
  // mode ID so the intent links by id, not name.
  let modeRecord = null;
  let modeRef = parsed.intent.mode;
  if (modeRef && modeRef !== 'default' && modeRef !== 'all') {
    const modes = await repo.listModes(c.env.DB, userId);
    modeRecord = modes.find((m) => m.name === modeRef) ?? null;
    if (!modeRecord && parsed.mode?.name) {
      modeRecord = await repo.createMode(c.env.DB, userId, { name: parsed.mode.name, span: parsed.mode.span });
    }
    modeRef = modeRecord ? modeRecord.id : 'default';
  }
  const draft = { ...parsed.intent, mode: modeRef };
  const allModes = await repo.listModes(c.env.DB, userId);
  const err = firstError(validateIntent(draft, { config, modes: allModes }));
  if (err) return c.json({ error: `The AI produced an invalid intent: ${err}`, explanation: parsed.explanation }, 422);
  const intent = await repo.createIntent(c.env.DB, userId, draft);
  await invalidate(c);
  return c.json({ intent, mode: modeRecord, explanation: parsed.explanation }, 201);
});

// Propose an edit to an intent from a natural-language instruction. Does NOT
// persist — returns the updated intent to populate the editor for review, plus a
// summary and any parts of the request that could not be represented.
app.post('/api/smart/edit', requireAuth, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { intent?: Intent; instruction?: string };
  if (!body.intent || !body.instruction?.trim()) return c.json({ error: 'intent and instruction are required' }, 400);

  const userId = c.get('userId');
  const config = await repo.getConfig(c.env.DB, userId);
  const today = new Date(Date.now() + (config.utcOffsetMinutes ?? 0) * 60_000).toISOString().slice(0, 10);

  // Keep the model in name-space: translate the intent's mode id → name on the
  // way in, and the returned name → id on the way out (preserving the original
  // link if the model names a mode that doesn't exist).
  const modes = await repo.listModes(c.env.DB, userId);
  const idToName = new Map(modes.map((m) => [m.id, m.name] as const));
  const nameToId = new Map(modes.map((m) => [m.name, m.id] as const));
  const original = body.intent;
  const forLLM: Intent = {
    ...original,
    mode: original.mode === 'default' || original.mode === 'all' ? original.mode : idToName.get(original.mode) ?? original.mode,
  };

  try {
    const result = await parseSmartEdit(c.env, forLLM, body.instruction.trim(), {
      today,
      wakeup: String(config.wakeup),
      sleep: String(config.sleep),
    });
    const rm = result.intent.mode;
    result.intent.mode = rm === 'default' || rm === 'all' ? rm : nameToId.get(rm) ?? original.mode;
    return c.json(result);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

/* --------------------------------- geo (IP-based, no browser prompt) --------------------------------- */

app.get('/api/geo', requireAuth, (c) => {
  const cf = ((c.req.raw as any).cf ?? {}) as { latitude?: string; longitude?: string; city?: string; region?: string; country?: string; timezone?: string };
  const lat = cf.latitude != null ? Math.round(parseFloat(cf.latitude) * 100) / 100 : undefined;
  const lon = cf.longitude != null ? Math.round(parseFloat(cf.longitude) * 100) / 100 : undefined;
  return c.json({
    lat: Number.isFinite(lat) ? lat : undefined,
    lon: Number.isFinite(lon) ? lon : undefined,
    city: cf.city,
    region: cf.region,
    country: cf.country,
    timezone: cf.timezone,
  });
});

/* --------------------------------- solve + metrics --------------------------------- */

app.get('/api/solve', requireAuth, async (c) => {
  const r = await getSolved(c.env.DB, c.get('userId'));
  c.header('X-Solve-Ms', String(r.solveMs));
  return c.json({
    instances: r.instances,
    conflicts: r.conflicts,
    horizon: r.horizon,
    solveMs: r.solveMs,
    computedAt: r.computedAt,
    cached: r.cached,
  });
});

app.get('/api/metrics', requireAuth, async (c) => {
  const recent = await repo.listMetrics(c.env.DB, c.get('userId'), 50);
  const lastMs = recent[0]?.solve_ms ?? null;
  const avgMs = recent.length ? Math.round(recent.reduce((a, r) => a + r.solve_ms, 0) / recent.length) : null;
  return c.json({ recent, lastMs, avgMs });
});

/* --------------------------------- bug reports --------------------------------- */

app.post('/api/bugs', requireAuth, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    description?: string;
    clientDatetime?: string;
    timezone?: string;
    config?: unknown;
    weekStart?: string;
    weekEnd?: string;
    schedule?: unknown;
  };
  const description = (body.description || '').trim();
  if (!description) return c.json({ error: 'A description is required' }, 400);

  const userId = c.get('userId');
  const user = await repo.getUserById(c.env.DB, userId);
  const saved = await repo.createBugReport(c.env.DB, userId, user?.username ?? '', {
    description,
    clientDatetime: body.clientDatetime,
    timezone: body.timezone,
    config: body.config ?? null,
    weekStart: body.weekStart,
    weekEnd: body.weekEnd,
    schedule: body.schedule ?? [],
  });
  return c.json({ ok: true, id: saved.id }, 201);
});

/* --------------------------------- feed mgmt + public feed --------------------------------- */

app.get('/api/feed', requireAuth, async (c) => {
  const user = await repo.getUserById(c.env.DB, c.get('userId'));
  if (!user) return c.json({ error: 'Not found' }, 404);
  return c.json({ url: feedUrl(c, user.feed_secret), rotatedAt: user.feed_rotated_at });
});

app.post('/api/feed/rotate', requireAuth, async (c) => {
  const secret = await repo.rotateFeedSecret(c.env.DB, c.get('userId'));
  return c.json({ url: feedUrl(c, secret), rotatedAt: new Date().toISOString() });
});

app.get('/feed/:file', async (c) => {
  const file = c.req.param('file');
  const secret = file.replace(/\.ics$/i, '');
  const user = await repo.getUserByFeedSecret(c.env.DB, secret);
  if (!user) return c.text('Not found', 404);
  const r = await getSolved(c.env.DB, user.id);
  return new Response(r.ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="calendizer.ics"`,
      'X-Solve-Ms': String(r.solveMs),
      'Cache-Control': 'public, max-age=300',
    },
  });
});

/* --------------------------------- static assets (SPA) --------------------------------- */

app.get('/api/*', (c) => c.json({ error: 'Not found' }, 404));
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
