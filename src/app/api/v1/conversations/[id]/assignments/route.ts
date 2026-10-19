// ============================================================
// GET /api/v1/conversations/{id}/assignments — the chat's handoff
// history (scope: conversations:read), oldest first: who assigned it
// to whom, and when (migration 048). Account-scoped: a foreign id → 404.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { serializeAssignment, type AssignmentRow } from '@/lib/api/v1/conversations';
import { senderNames } from '@/lib/api/v1/sender';

const MAX_ASSIGNMENTS = 200;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'conversations:read');
    const { id } = await params;

    const { data: conv } = await ctx.supabase
      .from('conversations')
      .select('id')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!conv) return fail('not_found', 'Conversation not found', 404);

    const { data, error } = await ctx.supabase
      .from('conversation_assignments')
      .select('id, from_agent_id, to_agent_id, actor_user_id, created_at')
      .eq('conversation_id', id)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: true })
      .limit(MAX_ASSIGNMENTS);
    if (error) {
      console.error('[api/v1/assignments] list error:', error);
      return fail('internal', 'Failed to list assignments', 500);
    }

    const rows = (data ?? []) as AssignmentRow[];
    const names = await senderNames(
      ctx.supabase,
      ctx.accountId,
      rows.flatMap((r) => [r.from_agent_id, r.to_agent_id, r.actor_user_id])
    );
    return okList(rows.map((r) => serializeAssignment(r, names)), null);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
