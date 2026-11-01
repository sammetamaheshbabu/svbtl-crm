/**
 * Converting a wall-clock time in a named zone to an absolute instant.
 *
 * "Call me back at 5:30" is a wall-clock intent, not an instant: it means
 * 5:30 on the agent's clock. Turning that into a TIMESTAMPTZ needs the
 * zone's offset at that moment, which itself depends on the instant —
 * hence the two-pass correction below, the same trick
 * `src/lib/ai/usage-days.ts` already uses for zoned day boundaries.
 * (That module keeps its own copy because it works in day keys; this one
 * takes hours and minutes.)
 */

/** Fallback when no zone is known. Matches `resolveTimeZone`'s default. */
export const DEFAULT_TIME_ZONE = 'UTC';

/** The zone this browser is in, or UTC where that cannot be read. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIME_ZONE;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

/** True when the runtime recognises `zone` as an IANA zone name. */
export function isValidTimeZone(zone: string): boolean {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function zonedParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const value = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}

/** How far `timeZone` is ahead of UTC at `instant`, in milliseconds. */
function offsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

export interface WallClock {
  year: number;
  /** 1-12, as a human writes it — not JavaScript's 0-11. */
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/**
 * The instant at which it is `wall` o'clock in `timeZone`.
 *
 * The first guess subtracts the offset that applies *now*; the second
 * subtracts the offset that applies at the guessed instant, which is the
 * one that actually governs. Two passes settle every zone except a time
 * that does not exist (the hour a DST jump skips), where it lands on the
 * instant immediately after the jump. India has no DST, so for this
 * business the question never arises.
 */
export function wallClockToInstant(wall: WallClock, timeZone: string): Date {
  const asUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute
  );
  const firstGuess = asUtc - offsetMs(new Date(asUtc), timeZone);
  return new Date(asUtc - offsetMs(new Date(firstGuess), timeZone));
}

/** What the clock reads in `timeZone` at `instant`. */
export function instantToWallClock(instant: Date, timeZone: string): WallClock {
  const p = zonedParts(instant, timeZone);
  return {
    year: p.year,
    month: p.month,
    day: p.day,
    hour: p.hour,
    minute: p.minute,
  };
}
