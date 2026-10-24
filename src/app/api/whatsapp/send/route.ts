import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'
import {
  sendMessageToConversation,
  validateSendMessageParams,
  SendMessageError,
} from '@/lib/whatsapp/send-message'
import { getT } from '@/lib/i18n/translate'
import { isUniqueViolation } from '@/lib/contacts/dedupe'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { resolveStartChat, recordOptIn } from '@/lib/whatsapp/start-chat'

const t = getT('Api')

// The dashboard's outbound-send endpoint. It owns auth, per-user rate
// limiting, and the three ways the UI targets a thread — an existing
// `conversation_id` (inbox), a `contact_id` (Contact detail →
// find-or-create the conversation), or a typed `phone` (inbox → New
// chat, template only). The actual Meta plumbing (validate
// → send → persist → pause flows) lives in the shared
// `sendMessageToConversation` core, which the public `/api/v1/messages`
// endpoint reuses. This route is a thin adapter: resolve the
// conversation, delegate, then map `SendMessageError` back onto the
// dashboard's internal `{ error }` shape.
export async function POST(request: Request) {
  try {
    // Requires the 'agent' role, matching both `canSendMessages` and the
    // `messages_modify` RLS policy (migration 017).
    //
    // Resolving `account_id` off the profile — which any 'viewer' has —
    // was previously the only gate. RLS did block the message INSERT, but
    // the send core calls Meta BEFORE it persists, so a viewer's request
    // still delivered a real WhatsApp message to the customer and merely
    // failed to record it (surfacing as "sent to Meta but failed to save
    // to DB"). RLS can't un-send that, so the role check belongs here.
    const { supabase, accountId, userId, role } = await requireRole('agent')

    // Per-user rate limit. Bucket key is scoped to this route so
    // `/broadcast` has an independent budget.
    const limit = checkRateLimit(`send:${userId}`, RATE_LIMITS.send)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    const body = await request.json()
    const {
      // `conversation_id` targets an existing thread (inbox). `contact_id`
      // lets a caller initiate from a contact that may have no conversation
      // yet (Contact detail → Send template) — we find-or-create one below.
      conversation_id: conversationIdInput,
      contact_id,
      // `phone` starts a chat with someone who may not be a contact yet
      // (inbox → New chat). `name` names a new contact; `opt_in_confirmed`
      // is the sender confirming the customer agreed to hear from us.
      phone,
      name,
      opt_in_confirmed,
      message_type,
      content_text,
      media_url,
      filename,
      template_name,
      template_language,
      template_params,
      template_message_params,
      interactive_payload,
      reply_to_message_id,
    } = body

    if ((!conversationIdInput && !contact_id && !phone) || !message_type) {
      return NextResponse.json(
        {
          error:
            t('send.idsRequired'),
        },
        { status: 400 }
      )
    }

    // Validate the message shape up front — before the contact_id path
    // finds-or-creates a conversation — so an invalid payload 400s
    // without leaving an orphan empty conversation behind.
    try {
      validateSendMessageParams({
        messageType: message_type,
        contentText: content_text,
        mediaUrl: media_url,
        templateName: template_name,
        interactivePayload: interactive_payload,
      })
    } catch (err) {
      if (err instanceof SendMessageError) {
        return NextResponse.json({ error: err.message }, { status: err.status })
      }
      throw err
    }

    // Meta only lets a business message someone first with an approved
    // template; free text waits until the customer replies.
    if (phone && !conversationIdInput && !contact_id && message_type !== 'template') {
      return NextResponse.json(
        { error: t('send.newChatTemplateOnly') },
        { status: 400 }
      )
    }

    // Resolve the target conversation. With `conversation_id` we load the
    // existing thread; with `contact_id` we find-or-create one for the
    // contact so a business-initiated template send (Contact detail view)
    // reuses the shared send core below.
    let conversationId: string | null = null
    // On the `phone` path, the contact whose opt-in this send records.
    let optInContactId: string | null = null

    if (conversationIdInput) {
      const { data, error: convError } = await supabase
        .from('conversations')
        .select('id')
        .eq('id', conversationIdInput)
        .eq('account_id', accountId)
        .single()

      if (convError || !data) {
        return NextResponse.json(
          { error: t('common.conversationNotFound') },
          { status: 404 }
        )
      }
      conversationId = data.id
    } else if (contact_id) {
      // contact_id path: verify the contact is in this account first so a
      // caller can't open a conversation against someone else's contact.
      const { data: contactRow, error: contactErr } = await supabase
        .from('contacts')
        .select('id')
        .eq('id', contact_id)
        .eq('account_id', accountId)
        .maybeSingle()

      if (contactErr || !contactRow) {
        return NextResponse.json(
          { error: t('send.contactNotFound') },
          { status: 404 }
        )
      }

      const resolved = await findOrCreateConversation(
        supabase,
        accountId,
        userId,
        contact_id
      )
      if (resolved === 'hidden') {
        // The contact's chat exists but RLS hides it: an agent's view
        // stops at their own and unassigned chats (migration 900).
        return NextResponse.json(
          { error: t('send.assignedElsewhere') },
          { status: 403 }
        )
      }
      if (!resolved) {
        return NextResponse.json(
          { error: t('send.openConversationFailed') },
          { status: 500 }
        )
      }
      conversationId = resolved
    } else {
      // phone path: find-or-create the contact and chat on the service
      // role, so a chat this agent can't see is refused rather than
      // duplicated.
      try {
        const target = await resolveStartChat(supabaseAdmin(), accountId, {
          phone: String(phone),
          name: typeof name === 'string' ? name : null,
          optInConfirmed: opt_in_confirmed === true,
          senderId: userId,
          senderRole: role,
        })
        conversationId = target.conversationId
        if (target.recordOptIn) optInContactId = target.contactId
      } catch (err) {
        if (err instanceof SendMessageError) {
          return NextResponse.json({ error: err.message }, { status: err.status })
        }
        throw err
      }
    }

    if (!conversationId) {
      return NextResponse.json(
        { error: t('common.conversationNotFound') },
        { status: 404 }
      )
    }

    // Delegate to the shared send core (validates, sends to Meta with
    // phone-variant retry, persists, pauses active flow runs). Its
    // `SendMessageError` carries a machine code + HTTP status; the
    // dashboard maps it to the internal `{ error }` shape.
    try {
      const result = await sendMessageToConversation(supabase, accountId, {
        conversationId,
        messageType: message_type,
        contentText: content_text,
        mediaUrl: media_url,
        filename,
        templateName: template_name,
        templateLanguage: template_language,
        templateParams: template_params,
        templateMessageParams: template_message_params,
        interactivePayload: interactive_payload,
        replyToMessageId: reply_to_message_id,
        // Who replied, so the inbox can show the sender's name; an agent's
        // reply also claims an unassigned chat
        senderId: userId,
        senderRole: role,
      })

      if (optInContactId) {
        await recordOptIn(supabaseAdmin(), accountId, optInContactId, userId)
      }

      return NextResponse.json({
        success: true,
        message_id: result.messageId,
        whatsapp_message_id: result.whatsappMessageId,
        claimed: result.claimed,
        // New chat opens the thread it just started.
        conversation_id: conversationId,
      })
    } catch (err) {
      if (err instanceof SendMessageError) {
        return NextResponse.json(
          { error: err.message },
          { status: err.status }
        )
      }
      throw err
    }
  } catch (error) {
    // requireRole throws Unauthorized/Forbidden; toErrorResponse maps
    // those to 401/403 and collapses anything else to a generic 500.
    console.error('Error in WhatsApp send POST:', error)
    return toErrorResponse(error)
  }
}

type SendSupabase = Awaited<ReturnType<typeof createClient>>

/**
 * Return the contact's conversation id in this account, creating one if
 * it doesn't exist yet. Mirrors the webhook's find-or-create so an
 * inbound-then-outbound (or outbound-first) sequence converges on a single
 * thread per contact. Runs under the caller's RLS — the conversations_insert
 * policy requires account agent membership, which the caller already is.
 * Returns 'hidden' when the insert collides with a chat the caller's RLS
 * hides (an agent and someone else's chat).
 */
async function findOrCreateConversation(
  supabase: SendSupabase,
  accountId: string,
  userId: string,
  contactId: string,
): Promise<string | 'hidden' | null> {
  const { data: existing } = await supabase
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .maybeSingle()

  if (existing) return existing.id

  const { data: created, error } = await supabase
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: userId,
      contact_id: contactId,
    })
    .select('id')
    .single()

  if (error) {
    if (isUniqueViolation(error)) return 'hidden'
    console.error('Error creating conversation for contact send:', error.message)
    return null
  }

  return created.id
}
