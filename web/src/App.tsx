import { useEffect, useMemo, useRef, useState } from 'react';
import type { GlobalConfig, Intent } from 'calendizer';
import { api, getToken, setToken, type FeedInfo, type ModeRecord, type SolveResponse, type User } from './api';
import { Login } from './Login';
import { Sidebar } from './components/Sidebar';
import { WeekCalendar } from './components/WeekCalendar';
import { IntentEditor, blankIntent } from './components/IntentEditor';
import { INTENT_LIBRARY } from './data/intents';
import { addDays, mondayOf, rangeLabel, weekDates } from './lib/dates';

const NO_FIXED: never[] = [];

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);

  const [config, setConfigState] = useState<GlobalConfig | null>(null);
  const [intents, setIntents] = useState<Intent[]>([]);
  const [modes, setModes] = useState<ModeRecord[]>([]);
  const [solveResp, setSolveResp] = useState<SolveResponse | null>(null);
  const [feed, setFeed] = useState<FeedInfo | null>(null);
  const [viewWeek, setViewWeek] = useState(0);
  const [editing, setEditing] = useState<{ intent: Intent; isNew: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const configDirty = useRef(false);
  const initialWeekSet = useRef(false);

  /* ---------------- boot: validate token, load everything ---------------- */
  useEffect(() => {
    (async () => {
      if (!getToken()) {
        setBooting(false);
        return;
      }
      try {
        const me = await api.me();
        setUser(me.user);
        await loadAll();
      } catch {
        setToken(null);
      } finally {
        setBooting(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAll() {
    const [cfg, ints, mds, slv, fd] = await Promise.all([
      api.getConfig(),
      api.listIntents(),
      api.listModes(),
      api.solve(),
      api.getFeed(),
    ]);
    setConfigState(cfg);
    setIntents(ints);
    setModes(mds);
    setSolveResp(slv);
    setFeed(fd);
  }

  async function reload() {
    const [ints, mds, slv] = await Promise.all([api.listIntents(), api.listModes(), api.solve()]);
    setIntents(ints);
    setModes(mds);
    setSolveResp(slv);
  }

  function guard<T>(p: Promise<T>): Promise<T | void> {
    return p.catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }

  /* ---------------- config: debounced persist + re-solve ---------------- */
  useEffect(() => {
    if (!config || !configDirty.current) return;
    const t = setTimeout(async () => {
      configDirty.current = false;
      await guard(api.putConfig(config).then(() => api.solve()).then(setSolveResp));
    }, 500);
    return () => clearTimeout(t);
  }, [config]);

  function changeConfig(next: GlobalConfig) {
    configDirty.current = true;
    setConfigState(next);
  }

  /* ---------------- mutations ---------------- */
  async function onAddPreset(presetId: string) {
    const preset = INTENT_LIBRARY.find((p) => p.id === presetId);
    if (!preset) return;
    await guard(api.createIntent(structuredClone(preset.intent)).then(reload));
    if (preset.needsMode && !modes.some((m) => m.name === preset.needsMode)) {
      const start = solveResp?.horizon.start ?? mondayOf(today);
      await guard(api.createMode({ name: preset.needsMode, span: [start, addDays(start, 6)] }).then(reload));
    }
  }
  async function saveEditing(updated: Intent) {
    if (!editing) return;
    const p = editing.isNew ? api.createIntent(updated) : api.updateIntent(updated.id!, updated);
    await guard(p.then(reload));
    setEditing(null);
  }
  async function deleteIntent(id: string) {
    await guard(api.deleteIntent(id).then(reload));
  }
  async function aiAdd(query: string): Promise<{ explanation?: string }> {
    const res = await api.smart(query);
    await reload();
    return { explanation: res.explanation };
  }
  async function rotateFeed() {
    await guard(api.rotateFeed().then(setFeed));
  }

  function logout() {
    setToken(null);
    setUser(null);
    setConfigState(null);
    setIntents([]);
    setModes([]);
    setSolveResp(null);
    initialWeekSet.current = false;
  }

  /* ---------------- derived: weeks + today ---------------- */
  const today = useMemo(
    () => new Date(Date.now() + (config?.utcOffsetMinutes ?? 0) * 60_000).toISOString().slice(0, 10),
    [config]
  );
  const mondays = useMemo(() => {
    if (!solveResp) return [];
    const out: string[] = [];
    let m = mondayOf(solveResp.horizon.start);
    while (m <= solveResp.horizon.end) {
      out.push(m);
      m = addDays(m, 7);
    }
    return out;
  }, [solveResp]);

  // Land on the current week the first time a solve arrives.
  useEffect(() => {
    if (!initialWeekSet.current && mondays.length) {
      const tm = mondayOf(today);
      const idx = Math.max(0, mondays.findIndex((m) => m === tm));
      setViewWeek(idx >= 0 ? idx : 0);
      initialWeekSet.current = true;
    }
  }, [mondays, today]);

  if (booting) return <div className="boot">Loading…</div>;
  if (!user)
    return (
      <Login
        onAuthed={(u) => {
          setUser(u);
          loadAll().catch((e) => setError(e instanceof Error ? e.message : String(e)));
        }}
      />
    );

  const safeWeek = Math.min(viewWeek, Math.max(0, mondays.length - 1));
  const days = mondays.length ? weekDates(mondays[safeWeek]) : [];
  const conflicts = (solveResp?.conflicts ?? []).filter(
    (c) => !c.date || (days.length > 0 && c.date >= days[0] && c.date <= days[6])
  );

  return (
    <div className="app">
      <Sidebar
        user={user}
        onLogout={logout}
        config={config}
        onConfigChange={changeConfig}
        intents={intents}
        onAddPreset={onAddPreset}
        onAIAdd={aiAdd}
        onEditIntent={(intent) => setEditing({ intent, isNew: false })}
        onNewIntent={() => setEditing({ intent: blankIntent(), isNew: true })}
        onDeleteIntent={deleteIntent}
        modes={modes}
        onAddMode={() => {
          const start = solveResp?.horizon.start ?? mondayOf(today);
          guard(api.createMode({ name: 'mode', span: [start, addDays(start, 6)] }).then(reload));
        }}
        onUpdateMode={(id, mode) => guard(api.updateMode(id, mode).then(reload))}
        onDeleteMode={(id) => guard(api.deleteMode(id).then(reload))}
        intentLibrary={INTENT_LIBRARY}
        feed={feed}
        onRotateFeed={rotateFeed}
        solveMs={solveResp?.solveMs ?? null}
        instanceCount={solveResp?.instances.length ?? 0}
        cached={solveResp?.cached ?? null}
        conflictCount={solveResp?.conflicts.length ?? 0}
      />

      <div className="main">
        <div className="toolbar">
          <button className="nav-btn" onClick={() => setViewWeek((w) => Math.max(0, w - 1))} disabled={safeWeek === 0}>
            ‹
          </button>
          <button
            className="nav-btn"
            onClick={() => setViewWeek((w) => Math.min(mondays.length - 1, w + 1))}
            disabled={safeWeek >= mondays.length - 1}
          >
            ›
          </button>
          <div className="week-label">{days.length ? rangeLabel(days[0], days[6]) : '—'}</div>
          <span className="pill">
            Week {safeWeek + 1} of {mondays.length}
          </span>
          <div className="spacer" />
          <div className="legend">
            <span><span className="swatch" style={{ background: 'hsl(210 70% 92%)', border: '1px solid hsl(210 65% 55%)' }} />Solved</span>
            <span>🌙 during sleep</span>
            <span><span className="swatch" style={{ background: '#fff', outline: '2px solid var(--danger)' }} />overlap</span>
          </div>
        </div>

        {error ? (
          <div className="conflict-banner">
            <b>Error:</b> {error} <button className="btn tiny ghost" onClick={() => setError(null)}>dismiss</button>
          </div>
        ) : conflicts.length ? (
          <div className="conflict-banner">
            <b>{conflicts.length} conflict{conflicts.length > 1 ? 's' : ''} this week:</b>
            <ul>
              {conflicts.slice(0, 6).map((c, i) => (
                <li key={i}>[{c.kind}] {c.message}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <WeekCalendar days={days} fixed={NO_FIXED} instances={solveResp?.instances ?? []} today={today} />
      </div>

      {editing ? (
        <IntentEditor
          key={editing.isNew ? 'new' : editing.intent.id}
          initial={editing.intent}
          isNew={editing.isNew}
          onSave={saveEditing}
          onCancel={() => setEditing(null)}
          onSmartEdit={(intent, instruction) => api.smartEdit(intent, instruction)}
        />
      ) : null}
    </div>
  );
}
