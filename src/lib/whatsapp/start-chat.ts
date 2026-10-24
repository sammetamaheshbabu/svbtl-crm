// ============================================================
// Start a chat by phone number (inbox → New chat).
//
// The team types a number and sends an approved template — the only
// kind of message Meta allows to someone who hasn't written to us in
// the last 24 hours. This resolves the number to a contact and its
// single conversation (creating both if needed), after checking:
//   - the number is international (leading + and country code),
//   - the customer's opt-in was confirmed, now or on an earlier chat,
//   - an agent isn't starting a chat another team member is handling.
//
// It runs on the service-role client so it also finds chats the
// caller can't see (an agent only sees their own and unassigned ones),
// and refuses before anything is created or sent.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { findExistingContact } from '@/lib/contacts/dedupe';
import { parseInternationalPhone } from '@/lib/whatsapp/phone-utils';
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation';
import { SendMessageError, isAgentSender } from '@/lib/whatsapp/send-message';
import type { AccountRole } from '@/lib/auth/roles';

export interface StartChatInput {
  /** The number as typed, with its leading + and country code. */
  phone: string;
  /** Name for a new contact. An existing contact's name is kept. */
  name?: string | null;
  /** The sender ticked "this customer agreed to receive messages". */
  optInConfirmed: boolean;
  senderId: string;
  senderRole: AccountRole;
}

export interface StartChatTarget {
  conversationId: string;
  contactId: string;
  /** True when this send should record the opt-in on the contact. */
  recordOptIn: boolean;
}

export async function resolveStartChat(
  db: SupabaseClient,
  accountId: string,
  input: StartChatInput
): Promise<StartChatTarget> {
  const phone = parseInternationalPhone(input.phone);
  if (!phone) {
    throw new SendMessageError(
      'bad_request',
      'Enter the number with its country code, e.g. +919876543210',
      400
    );
  }

  const existing = await findExistingContact(db, accountId, phone);
  const alreadyOptedIn = Boolean(existing?.whatsapp_opt_in_at);
  if (!input.optInConfirmed && !alreadyOptedIn) {
    throw new SendMessageError(
      'opt_in_required',
      'Confirm the customer agreed to receive WhatsApp messages from us',
      400
    );
  }

  if (existing && isAgentSender(input.senderId, input.senderRole)) {
    const { data: conv } = await db
      .from('conversations')
      .select('assigned_agent_id')
      .eq('account_id', accountId)
      .eq('contact_id', existing.id)
      .order('created_at', { ascending: true })
      .limit(1);
    const assignedTo: string | null = conv?.[0]?.assigned_agent_id ?? null;
    if (assignedTo && assignedTo !== input.senderId) {
      const { data: profile } = await db
        .from('profiles')
        .select('full_name')
        .eq('user_id', assignedTo)
        .eq('account_id', accountId)
        .maybeSingle();
      const who = profile?.full_name?.trim();
      throw new SendMessageError(
        'forbidden',
        who
          ? `${who} is already handling this customer's chat`
          : 'This chat is assigned to someone else',
        403
      );
    }
  }

  const resolved = await resolveConversationByPhone(
    db,
    accountId,
    `+${phone}`,
    existing ? null : input.name?.trim() || null
  );

  return {
    conversationId: resolved.conversationId,
    contactId: resolved.contactId,
    recordOptIn: input.optInConfirmed && !alreadyOptedIn,
  };
}

/**
 * Note on the contact who confirmed the opt-in, and when. The first
 * confirmation stands; a later one doesn't overwrite it.
 */
export async function recordOptIn(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  userId: string | null
): Promise<void> {
  const { error } = await db
    .from('contacts')
    .update({
      whatsapp_opt_in_at: new Date().toISOString(),
      whatsapp_opt_in_by: userId,
    })
    .eq('id', contactId)
    .eq('account_id', accountId)
    .is('whatsapp_opt_in_at', null);
  if (error) {
    // The message is already sent; a missing note must not fail it.
    console.error('[start-chat] opt-in record error:', error.message);
  }
}
