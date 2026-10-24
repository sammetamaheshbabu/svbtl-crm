import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { getT } from '@/lib/i18n/translate'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { requestHandover } from '@/lib/conversations/handover-request'

const t = getT('Api')

type Params = { params: Promise<{ conversationId: string }> }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/conversations/[conversationId]/handover-request  (agent+)
 *
 * SVBTL fork: "Ask … to hand it over" from the New chat dialog. Notifies
 * the teammate handling the chat and the owners/admins. Service role: the
 * requester can't see the chat. One request per chat per hour.
 */
export async function POST(_request: Request, { params }: Params) {
  try {
    const { accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`handover-request:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const { conversationId } = await params
    if (!UUID_RE.test(conversationId)) {
      return NextResponse.json({ error: t('common.conversationNotFound') }, { status: 404 })
    }

    const result = await requestHandover(supabaseAdmin(), {
      accountId,
      conversationId,
      requesterId: userId,
      title: t('handover.title'),
      body: ({ requester, contact }) => t('handover.body', { requester, contact }),
    })
    if (result.status === 'not_found') {
      return NextResponse.json({ error: t('common.conversationNotFound') }, { status: 404 })
    }
    return NextResponse.json(result)
  } catch (error) {
    return toErrorResponse(error)
  }
}
