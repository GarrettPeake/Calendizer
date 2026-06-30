import { useState } from 'react';
import type { Intent, TimeValue, Marker, DaysSpec } from 'calendizer';

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
                placeholder='Modify with AI — e.g. "make it 4× a week in the mornings"'
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
                {aiBusy ? '…' : 'Apply'}
              </button>
            </div>
            {aiError ? <p className="ai-note err">{aiError}</p> : null}
            {aiSummary ? <p className="ai-note ok">{aiSummary} <span className="ai-hint">— review below, then Save</span></p> : null}
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
            <Field label="Subject">
              <input type="text" value={d.subject} onChange={(e) => patch({ subject: e.target.value })} />
            </Field>
            <div className="grid3">
              <Field label="Mode">
                <input
                  type="text"
                  value={d.mode}
                  onChange={(e) => patch({ mode: e.target.value })}
                  placeholder="default | all | <mode>"
                />
              </Field>
              <Field label="Priority">
                <input type="number" value={d.priority} onChange={(e) => patch({ priority: Number(e.target.value) })} />
              </Field>
              <div />
            </div>
            <div className="grid3">
              <Field label="Duration min (m)">
                <input
                  type="number"
                  value={d.duration[0]}
                  onChange={(e) => patch({ duration: [Number(e.target.value), d.duration[1]] })}
                />
              </Field>
              <Field label="Duration max (m)">
                <input
                  type="number"
                  value={d.duration[1]}
                  onChange={(e) => patch({ duration: [d.duration[0], Number(e.target.value)] })}
                />
              </Field>
              <div className="hint-cell">min = max ⇒ fixed length</div>
            </div>
          </Group>

          {/* Window */}
          <Group title="Window — when an occurrence may sit">
            <TimeValueField
              label="not before"
              value={d.window.not_before}
              onChange={(v) => patchWindow({ not_before: v })}
            />
            <TimeValueField
              label="not after"
              value={d.window.not_after}
              onChange={(v) => patchWindow({ not_after: v })}
            />
            <TimeValueField
              label="starts at (pin)"
              value={d.window.starts_at}
              onChange={(v) => patchWindow({ starts_at: v })}
            />
            {d.window.overrides ? (
              <div className="hint-cell">
                Has per-weekday overrides ({Object.keys(d.window.overrides).join('; ')}) — preserved; edit via JSON for fine control.
              </div>
            ) : null}
          </Group>

          {/* Cardinality */}
          <Group title="Cardinality — how many & how often">
            {/* Period */}
            <div className="grid3">
              <Field label="Period unit">
                <select
                  value={card.period?.unit ?? 'none'}
                  onChange={(e) => {
                    const u = e.target.value;
                    if (u === 'none') patchCard({ period: undefined });
                    else patchCard({ period: { unit: u as any, interval: card.period?.interval ?? 1 } });
                  }}
                >
                  <option value="none">— none —</option>
                  <option value="day">day</option>
                  <option value="week">week</option>
                  <option value="month">month</option>
                  <option value="mode">mode</option>
                </select>
              </Field>
              <Field label="Interval">
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
              <div />
            </div>

            {/* Days */}
            <Field label="Days selection">
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
                <option value="count">count (solver picks, spread)</option>
                <option value="weekdays">specific weekdays</option>
                <option value="dates">specific dates</option>
              </select>
            </Field>

            {daysKind === 'count' && card.days && 'count' in card.days ? (
              <div className="grid3">
                <Field label="min days">
                  <input
                    type="number"
                    value={card.days.count[0]}
                    onChange={(e) =>
                      patchCard({ days: { count: [Number(e.target.value), (card.days as any).count[1]] } })
                    }
                  />
                </Field>
                <Field label="max days">
                  <input
                    type="number"
                    value={card.days.count[1]}
                    onChange={(e) =>
                      patchCard({ days: { count: [(card.days as any).count[0], Number(e.target.value)] } })
                    }
                  />
                </Field>
                <div className="hint-cell">per period bucket</div>
              </div>
            ) : null}

            {daysKind === 'weekdays' && card.days && 'weekdays' in card.days ? (
              <Field label="weekdays">
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
              <Field label="dates (comma-separated YYYY-MM-DD)">
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
                stack multiple per day (per_day)
              </label>
            </Field>
            {card.per_day ? (
              <div className="grid3">
                <Field label="per-day min">
                  <input
                    type="number"
                    value={card.per_day.count[0]}
                    onChange={(e) => patchCard({ per_day: { count: [Number(e.target.value), card.per_day!.count[1]] } })}
                  />
                </Field>
                <Field label="per-day max">
                  <input
                    type="number"
                    value={card.per_day.count[1]}
                    onChange={(e) => patchCard({ per_day: { count: [card.per_day!.count[0], Number(e.target.value)] } })}
                  />
                </Field>
                <div />
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
                lifetime total bound
              </label>
            </Field>
            {card.total ? (
              <div className="grid3">
                <Field label="total min (blank = none)">
                  <input
                    type="text"
                    value={card.total[0] ?? ''}
                    onChange={(e) =>
                      patchCard({ total: [e.target.value === '' ? null : Number(e.target.value), card.total![1]] })
                    }
                  />
                </Field>
                <Field label="total max (blank = ∞)">
                  <input
                    type="text"
                    value={card.total[1] ?? ''}
                    onChange={(e) =>
                      patchCard({ total: [card.total![0], e.target.value === '' ? null : Number(e.target.value)] })
                    }
                  />
                </Field>
                <div />
              </div>
            ) : null}
          </Group>

          {/* Children */}
          <Group title="Children — ordered sub-events that tile the block">
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
                has children
              </label>
            </Field>
            {d.children ? (
              <>
                {d.children.map((c, i) => {
                  const isWeight = 'weight' in c;
                  return (
                    <div className="child-row" key={i}>
                      <input
                        type="text"
                        value={c.subject}
                        placeholder="subject"
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
                        <option value="duration">fixed (min)</option>
                        <option value="weight">weight</option>
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
                <div className="hint-cell">
                  Children fill the block in order, no gaps. Keep ≥1 “weight” child so it always tiles exactly; fixed
                  durations must sum ≤ duration min.
                </div>
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
        <input
          type="number"
          value={offset}
          title="offset minutes"
          onChange={(e) => props.onChange({ marker: kind as Marker, offset_min: Number(e.target.value) })}
        />
      ) : (
        <div />
      )}
      {kind !== 'none' && kind !== 'clock' ? <span className="tv-suffix">±min</span> : null}
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
