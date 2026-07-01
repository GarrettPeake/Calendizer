/**
 * Natural-language helpers via OpenRouter (DeepSeek), server-side only.
 *  - parseSmart:    free-text → a brand new intent (persisted by the caller).
 *  - parseSmartEdit: current intent + instruction → the proposed updated intent,
 *    a summary, and a list of unrepresentable parts (NOT persisted — the user
 *    reviews the populated form before saving).
 */
import type { Intent, Mode } from '../../src/index';
import type { Env } from './env';

const INTENT_SCHEMA = `The Intent type (TypeScript):
interface Intent {
  subject: string;                 // short label, e.g. "guitar practice"
  mode: string;                    // "default" normally; "all" for must-happen-always; or a mode name
  priority: number;                // 0-100, higher wins contention
  duration: [number, number];      // [minMinutes, maxMinutes]; equal ⇒ fixed length
  window: {
    not_before?: TimeValue;        // earliest start
    not_after?: TimeValue;         // latest end
    starts_at?: TimeValue;         // pin the start exactly (mutually exclusive with ends_at)
    ends_at?: TimeValue;           // pin the end exactly (e.g. butt a routine up against bedtime)
    overrides?: { "<WEEKDAYS>": Partial<Window> };
  };
  children?: ({subject:string,duration:number} | {subject:string,weight:number})[];
  cardinality: {
    period?: { unit: "day"|"week"|"month"|"mode", interval?: number };
    days?: { count: [number,number] } | { weekdays: string[] } | { dates: string[] };
    per_day?: { count: [number,number] };
    total?: [number|null, number|null];
  };
}
type TimeValue = "HH:MM" | { marker: "wakeup"|"sleep"|"dawn"|"dusk"|"sunrise"|"sunset", offset_min?: number };
interface Mode { name: string; span: [startDate, endDate]; }  // dates "YYYY-MM-DD"
Weekday codes: MO TU WE TH FR SA SU. Clock times must be 00:00–23:59.`;

const CREATE_SYSTEM_PROMPT = `You translate a person's natural-language description of something they want on their calendar into ONE structured "intent" for a deterministic scheduling solver. You are a TRANSLATOR ONLY: emit symbolic time markers (like "sunset") when relevant — never resolve them to clock times, and never pick concrete clock times unless the user gave one.

Return ONLY a single JSON object (no markdown, no prose) of the shape:
{ "intent": Intent, "mode": Mode | null, "explanation": string }

${INTENT_SCHEMA}

Rules:
- A one-off on a specific day → cardinality.days.dates: ["YYYY-MM-DD"] (compute from "today"). No period needed.
- "N times a week" → period {unit:"week"} + days {count:[N,N]}.
- "every day" → period {unit:"day", interval:1} + per_day {count:[1,1]}.
- Specific weekdays → days {weekdays:[...]}. "twice a day" → per_day {count:[2,2]}.
- "at least twice during X" (a span) → emit a Mode for X, intent.mode = that mode name, period {unit:"mode"}, total:[2,null].
- "after I wake up" → not_before {marker:"wakeup"}; "before bed" → not_after {marker:"sleep"}; "at sunset" → {marker:"sunset"}.
- If the user gives an explicit clock time, use it. If a duration range is implied ("1-2 hours") use [60,120]. Choose a concise lowercase subject.

Example: "practice guitar 3 times this week for 1-2 hours in the evening"
{"intent":{"subject":"guitar practice","mode":"default","priority":45,"duration":[60,120],"window":{"not_before":"17:00","not_after":"22:00"},"cardinality":{"period":{"unit":"week","interval":1},"days":{"count":[3,3]}}},"mode":null,"explanation":"Three 1-2h evening guitar sessions this week."}`;

const EDIT_SYSTEM_PROMPT = `You edit an EXISTING calendar "intent" for a deterministic scheduling solver according to a natural-language instruction.

You are given the CURRENT intent as JSON plus an instruction. Apply ONLY the changes that are representable in the schema; preserve every other field of the current intent EXACTLY. Never produce impossible values (clock times 00:00–23:59; durations positive minutes with min ≤ max; priority 0–100; only the listed markers and weekday codes). If part of the request is impossible or nonsensical, leave that part unchanged and record it under "issues".

Return ONLY a JSON object (no markdown, no prose):
{
  "intent": <the FULL updated Intent, same shape as the input, keeping its "id">,
  "updates": "<one short sentence summarizing what changed, or exactly 'No update made'>",
  "issues": [ <one string per part of the request that could NOT be represented, explaining why; [] if none> ]
}

${INTENT_SCHEMA}

Examples:
- Instruction "make it 4 times a week instead of 3" on days.count [3,3] → intent days.count [4,4], updates "Changed to 4 times per week.", issues [].
- Instruction "set the start time to 25 o'clock" → window unchanged, updates "No update made", issues ["There are only 24 hours in a day (00:00–23:59)."]
- Instruction "move it to mornings and add a 5-minute warm-up first" → window not_before/not_after shifted to morning, children prepended with a warm-up; updates summarizes both; issues [] (or note anything not representable).`;

export interface SmartResult {
  intent: Intent;
  mode: Mode | null;
  explanation: string;
}
export interface SmartEditResult {
  intent: Intent;
  updates: string;
  issues: string[];
}
export interface SmartCtx {
  today: string;
  wakeup: string;
  sleep: string;
}

function extractJson(content: string): any {
  const cleaned = content.replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error('Model did not return JSON');
  }
}

async function chat(env: Env, system: string, user: string): Promise<string> {
  if (!env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is not configured on the server');
  const model = env.OPENROUTER_MODEL || 'deepseek/deepseek-v4-flash';
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'X-Title': 'Calendizer',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      provider: { sort: 'throughput' }, // route to the highest-throughput provider
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`OpenRouter ${r.status}: ${t.slice(0, 400)}`);
  }
  const data: any = await r.json();
  const content: string = data?.choices?.[0]?.message?.content ?? '';
  if (!content) throw new Error('Empty response from model');
  return content;
}

export async function parseSmart(env: Env, query: string, ctx: SmartCtx): Promise<SmartResult> {
  const userMsg =
    `Today is ${ctx.today}. The user's wakeup is ${ctx.wakeup} and sleep is ${ctx.sleep}.\n\n` +
    `Event description: ${query.trim()}`;
  const parsed = extractJson(await chat(env, CREATE_SYSTEM_PROMPT, userMsg));
  if (!parsed?.intent) throw new Error('Response had no "intent" field');
  return { intent: parsed.intent, mode: parsed.mode ?? null, explanation: parsed.explanation ?? 'Added.' };
}

export async function parseSmartEdit(
  env: Env,
  current: Intent,
  instruction: string,
  ctx: SmartCtx
): Promise<SmartEditResult> {
  const userMsg =
    `Today is ${ctx.today}. The user's wakeup is ${ctx.wakeup} and sleep is ${ctx.sleep}.\n\n` +
    `CURRENT intent:\n${JSON.stringify(current)}\n\nInstruction: ${instruction.trim()}`;
  const parsed = extractJson(await chat(env, EDIT_SYSTEM_PROMPT, userMsg));
  const intent: Intent = parsed?.intent ?? current;
  intent.id = current.id; // never let the model change identity
  if (!intent.subject) intent.subject = current.subject;
  return {
    intent,
    updates: typeof parsed?.updates === 'string' ? parsed.updates : 'No update made',
    issues: Array.isArray(parsed?.issues) ? parsed.issues.map((x: unknown) => String(x)) : [],
  };
}
