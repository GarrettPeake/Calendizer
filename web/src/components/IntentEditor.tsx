import { useState } from 'react';
import type { Intent, TimeValue, Marker, DaysSpec } from 'calendizer';
import type { ModeRecord } from '../api';

const MARKERS: Marker[] = ['wakeup', 'sleep', 'dawn', 'dusk', 'sunrise', 'sunset'];
const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

/** A blank intent used by "new intent". */
export function blankIntent(): Intent {
  return {
    subject: 'new intent',
    mode: 'default',
    priority: 50,
    duration: [60, 60],
    window: {},
    cardinality: { period: { unit: 'week', interval: 1 }, days: { count: [1, 1] } },
  };
}

export function IntentEditor(props: {
  initial: Intent;
  isNew: boolean;
  modes: ModeRecord[];
  onSave: (intent: Intent) => void;
  onCancel: () => void;
  onSmartEdit: (intent: Intent, instruction: string) => Promise<{ intent: Intent; updates: string; issues: string[] }>;
}) {
  const [d, setD] = useState<Intent>(() => structuredClone(props.initial));

  // Natural-language modify: proposes changes that populate the form for review.
  const [instruction, setInstruction] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiIssues, setAiIssues] = useState<string[]>([]);

  async function applyInstruction() {
    if (!instruction.trim() || aiBusy) return;
    setAiBusy(true);
    setAiError(null);
    setAiSummary(null);
    setAiIssues([]);
    try {
      const res = await props.onSmartEdit(d, instruction.trim());
      setD(res.intent); // populate the form — NOT saved until the user clicks Save
      setAiSummary(res.updates);
      setAiIssues(res.issues);
      setInstruction('');
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  }

  const patch = (p: Partial<Intent>) => setD((cur) => ({ ...cur, ...p }));
  const patchWindow = (p: Partial<Intent['window']>) => setD((cur) => ({ ...cur, window: { ...cur.window, ...p } }));
  const patchCard = (p: Partial<Intent['cardinality']>) =>
    setD((cur) => ({ ...cur, cardinality: { ...cur.cardinality, ...p } }));

  const card = d.cardinality;
  const daysKind: 'none' | 'count' | 'weekdays' | 'dates' = !card.days
    ? 'none'
    : 'count' in card.days
    ? 'count'
    : 'weekdays' in card.days
    ? 'weekdays'
    : 'dates';

  // Resolve the mode reference to a <select> value: "default"/"all", a known
  // mode id, or a legacy name mapped to its id. Unknown refs get a fallback option.
  const modeValue =
    d.mode === 'default' || d.mode === 'all'
      ? d.mode
      : props.modes.find((m) => m.id === d.mode)?.id ?? props.modes.find((m) => m.name === d.mode)?.id ?? d.mode;
  const modeKnown = modeValue === 'default' || modeValue === 'all' || props.modes.some((m) => m.id === modeValue);

  return (
    <div className="modal-overlay" onMouseDown={props.onCancel}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{props.isNew ? 'New intent' : `Edit “${props.initial.subject}”`}</h3>
          <button className="x" onClick={props.onCancel}>
            ×
          </button>
        </div>

        <div className="modal-body">
          {/* Natural-language modify */}
          <div className="ai-modify">
            <div className="ai-modify-row">
              <input
                type="text"
                placeholder='Modify with AI — e.g. "make it 4x a week in the mornings"'
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    applyInstruction();
                  }
                }}
              />
              <button className="btn" type="button" onClick={applyInstruction} disabled={aiBusy || !instruction.trim()}>
                {aiBusy ? 'Processing…' : 'Apply'}
              </button>
            </div>
            {aiError ? <p className="ai-note err">{aiError}</p> : null}
            {aiSummary ? <p className="ai-note ok">{aiSummary} <span className="ai-hint">— review below, then save</span></p> : null}
            {aiIssues.length ? (
              <ul className="ai-issues">
                {aiIssues.map((iss, i) => (
                  <li key={i}>{iss}</li>
                ))}
              </ul>
            ) : null}
          </div>

          {/* Basics */}
          <Group title="Basics">
            <Field label="Name">
              <input type="text" value={d.subject} onChange={(e) => patch({ subject: e.target.value })} />
            </Field>
            <div className="grid2">
              <Field label="Mode">
                <select value={modeValue} onChange={(e) => patch({ mode: e.target.value })}>
                  <option value="default">normal</option>
                  <option value="all">all (happens in every mode)</option>
                  {props.modes.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                  {!modeKnown ? <option value={modeValue}>(unknown mode)</option> : null}
                </select>
              </Field>
              <Field label="Priority">
                <input type="number" value={d.priority} onChange={(e) => patch({ priority: Number(e.target.value) })} />
              </Field>
            </div>
            <div className="grid2">
              <Field label="Min duration (m)">
                <input
                  type="number"
                  value={d.duration[0]}
                  onChange={(e) => patch({ duration: [Number(e.target.value), d.duration[1]] })}
                />
              </Field>
              <Field label="Max duration (m)">
                <input
                  type="number"
                  value={d.duration[1]}
                  onChange={(e) => patch({ duration: [d.duration[0], Number(e.target.value)] })}
                />
              </Field>
            </div>
          </Group>

          {/* Window */}
          <Group title="Timing (when an occurrences are placed)">
            <TimeValueField
              label="Can't start before"
              value={d.window.not_before}
              onChange={(v) => patchWindow({ not_before: v })}
            />
            <TimeValueField
              label="Can't end after"
              value={d.window.not_after}
              onChange={(v) => patchWindow({ not_after: v })}
            />
            <TimeValueField
              label="Starts exactly at (pin)"
              value={d.window.starts_at}
              onChange={(v) => patchWindow({ starts_at: v })}
            />
            {d.window.overrides ? (
              <div className="hint-cell">
                Has per-weekday overrides ({Object.keys(d.window.overrides).join('; ')}) — preserved
              </div>
            ) : null}
          </Group>

          {/* Cardinality */}
          <Group title="Scheduling (how many & how often)">
            {/* Period */}
            <div className="grid2">
              <Field label="Time period to spread occurences in">
                <select
                  value={card.period?.unit ?? 'none'}
                  onChange={(e) => {
                    const u = e.target.value;
                    if (u === 'none') patchCard({ period: undefined });
                    else patchCard({ period: { unit: u as any, interval: card.period?.interval ?? 1 } });
                  }}
                >
                  <option value="none">One time</option>
                  <option value="day">Day</option>
                  <option value="week">Week</option>
                  <option value="month">Month</option>
                  <option value="mode">Calendar Mode</option>
                </select>
              </Field>
              <Field label="">
                <input
                  type="number"
                  min={1}
                  disabled={!card.period || card.period.unit === 'mode'}
                  value={card.period?.interval ?? 1}
                  onChange={(e) =>
                    card.period && patchCard({ period: { ...card.period, interval: Number(e.target.value) } })
                  }
                />
              </Field>
            </div>

            {/* Days */}
            <Field label="What days?">
              <select
                value={daysKind}
                onChange={(e) => {
                  const k = e.target.value;
                  if (k === 'none') patchCard({ days: undefined });
                  else if (k === 'count') patchCard({ days: { count: [1, 1] } });
                  else if (k === 'weekdays') patchCard({ days: { weekdays: ['MO', 'WE', 'FR'] } });
                  else patchCard({ days: { dates: [] } });
                }}
              >
                <option value="none">— none —</option>
                <option value="count">Count, spread across the period</option>
                <option value="weekdays">Specific weekdays</option>
                <option value="dates">Specific dates</option>
              </select>
            </Field>

            {daysKind === 'count' && card.days && 'count' in card.days ? (
              <div className="grid2">
                <Field label="Min days">
                  <input
                    type="number"
                    value={card.days.count[0]}
                    onChange={(e) =>
                      patchCard({ days: { count: [Number(e.target.value), (card.days as any).count[1]] } })
                    }
                  />
                </Field>
                <Field label="Max days">
                  <input
                    type="number"
                    value={card.days.count[1]}
                    onChange={(e) =>
                      patchCard({ days: { count: [(card.days as any).count[0], Number(e.target.value)] } })
                    }
                  />
                </Field>
              </div>
            ) : null}

            {daysKind === 'weekdays' && card.days && 'weekdays' in card.days ? (
              <Field label="">
                <div className="toggle-row">
                  {WEEKDAYS.map((w) => {
                    const on = (card.days as any).weekdays.includes(w);
                    return (
                      <button
                        key={w}
                        type="button"
                        className={`toggle${on ? ' on' : ''}`}
                        onClick={() => {
                          const cur: string[] = (card.days as any).weekdays;
                          const next = on ? cur.filter((x) => x !== w) : [...cur, w];
                          // keep canonical order
                          patchCard({ days: { weekdays: WEEKDAYS.filter((x) => next.includes(x)) } as DaysSpec });
                        }}
                      >
                        {w}
                      </button>
                    );
                  })}
                </div>
              </Field>
            ) : null}

            {daysKind === 'dates' && card.days && 'dates' in card.days ? (
              <Field label="Dates (YYYY-MM-DD format, separate multiple with commas)">
                <input
                  type="text"
                  value={(card.days as any).dates.join(', ')}
                  onChange={(e) =>
                    patchCard({
                      days: {
                        dates: e.target.value
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean),
                      },
                    })
                  }
                />
              </Field>
            ) : null}

            {/* per_day */}
            <Field label="">
              <label className="chk">
                <input
                  type="checkbox"
                  checked={!!card.per_day}
                  onChange={(e) => patchCard({ per_day: e.target.checked ? { count: [1, 1] } : undefined })}
                />
                Schedule multiple per day
              </label>
            </Field>
            {card.per_day ? (
              <div className="grid2">
                <Field label="Min">
                  <input
                    type="number"
                    value={card.per_day.count[0]}
                    onChange={(e) => patchCard({ per_day: { count: [Number(e.target.value), card.per_day!.count[1]] } })}
                  />
                </Field>
                <Field label="Max">
                  <input
                    type="number"
                    value={card.per_day.count[1]}
                    onChange={(e) => patchCard({ per_day: { count: [card.per_day!.count[0], Number(e.target.value)] } })}
                  />
                </Field>
              </div>
            ) : null}

            {/* total */}
            <Field label="">
              <label className="chk">
                <input
                  type="checkbox"
                  checked={!!card.total}
                  onChange={(e) => patchCard({ total: e.target.checked ? [null, null] : undefined })}
                />
                Limit total occurences
              </label>
            </Field>
            {card.total ? (
              <div className="grid2">
                <Field label="Min (leave blank for no min)">
                  <input
                    type="text"
                    value={card.total[0] ?? ''}
                    onChange={(e) =>
                      patchCard({ total: [e.target.value === '' ? null : Number(e.target.value), card.total![1]] })
                    }
                  />
                </Field>
                <Field label="Max (leave blank for ∞)">
                  <input
                    type="text"
                    value={card.total[1] ?? ''}
                    onChange={(e) =>
                      patchCard({ total: [card.total![0], e.target.value === '' ? null : Number(e.target.value)] })
                    }
                  />
                </Field>
              </div>
            ) : null}
          </Group>

          {/* Children */}
          <Group title="Children (break it down into smaller items)">
            <Field label="">
              <label className="chk">
                <input
                  type="checkbox"
                  checked={!!d.children}
                  onChange={(e) =>
                    patch({
                      children: e.target.checked
                        ? [
                            { subject: 'part 1', duration: 10 },
                            { subject: 'part 2', weight: 1 },
                          ]
                        : undefined,
                    })
                  }
                />
                Has children
              </label>
            </Field>
            {d.children ? (
              <>
                <div className="hint-cell">
                  Children fill the block in order, no gaps. Must keep at least one “fill” child and fixed children
                  must sum to at most the min duration.
                </div>
                {d.children.map((c, i) => {
                  const isWeight = 'weight' in c;
                  return (
                    <div className="child-row" key={i}>
                      <input
                        type="text"
                        value={c.subject}
                        placeholder="Name"
                        onChange={(e) =>
                          patch({ children: d.children!.map((x, j) => (j === i ? { ...x, subject: e.target.value } : x)) })
                        }
                      />
                      <select
                        value={isWeight ? 'weight' : 'duration'}
                        onChange={(e) => {
                          const toWeight = e.target.value === 'weight';
                          patch({
                            children: d.children!.map((x, j) =>
                              j === i
                                ? toWeight
                                  ? { subject: x.subject, weight: 1 }
                                  : { subject: x.subject, duration: 10 }
                                : x
                            ),
                          });
                        }}
                      >
                        <option value="duration">Fixed time (min)</option>
                        <option value="weight">Fill (weight)</option>
                      </select>
                      <input
                        type="number"
                        value={isWeight ? (c as any).weight : (c as any).duration}
                        onChange={(e) =>
                          patch({
                            children: d.children!.map((x, j) =>
                              j === i
                                ? isWeight
                                  ? { subject: x.subject, weight: Number(e.target.value) }
                                  : { subject: x.subject, duration: Number(e.target.value) }
                                : x
                            ),
                          })
                        }
                      />
                      <button
                        className="x small"
                        onClick={() => patch({ children: d.children!.filter((_, j) => j !== i) })}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
                <button
                  className="btn-lite"
                  onClick={() => patch({ children: [...d.children!, { subject: 'part', weight: 1 }] })}
                >
                  + add child
                </button>
              </>
            ) : null}
          </Group>
        </div>

        <div className="modal-foot">
          <button className="btn ghost" onClick={props.onCancel}>
            Cancel
          </button>
          <button className="btn" onClick={() => props.onSave(d)} disabled={!d.subject.trim()}>
            {props.isNew ? 'Add intent' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- sub-controls ---------- */

function TimeValueField(props: { label: string; value: TimeValue | undefined; onChange: (v: TimeValue | undefined) => void }) {
  const v = props.value;
  const kind: 'none' | 'clock' | Marker = v === undefined ? 'none' : typeof v === 'string' ? 'clock' : v.marker;
  const clock = typeof v === 'string' ? v : '09:00';
  const offset = typeof v === 'object' && v ? v.offset_min ?? 0 : 0;

  return (
    <div className="tv-row">
      <div className="tv-label">{props.label}</div>
      <div className="tv-controls">
        <select
          value={kind}
          onChange={(e) => {
            const k = e.target.value;
            if (k === 'none') props.onChange(undefined);
            else if (k === 'clock') props.onChange('09:00');
            else props.onChange({ marker: k as Marker, offset_min: 0 });
          }}
        >
          <option value="none">— unset —</option>
          <option value="clock">clock time</option>
          {MARKERS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        {kind === 'clock' ? (
          <input type="text" value={clock} placeholder="HH:MM" onChange={(e) => props.onChange(e.target.value)} />
        ) : kind !== 'none' ? (
          <>
            <input
              type="number"
              value={offset}
              title="offset minutes"
              onChange={(e) => props.onChange({ marker: kind as Marker, offset_min: Number(e.target.value) })}
            />
            <span className="tv-suffix">±min</span>
          </>
        ) : null}
      </div>
    </div>
  );
}

function Group(props: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="edit-group">
      <legend>{props.title}</legend>
      {props.children}
    </fieldset>
  );
}
function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <label className="edit-field">
      {props.label ? <span>{props.label}</span> : null}
      {props.children}
    </label>
  );
}
