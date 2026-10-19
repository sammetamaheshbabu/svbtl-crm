// ============================================================
// Message senders for the public API (v1).
//
// A message we send records the team member behind it in
// `messages.sender_id` (an auth user id). The dashboard sets it to the
// signed-in user; a public-API caller may pass `sender_user_id` to say
// which team member it is sending for. That id must belong to the key's
// own account, so one account can never attribute a message to a user
// of another. Names come from `profiles.full_name`.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { SendMessageError } from '@/lib/whatsapp/send-message';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The validated sender for a public-API send, or null when none was given.
 * Throws `SendMessageError` (400) for a malformed id or one that is not a
 * member of the account.
 */
export async function resolveSenderId(
  db: SupabaseClient,
  accountId: string,
  raw: unknown
): Promise<string | null> {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' || !UUID_RE.test(raw)) {
    throw new SendMessageError('bad_request', "'sender_user_id' must be a user id", 400);
  }
  const { data } = await db
    .from('profiles')
    .select('user_id')
    .eq('user_id', raw)
    .eq('account_id', accountId)
    .maybeSingle();
  if (!data) {
    throw new SendMessageError(
      'bad_request',
      "'sender_user_id' is not a member of this account",
      400
    );
  }
  return raw;
}

/** Full names of the account's members among `userIds`, by auth user id. */
export async function senderNames(
  db: SupabaseClient,
  accountId: string,
  userIds: Array<string | null | undefined>
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => !!id))];
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  const { data } = await db
    .from('profiles')
    .select('user_id, full_name')
    .eq('account_id', accountId)
    .in('user_id', ids);
  for (const row of (data ?? []) as Array<{ user_id: string; full_name: string | null }>) {
    if (row.full_name) names.set(row.user_id, row.full_name);
  }
  return names;
}
