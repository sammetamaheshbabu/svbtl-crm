// ============================================================
// "Ask … to hand it over" — an agent who can't open a chat (it belongs
// to a teammate) asks for it. The teammate handling it and the account's
// owners/admins get a notification; tapping it opens the chat, where the
// assignee picker hands it over (recorded by migration 901).
//
// Runs on the service role: the requester can't see the chat. One
// request per requester and chat per hour, so nobody gets spammed.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export const HANDOVER_REQUEST_COOLDOWN_MS = 60 * 60 * 1000;

export type HandoverRequestResult =
  | { status: 'sent'; notified: number }
  | { status: 'already_requested' }
  | { status: 'not_needed' }
  | { status: 'not_found' };

export async function requestHandover(
  db: SupabaseClient,
  input: {
    accountId: string;
    conversationId: string;
    requesterId: string;
    /** Notification text, already in the account's language. */
    title: string;
    body: (names: { requester: string; contact: string }) => string;
    now?: Date;
  }
): Promise<HandoverRequestResult> {
  const now = input.now ?? new Date();

  const { data: conv } = await db
    .from('conversations')
    .select('id, assigned_agent_id, contact_id, contact:contacts(name, phone)')
    .eq('id', input.conversationId)
    .eq('account_id', input.accountId)
    .maybeSingle();
  if (!conv) return { status: 'not_found' };

  const owner: string | null = conv.assigned_agent_id ?? null;
  // Unassigned or already theirs: they can just open it.
  if (!owner || owner === input.requesterId) return { status: 'not_needed' };

  const since = new Date(now.getTime() - HANDOVER_REQUEST_COOLDOWN_MS).toISOString();
  const { data: recent } = await db
    .from('notifications')
    .select('id')
    .eq('account_id', input.accountId)
    .eq('type', 'handover_requested')
    .eq('conversation_id', input.conversationId)
    .eq('actor_user_id', input.requesterId)
    .gte('created_at', since)
    .limit(1);
  if (recent && recent.length > 0) return { status: 'already_requested' };

  const { data: members } = await db
    .from('profiles')
    .select('user_id, full_name, account_role')
    .eq('account_id', input.accountId);
  const people = (members ?? []) as { user_id: string; full_name: string | null; account_role: string }[];
  const recipients = new Set<string>([owner]);
  for (const p of people) {
    if (p.account_role === 'owner' || p.account_role === 'admin') recipients.add(p.user_id);
  }
  recipients.delete(input.requesterId);

  const requester = people.find((p) => p.user_id === input.requesterId)?.full_name?.trim() || 'A teammate';
  const contactRow = (Array.isArray(conv.contact) ? conv.contact[0] : conv.contact) as
    | { name: string | null; phone: string | null }
    | null;
  const contact = contactRow?.name?.trim() || contactRow?.phone || 'a customer';

  const rows = [...recipients].map((userId) => ({
    account_id: input.accountId,
    user_id: userId,
    type: 'handover_requested',
    conversation_id: conv.id,
    contact_id: conv.contact_id,
    actor_user_id: input.requesterId,
    title: input.title,
    body: input.body({ requester, contact }),
  }));
  if (rows.length === 0) return { status: 'not_needed' };

  const { error } = await db.from('notifications').insert(rows);
  if (error) throw new Error(error.message);
  return { status: 'sent', notified: rows.length };
}
