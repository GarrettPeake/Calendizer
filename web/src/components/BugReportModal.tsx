import { useState } from 'react';
import { rangeLabel } from '../lib/dates';

/** Report a bug. The parent attaches the context (datetime, config, viewed-week
 *  schedule) on submit; this modal only collects the description. */
export function BugReportModal(props: {
  weekStart: string;
  weekEnd: string;
  onSubmit: (description: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    if (!description.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await props.onSubmit(description.trim());
      setDone(true);
      setTimeout(props.onCancel, 900);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={props.onCancel}>
      <div className="modal" style={{ width: 460 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Report a bug</h3>
          <button className="x" onClick={props.onCancel}>
            ×
          </button>
        </div>
        <div className="modal-body">
          {done ? (
            <p className="empty-hint" style={{ fontStyle: 'normal' }}>Thanks — your report was sent.</p>
          ) : (
            <>
              <label className="edit-field">
                <span>What went wrong?</span>
                <textarea
                  rows={5}
                  autoFocus
                  placeholder="Describe what you expected vs. what you saw…"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              <p className="hint-cell">
                We’ll attach your current date/time, your calendar settings, and the schedule for the week you’re viewing
                ({props.weekStart ? rangeLabel(props.weekStart, props.weekEnd) : 'current week'}) to help us reproduce it.
              </p>
              {error ? <p className="field-msg error">{error}</p> : null}
            </>
          )}
        </div>
        {!done ? (
          <div className="modal-foot">
            <button className="btn ghost" onClick={props.onCancel}>
              Cancel
            </button>
            <button className="btn" onClick={submit} disabled={busy || !description.trim()}>
              {busy ? 'Sending…' : 'Send report'}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
