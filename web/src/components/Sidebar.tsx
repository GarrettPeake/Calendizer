import { useState } from 'react';
import type { GlobalConfig, Intent, Mode } from 'calendizer';
import type { BaseCalendar } from '../data/calendars';
import type { IntentPreset } from '../data/intents';
import { colorFor } from '../lib/colors';
import { slug, summarize } from '../lib/intentMeta';

interface Props {
  calendars: BaseCalendar[];
  calendarId: string;
  onSelectCalendar: (id: string) => void;
  calendarModes: Mode[];
  config: GlobalConfig;
  setConfig: (f: (c: GlobalConfig) => GlobalConfig) => void;
  userModes: Mode[];
  setUserModes: (f: (m: Mode[]) => Mode[]) => void;
  intents: Intent[];
  setIntents: (f: (i: Intent[]) => Intent[]) => void;
  intentLibrary: IntentPreset[];
  onAddPreset: (id: string) => void;
  horizonWeeks: number;
  setHorizonWeeks: (n: number) => void;
  instanceCount: number;
  conflictCount: number;
}

export function Sidebar(p: Props) {
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [jsonErr, setJsonErr] = useState<string | null>(null);

  const cal = p.calendars.find((c) => c.id === p.calendarId)!;

  function openJson() {
    setJsonText(JSON.stringify(p.intents, null, 2));
    setJsonErr(null);
    setJsonMode(true);
  }
  function applyJson() {
    try {
      const parsed = JSON.parse(jsonText);
      if (!Array.isArray(parsed)) throw new Error('Top level must be an array of intents');
      p.setIntents(() => parsed);
      setJsonErr(null);
      setJsonMode(false);
    } catch (e) {
      setJsonErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <aside className="sidebar">
      <h1>Calendizer Playground</h1>
      <p className="tagline">
        {p.instanceCount} solved occurrence{p.instanceCount === 1 ? '' : 's'} ·{' '}
        {p.conflictCount} conflict{p.conflictCount === 1 ? '' : 's'}
      </p>

      {/* ---- Base calendar ---- */}
      <div className="section">
        <h2>Base calendar</h2>
        <select value={p.calendarId} onChange={(e) => p.onSelectCalendar(e.target.value)}>
          {p.calendars.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <p className="empty-hint" style={{ marginTop: 6 }}>
          {cal.description}
        </p>
      </div>

      {/* ---- Intent library ---- */}
      <div className="section">
        <h2>Add from intent library</h2>
        <div className="lib-grid">
          {p.intentLibrary.map((preset) => (
            <button key={preset.id} className="lib-item" onClick={() => p.onAddPreset(preset.id)} title={preset.description}>
              <div className="l-title">{preset.label}</div>
              <div className="l-desc">{preset.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* ---- Active intents ---- */}
      <div className="section">
        <h2>
          Active intents ({p.intents.length})
          <button className="btn tiny ghost" style={{ float: 'right' }} onClick={jsonMode ? () => setJsonMode(false) : openJson}>
            {jsonMode ? 'close JSON' : 'edit JSON'}
          </button>
        </h2>

        {jsonMode ? (
          <div className="card">
            <textarea rows={16} value={jsonText} onChange={(e) => setJsonText(e.target.value)} spellCheck={false} />
            {jsonErr ? <p className="empty-hint" style={{ color: '#ffb4b6' }}>{jsonErr}</p> : null}
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn" onClick={applyJson}>
                Apply
              </button>
              <button className="btn ghost" onClick={() => setJsonMode(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : p.intents.length === 0 ? (
          <p className="empty-hint">No intents yet — add some from the library above.</p>
        ) : (
          p.intents.map((intent, idx) => {
            const col = colorFor(intent.id ?? slug(intent.subject));
            return (
              <div className="intent-row" key={idx}>
                <span className="dot" style={{ background: col.border }} />
                <div className="meta">
                  <div className="s">{intent.subject}</div>
                  <div className="sub">{summarize(intent)}</div>
                </div>
                <button
                  className="btn tiny danger"
                  onClick={() => p.setIntents((prev) => prev.filter((_, i) => i !== idx))}
                  title="Remove"
                >
                  ✕
                </button>
              </div>
            );
          })
        )}
        {!jsonMode && p.intents.length > 0 ? (
          <button className="btn tiny ghost" style={{ marginTop: 4 }} onClick={() => p.setIntents(() => [])}>
            Clear all
          </button>
        ) : null}
      </div>

      {/* ---- Modes ---- */}
      <div className="section">
        <h2>Modes</h2>
        {p.calendarModes.map((m) => (
          <div className="mode-row" key={'cal-' + m.name}>
            <input value={m.name} disabled style={{ flex: 1.2 }} />
            <input value={m.span[0]} disabled />
            <input value={m.span[1]} disabled />
            <span className="pill" style={{ color: '#8b94a7', fontSize: 10 }}>cal</span>
          </div>
        ))}
        {p.userModes.map((m, i) => (
          <div className="mode-row" key={i}>
            <input
              value={m.name}
              style={{ flex: 1.2 }}
              onChange={(e) => p.setUserModes((prev) => prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
            />
            <input
              value={m.span[0]}
              onChange={(e) => p.setUserModes((prev) => prev.map((x, j) => (j === i ? { ...x, span: [e.target.value, x.span[1]] } : x)))}
            />
            <input
              value={m.span[1]}
              onChange={(e) => p.setUserModes((prev) => prev.map((x, j) => (j === i ? { ...x, span: [x.span[0], e.target.value] } : x)))}
            />
            <button className="btn tiny danger" onClick={() => p.setUserModes((prev) => prev.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
        <button
          className="btn tiny ghost"
          onClick={() => p.setUserModes((prev) => [...prev, { name: 'mode' + (prev.length + 1), span: ['2026-06-22', '2026-06-28'] }])}
        >
          + add mode
        </button>
      </div>

      {/* ---- Global config ---- */}
      <div className="section">
        <h2>Global config</h2>
        <div className="card">
          <div className="row">
            <TextField label="wakeup" value={p.config.wakeup as string} onChange={(v) => p.setConfig((c) => ({ ...c, wakeup: v }))} />
            <TextField label="sleep" value={p.config.sleep as string} onChange={(v) => p.setConfig((c) => ({ ...c, sleep: v }))} />
          </div>
          <div className="row">
            <NumField label="grid (min)" value={p.config.grid} onChange={(v) => p.setConfig((c) => ({ ...c, grid: v }))} />
            <NumField label="padding (min)" value={p.config.padding} onChange={(v) => p.setConfig((c) => ({ ...c, padding: v }))} />
          </div>
          <div className="row">
            <NumField label="min break" value={p.config.min_break} onChange={(v) => p.setConfig((c) => ({ ...c, min_break: v }))} />
            <NumField label="max block" value={p.config.max_block} onChange={(v) => p.setConfig((c) => ({ ...c, max_block: v }))} />
          </div>
          <div className="row">
            <NumField
              label="lat"
              value={p.config.location?.lat ?? 0}
              onChange={(v) => p.setConfig((c) => ({ ...c, location: { lat: v, lon: c.location?.lon ?? 0 } }))}
            />
            <NumField
              label="lon"
              value={p.config.location?.lon ?? 0}
              onChange={(v) => p.setConfig((c) => ({ ...c, location: { lat: c.location?.lat ?? 0, lon: v } }))}
            />
            <NumField
              label="utc offset"
              value={p.config.utcOffsetMinutes ?? 0}
              onChange={(v) => p.setConfig((c) => ({ ...c, utcOffsetMinutes: v }))}
            />
          </div>
          <NumField label="horizon (weeks)" value={p.horizonWeeks} min={1} max={12} onChange={(v) => p.setHorizonWeeks(Math.max(1, Math.min(12, v)))} />
        </div>
      </div>
    </aside>
  );
}

function TextField(props: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input type="text" value={props.value} onChange={(e) => props.onChange(e.target.value)} />
    </label>
  );
}
function NumField(props: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        type="number"
        value={props.value}
        min={props.min}
        max={props.max}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}
