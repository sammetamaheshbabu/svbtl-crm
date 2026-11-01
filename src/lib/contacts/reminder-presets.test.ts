import { describe, expect, it } from 'vitest';

import {
  exactReminderInstant,
  reminderPresets,
} from '@/lib/contacts/reminder-presets';
import { instantToWallClock } from '@/lib/time/zoned';

const IST = 'Asia/Kolkata';

/** What the clock reads in IST at an instant, as "HH:mm on YYYY-MM-DD". */
function istClock(at: Date): string {
  const w = instantToWallClock(at, IST);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(w.hour)}:${pad(w.minute)} on ${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

/** 09:00 IST on 1 Nov 2026 — a working morning, before the evening slot. */
const MORNING_IST = new Date('2026-11-01T03:30:00.000Z');
/** 20:00 IST the same day — after 17:30 has gone by. */
const NIGHT_IST = new Date('2026-11-01T14:30:00.000Z');

describe('reminderPresets', () => {
  it('offers this evening at 5:30 pm on the agent’s clock', () => {
    const presets = reminderPresets(MORNING_IST, IST);
    const evening = presets.find((p) => p.id === 'this_evening');
    expect(evening).toBeDefined();
    expect(istClock(evening!.at)).toBe('17:30 on 2026-11-01');
  });

  it('drops this evening once 5:30 pm has passed', () => {
    const ids = reminderPresets(NIGHT_IST, IST).map((p) => p.id);
    expect(ids).not.toContain('this_evening');
    // The rest still stand — tomorrow has not moved.
    expect(ids).toEqual([
      'tomorrow_morning',
      'in_three_days',
      'next_week',
    ]);
  });

  it('reads tomorrow and three days from the agent’s calendar, not UTC', () => {
    // 01:00 IST on the 2nd is still 19:30 UTC on the 1st: a naive
    // implementation would call "tomorrow" the 2nd instead of the 3rd.
    const justAfterMidnightIst = new Date('2026-11-01T19:30:00.000Z');
    const presets = reminderPresets(justAfterMidnightIst, IST);
    const byId = Object.fromEntries(presets.map((p) => [p.id, p.at]));

    expect(istClock(byId.tomorrow_morning)).toBe('10:00 on 2026-11-03');
    expect(istClock(byId.in_three_days)).toBe('10:00 on 2026-11-05');
    expect(istClock(byId.next_week)).toBe('10:00 on 2026-11-09');
  });

  it('rolls over a month end', () => {
    // 28 Nov + 3 days lands in December.
    const lateNovember = new Date('2026-11-28T06:00:00.000Z');
    const presets = reminderPresets(lateNovember, IST);
    const inThree = presets.find((p) => p.id === 'in_three_days')!;
    expect(istClock(inThree.at)).toBe('10:00 on 2026-12-01');
  });

  it('always returns instants in the future', () => {
    for (const now of [MORNING_IST, NIGHT_IST]) {
      for (const preset of reminderPresets(now, IST)) {
        expect(preset.at.getTime()).toBeGreaterThan(now.getTime());
      }
    }
  });

  it('honours a zone other than the one the test runs in', () => {
    // 09:00 in New York (EST, UTC-5) on 5 Nov — which is already 19:30
    // IST, so the two zones disagree about both the hour and whether
    // this evening is still ahead.
    const nyMorning = new Date('2026-11-05T14:00:00.000Z');
    const evening = reminderPresets(nyMorning, 'America/New_York').find(
      (p) => p.id === 'this_evening'
    )!;

    const ny = instantToWallClock(evening.at, 'America/New_York');
    expect(`${ny.hour}:${ny.minute} on ${ny.day}`).toBe('17:30 on 5');
    // The same instant is the small hours of the next day in India.
    expect(istClock(evening.at)).toBe('04:00 on 2026-11-06');

    // And from India at that same moment, this evening is long gone.
    expect(
      reminderPresets(nyMorning, IST).map((p) => p.id)
    ).not.toContain('this_evening');
  });
});

describe('exactReminderInstant', () => {
  it('reads a date and time as wall-clock in the given zone', () => {
    const at = exactReminderInstant('2026-11-05', '17:30', IST)!;
    expect(at.toISOString()).toBe('2026-11-05T12:00:00.000Z');
    expect(istClock(at)).toBe('17:30 on 2026-11-05');
  });

  it('rejects a missing or malformed date or time', () => {
    expect(exactReminderInstant('', '17:30', IST)).toBeNull();
    expect(exactReminderInstant('2026-11-05', '', IST)).toBeNull();
    expect(exactReminderInstant('05/11/2026', '17:30', IST)).toBeNull();
    expect(exactReminderInstant('2026-11-05', '5:30pm', IST)).toBeNull();
  });

  it('rejects out-of-range values the regex alone would let through', () => {
    expect(exactReminderInstant('2026-13-05', '10:00', IST)).toBeNull();
    expect(exactReminderInstant('2026-11-05', '25:00', IST)).toBeNull();
    expect(exactReminderInstant('2026-11-05', '10:61', IST)).toBeNull();
  });
});
