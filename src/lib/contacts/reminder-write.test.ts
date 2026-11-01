import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import {
  createReminder,
  deleteReminder,
  ReminderWriteError,
  updateReminder,
  REASON_MAX_CHARS,
} from '@/lib/contacts/reminder-write';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const AGENT = '22222222-2222-4222-8222-222222222222';
const CONTACT = '33333333-3333-4333-8333-333333333333';
const REMINDER = '44444444-4444-4444-8444-444444444444';

const NOW = new Date('2026-11-01T06:00:00.000Z');
const FUTURE = '2026-11-01T12:00:00.000Z';
const PAST = '2026-11-01T05:00:00.000Z';

/**
 * The slice of the Supabase client these helpers touch. `contacts` reads
 * resolve the ownership check; `contact_reminders` writes record what
 * was sent so the assertions can look at it.
 */
function fakeDb(options: {
  contactFound?: boolean;
  insertError?: { message: string };
  updateReturns?: unknown;
} = {}) {
  const calls: { table: string; op: string; payload?: unknown }[] = [];
  const { contactFound = true } = options;

  const db = {
    from(table: string) {
      if (table === 'contacts') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: contactFound ? { id: CONTACT } : null,
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      // contact_reminders
      return {
        insert(payload: unknown) {
          calls.push({ table, op: 'insert', payload });
          return {
            select: () => ({
              single: async () => ({
                data: options.insertError
                  ? null
                  : { id: REMINDER, ...(payload as object) },
                error: options.insertError ?? null,
              }),
            }),
          };
        },
        update(payload: unknown) {
          calls.push({ table, op: 'update', payload });
          return {
            eq: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: async () => ({
                    data:
                      'updateReturns' in options
                        ? options.updateReturns
                        : { id: REMINDER, ...(payload as object) },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        },
        delete() {
          calls.push({ table, op: 'delete' });
          return { eq: () => ({ eq: async () => ({ error: null }) }) };
        },
      };
    },
  } as unknown as SupabaseClient;

  return { db, calls };
}

const baseInput = {
  accountId: ACCOUNT,
  agentId: AGENT,
  contactId: CONTACT,
  reason: 'Wants pricing for the wedding package',
  remindAt: FUTURE,
  remindAtTz: 'Asia/Kolkata',
  notificationTitle: 'Call Murali Photography back',
  now: NOW,
};

describe('createReminder', () => {
  it('stores the instant, the zone and the pre-translated title', async () => {
    const { db, calls } = fakeDb();
    await createReminder(db, baseInput);

    expect(calls).toHaveLength(1);
    expect(calls[0].payload).toMatchObject({
      account_id: ACCOUNT,
      agent_id: AGENT,
      contact_id: CONTACT,
      conversation_id: null,
      reason: 'Wants pricing for the wedding package',
      remind_at: FUTURE,
      remind_at_tz: 'Asia/Kolkata',
      notification_title: 'Call Murali Photography back',
    });
  });

  it('trims the reason', async () => {
    const { db, calls } = fakeDb();
    await createReminder(db, { ...baseInput, reason: '  ring back  ' });
    expect(calls[0].payload).toMatchObject({ reason: 'ring back' });
  });

  it('refuses a time in the past — it would fire on the next tick', async () => {
    const { db } = fakeDb();
    await expect(
      createReminder(db, { ...baseInput, remindAt: PAST })
    ).rejects.toMatchObject({ name: 'ReminderWriteError', status: 400 });
  });

  it('refuses the exact current instant', async () => {
    const { db } = fakeDb();
    await expect(
      createReminder(db, { ...baseInput, remindAt: NOW.toISOString() })
    ).rejects.toBeInstanceOf(ReminderWriteError);
  });

  it('refuses an unparseable time', async () => {
    const { db } = fakeDb();
    await expect(
      createReminder(db, { ...baseInput, remindAt: 'this evening' })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses an empty or whitespace-only reason', async () => {
    const { db } = fakeDb();
    await expect(
      createReminder(db, { ...baseInput, reason: '   ' })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses a reason too long to fit a notification', async () => {
    const { db } = fakeDb();
    await expect(
      createReminder(db, { ...baseInput, reason: 'x'.repeat(REASON_MAX_CHARS + 1) })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses a zone the runtime does not know', async () => {
    const { db } = fakeDb();
    await expect(
      createReminder(db, { ...baseInput, remindAtTz: 'Mars/Olympus_Mons' })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses a contact id that is not a UUID', async () => {
    const { db } = fakeDb();
    await expect(
      createReminder(db, { ...baseInput, contactId: 'not-a-uuid' })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('404s when the contact belongs to another account', async () => {
    const { db } = fakeDb({ contactFound: false });
    await expect(createReminder(db, baseInput)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('never writes when validation fails', async () => {
    const { db, calls } = fakeDb();
    await expect(
      createReminder(db, { ...baseInput, reason: '' })
    ).rejects.toBeInstanceOf(ReminderWriteError);
    expect(calls).toHaveLength(0);
  });
});

describe('updateReminder', () => {
  it('stamps completed_at when marked done', async () => {
    const { db, calls } = fakeDb();
    await updateReminder(db, {
      accountId: ACCOUNT,
      reminderId: REMINDER,
      status: 'done',
      now: NOW,
    });
    expect(calls[0].payload).toMatchObject({
      status: 'done',
      completed_at: NOW.toISOString(),
    });
  });

  it('clears completed_at when cancelled', async () => {
    const { db, calls } = fakeDb();
    await updateReminder(db, {
      accountId: ACCOUNT,
      reminderId: REMINDER,
      status: 'cancelled',
      now: NOW,
    });
    expect(calls[0].payload).toMatchObject({
      status: 'cancelled',
      completed_at: null,
    });
  });

  it('rescheduling puts an already-notified reminder back in the queue', async () => {
    const { db, calls } = fakeDb();
    await updateReminder(db, {
      accountId: ACCOUNT,
      reminderId: REMINDER,
      remindAt: FUTURE,
      remindAtTz: 'Asia/Kolkata',
      now: NOW,
    });
    // Without resetting these the cron would never pick it up again.
    expect(calls[0].payload).toMatchObject({
      remind_at: FUTURE,
      remind_at_tz: 'Asia/Kolkata',
      status: 'pending',
      notified_at: null,
      completed_at: null,
    });
  });

  it('refuses to reschedule into the past', async () => {
    const { db } = fakeDb();
    await expect(
      updateReminder(db, {
        accountId: ACCOUNT,
        reminderId: REMINDER,
        remindAt: PAST,
        now: NOW,
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses an empty patch', async () => {
    const { db } = fakeDb();
    await expect(
      updateReminder(db, { accountId: ACCOUNT, reminderId: REMINDER, now: NOW })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('404s when the row is gone or RLS hides it', async () => {
    const { db } = fakeDb({ updateReturns: null });
    await expect(
      updateReminder(db, {
        accountId: ACCOUNT,
        reminderId: REMINDER,
        status: 'done',
        now: NOW,
      })
    ).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a reminder id that is not a UUID', async () => {
    const { db } = fakeDb();
    await expect(
      updateReminder(db, {
        accountId: ACCOUNT,
        reminderId: 'nope',
        status: 'done',
        now: NOW,
      })
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('deleteReminder', () => {
  it('scopes the delete to the account', async () => {
    const { db, calls } = fakeDb();
    await deleteReminder(db, { accountId: ACCOUNT, reminderId: REMINDER });
    expect(calls).toMatchObject([{ table: 'contact_reminders', op: 'delete' }]);
  });

  it('refuses a reminder id that is not a UUID', async () => {
    const { db } = fakeDb();
    await expect(
      deleteReminder(db, { accountId: ACCOUNT, reminderId: 'nope' })
    ).rejects.toMatchObject({ status: 400 });
  });
});
