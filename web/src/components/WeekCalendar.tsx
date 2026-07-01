import { useMemo } from 'react';
import type { CalendarEvent, Instance, TimeValue } from 'calendizer';
import { colorFor, modeColor } from '../lib/colors';
import { dateOf, dayLabel, timeOfMin, weekdayCode } from '../lib/dates';

const HOUR_H = 48; // px per hour
const PX = HOUR_H / 60;

interface ModeSpan {
  id: string;
  name: string;
  span: [string, string];
}

/** Parse an "HH:MM" clock string to minutes from midnight; null for markers. */
function clockMin(t: TimeValue | undefined): number | null {
  if (typeof t !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** The asleep regions of a day as [startMin, endMin] bands, given wake/sleep. */
function sleepBands(wakeup: number | null, sleep: number | null): [number, number][] {
  if (wakeup == null || sleep == null) return [];
  if (wakeup === sleep) return [];
  // Normal case (wake before sleep): asleep is the night on either end of the day.
  if (wakeup < sleep) {
    const out: [number, number][] = [];
    if (wakeup > 0) out.push([0, wakeup]);
    if (sleep < 1440) out.push([sleep, 1440]);
    return out;
  }
  // Overnight-awake: a single asleep band in the middle of the day.
  return [[sleep, wakeup]];
}

interface DisplayEvent {
  uid: string;
  subject: string;
  date: string;
  startMin: number;
  endMin: number;
  kind: 'fixed' | 'instance';
  intentId?: string;
  children?: { subject: string; start: string; end: string }[];
  placedDuringSleep?: boolean;
  _lane?: number;
  _lanes?: number;
  _overlap?: boolean;
  /** Start of the next event in the same lane (or 1440) — bounds the drawn height
   *  so a min-height tiny event never grows into its neighbour. */
  _maxBottomMin?: number;
}

function layoutDay(evts: DisplayEvent[]): DisplayEvent[] {
  // All geometry uses REAL times. A min *pixel* height keeps tiny events visible
  // without distorting the schedule or causing false overlaps.
  const sorted = [...evts].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  for (const e of sorted) {
    e._overlap = sorted.some((o) => o !== e && e.startMin < o.endMin && o.startMin < e.endMin);
  }
  // lane packing within connected overlap clusters
  const out: DisplayEvent[] = [];
  let cluster: DisplayEvent[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes: DisplayEvent[][] = [];
    for (const e of cluster) {
      let placed = false;
      for (let i = 0; i < lanes.length; i++) {
        if (lanes[i][lanes[i].length - 1].endMin <= e.startMin) {
          e._lane = i;
          lanes[i].push(e);
          placed = true;
          break;
        }
      }
      if (!placed) {
        e._lane = lanes.length;
        lanes.push([e]);
      }
    }
    for (const e of cluster) {
      e._lanes = lanes.length;
      out.push(e);
    }
    cluster = [];
  };
  for (const e of sorted) {
    if (cluster.length && e.startMin >= clusterEnd) flush();
    cluster.push(e);
    clusterEnd = cluster.length === 1 ? e.endMin : Math.max(clusterEnd, e.endMin);
  }
  if (cluster.length) flush();

  // The next event sharing an event's column bounds its drawn height — computed
  // globally (across clusters) so a tiny event can't overflow the next block,
  // even when they don't actually overlap in time.
  const byLane = new Map<number, DisplayEvent[]>();
  for (const e of out) {
    const arr = byLane.get(e._lane!) ?? [];
    arr.push(e);
    byLane.set(e._lane!, arr);
  }
  for (const lane of byLane.values()) {
    lane.sort((a, b) => a.startMin - b.startMin);
    for (let i = 0; i < lane.length; i++) {
      lane[i]._maxBottomMin = i + 1 < lane.length ? lane[i + 1].startMin : 1440;
    }
  }
  return out;
}

const MIN_EVT_PX = 15; // desired minimum height for readability

export function WeekCalendar(props: {
  days: string[];
  fixed: CalendarEvent[];
  instances: Instance[];
  today: string;
  /** Current local wall-clock as "YYYY-MM-DDTHH:MM"; events before it read as settled. */
  now?: string;
  modes?: ModeSpan[];
  wakeup?: TimeValue;
  sleep?: TimeValue;
}) {
  const { days, fixed, instances, today, now, modes = [] } = props;
  const dayset = new Set(days);

  // Which modes cover each visible day (a day can sit inside several spans).
  const modesByDay = useMemo(() => {
    const map: Record<string, ModeSpan[]> = {};
    for (const d of days) map[d] = modes.filter((m) => d >= m.span[0] && d <= m.span[1]);
    return map;
  }, [days, modes]);

  const bands = useMemo(() => sleepBands(clockMin(props.wakeup), clockMin(props.sleep)), [props.wakeup, props.sleep]);

  const byDay = useMemo(() => {
    const map: Record<string, DisplayEvent[]> = {};
    for (const d of days) map[d] = [];
    for (const f of fixed) {
      const d = dateOf(f.start);
      if (!dayset.has(d)) continue;
      map[d].push({
        uid: f.uid,
        subject: f.subject,
        date: d,
        startMin: timeOfMin(f.start),
        endMin: timeOfMin(f.end),
        kind: 'fixed',
      });
    }
    for (const inst of instances) {
      const d = inst.date;
      if (!dayset.has(d)) continue;
      map[d].push({
        uid: inst.uid,
        subject: inst.subject,
        date: d,
        startMin: timeOfMin(inst.start),
        endMin: timeOfMin(inst.end),
        kind: 'instance',
        intentId: inst.intentId,
        children: inst.children,
        placedDuringSleep: inst.placedDuringSleep,
      });
    }
    for (const d of days) map[d] = layoutDay(map[d]);
    return map;
  }, [days, fixed, instances]);

  const hours = Array.from({ length: 24 }, (_, i) => i);

  return (
    <div className="cal-scroll" style={{ ['--hour-h' as any]: `${HOUR_H}px` }}>
      <div className="cal-head">
        <div className="corner" />
        {days.map((d) => {
          const { dow, day } = dayLabel(d);
          return (
            <div key={d} className={`dh${d === today ? ' today' : ''}`}>
              <div className="dow">{dow}</div>
              <div className="num">{day}</div>
              {modesByDay[d].length ? (
                <div className="mode-chips">
                  {modesByDay[d].map((m) => {
                    const c = modeColor(m.id);
                    return (
                      <span
                        key={m.id}
                        className="mode-chip"
                        style={{ background: c.wash, color: c.text, borderColor: c.chip }}
                        title={m.name}
                      >
                        {m.name}
                      </span>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="cal-body">
        <div className="time-gutter">
          {hours.map((h) => (
            <div className="hr" key={h}>
              <span>{h === 0 ? '' : `${String(h).padStart(2, '0')}:00`}</span>
            </div>
          ))}
        </div>

        {days.map((d) => {
          const wd = weekdayCode(d);
          const weekend = wd === 'SA' || wd === 'SU';
          return (
            <div key={d} className={`day-col${weekend ? ' weekend' : ''}`}>
              {modesByDay[d].map((m) => (
                <div key={m.id} className="day-mode-wash" style={{ background: modeColor(m.id).wash }} />
              ))}
              {bands.map(([s, e], i) => (
                <div
                  key={`sb${i}`}
                  className="sleep-band"
                  style={{ top: s * PX, height: (e - s) * PX }}
                />
              ))}
              {hours.map((h) => (
                <div className="hr-line" key={h} />
              ))}
              {byDay[d].map((e) => {
                const lanes = e._lanes ?? 1;
                const lane = e._lane ?? 0;
                const widthPct = 100 / lanes;
                const col = e.kind === 'instance' ? colorFor(e.intentId ?? e.subject) : null;
                const past = now ? `${e.date}T${fmt(e.startMin)}` < now : false;
                // Real height, but at least MIN_EVT_PX for readability — clamped so
                // it never overflows into the next event sharing this lane.
                const realPx = (e.endMin - e.startMin) * PX;
                const availablePx = ((e._maxBottomMin ?? 1440) - e.startMin) * PX - 1;
                const height = Math.max(Math.min(Math.max(realPx - 1, MIN_EVT_PX), availablePx), 4);
                const style: React.CSSProperties = {
                  top: e.startMin * PX,
                  height,
                  left: `calc(${lane * widthPct}% + 3px)`,
                  width: `calc(${widthPct}% - 6px)`,
                  ...(col ? { background: col.bg, borderLeftColor: col.border, color: col.text } : {}),
                };
                return (
                  <div
                    key={e.uid}
                    className={`evt ${e.kind}${e._overlap ? ' overlap' : ''}${past ? ' past' : ''}`}
                    style={style}
                    title={`${e.subject}\n${fmt(e.startMin)}–${fmt(e.endMin)}${
                      e.children?.length ? '\n' + e.children.map((c) => `• ${c.subject}`).join('\n') : ''
                    }`}
                  >
                    <div className="t">
                      {e.placedDuringSleep ? <span className="sleep-tag">sleep</span> : null}
                      {e.subject}
                    </div>
                    <div className="time">
                      {fmt(e.startMin)}–{fmt(e.endMin)}
                    </div>
                    {e.children?.length ? (
                      <div className="kids">
                        {e.children
                          .filter((c) => timeOfMin(c.end) > timeOfMin(c.start))
                          .map((c) => c.subject)
                          .join(' · ')}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function fmt(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
