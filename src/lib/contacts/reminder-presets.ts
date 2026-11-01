/**
 * The one-tap callback times.
 *
 * Telecallers set these while still on the call, so the common answers —
 * "this evening", "after three days" — have to be one tap. Each preset is
 * a wall-clock intent in the agent's own zone, not an offset from now:
 * "tomorrow morning" means 10am on their clock, whatever time it is when
 * they tap it.
 *
 * `laterToday` is deliberately absent from the list when 5:30pm has
 * already passed — offering an option that resolves to the past is worse
 * than offering nothing.
 */

import {
  instantToWallClock,
  wallClockToInstant,
  type WallClock,
} from '@/lib/time/zoned';

export type ReminderPresetId =
  | 'this_evening'
  | 'tomorrow_morning'
  | 'in_three_days'
  | 'next_week';

export interface ReminderPreset {
  id: ReminderPresetId;
  /** The instant the callback falls due. */
  at: Date;
}

/** 5:30pm — the hour customers name most often. */
const EVENING = { hour: 17, minute: 30 };
/** 10:00am — after a studio opens, before the day fills up. */
const MORNING = { hour: 10, minute: 0 };

/** Shift a wall-clock date by whole days, letting Date normalise months. */
function addDays(wall: WallClock, days: number): WallClock {
  const shifted = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: wall.hour,
    minute: wall.minute,
  };
}

/**
 * The presets worth offering right now, in the order they should appear.
 *
 * `now` and `timeZone` are injected so this stays pure and testable —
 * callers pass `new Date()` and `browserTimeZone()`.
 */
export function reminderPresets(now: Date, timeZone: string): ReminderPreset[] {
  const today = instantToWallClock(now, timeZone);
  const presets: ReminderPreset[] = [];

  // Only while there is still an evening left to call in.
  const evening = wallClockToInstant({ ...today, ...EVENING }, timeZone);
  if (evening.getTime() > now.getTime()) {
    presets.push({ id: 'this_evening', at: evening });
  }

  presets.push({
    id: 'tomorrow_morning',
    at: wallClockToInstant({ ...addDays(today, 1), ...MORNING }, timeZone),
  });
  presets.push({
    id: 'in_three_days',
    at: wallClockToInstant({ ...addDays(today, 3), ...MORNING }, timeZone),
  });
  presets.push({
    id: 'next_week',
    at: wallClockToInstant({ ...addDays(today, 7), ...MORNING }, timeZone),
  });

  return presets;
}

/**
 * The instant for a date and time typed into the exact-time fields.
 *
 * `date` is an `<input type="date">` value (`YYYY-MM-DD`) and `time` an
 * `<input type="time">` value (`HH:mm`), both wall-clock in `timeZone`.
 * Returns null when either is missing or malformed, so the caller can
 * keep the Add button disabled rather than send a bad instant.
 */
export function exactReminderInstant(
  date: string,
  time: string,
  timeZone: string
): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) return null;

  const wall: WallClock = {
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
  };
  if (wall.month < 1 || wall.month > 12 || wall.day < 1 || wall.day > 31) {
    return null;
  }
  if (wall.hour > 23 || wall.minute > 59) return null;

  const instant = wallClockToInstant(wall, timeZone);
  return Number.isNaN(instant.getTime()) ? null : instant;
}
