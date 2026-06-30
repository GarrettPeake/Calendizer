import type { GlobalConfig, Intent } from 'calendizer';
import type { FeedInfo, ModeRecord, User } from '../api';
import { colorFor } from '../lib/colors';
import { rangeLabel } from '../lib/dates';
import { slug, summarize } from '../lib/intentMeta';
import { CITIES, findCity, tzOffsetMinutes } from '../data/cities';
import { AIComposer } from './AIComposer';
import { FeedPanel } from './FeedPanel';
import { SectionHeader } from './SectionHeader';
import { LayersIcon, ListIcon, SlidersIcon } from './icons';

interface Props {
  user: User;
  onLogout: () => void;
  config: GlobalConfig | null;
  onConfigChange: (config: GlobalConfig) => void;
  intents: Intent[];
  onAIAdd: (text: string) => Promise<{ explanation?: string }>;
  onEditIntent: (intent: Intent) => void;
  onNewIntent: () => void;
  onDeleteIntent: (id: string) => void;
  modes: ModeRecord[];
  onNewMode: () => void;
  onEditMode: (mode: ModeRecord) => void;
  onDeleteMode: (id: string) => void;
  feed: FeedInfo | null;
  onRotateFeed: () => Promise<void>;
  solveMs: number | null;
  instanceCount: number;
  cached: boolean | null;
  conflictCount: number;
}

export function Sidebar(p: Props) {
  // Intents reference a mode by id; show its current name in the summary.
  const modeName = (ref: string) =>
    ref === 'default' || ref === 'all'
      ? ref
      : p.modes.find((m) => m.id === ref)?.name ?? p.modes.find((m) => m.name === ref)?.name ?? ref;

  return (
    <aside className="sidebar">
      <div className="side-head">
        <div>
          <h1>Calendizer</h1>
          <p className="tagline">
            {p.instanceCount} events · {p.conflictCount} conflict{p.conflictCount === 1 ? '' : 's'}
          </p>
        </div>
        <button className="btn tiny ghost" onClick={p.onLogout} title={`Signed in as ${p.user.username}`}>
          Log out
        </button>
      </div>

      <AIComposer onSubmit={p.onAIAdd} />

      <div className="section">
        <SectionHeader
          icon={<ListIcon />}
          title={`Active intents (${p.intents.length})`}
          hint="Your scheduling intents. Click one to edit it; the calendar re-solves on every change."
        />
        {p.intents.length === 0 ? (
          <p className="empty-hint">No intents yet — add one above or describe an event.</p>
        ) : (
          p.intents.map((intent) => {
            const col = colorFor(intent.id ?? slug(intent.subject));
            return (
              <div className="intent-row clickable" key={intent.id} onClick={() => p.onEditIntent(intent)} title="Click to edit">
                <span className="dot" style={{ background: col.border }} />
                <div className="meta">
                  <div className="s">{intent.subject}</div>
                  <div className="sub">{summarize(intent, modeName(intent.mode))}</div>
                </div>
                <button
                  className="btn tiny danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (intent.id) p.onDeleteIntent(intent.id);
                  }}
                  title="Remove"
                >
                  ×
                </button>
              </div>
            );
          })
        )}
        <button className="btn tiny" style={{ marginTop: 6 }} onClick={p.onNewIntent}>
          + new intent
        </button>
      </div>

      <div className="section">
        <SectionHeader
          icon={<LayersIcon />}
          title="Modes"
          hint="Named date spans (e.g. a vacation) that swap which intents are active during them."
        />
        {p.modes.length === 0 ? (
          <p className="empty-hint">No modes. Add one to clear or swap intents over a date span.</p>
        ) : (
          p.modes.map((m) => (
            <div className="intent-row clickable" key={m.id} onClick={() => p.onEditMode(m)} title="Click to edit">
              <div className="meta">
                <div className="s">{m.name}</div>
                <div className="sub">{rangeLabel(m.span[0], m.span[1])}</div>
              </div>
              <button
                className="btn tiny danger"
                onClick={(e) => {
                  e.stopPropagation();
                  p.onDeleteMode(m.id);
                }}
                title="Remove mode"
              >
                ×
              </button>
            </div>
          ))
        )}
        <button className="btn tiny" style={{ marginTop: 6 }} onClick={p.onNewMode}>
          + new mode
        </button>
      </div>

      {p.config ? <ConfigCard config={p.config} onChange={p.onConfigChange} /> : null}

      <FeedPanel
        url={p.feed?.url ?? null}
        onRotate={p.onRotateFeed}
        solveMs={p.solveMs}
        instanceCount={p.instanceCount}
        cached={p.cached}
      />
    </aside>
  );
}

function ConfigCard({ config, onChange }: { config: GlobalConfig; onChange: (c: GlobalConfig) => void }) {
  const set = (patch: Partial<GlobalConfig>) => onChange({ ...config, ...patch });
  return (
    <div className="section">
      <SectionHeader
        icon={<SlidersIcon />}
        title="Global config"
        hint="Solver-wide settings applied to every intent. Hover each field for what it affects."
      />
      <div className="card">
        <div className="row">
          <Text label="wakeup" value={String(config.wakeup)} onChange={(v) => set({ wakeup: v })} hint="Your wake time (HH:MM). Resolves the 'wakeup' marker used in windows." />
          <Text label="sleep" value={String(config.sleep)} onChange={(v) => set({ sleep: v })} hint="Your bedtime (HH:MM). Resolves the 'sleep' marker and acts as a nightly blackout the solver avoids unless an event can only run then." />
        </div>
        <div className="row">
          <Num label="grid (min)" value={config.grid} onChange={(v) => set({ grid: v })} hint="Start-time resolution: occurrence starts snap to this many minutes (no 3:57 starts)." />
          <Num label="padding (min)" value={config.padding} onChange={(v) => set({ padding: v })} hint="Minimum buffer enforced between placed occurrences." />
        </div>
        <div className="row">
          <Num label="min break" value={config.min_break} onChange={(v) => set({ min_break: v })} hint="Shortest gap that counts as a real break; smaller gaps are avoided as slivers." />
          <Num label="max block" value={config.max_block} onChange={(v) => set({ max_block: v })} hint="Longest continuous run of activity before a break is wanted." />
        </div>
        <label
          className="field"
          title="Sets your coordinates (for sunrise/sunset markers) and timezone offset. Auto-detected from your IP; change it here to override."
        >
          <span>city</span>
          <select
            value={config.city ?? ''}
            onChange={(e) => {
              const c = findCity(e.target.value);
              if (c) set({ city: c.name, location: { lat: c.lat, lon: c.lon }, utcOffsetMinutes: tzOffsetMinutes(c.tz) });
            }}
          >
            {!config.city ? <option value="">Select a city…</option> : null}
            {config.city && !findCity(config.city) ? <option value={config.city}>{config.city} (detected)</option> : null}
            {CITIES.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label
          className="chk"
          style={{ marginTop: 8, color: 'var(--muted)' }}
          title="When there's room, schedule up to the max of a range (e.g. 3–5×/week → 5) and split a contended window's flexible durations by priority. Off = always the guaranteed minimum."
        >
          <input type="checkbox" checked={config.fillToMax ?? false} onChange={(e) => set({ fillToMax: e.target.checked })} />
          Fill ranges toward max
        </label>
      </div>
    </div>
  );
}

function Text(props: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <label className="field" title={props.hint}>
      <span>{props.label}</span>
      <input type="text" value={props.value} onChange={(e) => props.onChange(e.target.value)} />
    </label>
  );
}
function Num(props: { label: string; value: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <label className="field" title={props.hint}>
      <span>{props.label}</span>
      <input type="number" value={props.value} onChange={(e) => props.onChange(Number(e.target.value))} />
    </label>
  );
}
