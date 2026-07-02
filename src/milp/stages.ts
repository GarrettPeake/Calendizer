/**
 * Lexicographic stage driver: solve stage k, pin its optimum as a constraint,
 * solve stage k+1. Deterministic: fixed HiGHS options (single thread, fixed
 * seed, zero gap, NO wall-clock limits — those would break same-input-same-
 * output). All stage optima are integer-valued (integer data, integer vars;
 * slacks sit at integer bounds at the optimum), so pins use round(opt) + 0.5,
 * which admits no worse integer value.
 */
import { StageObjective, WeekModel } from './lp';

/**
 * The injected HiGHS instance (from the `highs` WASM package). `src/` never
 * imports the package itself — callers (web, cucumber, scripts) load the WASM
 * and hand the instance in, so the API Worker bundle stays WASM-free.
 */
export interface HighsInstance {
  solve(problem: string, options?: Record<string, unknown>): HighsResult;
}
/** Structural subset of the `highs` package's solution type (infeasible
 *  solutions carry no Primal — treated as unusable below). */
export interface HighsResult {
  Status: string;
  ObjectiveValue: number;
  /** Column objects carry `Primal` for feasible solutions (read defensively —
   *  the concrete `highs` package types vary by solution kind). */
  Columns: Record<string, unknown>;
}

export const HIGHS_OPTIONS: Record<string, unknown> = {
  threads: 1,
  random_seed: 0,
  mip_rel_gap: 0,
  mip_abs_gap: 0,
  output_flag: false,
  // Deterministic backstop (a NODE count, never wall-clock — wall-clock limits
  // would break same-input-same-output). A pathological stage stops here with
  // its best incumbent; the never-worse-than-seed guard below decides whether
  // to use the week at all.
  mip_max_nodes: 3000,
  // Spend more effort on primal heuristics — we want good incumbents early.
  mip_heuristic_effort: 0.2,
};

export interface StageTrace {
  name: string;
  objective: number;
  lp: string;
  /** Wall-clock solve time (diagnostic only — never used for control flow). */
  ms: number;
  /** Set when this stage aborted the run (status/exception). */
  error?: string;
}

export interface StagesResult {
  /**
   * Final variable values from the last solved stage — or null when EVERY
   * stage was already ideal at the greedy seed (keep the seed verbatim).
   */
  values: Map<string, number> | null;
  /** Per-stage objective values + the exact LP text solved (for debugging). */
  trace: StageTrace[];
}

/** Render one stage's full LP text: objective + base model + pins so far. */
export function stageLp(model: WeekModel, stage: StageObjective, pins: string[]): string {
  const obj = termsExpr(stage.terms) || '0 s0';
  const lines: string[] = ['Minimize', ` obj: ${obj}`, 'Subject To'];
  for (const c of model.constraints) lines.push(` ${c}`);
  for (const p of pins) lines.push(` ${p}`);
  lines.push('Bounds');
  for (const b of model.bounds) lines.push(` ${b}`);
  if (model.generals.length) {
    lines.push('General');
    lines.push(' ' + model.generals.join(' '));
  }
  if (model.binaries.length) {
    lines.push('Binary');
    lines.push(' ' + model.binaries.join(' '));
  }
  lines.push('End');
  return lines.join('\n');
}

function termsExpr(terms: Map<string, number>): string {
  const parts: string[] = [];
  for (const [name, coeff] of terms) {
    parts.push(coeff >= 0 ? `+ ${coeff} ${name}` : `- ${-coeff} ${name}`);
  }
  return parts.join(' ');
}

/**
 * Run all stages. `values: null` in the result means "keep the greedy seed"
 * (a stage failed, the node cap left the seed lexicographically ahead, or the
 * seed was already ideal everywhere); the trace always tells the story.
 */
export function runStages(highs: HighsInstance, model: WeekModel): StagesResult {
  const pins: string[] = [];
  const trace: StageTrace[] = [];
  // The incumbent starts as the greedy seed — any stage the seed already
  // solves ideally (clean tiers, all optionals placed, ...) skips its solve.
  let values: Map<string, number> = new Map(model.seedValues);
  let solvedAny = false;

  const evalTerms = (terms: Map<string, number>, vals: Map<string, number>): number => {
    let v = 0;
    for (const [name, coeff] of terms) v += coeff * (vals.get(name) ?? 0);
    return Math.round(v);
  };
  // The greedy seed's lexicographic tuple — the floor the result must beat.
  const seedTuple = model.stages.map((s) => evalTerms(s.terms, model.seedValues));
  const solvedTuple: number[] = [];

  let orderFixed = false;
  for (let k = 0; k < model.stages.length; k++) {
    const stage = model.stages[k];

    // Sliding tiers: freeze the pair-order binaries to the incumbent so the
    // stage reduces to a grid-integer LP.
    if (stage.fixOrder && !orderFixed) {
      orderFixed = true;
      let n = 0;
      for (const name of model.binaries) {
        if (name.startsWith('z')) {
          pins.push(`fixz${n++}: + 1 ${name} = ${Math.round(values.get(name) ?? 0)}`);
        }
      }
    }

    const incumbentVal = evalTerms(stage.terms, values);
    if (incumbentVal === stage.ideal) {
      trace.push({ name: stage.name, objective: stage.ideal, lp: '(skipped: incumbent already ideal)', ms: 0 });
      pins.push(`pin${k}: ${termsExpr(stage.terms)} <= ${stage.ideal + 0.5}`);
      solvedTuple.push(stage.ideal);
    } else {
      const lp = stageLp(model, stage, pins);
      const t0 = Date.now();
      let res: HighsResult;
      try {
        res = highs.solve(lp, stage.options ? { ...HIGHS_OPTIONS, ...stage.options } : HIGHS_OPTIONS);
      } catch (e) {
        trace.push({ name: stage.name, objective: NaN, lp, ms: Date.now() - t0, error: String(e) });
        return { values: null, trace };
      }
      // Accept the node-cap incumbent too (deterministic under fixed options);
      // anything without a usable solution aborts to the greedy seed.
      const usable =
        res.Columns && Object.keys(res.Columns).length > 0 && Number.isFinite(res.ObjectiveValue) && res.Status !== 'Infeasible';
      if (!usable) {
        trace.push({ name: stage.name, objective: NaN, lp, ms: Date.now() - t0, error: `status=${res.Status}` });
        return { values: null, trace };
      }
      values = new Map<string, number>();
      for (const [name, col] of Object.entries(res.Columns)) {
        values.set(name, (col as { Primal?: number }).Primal ?? 0);
      }
      solvedAny = true;
      const objective = evalTerms(stage.terms, values);
      trace.push({ name: stage.name, objective, lp, ms: Date.now() - t0 });
      solvedTuple.push(objective);
      // Pin: the stage expression may take no worse a value in later stages.
      pins.push(`pin${k}: ${termsExpr(stage.terms)} <= ${objective + 0.5}`);
    }
  }

  if (!solvedAny) {
    // Every stage was already ideal at the seed — nothing changed; tell the
    // caller to keep the greedy arrangement verbatim.
    return { values: null, trace };
  }
  // Never-worse-than-greedy guard: if the seed lexicographically beats (or
  // ties) what the stages produced — possible only when a node cap truncated a
  // search — keep the seed.
  for (let k = 0; k < seedTuple.length; k++) {
    if (solvedTuple[k] < seedTuple[k]) break; // solver strictly better
    if (solvedTuple[k] > seedTuple[k]) return { values: null, trace }; // seed better
    if (k === seedTuple.length - 1) return { values: null, trace }; // exact tie → keep seed
  }
  return { values, trace };
}
