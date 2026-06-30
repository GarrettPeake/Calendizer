import { useState } from 'react';
import type { Mode } from 'calendizer';

/** Edit/create a mode in a modal (matching the intent editor), instead of
 *  always-on inline inputs. */
export function ModeEditor(props: {
  initial: { name: string; span: [string, string] };
  isNew: boolean;
  onSave: (mode: Mode) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(props.initial.name);
  const [from, setFrom] = useState(props.initial.span[0]);
  const [to, setTo] = useState(props.initial.span[1]);
  const valid = name.trim() && from.trim() && to.trim();

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
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bahamas Cruise" autoFocus />
          </label>
          <div className="grid2">
            <label className="edit-field">
              <span>From</span>
              <input type="text" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="YYYY-MM-DD" />
            </label>
            <label className="edit-field">
              <span>To</span>
              <input type="text" value={to} onChange={(e) => setTo(e.target.value)} placeholder="YYYY-MM-DD" />
            </label>
          </div>
          <p className="hint-cell">
            During this span, only intents set to this mode (plus “all”) are active
          </p>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={props.onCancel}>
            Cancel
          </button>
          <button className="btn" disabled={!valid} onClick={() => props.onSave({ name: name.trim(), span: [from.trim(), to.trim()] })}>
            {props.isNew ? 'Add mode' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
