#!/usr/bin/env node
/**
 * Bug-report triage: reads the `bug_reports` table via `wrangler d1 execute` and
 * prints a readable digest. Local by default.
 *
 *   node scripts/triage.mjs                # last 20, local DB
 *   node scripts/triage.mjs --remote       # against the deployed D1
 *   node scripts/triage.mjs --limit 50     # more rows
 *   node scripts/triage.mjs --full         # dump full config + schedule JSON
 *   node scripts/triage.mjs --id <uuid>    # one report, full detail
 *
 * (npm: `npm run bugs`, `npm run bugs:remote`)
 */
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const remote = has('--remote');
const full = has('--full');
const id = val('--id', null);
const limit = Number(val('--limit', '20')) || 20;

const where = id ? `WHERE id = '${id.replace(/'/g, "''")}'` : '';
const sql =
  `SELECT id, username, description, client_datetime, timezone, week_start, week_end, schedule_json, config_json, created_at ` +
  `FROM bug_reports ${where} ORDER BY created_at DESC LIMIT ${id ? 1 : limit};`;

let raw;
try {
  raw = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'calendizer', remote ? '--remote' : '--local', '--json', '--command', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 }
  );
} catch (e) {
  console.error('Failed to query D1. Is wrangler installed and the DB migrated?');
  process.exit(1);
}

// wrangler --json prints a JSON array; slice from the first bracket to be safe.
const start = raw.indexOf('[');
const parsed = JSON.parse(raw.slice(start));
const rows = (Array.isArray(parsed) ? parsed[0]?.results : parsed?.results) ?? [];

if (!rows.length) {
  console.log(`No bug reports found (${remote ? 'remote' : 'local'}).`);
  process.exit(0);
}

const line = '─'.repeat(72);
console.log(`\n${rows.length} bug report(s) — ${remote ? 'remote' : 'local'}\n`);

for (const r of rows) {
  const cfg = safeParse(r.config_json);
  const sched = safeParse(r.schedule_json) ?? [];
  console.log(line);
  console.log(`#${r.id}`);
  console.log(`  by:        ${r.username}    submitted: ${r.created_at}`);
  console.log(`  user time: ${r.client_datetime ?? '—'}  (${r.timezone ?? '—'})`);
  console.log(`  week:      ${r.week_start ?? '—'} → ${r.week_end ?? '—'}   (${Array.isArray(sched) ? sched.length : 0} events)`);
  if (cfg) {
    console.log(
      `  config:    wake ${cfg.wakeup} · sleep ${cfg.sleep} · grid ${cfg.grid} · pad ${cfg.padding} · ` +
        `city ${cfg.city ?? '—'} · fillToMax ${cfg.fillToMax ? 'on' : 'off'}`
    );
  }
  console.log(`\n  “${r.description}”\n`);
  if (full) {
    console.log('  --- config ---');
    console.log(indent(JSON.stringify(cfg, null, 2)));
    console.log('  --- schedule ---');
    console.log(indent(JSON.stringify(sched, null, 2)));
    console.log('');
  }
}
console.log(line);
if (!full && !id) console.log('Tip: `--full` for full JSON, or `--id <uuid>` for one report.\n');

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
function indent(s) {
  return s
    .split('\n')
    .map((l) => '    ' + l)
    .join('\n');
}
