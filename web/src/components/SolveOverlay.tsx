/**
 * The solving overlay: a medium-opacity grey veil over the (emptied) calendar
 * with a REAL progress bar (weeks solved / total from the worker) and a gently
 * rotating status message. On completion it flips to a short success beat —
 * white checkmark, "Solved", grey → green (200ms) — then the whole overlay
 * fades out (100ms) while the events fade in underneath.
 */
import { useEffect, useRef, useState } from 'react';
import type { Intent } from 'calendizer';

export type OverlayPhase = 'solving' | 'success' | 'fadeout';

const MESSAGES = [
  'Solving for your best life',
  'Making time work for you',
  'Finding time for {intent}',
  'Crunching the numbers',
  'Getting you time back',
  'Ensuring your goals are met',
  'Computing all possible futures',
  'Calibrating the fourth dimension',
];

/**
 * Shuffle-bag selection: draw templates randomly WITHOUT replacement; when the
 * bag empties, refill it. Every message appears once per cycle — random order,
 * no repeats. The only special cases: the "{intent}" template is discarded when
 * there's nothing to name, and a fresh bag won't open with the message that
 * just closed the previous one.
 */
function drawMessage(bag: string[], prev: string | null, intents: Intent[]): string {
  for (let tries = 0; tries < MESSAGES.length * 2; tries++) {
    if (bag.length === 0) bag.push(...MESSAGES);
    let m = bag.splice(Math.floor(Math.random() * bag.length), 1)[0];
    if (m.includes('{intent}')) {
      if (intents.length === 0) continue; // nothing to name — discard this draw
      m = m.replace('{intent}', intents[Math.floor(Math.random() * intents.length)].subject);
    }
    if (m === prev && bag.length > 0) {
      bag.push(m); // cross-refill collision: keep it in the cycle, draw another
      continue;
    }
    return m;
  }
  return MESSAGES[3];
}

export function SolveOverlay({ phase, progress, intents }: { phase: OverlayPhase; progress: number; intents: Intent[] }) {
  const bagRef = useRef<string[]>([]);
  const intentsRef = useRef(intents);
  intentsRef.current = intents;
  const [message, setMessage] = useState(() => drawMessage(bagRef.current, null, intents));
  const lastRef = useRef(message);
  const [msgKey, setMsgKey] = useState(0); // remount → re-run the entry animation

  useEffect(() => {
    if (phase !== 'solving') return;
    const t = setInterval(() => {
      // Draw outside the state updater — it mutates the bag (side effect).
      const next = drawMessage(bagRef.current, lastRef.current, intentsRef.current);
      lastRef.current = next;
      setMessage(next);
      setMsgKey((k) => k + 1);
    }, 2200);
    return () => clearInterval(t);
  }, [phase]);

  const done = phase !== 'solving';
  const text = done ? 'Solved' : message;
  // Per-letter staggered rise: the first letters land before the last, left to
  // right. The success beat is short, so "Solved" cascades tighter and faster.
  const stagger = done ? 12 : 16;
  return (
    <div className={`solve-overlay ${phase}`}>
      <div className="solve-box">
        <div key={done ? 'solved' : msgKey} className={`solve-msg${done ? ' solved' : ''}`}>
          {[...text].map((ch, i) => (
            <span key={i} className="solve-ch" style={{ animationDelay: `${i * stagger}ms` }}>
              {ch === ' ' ? ' ' : ch}
            </span>
          ))}
        </div>
        {done ? (
          <svg className="solve-check" viewBox="0 0 24 24" width="34" height="34" aria-hidden>
            <path d="M4 12.5 L10 18.5 L20 6.5" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <div className="solve-track">
            <div className="solve-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}
