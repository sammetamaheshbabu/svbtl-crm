// ============================================================
// Assigning a chat to a team member (or unassigning it).
//
// Every write goes through the `assign_conversation` database function
// (migration 048), which records the handoff in
// `conversation_assignments` with who made it. When the assignee
// changes, a `conversation.assigned` webhook is sent so integrations —
// the SVB mobile app among them — can tell the new owner.
//
// Pass the caller's client: the RLS-scoped one for a signed-in user,
// or the service client for the public API (then name the actor).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';

export interface AssignInput {
  conversationId: string;
  /** The new assignee's user id, or null to unassign. */
  agentId: string | null;
  /** Who is making the change; null for changes nobody made (automations). */
  actorUserId: string | null;
  /** Leave a chat someone already took alone (claim on reply). */
  onlyIfUnassigned?: boolean;
}

export interface AssignResult {
  /** False when the chat was not found, or already had this assignee, or was taken. */
  changed: boolean;
  fromAgentId: string | null;
}

export async function assignConversation(
  db: SupabaseClient,
  accountId: string,
  input: AssignInput
): Promise<AssignResult> {
  const { data, error } = await db.rpc('assign_conversation', {
    p_account_id: accountId,
    p_conversation_id: input.conversationId,
    p_agent_id: input.agentId,
    p_actor_id: input.actorUserId,
    p_only_if_unassigned: input.onlyIfUnassigned ?? false,
  });
  if (error) throw new Error(`assign_conversation failed: ${error.message}`);

  const row = (data ?? {}) as {
    changed?: boolean;
    from_agent_id?: string | null;
    contact_id?: string | null;
  };
  const result = { changed: row.changed === true, fromAgentId: row.from_agent_id ?? null };
  if (result.changed) {
    await announceAssignment(accountId, input, result.fromAgentId, row.contact_id ?? null);
  }
  return result;
}

/** Sends `conversation.assigned`, with the names a notification needs. Best-effort. */
async function announceAssignment(
  accountId: string,
  input: AssignInput,
  fromAgentId: string | null,
  contactId: string | null
): Promise<void> {
  try {
    const admin = supabaseAdmin();
    const [actor, contact] = await Promise.all([
      input.actorUserId
        ? admin
            .from('profiles')
            .select('full_name')
            .eq('user_id', input.actorUserId)
            .eq('account_id', accountId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      contactId
        ? admin.from('contacts').select('name, phone').eq('id', contactId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const contactRow = contact.data as { name: string | null; phone: string | null } | null;
    await dispatchWebhookEvent(admin, accountId, 'conversation.assigned', {
      conversation_id: input.conversationId,
      contact_id: contactId,
      from_agent_id: fromAgentId,
      to_agent_id: input.agentId,
      actor_user_id: input.actorUserId,
      actor_name: (actor.data as { full_name: string | null } | null)?.full_name ?? null,
      contact_name: contactRow?.name || contactRow?.phone || null,
    });
  } catch (err) {
    console.error(
      '[assign] conversation.assigned webhook failed:',
      err instanceof Error ? err.message : err
    );
  }
}
