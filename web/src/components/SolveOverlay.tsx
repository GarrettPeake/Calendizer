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

function pickMessage(prev: string | null, intents: Intent[]): string {
  for (let tries = 0; tries < 8; tries++) {
    let m = MESSAGES[Math.floor(Math.random() * MESSAGES.length)];
    if (m.includes('{intent}')) {
      if (intents.length === 0) continue; // nothing to name — pick another
      m = m.replace('{intent}', intents[Math.floor(Math.random() * intents.length)].subject);
    }
    if (m !== prev) return m;
  }
  return MESSAGES[3];
}

export function SolveOverlay({ phase, progress, intents }: { phase: OverlayPhase; progress: number; intents: Intent[] }) {
  const [message, setMessage] = useState(() => pickMessage(null, intents));
  const [msgKey, setMsgKey] = useState(0); // remount → re-run the entry animation
  const intentsRef = useRef(intents);
  intentsRef.current = intents;

  useEffect(() => {
    if (phase !== 'solving') return;
    const t = setInterval(() => {
      setMessage((prev) => pickMessage(prev, intentsRef.current));
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
