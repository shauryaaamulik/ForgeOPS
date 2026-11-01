/**
 * Overall Equipment Effectiveness (OEE) = Availability x Performance x Quality.
 *
 * Availability = run time / planned production time
 * Performance  = (ideal cycle time x total count) / run time   (capped at 1)
 * Quality      = good count / total count
 *
 * All times are in seconds. Each ratio is clamped to [0, 1]; an undefined
 * ratio (zero denominator) is treated as 0 so OEE never becomes NaN.
 */
export interface OeeInput {
  plannedTimeSec: number;
  downtimeSec: number;
  idealCycleTimeSec: number;
  totalCount: number;
  goodCount: number;
}

export interface OeeResult {
  availability: number;
  performance: number;
  quality: number;
  oee: number;
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const ratio = (num: number, den: number): number => (den > 0 ? clamp01(num / den) : 0);

export function calculateOee(input: OeeInput): OeeResult {
  const { plannedTimeSec, downtimeSec, idealCycleTimeSec, totalCount, goodCount } = input;
  for (const [k, v] of Object.entries(input)) {
    if (!Number.isFinite(v) || v < 0) throw new RangeError(`${k} must be a non-negative number`);
  }
  if (downtimeSec > plannedTimeSec) throw new RangeError("downtimeSec cannot exceed plannedTimeSec");
  if (goodCount > totalCount) throw new RangeError("goodCount cannot exceed totalCount");

  const runTimeSec = plannedTimeSec - downtimeSec;
  const availability = ratio(runTimeSec, plannedTimeSec);
  const performance = ratio(idealCycleTimeSec * totalCount, runTimeSec);
  const quality = ratio(goodCount, totalCount);
  return { availability, performance, quality, oee: availability * performance * quality };
}
