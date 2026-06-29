import type { GlobalConfig, Intent, Mode } from 'calendizer';
import type { FeedInfo, ModeRecord, User } from '../api';
import type { IntentPreset } from '../data/intents';
import { colorFor } from '../lib/colors';
import { slug, summarize } from '../lib/intentMeta';
import { AIComposer } from './AIComposer';
import { FeedPanel } from './FeedPanel';

interface Props {
  user: User;
  onLogout: () => void;
  config: GlobalConfig | null;
  onConfigChange: (config: GlobalConfig) => void;
  intents: Intent[];
  onAddPreset: (id: string) => void;
  onAIAdd: (text: string) => Promise<{ explanation?: string }>;
  onEditIntent: (intent: Intent) => void;
  onNewIntent: () => void;
  onDeleteIntent: (id: string) => void;
  modes: ModeRecord[];
  onAddMode: () => void;
  onUpdateMode: (id: string, mode: Mode) => void;
  onDeleteMode: (id: string) => void;
  intentLibrary: IntentPreset[];
  feed: FeedInfo | null;
  onRotateFeed: () => Promise<void>;
  solveMs: number | null;
  instanceCount: number;
  cached: boolean | null;
  conflictCount: number;
}

export function Sidebar(p: Props) {
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

      <div className="section">
        <h2>Active intents ({p.intents.length})</h2>
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
                  <div className="sub">{summarize(intent)}</div>
                </div>
                <span className="edit-hint">edit</span>
                <button
                  className="btn tiny danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (intent.id) p.onDeleteIntent(intent.id);
                  }}
                  title="Remove"
                >
                  ✕
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
        <h2>Modes</h2>
        {p.modes.map((m) => (
          <div className="mode-row" key={m.id}>
            <input
              defaultValue={m.name}
              style={{ flex: 1.2 }}
              onBlur={(e) => p.onUpdateMode(m.id, { name: e.target.value, span: m.span })}
            />
            <input defaultValue={m.span[0]} onBlur={(e) => p.onUpdateMode(m.id, { name: m.name, span: [e.target.value, m.span[1]] })} />
            <input defaultValue={m.span[1]} onBlur={(e) => p.onUpdateMode(m.id, { name: m.name, span: [m.span[0], e.target.value] })} />
            <button className="btn tiny danger" onClick={() => p.onDeleteMode(m.id)}>
              ✕
            </button>
          </div>
        ))}
        <button className="btn tiny ghost" onClick={p.onAddMode}>
          + add mode
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
      <h2>Global config</h2>
      <div className="card">
        <div className="row">
          <Text label="wakeup" value={String(config.wakeup)} onChange={(v) => set({ wakeup: v })} />
          <Text label="sleep" value={String(config.sleep)} onChange={(v) => set({ sleep: v })} />
        </div>
        <div className="row">
          <Num label="grid (min)" value={config.grid} onChange={(v) => set({ grid: v })} />
          <Num label="padding (min)" value={config.padding} onChange={(v) => set({ padding: v })} />
        </div>
        <div className="row">
          <Num label="min break" value={config.min_break} onChange={(v) => set({ min_break: v })} />
          <Num label="max block" value={config.max_block} onChange={(v) => set({ max_block: v })} />
        </div>
        <div className="row">
          <Num label="lat" value={config.location?.lat ?? 0} onChange={(v) => set({ location: { lat: v, lon: config.location?.lon ?? 0 } })} />
          <Num label="lon" value={config.location?.lon ?? 0} onChange={(v) => set({ location: { lat: config.location?.lat ?? 0, lon: v } })} />
          <Num label="utc offset" value={config.utcOffsetMinutes ?? 0} onChange={(v) => set({ utcOffsetMinutes: v })} />
        </div>
        <label className="chk" style={{ marginTop: 8, color: '#aab2c2' }}>
          <input type="checkbox" checked={config.fillToMax ?? false} onChange={(e) => set({ fillToMax: e.target.checked })} />
          fill ranges toward max (e.g. 3–5×/week → 5 when there's room)
        </label>
      </div>
    </div>
  );
}

function Text(props: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input type="text" value={props.value} onChange={(e) => props.onChange(e.target.value)} />
    </label>
  );
}
function Num(props: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input type="number" value={props.value} onChange={(e) => props.onChange(Number(e.target.value))} />
    </label>
  );
}
