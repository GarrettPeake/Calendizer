import { useState } from 'react';
import type { Mode } from 'calendizer';
import { validateMode } from 'calendizer';
import type { ModeRecord } from '../api';
import { addDays } from '../lib/dates';
import { FieldMsgs } from './formkit';

/** Edit/create a mode in a modal. Dates use native pickers (so malformed input is
 *  impossible); the To picker can't precede From, and choosing From auto-fills a
 *  one-week span. Overlap with other modes is blocked at Save. */
export function ModeEditor(props: {
  initial: { name: string; span: [string, string] };
  isNew: boolean;
  others?: ModeRecord[];
  horizon?: { start: string; end: string };
  onSave: (mode: Mode) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(props.initial.name);
  const [from, setFrom] = useState(props.initial.span[0]);
  const [to, setTo] = useState(props.initial.span[1]);

  const candidate: Mode = { name: name.trim(), span: [from, to] };
  const v = validateMode(candidate, { others: props.others, horizon: props.horizon });

  function onFromChange(next: string) {
    setFrom(next);
    // Auto-fill / snap To to keep an ordered span.
    if (next && (!to || to < next)) setTo(addDays(next, 6));
  }
  function normalizeName() {
    setName((n) => n.trim().replace(/\s+/g, ' '));
  }

  return (
    <div className="modal-overlay" onMouseDown={props.onCancel}>
      <div className="modal" style={{ width: 420 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{props.isNew ? 'New mode' : `Edit “${props.initial.name}”`}</h3>
          <button className="x" onClick={props.onCancel}>
            ×
          </button>
        </div>
        <div className="modal-body">
          <label className="edit-field">
            <span>Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={normalizeName}
              placeholder="e.g. Bahamas Cruise"
              autoFocus
            />
          </label>
          <FieldMsgs result={v} field="name" />
          <div className="grid2">
            <label className="edit-field">
              <span>From</span>
              <input type="date" value={from} max={to || undefined} onChange={(e) => onFromChange(e.target.value)} />
            </label>
            <label className="edit-field">
              <span>To</span>
              <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
          <FieldMsgs result={v} field="span" />
          <p className="hint-cell">
            During this span, only intents set to this mode (plus “all”) are active
          </p>
        </div>
        <div className="modal-foot">
          {!v.ok ? <span className="foot-note error">{v.errors.length} issue{v.errors.length === 1 ? '' : 's'} to fix</span> : null}
          <button className="btn ghost" onClick={props.onCancel}>
            Cancel
          </button>
          <button className="btn" disabled={!v.ok} onClick={() => props.onSave(candidate)}>
            {props.isNew ? 'Add mode' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
