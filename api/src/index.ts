import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, Vars } from './env';
import type { GlobalConfig, Intent, Mode } from '../../src/index';
import { hashPassword, verifyPassword, signToken, verifyToken } from './auth';
import * as repo from './repo';
import { getSolved } from './solveService';
import { parseSmart } from './smart';

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

/* --------------------------------- auth --------------------------------- */

app.post('/api/auth/register', async (c) => {
  const secret = c.env.AUTH_SECRET;
  if (!secret) return c.json({ error: 'AUTH_SECRET not configured' }, 500);
  if (!c.env.INVITE_CODE) return c.json({ error: 'Registration is disabled (no INVITE_CODE)' }, 403);

  const body = (await c.req.json().catch(() => ({}))) as { username?: string; password?: string; invite?: string };
  const username = (body.username || '').trim();
  const password = body.password || '';
  if (body.invite !== c.env.INVITE_CODE) return c.json({ error: 'Invalid invite code' }, 403);
  if (username.length < 3 || password.length < 8)
    return c.json({ error: 'Username must be ≥3 chars and password ≥8 chars' }, 400);

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
  await repo.setConfig(c.env.DB, c.get('userId'), cfg);
  await invalidate(c);
  return c.json(cfg);
});

/* --------------------------------- intents --------------------------------- */

app.get('/api/intents', requireAuth, async (c) => c.json(await repo.listIntents(c.env.DB, c.get('userId'))));

app.post('/api/intents', requireAuth, async (c) => {
  const intent = await c.req.json<Intent>();
  const created = await repo.createIntent(c.env.DB, c.get('userId'), intent);
  await invalidate(c);
  return c.json(created, 201);
});

app.get('/api/intents/:id', requireAuth, async (c) => {
  const intent = await repo.getIntent(c.env.DB, c.get('userId'), c.req.param('id'));
  return intent ? c.json(intent) : c.json({ error: 'Not found' }, 404);
});

app.put('/api/intents/:id', requireAuth, async (c) => {
  const intent = await c.req.json<Intent>();
  const updated = await repo.updateIntent(c.env.DB, c.get('userId'), c.req.param('id'), intent);
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
  const created = await repo.createMode(c.env.DB, c.get('userId'), mode);
  await invalidate(c);
  return c.json(created, 201);
});

app.put('/api/modes/:id', requireAuth, async (c) => {
  const mode = await c.req.json<Mode>();
  const updated = await repo.updateMode(c.env.DB, c.get('userId'), c.req.param('id'), mode);
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

  const intent = await repo.createIntent(c.env.DB, userId, parsed.intent);
  let mode = null;
  if (parsed.mode?.name) {
    const existing = (await repo.listModes(c.env.DB, userId)).find((m) => m.name === parsed.mode!.name);
    mode = existing ?? (await repo.createMode(c.env.DB, userId, parsed.mode));
  }
  await invalidate(c);
  return c.json({ intent, mode, explanation: parsed.explanation }, 201);
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
