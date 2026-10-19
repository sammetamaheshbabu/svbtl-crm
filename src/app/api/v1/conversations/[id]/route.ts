// ============================================================
// GET /api/v1/conversations/{id} — read one conversation
// (scope: conversations:read). Account-scoped: a foreign id → 404.
//
// PATCH /api/v1/conversations/{id} — hand the chat to a team member
// (scope: messages:send, the same permission as replying):
//   { "assigned_agent_id": "<user id>" | null,
//     "actor_user_id": "<user id>" }   // optional, who is handing it over
// Both ids must be members of the key's account. The handoff is
// recorded (GET …/assignments) and sent as `conversation.assigned`.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  CONVERSATION_SELECT,
  normalizeConversation,
} from '@/lib/inbox/conversations';
import { serializeConversation } from '@/lib/api/v1/conversations';
import { assignConversation } from '@/lib/conversations/assign';
import type { Conversation } from '@/types';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'conversations:read');
    const { id } = await params;

    const { data, error } = await ctx.supabase
      .from('conversations')
      .select(CONVERSATION_SELECT)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error('[api/v1/conversations] read error:', error);
      return fail('internal', 'Failed to read conversation', 500);
    }
    if (!data) return fail('not_found', 'Conversation not found', 404);

    return ok(serializeConversation(normalizeConversation(data as Conversation)));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'messages:send');
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || !('assigned_agent_id' in body)) {
      return fail('bad_request', "'assigned_agent_id' is required (a user id, or null to unassign)", 400);
    }
    const agentId = body.assigned_agent_id;
    const actorId = body.actor_user_id ?? null;
    for (const [field, value] of [['assigned_agent_id', agentId], ['actor_user_id', actorId]] as const) {
      if (value === null) continue;
      if (typeof value !== 'string' || !UUID_RE.test(value)) {
        return fail('bad_request', `'${field}' must be a user id`, 400);
      }
      const { data: member } = await ctx.supabase
        .from('profiles')
        .select('user_id')
        .eq('user_id', value)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      if (!member) return fail('bad_request', `'${field}' is not a member of this account`, 400);
    }

    const { data: exists } = await ctx.supabase
      .from('conversations')
      .select('id')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!exists) return fail('not_found', 'Conversation not found', 404);

    await assignConversation(ctx.supabase, ctx.accountId, {
      conversationId: id,
      agentId: agentId as string | null,
      actorUserId: actorId as string | null,
    });

    const { data } = await ctx.supabase
      .from('conversations')
      .select(CONVERSATION_SELECT)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!data) return fail('not_found', 'Conversation not found', 404);
    return ok(serializeConversation(normalizeConversation(data as Conversation)));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
