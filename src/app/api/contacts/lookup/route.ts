import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { parseInternationalPhone } from '@/lib/whatsapp/phone-utils'
import { lookupNumber } from '@/lib/contacts/number-lookup'

/**
 * GET /api/contacts/lookup?phone=+919876543210  (agent+)
 *
 * SVBTL fork: the New chat dialog's "who is this number?" check. Runs on
 * the service role because agents can't see other agents' customers
 * (migration 904); answers only about the number given. See
 * `lookupNumber` for the shape.
 */
export async function GET(request: Request) {
  try {
    const { accountId, userId, role } = await requireRole('agent')

    // Debounced as the agent types; the reaction budget fits.
    const limit = checkRateLimit(`contact-lookup:${userId}`, RATE_LIMITS.react)
    if (!limit.success) return rateLimitResponse(limit)

    const phone = parseInternationalPhone(new URL(request.url).searchParams.get('phone'))
    if (!phone) {
      return NextResponse.json({ error: 'phone must include its country code' }, { status: 400 })
    }

    const result = await lookupNumber(supabaseAdmin(), accountId, phone, { userId, role })
    return NextResponse.json(result)
  } catch (error) {
    return toErrorResponse(error)
  }
}
