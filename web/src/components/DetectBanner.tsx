import type { GeoProposal } from '../lib/detect';

export function DetectBanner(props: { proposal: GeoProposal; onApply: () => void; onDismiss: () => void }) {
  const { proposal } = props;
  return (
    <div className="detect-banner">
      <div className="detect-text">
        <b>Update location &amp; timezone?</b>{' '}
        {proposal.tzName ? `Detected ${proposal.tzName}.` : 'Detected a change.'}
        <ul>
          {proposal.changes.map((c) => (
            <li key={c.label}>
              {c.label}: {c.from} → {c.to}
            </li>
          ))}
        </ul>
      </div>
      <div className="detect-actions">
        <button className="btn tiny" onClick={props.onApply}>
          Apply
        </button>
        <button className="btn tiny ghost" onClick={props.onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
