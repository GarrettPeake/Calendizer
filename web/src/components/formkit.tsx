import type { ValidationIssue, ValidationResult } from 'calendizer';

/** Issues whose field is exactly `field` or nested under it (`field.*`). */
export function issuesFor(issues: ValidationIssue[], field: string): ValidationIssue[] {
  return issues.filter((i) => i.field === field || i.field.startsWith(field + '.'));
}

const all = (r: ValidationResult) => [...r.errors, ...r.warnings];

/** Inline error/warning messages for a single field (or field subtree). */
export function FieldMsgs({ result, field }: { result: ValidationResult; field: string }) {
  const hits = issuesFor(all(result), field);
  if (!hits.length) return null;
  return (
    <div className="field-msgs">
      {hits.map((i, n) => (
        <p key={n} className={`field-msg ${i.severity}`}>
          {i.message}
        </p>
      ))}
    </div>
  );
}

/** A compact summary block (errors first, then warnings) for the top of a form. */
export function IssueSummary({ result }: { result: ValidationResult }) {
  if (result.ok && result.warnings.length === 0) return null;
  return (
    <div className={`issue-summary ${result.ok ? 'warn-only' : ''}`}>
      {result.errors.map((i, n) => (
        <p key={`e${n}`} className="field-msg error">
          {i.message}
        </p>
      ))}
      {result.warnings.map((i, n) => (
        <p key={`w${n}`} className="field-msg warning">
          {i.message}
        </p>
      ))}
    </div>
  );
}

/**
 * Number input that always emits a clean integer (or NaN → the caller decides).
 * Prevents the `Number('')`/negative/float garbage the raw inputs allowed.
 */
export function NumInput(props: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const { integer = true, ...rest } = props;
  return (
    <input
      type="number"
      value={Number.isFinite(props.value) ? props.value : ''}
      min={props.min}
      max={props.max}
      step={props.step ?? (integer ? 1 : undefined)}
      disabled={props.disabled}
      placeholder={props.placeholder}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '') {
          props.onChange(NaN);
          return;
        }
        let n = Number(raw);
        if (integer) n = Math.trunc(n);
        props.onChange(n);
      }}
    />
  );
}
