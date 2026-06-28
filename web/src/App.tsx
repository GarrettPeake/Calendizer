import { useMemo, useState } from 'react';
import { solve } from 'calendizer';
import type { GlobalConfig, Intent, Mode, SolveOutput } from 'calendizer';
import { Sidebar } from './components/Sidebar';
import { WeekCalendar } from './components/WeekCalendar';
import { BASE_CALENDARS } from './data/calendars';
import { INTENT_LIBRARY } from './data/intents';
import { expandFixed } from './lib/expandFixed';
import { addDays, mondayOf, rangeLabel, weekDates } from './lib/dates';

// The playground anchors "today" to the project's reference date so the seeded
// example dates (e.g. the Saturday fishing trip) line up.
const TODAY = '2026-06-28';
const HORIZON_START = mondayOf(TODAY); // 2026-06-22

const DEFAULT_CONFIG: GlobalConfig = {
  wakeup: '07:00',
  sleep: '23:00',
  padding: 0,
  grid: 5,
  min_break: 15,
  max_block: 180,
  utcOffsetMinutes: 0,
};

const STARTER_INTENTS: Intent[] = [
  structuredClone(INTENT_LIBRARY.find((p) => p.id === 'medication')!.intent),
  structuredClone(INTENT_LIBRARY.find((p) => p.id === 'gym')!.intent),
  structuredClone(INTENT_LIBRARY.find((p) => p.id === 'guitar')!.intent),
];

export function App() {
  const [calendarId, setCalendarId] = useState('professional');
  const [config, setConfig] = useState<GlobalConfig>(DEFAULT_CONFIG);
  const [userModes, setUserModes] = useState<Mode[]>([]);
  const [intents, setIntents] = useState<Intent[]>(STARTER_INTENTS);
  const [horizonWeeks, setHorizonWeeks] = useState(4);
  const [viewWeek, setViewWeek] = useState(0);

  const calendar = BASE_CALENDARS.find((c) => c.id === calendarId)!;

  const mondays = useMemo(
    () => Array.from({ length: horizonWeeks }, (_, w) => addDays(HORIZON_START, w * 7)),
    [horizonWeeks]
  );
  const horizon = useMemo(
    () => ({ start: HORIZON_START, end: addDays(HORIZON_START, horizonWeeks * 7 - 1) }),
    [horizonWeeks]
  );
  const solverModes = useMemo(() => [...(calendar.modes ?? []), ...userModes], [calendar, userModes]);
  const fixed = useMemo(() => expandFixed(calendar, mondays), [calendar, mondays]);

  const { output, error } = useMemo<{ output: SolveOutput | null; error: string | null }>(() => {
    try {
      return {
        output: solve({ config, intents, modes: solverModes, existingCalendar: fixed, horizon }),
        error: null,
      };
    } catch (e) {
      return { output: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [config, intents, solverModes, fixed, horizon]);

  const safeViewWeek = Math.min(viewWeek, horizonWeeks - 1);
  const days = weekDates(mondays[safeViewWeek]);
  const conflictsThisWeek = (output?.conflicts ?? []).filter(
    (c) => !c.date || (c.date >= days[0] && c.date <= days[6])
  );

  function loadCalendar(id: string) {
    setCalendarId(id);
    const cal = BASE_CALENDARS.find((c) => c.id === id)!;
    if (cal.configPatch) setConfig((cfg) => ({ ...cfg, ...cal.configPatch }));
  }

  function addPreset(presetId: string) {
    const preset = INTENT_LIBRARY.find((p) => p.id === presetId)!;
    setIntents((prev) => [...prev, structuredClone(preset.intent)]);
    if (preset.needsMode) {
      const has = solverModes.some((m) => m.name === preset.needsMode);
      if (!has) {
        setUserModes((prev) => [
          ...prev,
          { name: preset.needsMode!, span: [HORIZON_START, addDays(HORIZON_START, 6)] },
        ]);
      }
    }
  }

  return (
    <div className="app">
      <Sidebar
        calendars={BASE_CALENDARS}
        calendarId={calendarId}
        onSelectCalendar={loadCalendar}
        calendarModes={calendar.modes ?? []}
        config={config}
        setConfig={setConfig}
        userModes={userModes}
        setUserModes={setUserModes}
        intents={intents}
        setIntents={setIntents}
        intentLibrary={INTENT_LIBRARY}
        onAddPreset={addPreset}
        horizonWeeks={horizonWeeks}
        setHorizonWeeks={(n) => {
          setHorizonWeeks(n);
          setViewWeek((w) => Math.min(w, n - 1));
        }}
        instanceCount={output?.instances.length ?? 0}
        conflictCount={output?.conflicts.length ?? 0}
      />

      <div className="main">
        <div className="toolbar">
          <button className="nav-btn" onClick={() => setViewWeek((w) => Math.max(0, w - 1))} disabled={safeViewWeek === 0}>
            ‹
          </button>
          <button
            className="nav-btn"
            onClick={() => setViewWeek((w) => Math.min(horizonWeeks - 1, w + 1))}
            disabled={safeViewWeek === horizonWeeks - 1}
          >
            ›
          </button>
          <div className="week-label">{rangeLabel(days[0], days[6])}</div>
          <span className="pill">
            Week {safeViewWeek + 1} of {horizonWeeks}
          </span>
          <div className="spacer" />
          <div className="legend">
            <span><span className="swatch" style={{ background: '#eceff3', border: '1px solid #9aa3b2' }} />Fixed</span>
            <span><span className="swatch" style={{ background: 'hsl(210 70% 92%)', border: '1px solid hsl(210 65% 55%)' }} />Solved</span>
            <span>🌙 during sleep</span>
            <span><span className="swatch" style={{ background: '#fff', outline: '2px solid var(--danger)' }} />overlap</span>
          </div>
        </div>

        {error ? (
          <div className="conflict-banner">
            <b>Couldn’t solve:</b> {error} — check your intent JSON.
          </div>
        ) : conflictsThisWeek.length ? (
          <div className="conflict-banner">
            <b>{conflictsThisWeek.length} conflict{conflictsThisWeek.length > 1 ? 's' : ''} this week:</b>
            <ul>
              {conflictsThisWeek.slice(0, 6).map((c, i) => (
                <li key={i}>
                  [{c.kind}] {c.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <WeekCalendar days={days} fixed={fixed} instances={output?.instances ?? []} today={TODAY} />
      </div>
    </div>
  );
}
