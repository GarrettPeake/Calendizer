import type { GlobalConfig, Intent } from 'calendizer';
import { validateConfig } from 'calendizer';
import type { FeedInfo, ModeRecord, User } from '../api';
import { FieldMsgs } from './formkit';
import { colorFor, modeColor } from '../lib/colors';
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
          title={`${p.intents.length} Active intents`}
          hint="The things you intend to do. Click one to edit it."
        />
        {p.intents.length === 0 ? (
          <p className="empty-hint">What do you intend to get done?</p>
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
          title="Calendar Modes"
          hint="Time ranges that behave differently, like a vacation. Intents are mode-specific or global, so you won't be scheduled to sip Mai Tais at the beach during a normal week, only during vacation mode."
        />
        {p.modes.length === 0 ? (
          <p className="empty-hint">Time to plan a vacation?</p>
        ) : (
          p.modes.map((m) => (
            <div className="intent-row clickable" key={m.id} onClick={() => p.onEditMode(m)} title="Click to edit">
              <span className="dot" style={{ background: modeColor(m.id).chip }} />
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
  const v = validateConfig(config);
  return (
    <div className="section">
      <SectionHeader
        icon={<SlidersIcon />}
        title="Calendar config"
        hint="Settings applied to your whole calendar, hover over each to see what it does"
      />
      <div className="card">
        <div className="row">
          <Time label="Wakeup time" value={String(config.wakeup)} onChange={(t) => set({ wakeup: t })} hint="Your wake time. Useful to schedule intents for 'wakeup' or 'wakeup + 15m'" />
          <Time label="Bedtime" value={String(config.sleep)} onChange={(t) => set({ sleep: t })} hint="Your bedtime. Useful to schedule intents for 'bedtime - 30m'" />
        </div>
        <FieldMsgs result={v} field="wakeup" />
        <FieldMsgs result={v} field="sleep" />
        <div className="row">
          <Num label="Time grid (min)" min={1} step={1} value={config.grid} onChange={(n) => set({ grid: n })} hint="Events snap to this many minutes (i.e. no 3:57 starts)" />
          <Num label="Padding (min)" min={0} step={5} value={config.padding} onChange={(n) => set({ padding: n })} hint="Minimum buffer enforced between events" />
        </div>
        <FieldMsgs result={v} field="grid" />
        <FieldMsgs result={v} field="padding" />
        <label
          className="field"
          title="Sets your rough location which allows scheduling things for sunrise/sunset. Also needed to compute your timezone offset. Auto-detected from your IP; change it here to override"
        >
          <span>City</span>
          <select
            value={config.city ?? ''}
            onChange={(e) => {
              const c = findCity(e.target.value);
              if (c) set({ city: c.name, location: { lat: c.lat, lon: c.lon }, utcOffsetMinutes: tzOffsetMinutes(c.tz) });
            }}
          >
            {!config.city ? <option value="">When is your sunset?</option> : null}
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
          title="Always try to schedule the max of a range. An intent 3-5 times a week will schedule 5 times, or an intent that's 2-3 hours long will schedule for 3hours if there's space."
        >
          <input type="checkbox" checked={config.fillToMax ?? false} onChange={(e) => set({ fillToMax: e.target.checked })} />
          Maximize events
        </label>
      </div>
    </div>
  );
}

function Time(props: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <label className="field" title={props.hint}>
      <span>{props.label}</span>
      <input type="time" value={props.value} step={60} onChange={(e) => props.onChange(e.target.value)} />
    </label>
  );
}
function Num(props: { label: string; value: number; onChange: (v: number) => void; hint?: string; min?: number; step?: number }) {
  return (
    <label className="field" title={props.hint}>
      <span>{props.label}</span>
      <input
        type="number"
        min={props.min}
        step={props.step}
        value={Number.isFinite(props.value) ? props.value : ''}
        onChange={(e) => props.onChange(e.target.value === '' ? NaN : Math.trunc(Number(e.target.value)))}
      />
    </label>
  );
}
