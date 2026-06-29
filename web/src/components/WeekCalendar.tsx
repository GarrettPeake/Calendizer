import { useMemo } from 'react';
import type { CalendarEvent, Instance } from 'calendizer';
import { colorFor } from '../lib/colors';
import { dateOf, dayLabel, timeOfMin, weekdayCode } from '../lib/dates';

const HOUR_H = 48; // px per hour
const PX = HOUR_H / 60;

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
}) {
  const { days, fixed, instances, today } = props;
  const dayset = new Set(days);

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
              {hours.map((h) => (
                <div className="hr-line" key={h} />
              ))}
              {byDay[d].map((e) => {
                const lanes = e._lanes ?? 1;
                const lane = e._lane ?? 0;
                const widthPct = 100 / lanes;
                const col = e.kind === 'instance' ? colorFor(e.intentId ?? e.subject) : null;
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
                    className={`evt ${e.kind}${e._overlap ? ' overlap' : ''}`}
                    style={style}
                    title={`${e.subject}\n${fmt(e.startMin)}–${fmt(e.endMin)}${
                      e.children?.length ? '\n' + e.children.map((c) => `• ${c.subject}`).join('\n') : ''
                    }`}
                  >
                    <div className="t">
                      {e.placedDuringSleep ? <span className="moon">🌙 </span> : null}
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
