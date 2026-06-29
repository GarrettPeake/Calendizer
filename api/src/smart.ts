/**
 * Natural-language → structured intent via OpenRouter (DeepSeek). Server-side only.
 * Currently single-shot "add an event"; structured to grow into an agentic endpoint
 * (delete/modify) by having the model emit an op later.
 */
import type { Intent, Mode } from '../../src/index';
import type { Env } from './env';

const SYSTEM_PROMPT = `You translate a person's natural-language description of something they want on their calendar into ONE structured "intent" for a deterministic scheduling solver. You are a TRANSLATOR ONLY: emit symbolic time markers (like "sunset") when relevant — never resolve them to clock times, and never pick concrete clock times unless the user gave one.

Return ONLY a single JSON object (no markdown, no prose) of the shape:
{
  "intent": Intent,
  "mode": Mode | null,        // only when the request implies a named span like a vacation/trip
  "explanation": string       // one short sentence describing what you created
}

The Intent type (TypeScript):
interface Intent {
  subject: string;                 // short label, e.g. "guitar practice"
  mode: string;                    // "default" normally; "all" for must-happen-always (e.g. medication); or a mode name
  priority: number;                // 0-100, higher wins contention; routine self-care ~30, work ~60, must-do ~100
  duration: [number, number];      // [minMinutes, maxMinutes]; equal ⇒ fixed length
  window: {
    not_before?: TimeValue;        // earliest start
    not_after?: TimeValue;         // latest end
    starts_at?: TimeValue;         // pin the start exactly (use when user gives a specific time)
    overrides?: { "<WEEKDAYS>": Partial<Window> }; // e.g. {"TU,TH,SU": {"not_after":"21:00"}}
  };
  children?: ({subject:string,duration:number} | {subject:string,weight:number})[]; // ordered sub-events that tile the block; include >=1 "weight" child
  cardinality: {
    period?: { unit: "day"|"week"|"month"|"mode", interval?: number };
    days?: { count: [number,number] } | { weekdays: string[] } | { dates: string[] };
    per_day?: { count: [number,number] };
    total?: [number|null, number|null]; // lifetime [min,max]; null = open
  };
}
type TimeValue = "HH:MM" | { marker: "wakeup"|"sleep"|"dawn"|"dusk"|"sunrise"|"sunset", offset_min?: number };
interface Mode { name: string; span: [startDate, endDate]; }  // dates "YYYY-MM-DD"

Weekday codes: MO TU WE TH FR SA SU.

Rules:
- A one-off on a specific day → cardinality.days.dates: ["YYYY-MM-DD"] (compute the date from "today"). No period needed.
- "N times a week" → period {unit:"week"} + days {count:[N,N]} (or [min,max] if a range given).
- "every day" → period {unit:"day", interval:1} + per_day {count:[1,1]}.
- Specific weekdays → days {weekdays:[...]}.
- "twice a day" → per_day {count:[2,2]}.
- "for about a month then stop" → add total:[null, approxCount].
- "at least twice during X" (a span) → emit a Mode for X and intent.mode = that mode name, period {unit:"mode"}, total:[2,null].
- Use markers for natural-light or routine anchors: "after I wake up" → not_before {marker:"wakeup"}; "before bed" → not_after {marker:"sleep"}; "at sunset" → starts_at or not_before {marker:"sunset"}.
- If the user gives an explicit clock time, use it (starts_at for a pin, or not_before/not_after for a window).
- Keep durations sensible; if a range is implied ("1-2 hours") use [60,120].
- Choose a concise lowercase subject.

Examples:
User: "practice guitar 3 times this week for 1-2 hours in the evening"
{"intent":{"subject":"guitar practice","mode":"default","priority":45,"duration":[60,120],"window":{"not_before":"17:00","not_after":"22:00"},"cardinality":{"period":{"unit":"week","interval":1},"days":{"count":[3,3]}}},"mode":null,"explanation":"Three 1-2h evening guitar sessions this week."}

User: "take my meds every day at 8am no matter what"
{"intent":{"subject":"take medication","mode":"all","priority":100,"duration":[1,1],"window":{"starts_at":"08:00"},"cardinality":{"period":{"unit":"day","interval":1},"per_day":{"count":[1,1]}}},"mode":null,"explanation":"Daily 8am medication that runs in every mode."}

User: "I'm on vacation next week, I want a mai tai at the beach around noon at least twice"
{"intent":{"subject":"Mai Tai at the beach","mode":"vacation","priority":40,"duration":[60,120],"window":{"not_before":"11:00","not_after":"13:00"},"cardinality":{"period":{"unit":"mode"},"total":[2,null]}},"mode":{"name":"vacation","span":["2026-07-06","2026-07-12"]},"explanation":"At least two midday Mai Tais during the vacation mode."}`;

export interface SmartResult {
  intent: Intent;
  mode: Mode | null;
  explanation: string;
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

export async function parseSmart(
  env: Env,
  query: string,
  ctx: { today: string; wakeup: string; sleep: string }
): Promise<SmartResult> {
  if (!env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is not configured on the server');
  const model = env.OPENROUTER_MODEL || 'deepseek/deepseek-v4-flash';

  const userMsg =
    `Today is ${ctx.today}. The user's wakeup is ${ctx.wakeup} and sleep is ${ctx.sleep}.\n\n` +
    `Event description: ${query.trim()}`;

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
      // Route to the highest-throughput provider for this model.
      provider: { sort: 'throughput' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
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

  const parsed = extractJson(content);
  if (!parsed?.intent) throw new Error('Response had no "intent" field');
  return { intent: parsed.intent, mode: parsed.mode ?? null, explanation: parsed.explanation ?? 'Added.' };
}
