/**
 * Calendizer — a deterministic calendar manager.
 *
 * Ingests N declarative intents (+ modes + an existing calendar) and produces a
 * concrete placement: derived instances, the set of updates to apply, and a
 * conflict report naming any constraints in tension. The solver always places
 * and is deterministic — same inputs always yield the same output.
 */
export * from './types';
export { solve, greedySolver } from './solver';
export type { Solver } from './solver';
export { renderICS } from './ics';
export { resolveTimeValue, resolveWindow } from './markers';
export { solarTimes } from './solar';
export { expandIntent } from './expand';
export { tileChildren } from './children';
export { activeModeOn, isIntentActiveOn, detectModeOverlaps } from './modes';
export { alignHorizonStart, overlay, realizedConflicts, isFullyPassed } from './temporal';
export {
  validateIntent,
  validateMode,
  validateConfig,
  validateCredentials,
  isValidClock,
  isValidISODate,
} from './validate';
export type {
  ValidationIssue,
  ValidationResult,
  Severity,
  IntentValidationContext,
  ModeValidationContext,
  CredentialInput,
} from './validate';
