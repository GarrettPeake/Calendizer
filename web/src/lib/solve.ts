/**
 * Client-side scheduling. The pure `assembleSchedule` pipeline (shared with the
 * Worker fallback) runs in the browser: instant preview, no server round-trip.
 */
import { assembleSchedule, type GlobalConfig, type Instance } from 'calendizer';
import type { ModeRecord } from '../api';

export interface ClientSchedule {
  instances: Instance[];
  conflicts: ReturnType<typeof assembleSchedule>['conflicts'];
  reapedIntentIds: string[];
  horizon: { start: string; end: string };
  solveMs: number;
  computedAt: string;
}

/** Current wall-clock "YYYY-MM-DDTHH:MM" in the user's fixed offset. */
function nowInOffset(offsetMinutes: number): string {
  return new Date(Date.now() + offsetMinutes * 60_000).toISOString().slice(0, 16);
}

/**
 * Solve the calendar from the current inputs. `previous` is the last published
 * calendar; its past slice is preserved as the immutable frozen history (the
 * pipeline filters it to start < now, so passing the whole thing is safe).
 */
export function computeSchedule(
  config: GlobalConfig,
  intents: Parameters<typeof assembleSchedule>[0]['intents'],
  modes: ModeRecord[],
  previous: Instance[]
): ClientSchedule {
  const offset = config.utcOffsetMinutes ?? 0;
  const nowDT = nowInOffset(offset);
  const today = nowDT.slice(0, 10);
  const r = assembleSchedule({ config, intents, modeRecords: modes, frozen: previous, nowDT, today });
  return { ...r, computedAt: new Date().toISOString() };
}
