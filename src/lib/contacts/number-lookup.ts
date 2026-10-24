// ============================================================
// Who is this number? — for the inbox's New chat dialog.
//
// Agents can't see other agents' customers (migrations 900 and 904), so
// a lookup under their own session would call another agent's customer
// "new" and they'd only learn otherwise when sending. This runs on the
// service role and answers only what the dialog needs about a number the
// caller already has: is it a customer, their name, opt-in, and who
// handles the chat. It never lists customers.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { findExistingContact } from '@/lib/contacts/dedupe';
import { isAgentSender } from '@/lib/whatsapp/send-message';
import type { AccountRole } from '@/lib/auth/roles';

export interface NumberLookup {
  /** False for a number we've never had. */
  exists: boolean;
  contactName: string | null;
  optedInAt: string | null;
  conversationId: string | null;
  /** The teammate handling the chat, when it's assigned. */
  handledBy: { userId: string; name: string | null } | null;
  /** True when the caller is an agent and the chat belongs to someone else. */
  blocked: boolean;
}

const NEW_NUMBER: NumberLookup = {
  exists: false,
  contactName: null,
  optedInAt: null,
  conversationId: null,
  handledBy: null,
  blocked: false,
};

/** `phone` is digits with the country code (as parseInternationalPhone returns). */
export async function lookupNumber(
  db: SupabaseClient,
  accountId: string,
  phone: string,
  caller: { userId: string; role: AccountRole }
): Promise<NumberLookup> {
  const contact = await findExistingContact(db, accountId, phone);
  if (!contact) return NEW_NUMBER;

  const { data: conversations } = await db
    .from('conversations')
    .select('id, assigned_agent_id')
    .eq('account_id', accountId)
    .eq('contact_id', contact.id)
    .order('created_at', { ascending: true })
    .limit(1);
  const conversation = conversations?.[0] ?? null;
  const assignedTo: string | null = conversation?.assigned_agent_id ?? null;

  let handledBy: NumberLookup['handledBy'] = null;
  if (assignedTo) {
    const { data: profile } = await db
      .from('profiles')
      .select('full_name')
      .eq('user_id', assignedTo)
      .eq('account_id', accountId)
      .maybeSingle();
    handledBy = { userId: assignedTo, name: profile?.full_name?.trim() || null };
  }

  return {
    exists: true,
    contactName: typeof contact.name === 'string' && contact.name.trim() ? contact.name : null,
    optedInAt: typeof contact.whatsapp_opt_in_at === 'string' ? contact.whatsapp_opt_in_at : null,
    conversationId: conversation?.id ?? null,
    handledBy,
    blocked:
      !!assignedTo && assignedTo !== caller.userId && isAgentSender(caller.userId, caller.role),
  };
}
