/**
 * Local solver debugging: re-solve a captured state with BOTH engines and dump
 * everything the MIP saw — per-stage LP text (human-readable CPLEX format),
 * objectives, timings, adoption/memo behaviour — plus a schedule diff.
 *
 * Usage:
 *   npm run debug:solve -- <state.json> [--today 2026-07-01] [--dump out/]
 *
 * state.json (assemble from a bug report + D1 dumps):
 *   {
 *     "config":  { ...GlobalConfig },
 *     "intents": [ ...Intent ],           // mode may be an id, name, default/all
 *     "modes":   [ {id?, name, span} ],   // optional
 *     "frozen":  [ ...Instance ],         // optional retained past
 *     "today":   "2026-07-01",            // optional; --today wins
 *     "horizonDays": 365                  // optional
 *   }
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { assembleSchedule, AssembleInput } from '../src/schedule';
import { greedySolver } from '../src/solver';
import { createMilpSolver } from '../src/milp/milpSolver';
import { StageTrace } from '../src/milp/stages';
import { Instance } from '../src/types';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const loadHighs = require('highs');

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function overlapMinutes(instances: Instance[]): number {
  const toAbs = (s: string) => Date.parse(s.slice(0, 10)) / 60000 + Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16));
  let total = 0;
  const sorted = [...instances].sort((a, b) => (a.start < b.start ? -1 : 1));
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[j].start >= sorted[i].end) break;
      const ov = Math.min(toAbs(sorted[i].end), toAbs(sorted[j].end)) - Math.max(toAbs(sorted[i].start), toAbs(sorted[j].start));
      if (ov > 0) total += ov;
    }
  }
  return total;
}

async function main() {
  const file = process.argv[2];
  if (!file || file.startsWith('--')) {
    console.error('usage: npm run debug:solve -- <state.json> [--today YYYY-MM-DD] [--dump dir/]');
    process.exit(1);
  }
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  const today: string = arg('--today') ?? state.today ?? new Date().toISOString().slice(0, 10);
  const dumpDir = arg('--dump');

  const base: Omit<AssembleInput, 'solver'> = {
    config: state.config,
    intents: state.intents ?? [],
    modeRecords: state.modes ?? [],
    frozen: state.frozen ?? [],
    nowDT: `${today}T00:00`,
    today,
    horizonDays: state.horizonDays ?? 365,
  };

  const g = assembleSchedule({ ...base, solver: greedySolver });

  const highs = await loadHighs();
  const weekLogs: string[] = [];
  const dumped: Array<{ name: string; trace: StageTrace }> = [];
  const milp = createMilpSolver(highs, {
    onWeek(wk, info) {
      if (info.skipped) {
        weekLogs.push(`${wk}: clean/adopted — greedy seed kept`);
        return;
      }
      const parts = (info.trace ?? []).map(
        (t) => `${t.name}=${Number.isNaN(t.objective) ? `ERROR(${t.error})` : t.objective}${t.ms ? ` ${t.ms}ms` : ''}`
      );
      weekLogs.push(`${wk}: ${info.fallback ? 'FALLBACK ' : ''}${info.memo ? '(memo) ' : ''}${parts.join('  ')}`);
      for (const t of info.trace ?? []) dumped.push({ name: `${wk}-${t.name.replace(/[^A-Za-z0-9_-]/g, '_')}`, trace: t });
    },
  });
  const m = assembleSchedule({ ...base, solver: milp });

  const summarize = (name: string, r: typeof g) =>
    console.log(
      `${name.padEnd(7)} ${r.instances.length} instances  ${r.conflicts.length} conflicts  ` +
        `${overlapMinutes(r.instances)} overlap-min  ${r.instances.reduce((s, i) => s + i.durationMin, 0)} total-min  ${r.solveMs}ms`
    );
  summarize('greedy', g);
  summarize('milp', m);
  console.log('\nPer-week:');
  for (const l of weekLogs) console.log('  ' + l);

  // Schedule diff (by uid).
  const byUid = new Map(g.instances.map((i) => [i.uid, i]));
  const diffs: string[] = [];
  for (const mi of m.instances) {
    const gi = byUid.get(mi.uid);
    if (!gi) diffs.push(`+ ${mi.uid}  ${mi.start}–${mi.end.slice(11)}  (milp only)`);
    else if (gi.start !== mi.start || gi.end !== mi.end)
      diffs.push(`~ ${mi.uid}  ${gi.start}–${gi.end.slice(11)}  →  ${mi.start}–${mi.end.slice(11)}`);
    byUid.delete(mi.uid);
  }
  for (const gi of byUid.values()) diffs.push(`- ${gi.uid}  ${gi.start}–${gi.end.slice(11)}  (greedy only)`);
  console.log(`\nDiff greedy → milp (${diffs.length} changes):`);
  for (const d of diffs.slice(0, 200)) console.log('  ' + d);
  if (diffs.length > 200) console.log(`  … ${diffs.length - 200} more`);

  if (dumpDir) {
    fs.mkdirSync(dumpDir, { recursive: true });
    for (const { name, trace } of dumped) {
      fs.writeFileSync(path.join(dumpDir, `${name}.lp`), trace.lp);
    }
    const sched = (r: typeof m) => r.instances.map((i) => `${i.start}–${i.end.slice(11)}  ${i.subject}`).join('\n');
    fs.writeFileSync(path.join(dumpDir, 'schedule-greedy.txt'), sched(g));
    fs.writeFileSync(path.join(dumpDir, 'schedule-milp.txt'), sched(m));
    fs.writeFileSync(
      path.join(dumpDir, 'conflicts.txt'),
      ['greedy:', ...g.conflicts.map((c) => `  ${c.kind} ${c.date ?? ''} ${c.message}`), 'milp:', ...m.conflicts.map((c) => `  ${c.kind} ${c.date ?? ''} ${c.message}`)].join('\n')
    );
    console.log(`\nDumped ${dumped.length} stage LPs + schedules to ${dumpDir}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
