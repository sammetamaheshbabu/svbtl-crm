import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { getT } from '@/lib/i18n/translate'
import { assignConversation } from '@/lib/conversations/assign'

const t = getT('Api')

type Params = { params: Promise<{ conversationId: string }> }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/conversations/[conversationId]/assign  (agent+)
 *
 * Hands a chat to a team member, or unassigns it — the inbox's assignee
 * picker. Body: { agent_id: string | null }.
 *
 * Any agent may hand over a chat they can see; the handoff is recorded
 * with who made it (migration 048) and announced to integrations as
 * `conversation.assigned`, so the new owner is alerted on their phone.
 * Runs on the RLS-scoped client: a chat the caller cannot see is a 404.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`assign:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const { conversationId } = await params
    const body = await request.json().catch(() => null)
    const agentId = body?.agent_id
    if (!body || (agentId !== null && (typeof agentId !== 'string' || !UUID_RE.test(agentId)))) {
      return NextResponse.json({ error: t('common.invalidRequestBody') }, { status: 400 })
    }

    if (agentId) {
      const { data: member } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('user_id', agentId)
        .eq('account_id', accountId)
        .maybeSingle()
      if (!member) {
        return NextResponse.json({ error: t('common.assigneeNotMember') }, { status: 400 })
      }
    }

    const { data: conv } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!conv) {
      return NextResponse.json({ error: t('common.conversationNotFound') }, { status: 404 })
    }

    const result = await assignConversation(supabase, accountId, {
      conversationId,
      agentId,
      actorUserId: userId,
    })
    return NextResponse.json({ success: true, changed: result.changed })
  } catch (error) {
    return toErrorResponse(error)
  }
}
