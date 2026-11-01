/** Pure helpers for turning stored status intervals and counters into OEE inputs. */
export interface Interval {
  start: Date;
  /** null means the interval is still open (the machine is still in that status). */
  end: Date | null;
}

/** Seconds of the given intervals that fall inside [from, to]. Open intervals end at min(now, to). */
export function overlapSeconds(intervals: Interval[], from: Date, to: Date, now: Date): number {
  const windowEnd = Math.min(to.getTime(), now.getTime());
  let ms = 0;
  for (const { start, end } of intervals) {
    const s = Math.max(start.getTime(), from.getTime());
    const e = Math.min(end ? end.getTime() : windowEnd, to.getTime());
    if (e > s) ms += e - s;
  }
  return ms / 1000;
}

/**
 * Delta of a cumulative machine counter. If the counter went backwards
 * (machine restart or counter reset) the new value is treated as the delta.
 */
export function counterDelta(current: number, previous: number): number {
  return current >= previous ? current - previous : current;
}
