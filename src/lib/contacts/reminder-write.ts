import type { SupabaseClient } from '@supabase/supabase-js';
import { getT } from '@/lib/i18n/translate';
import { isUuid } from '@/lib/api/v1/pagination';
import { isValidTimeZone } from '@/lib/time/zoned';
import type { ContactReminder, ReminderStatus } from '@/types';

const t = getT('LibErrors');

/** Longest a reason may be — it has to fit a notification body. */
export const REASON_MAX_CHARS = 280;

export class ReminderWriteError extends Error {
  readonly status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'ReminderWriteError';
    this.status = status;
  }
}

export interface CreateReminderInput {
  accountId: string;
  agentId: string;
  contactId: string;
  conversationId?: string | null;
  reason: string;
  /** ISO instant the callback is due. */
  remindAt: string;
  /** IANA zone the agent chose the time in. */
  remindAtTz: string;
  /**
   * Pre-translated notification title. Composed by the route from
   * `messages/*.json`, because the pg_cron job that fires the
   * notification has no request context to translate in.
   */
  notificationTitle: string;
  /** Injected so tests can pin "now" when checking the future rule. */
  now?: Date;
}

/**
 * A reminder in the past would be notified on the very next cron tick,
 * which is not a reminder — it is a surprise. Reject it at the door.
 */
function assertFutureInstant(remindAt: string, now: Date): Date {
  const at = new Date(remindAt);
  if (Number.isNaN(at.getTime())) {
    throw new ReminderWriteError(t('reminders.invalidRemindAt'), 400);
  }
  if (at.getTime() <= now.getTime()) {
    throw new ReminderWriteError(t('reminders.remindAtInPast'), 400);
  }
  return at;
}

async function assertContactInAccount(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<void> {
  if (!isUuid(contactId)) {
    throw new ReminderWriteError(t('reminders.invalidContactId'), 400);
  }
  const { data, error } = await db
    .from('contacts')
    .select('id')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle();

  if (error) throw new ReminderWriteError(t('reminders.verifyFailed'));
  if (!data) throw new ReminderWriteError(t('reminders.contactNotFound'), 404);
}

export async function createReminder(
  db: SupabaseClient,
  input: CreateReminderInput
): Promise<ContactReminder> {
  const now = input.now ?? new Date();
  const reason = input.reason.trim();

  if (!reason) {
    throw new ReminderWriteError(t('reminders.reasonRequired'), 400);
  }
  if (reason.length > REASON_MAX_CHARS) {
    throw new ReminderWriteError(
      t('reminders.reasonTooLong', { max: REASON_MAX_CHARS }),
      400
    );
  }
  if (!isValidTimeZone(input.remindAtTz)) {
    throw new ReminderWriteError(t('reminders.invalidTimeZone'), 400);
  }
  const at = assertFutureInstant(input.remindAt, now);
  await assertContactInAccount(db, input.accountId, input.contactId);

  const { data, error } = await db
    .from('contact_reminders')
    .insert({
      account_id: input.accountId,
      agent_id: input.agentId,
      contact_id: input.contactId,
      conversation_id: input.conversationId ?? null,
      reason,
      remind_at: at.toISOString(),
      remind_at_tz: input.remindAtTz,
      notification_title: input.notificationTitle,
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new ReminderWriteError(
      t('reminders.createFailed', { message: error?.message ?? '' })
    );
  }
  return data as ContactReminder;
}

export interface UpdateReminderInput {
  accountId: string;
  reminderId: string;
  /** 'done' or 'cancelled'; rescheduling sends `remindAt` instead. */
  status?: Extract<ReminderStatus, 'done' | 'cancelled'>;
  /** New due instant. Moving a reminder puts it back to 'pending'. */
  remindAt?: string;
  remindAtTz?: string;
  reason?: string;
  now?: Date;
}

/**
 * Mark done or cancelled, reschedule, or edit the reason.
 *
 * Rescheduling resets `status` to 'pending' and clears `notified_at`, so a
 * reminder that already fired can be pushed out again and will fire again
 * — the common case when a customer asks for one more day. RLS decides
 * whether this caller may touch the row at all.
 */
export async function updateReminder(
  db: SupabaseClient,
  input: UpdateReminderInput
): Promise<ContactReminder> {
  if (!isUuid(input.reminderId)) {
    throw new ReminderWriteError(t('reminders.invalidReminderId'), 400);
  }

  const now = input.now ?? new Date();
  const patch: Record<string, unknown> = { updated_at: now.toISOString() };

  if (input.remindAt !== undefined) {
    const at = assertFutureInstant(input.remindAt, now);
    patch.remind_at = at.toISOString();
    patch.status = 'pending';
    patch.notified_at = null;
    patch.completed_at = null;
    if (input.remindAtTz !== undefined) {
      if (!isValidTimeZone(input.remindAtTz)) {
        throw new ReminderWriteError(t('reminders.invalidTimeZone'), 400);
      }
      patch.remind_at_tz = input.remindAtTz;
    }
  }

  if (input.status !== undefined) {
    patch.status = input.status;
    patch.completed_at = input.status === 'done' ? now.toISOString() : null;
  }

  if (input.reason !== undefined) {
    const reason = input.reason.trim();
    if (!reason) {
      throw new ReminderWriteError(t('reminders.reasonRequired'), 400);
    }
    if (reason.length > REASON_MAX_CHARS) {
      throw new ReminderWriteError(
        t('reminders.reasonTooLong', { max: REASON_MAX_CHARS }),
        400
      );
    }
    patch.reason = reason;
  }

  // Only `updated_at` would change — the caller sent nothing to do.
  if (Object.keys(patch).length === 1) {
    throw new ReminderWriteError(t('reminders.nothingToUpdate'), 400);
  }

  const { data, error } = await db
    .from('contact_reminders')
    .update(patch)
    .eq('id', input.reminderId)
    .eq('account_id', input.accountId)
    .select('*')
    .maybeSingle();

  if (error) {
    throw new ReminderWriteError(
      t('reminders.updateFailed', { message: error.message })
    );
  }
  // No row came back: either it is gone, or RLS hid it from this caller.
  // Both are "you cannot change that" from here.
  if (!data) {
    throw new ReminderWriteError(t('reminders.reminderNotFound'), 404);
  }
  return data as ContactReminder;
}

export async function deleteReminder(
  db: SupabaseClient,
  input: { accountId: string; reminderId: string }
): Promise<void> {
  if (!isUuid(input.reminderId)) {
    throw new ReminderWriteError(t('reminders.invalidReminderId'), 400);
  }
  const { error } = await db
    .from('contact_reminders')
    .delete()
    .eq('id', input.reminderId)
    .eq('account_id', input.accountId);

  if (error) {
    throw new ReminderWriteError(
      t('reminders.deleteFailed', { message: error.message })
    );
  }
}
