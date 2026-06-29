import { useState } from 'react';

export function FeedPanel(props: {
  url: string | null;
  onRotate: () => Promise<void>;
  solveMs: number | null;
  instanceCount: number;
  cached: boolean | null;
}) {
  const [copied, setCopied] = useState(false);
  const [rotating, setRotating] = useState(false);

  async function copy() {
    if (!props.url) return;
    try {
      await navigator.clipboard.writeText(props.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }
  async function rotate() {
    if (!confirm('Rotate the secret URL? Any calendar currently subscribed will stop updating.')) return;
    setRotating(true);
    try {
      await props.onRotate();
    } finally {
      setRotating(false);
    }
  }

  return (
    <div className="section">
      <h2>Calendar feed</h2>
      <div className="card">
        <p className="empty-hint" style={{ marginTop: 0 }}>
          Subscribe in Google/Apple Calendar with this secret URL:
        </p>
        <input type="text" readOnly value={props.url ?? ''} onFocus={(e) => e.currentTarget.select()} />
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn tiny" onClick={copy}>
            {copied ? '✓ Copied' : 'Copy'}
          </button>
          <button className="btn tiny ghost" onClick={rotate} disabled={rotating}>
            {rotating ? '…' : 'Rotate'}
          </button>
        </div>
        <p className="empty-hint" style={{ marginTop: 8 }}>
          Solved {props.instanceCount} events over 12 months
          {props.solveMs != null ? ` in ${props.solveMs} ms` : ''}
          {props.cached ? ' (cached)' : ''}.
        </p>
      </div>
    </div>
  );
}
