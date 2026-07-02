import { useEffect, useMemo, useRef, useState } from 'react';
import type { GlobalConfig, Intent, Mode, Instance } from 'calendizer';
import { validateConfig } from 'calendizer';
import {
  api,
  getToken,
  setToken,
  type CalendarPayload,
  type FeedInfo,
  type ModeRecord,
  type PublishState,
  type SolveResponse,
  type User,
} from './api';
import { computeSchedule } from './lib/solve';

type SaveStatus = 'saved' | 'processing' | 'saving' | 'error';
const SAVE_RETRIES = 3;
import { Login } from './Login';
import { Sidebar } from './components/Sidebar';
import { WeekCalendar } from './components/WeekCalendar';
import { IntentEditor, blankIntent } from './components/IntentEditor';
import { ModeEditor } from './components/ModeEditor';
import { BugReportModal } from './components/BugReportModal';
import { ThemeToggle, type Theme } from './components/ThemeToggle';
import { DetectBanner } from './components/DetectBanner';
import { buildProposal, detectTimezone, type Detected } from './lib/detect';
import { addDays, mondayOf, rangeLabel, weekDates } from './lib/dates';

const NO_FIXED: never[] = [];

function initialTheme(): Theme {
  const saved = localStorage.getItem('calendizer_theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('calendizer_theme', theme);
  }, [theme]);
  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);

  const [config, setConfigState] = useState<GlobalConfig | null>(null);
  const [intents, setIntents] = useState<Intent[]>([]);
  const [modes, setModes] = useState<ModeRecord[]>([]);
  const [solveResp, setSolveResp] = useState<SolveResponse | null>(null);
  const [feed, setFeed] = useState<FeedInfo | null>(null);
  // The viewed week is tracked by its Monday date (not an index): the horizon now
  // starts ~3 months in the past, so an index is fragile — index 0 is the empty
  // past, and any horizon shift would silently move which week an index points at.
  const [viewMonday, setViewMonday] = useState('');
  const [editing, setEditing] = useState<{ intent: Intent; isNew: boolean } | null>(null);
  const [editingMode, setEditingMode] = useState<{ mode: ModeRecord | null } | null>(null);
  const [bugOpen, setBugOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detected, setDetected] = useState<Detected | null>(null);
  const [geoDismissed, setGeoDismissed] = useState<string>(() => localStorage.getItem('calendizer_geo_dismissed') ?? '');

  const configDirty = useRef(false);

  // --- async save manager: edits are instant; recompute + publish run in the
  // background with a status indicator, coalescing, retries, and a failure toast.
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [toast, setToast] = useState<string | null>(null);
  const pendingSave = useRef<{ state: PublishState; calendar: CalendarPayload } | null>(null);
  const saving = useRef(false);
  const unsaved = useRef(false); // gates the navigate-away warning

  // Warn before leaving with an unsaved (unpublished or failed) change.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (unsaved.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

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
    const [cfg, ints, mds, cal, fd] = await Promise.all([
      api.getConfig(),
      api.listIntents(),
      api.listModes(),
      api.getCalendar(),
      api.getFeed(),
    ]);
    setConfigState(cfg);
    setIntents(ints);
    setModes(mds);
    setFeed(fd);
    // Show the last published calendar instantly, then recompute + republish (rolls
    // the horizon, freezes elapsed occurrences, reaps dead intents).
    if (cal.horizon) {
      setSolveResp({
        instances: cal.instances,
        conflicts: cal.conflicts,
        horizon: cal.horizon,
        solveMs: cal.solveMs ?? 0,
        computedAt: cal.computedAt ?? '',
        cached: true,
      });
    }
    applyChange(cfg, ints, mds, cal.instances);
  }

  function guard<T>(p: Promise<T>): Promise<T | void> {
    return p.catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }

  /**
   * Drain the pending save: publish the latest queued state+calendar, retrying a
   * few times. Coalesces — if newer edits arrive mid-flight they replace the queued
   * payload, so only the latest is ever sent. On total failure: a toast + the change
   * stays flagged unsaved (the navigate-away warning stays armed).
   */
  async function pumpSaves() {
    if (saving.current) return;
    saving.current = true;
    try {
      while (pendingSave.current) {
        const payload = pendingSave.current;
        pendingSave.current = null;
        setSaveStatus('saving');
        let ok = false;
        for (let attempt = 0; attempt < SAVE_RETRIES && !ok; attempt++) {
          try {
            const stored = await api.publish(payload.state, payload.calendar);
            setSolveResp(stored);
            ok = true;
          } catch {
            if (attempt < SAVE_RETRIES - 1) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
          }
        }
        if (!ok) {
          if (!pendingSave.current) pendingSave.current = payload; // keep latest for a later retry
          setSaveStatus('error');
          setToast('Unable to save the last change, please refresh the page and try again');
          return;
        }
      }
      if (!pendingSave.current) {
        unsaved.current = false;
        setSaveStatus('saved');
      }
    } finally {
      saving.current = false;
    }
  }

  /**
   * The single write path. Applies the next inputs to local state INSTANTLY, then
   * recomputes the calendar and queues an async publish (recompute is deferred a
   * tick so the edit feels immediate). Inputs and calendar publish together, so
   * they can never diverge.
   */
  function applyChange(
    nextConfig: GlobalConfig,
    nextIntents: Intent[],
    nextModes: ModeRecord[],
    previousInstances?: Instance[]
  ) {
    const previous = previousInstances ?? solveResp?.instances ?? [];
    setConfigState(nextConfig);
    setIntents(nextIntents);
    setModes(nextModes);
    unsaved.current = true;
    setSaveStatus('processing');
    setTimeout(() => {
      const r = computeSchedule(nextConfig, nextIntents, nextModes, previous);
      const liveIntents = r.reapedIntentIds.length
        ? nextIntents.filter((i) => !r.reapedIntentIds.includes(i.id!))
        : nextIntents;
      if (r.reapedIntentIds.length) setIntents(liveIntents);
      setSolveResp({
        instances: r.instances,
        conflicts: r.conflicts,
        horizon: r.horizon,
        solveMs: r.solveMs,
        computedAt: r.computedAt,
        cached: false,
      });
      pendingSave.current = {
        state: { config: nextConfig, intents: liveIntents, modes: nextModes },
        calendar: {
          instances: r.instances,
          conflicts: r.conflicts,
          horizon: r.horizon,
          computedAt: r.computedAt,
          solveMs: r.solveMs,
        },
      };
      pumpSaves();
    }, 0);
  }

  /* ---------------- config: debounced recompute + publish ---------------- */
  useEffect(() => {
    if (!config || !configDirty.current) return;
    const t = setTimeout(() => {
      if (!validateConfig(config).ok) return; // invalid — hold off until it's fixed
      configDirty.current = false;
      applyChange(config, intents, modes);
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  function changeConfig(next: GlobalConfig) {
    configDirty.current = true;
    setConfigState(next);
  }

  /* ---------------- detect timezone (browser) + location (server IP geo) ---------------- */
  useEffect(() => {
    if (!user) return;
    const run = async () => {
      const tz = detectTimezone();
      let lat: number | undefined;
      let lon: number | undefined;
      let city: string | undefined;
      try {
        const g = await api.geo();
        lat = g.lat;
        lon = g.lon;
        city = g.city;
      } catch {
        /* geo unavailable — timezone still detected */
      }
      setDetected({ ...tz, lat, lon, city });
    };
    run();
    window.addEventListener('focus', run);
    return () => window.removeEventListener('focus', run);
  }, [user]);

  const geoProposal = useMemo(() => (config && detected ? buildProposal(config, detected) : null), [config, detected]);

  function applyGeo() {
    if (!config || !geoProposal) return;
    applyChange({ ...config, ...geoProposal.next }, intents, modes);
  }
  function dismissGeo() {
    if (!geoProposal) return;
    setGeoDismissed(geoProposal.sig);
    localStorage.setItem('calendizer_geo_dismissed', geoProposal.sig);
  }

  /* ---------------- mutations (all funnel through applyChange → async save) ---------------- */
  function saveEditing(updated: Intent) {
    if (!editing || !config) return;
    const withId: Intent = { ...updated, id: updated.id ?? crypto.randomUUID() };
    const nextIntents = editing.isNew
      ? [...intents, withId]
      : intents.map((i) => (i.id === withId.id ? withId : i));
    applyChange(config, nextIntents, modes);
    setEditing(null);
  }
  function deleteIntent(id: string) {
    if (!config) return;
    applyChange(config, intents.filter((i) => i.id !== id), modes);
  }
  function saveMode(mode: Mode) {
    if (!editingMode || !config) return;
    const id = editingMode.mode?.id ?? crypto.randomUUID();
    const rec: ModeRecord = { ...mode, id };
    const nextModes = editingMode.mode ? modes.map((m) => (m.id === id ? rec : m)) : [...modes, rec];
    applyChange(config, intents, nextModes);
    setEditingMode(null);
  }
  async function aiAdd(query: string): Promise<{ explanation?: string }> {
    if (!config) return {};
    const res = await api.smart(query); // AI parse stays a real request
    let nextModes = modes;
    let intent: Intent = { ...res.intent, id: res.intent.id ?? crypto.randomUUID() };
    if (res.mode) {
      const rec: ModeRecord = { id: crypto.randomUUID(), name: res.mode.name, span: res.mode.span };
      nextModes = [...modes, rec];
      intent = { ...intent, mode: rec.id }; // link the intent to the new mode's id
    }
    applyChange(config, [...intents, intent], nextModes);
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
    setViewMonday('');
  }

  /* ---------------- derived: weeks + today ---------------- */
  const today = useMemo(
    () => new Date(Date.now() + (config?.utcOffsetMinutes ?? 0) * 60_000).toISOString().slice(0, 10),
    [config]
  );
  const now = useMemo(
    () => new Date(Date.now() + (config?.utcOffsetMinutes ?? 0) * 60_000).toISOString().slice(0, 16),
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

  const currentMonday = useMemo(() => mondayOf(today), [today]);

  // Land on the current week, and re-land only if the view falls outside the
  // available range (e.g. horizon rolled). Manual navigation within range sticks.
  useEffect(() => {
    if (!mondays.length) return;
    const first = mondays[0];
    const last = mondays[mondays.length - 1];
    if (!viewMonday || viewMonday < first || viewMonday > last) {
      setViewMonday(currentMonday >= first && currentMonday <= last ? currentMonday : first);
    }
  }, [mondays, currentMonday, viewMonday]);

  if (booting)
    return (
      <>
        <div className="boot">Loading…</div>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </>
    );
  if (!user)
    return (
      <>
        <Login
          onAuthed={(u) => {
            setUser(u);
            loadAll().catch((e) => setError(e instanceof Error ? e.message : String(e)));
          }}
        />
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </>
    );

  // The effective viewed Monday, with an inline fallback to the current week so we
  // never render the empty past even before the landing effect runs.
  const first = mondays[0];
  const last = mondays[mondays.length - 1];
  const effMonday =
    viewMonday && viewMonday >= first && viewMonday <= last
      ? viewMonday
      : currentMonday >= first && currentMonday <= last
        ? currentMonday
        : first;
  const weekIdx = mondays.indexOf(effMonday);
  const atFirst = weekIdx <= 0;
  const atLast = weekIdx >= mondays.length - 1;
  const days = mondays.length ? weekDates(effMonday) : [];
  const conflicts = (solveResp?.conflicts ?? []).filter(
    (c) => !c.date || (days.length > 0 && c.date >= days[0] && c.date <= days[6])
  );

  return (
    <>
    <div className="app">
      <Sidebar
        user={user}
        onLogout={logout}
        config={config}
        onConfigChange={changeConfig}
        intents={intents}
        onAIAdd={aiAdd}
        onEditIntent={(intent) => setEditing({ intent, isNew: false })}
        onNewIntent={() => setEditing({ intent: blankIntent(), isNew: true })}
        onDeleteIntent={deleteIntent}
        modes={modes}
        onNewMode={() => setEditingMode({ mode: null })}
        onEditMode={(m) => setEditingMode({ mode: m })}
        onDeleteMode={(id) => config && applyChange(config, intents, modes.filter((m) => m.id !== id))}
        feed={feed}
        onRotateFeed={rotateFeed}
        onReportBug={() => setBugOpen(true)}
        solveMs={solveResp?.solveMs ?? null}
        instanceCount={solveResp?.instances.length ?? 0}
        cached={solveResp?.cached ?? null}
        conflictCount={solveResp?.conflicts.length ?? 0}
        saveStatus={saveStatus}
      />

      <div className="main">
        {geoProposal && geoProposal.sig !== geoDismissed ? (
          <DetectBanner proposal={geoProposal} onApply={applyGeo} onDismiss={dismissGeo} />
        ) : null}
        <div className="toolbar">
          <button className="nav-btn" onClick={() => setViewMonday(addDays(effMonday, -7))} disabled={atFirst}>
            ‹
          </button>
          <button className="nav-btn" onClick={() => setViewMonday(addDays(effMonday, 7))} disabled={atLast}>
            ›
          </button>
          <div className="week-label">{days.length ? rangeLabel(days[0], days[6]) : '—'}</div>
          <span className="pill">
            Week {weekIdx + 1} of {mondays.length}
          </span>
          <div className="spacer" />
          <div className="legend">
            <span><span className="sleep-tag">sleep</span> During sleep hours</span>
            <span><span className="swatch" style={{ background: 'transparent', outline: '2px solid var(--danger)' }} />Overlap</span>
          </div>
        </div>

        {error ? (
          <div className="conflict-banner">
            <b>Error:</b> {error} <button className="btn tiny ghost" onClick={() => setError(null)}>Dismiss</button>
          </div>
        ) : conflicts.length ? (
          <div className="conflict-banner">
            <b>{conflicts.length} conflict{conflicts.length > 1 ? 's' : ''} this week:</b>
            <ul>
              {conflicts.slice(0, 6).map((c, i) => (
                <li key={i}>{c.message}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <WeekCalendar
          days={days}
          fixed={NO_FIXED}
          instances={solveResp?.instances ?? []}
          today={today}
          now={now}
          modes={modes}
          wakeup={config?.wakeup}
          sleep={config?.sleep}
        />
      </div>

      {editing ? (
        <IntentEditor
          key={editing.isNew ? 'new' : editing.intent.id}
          initial={editing.intent}
          isNew={editing.isNew}
          modes={modes}
          config={config}
          horizon={solveResp?.horizon}
          onSave={saveEditing}
          onCancel={() => setEditing(null)}
          onSmartEdit={(intent, instruction) => api.smartEdit(intent, instruction)}
        />
      ) : null}

      {editingMode ? (
        <ModeEditor
          key={editingMode.mode?.id ?? 'new-mode'}
          initial={
            editingMode.mode
              ? { name: editingMode.mode.name, span: editingMode.mode.span }
              : { name: '', span: [solveResp?.horizon.start ?? mondayOf(today), addDays(solveResp?.horizon.start ?? mondayOf(today), 6)] }
          }
          isNew={!editingMode.mode}
          others={modes.filter((m) => m.id !== editingMode.mode?.id)}
          horizon={solveResp?.horizon}
          onSave={saveMode}
          onCancel={() => setEditingMode(null)}
        />
      ) : null}

      {bugOpen ? (
        <BugReportModal
          weekStart={days[0] ?? ''}
          weekEnd={days[6] ?? ''}
          onCancel={() => setBugOpen(false)}
          onSubmit={async (description) => {
            const schedule = (solveResp?.instances ?? []).filter(
              (i) => days.length > 0 && i.date >= days[0] && i.date <= days[6]
            );
            await api.reportBug({
              description,
              clientDatetime: new Date().toISOString(),
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              config,
              weekStart: days[0] ?? '',
              weekEnd: days[6] ?? '',
              schedule,
            });
          }}
        />
      ) : null}
    </div>
    {toast ? (
      <div className="toast toast-error" role="alert">
        <span>{toast}</span>
        <button className="toast-close" onClick={() => setToast(null)} aria-label="Dismiss">
          ×
        </button>
      </div>
    ) : null}
    <ThemeToggle theme={theme} onToggle={toggleTheme} />
    </>
  );
}
