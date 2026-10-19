// ============================================================
// Public API (v1) serializers for conversations + messages.
//
// The dashboard's `Conversation`/`Message` rows carry internal columns
// (account_id, user_id, sender_id) that shouldn't leak onto the public
// wire. These serializers project the stable public subset and rename
// the Meta id (`message_id` → `whatsapp_message_id`) to match the send
// endpoint's response vocabulary.
// ============================================================

import type { Conversation, Message } from '@/types';

export interface ApiConversation {
  id: string;
  contact_id: string;
  status: string;
  assigned_agent_id: string | null;
  last_message_text: string | null;
  last_message_at: string | null;
  unread_count: number;
  created_at: string;
  updated_at: string;
  contact: {
    id: string;
    phone: string;
    name: string | null;
    email: string | null;
    company: string | null;
    tags: { id: string; name: string; color: string }[];
  } | null;
}

export interface ApiMessage {
  id: string;
  conversation_id: string;
  direction: 'inbound' | 'outbound';
  sender_type: string;
  content_type: string;
  content_text: string | null;
  media_url: string | null;
  template_name: string | null;
  whatsapp_message_id: string | null;
  status: string;
  reply_to_message_id: string | null;
  interactive_reply_id: string | null;
  /** The buttons or list options of an interactive message; null for every other message. */
  interactive: ApiInteractive | null;
  /**
   * Name of the team member who sent this message, or null (customer messages, bots,
   * and sends with no person recorded). The internal `sender_id` itself stays private.
   */
  sender_name: string | null;
  created_at: string;
}

/** Public shape of an interactive message's options. A list's rows are flattened into `options`. */
export interface ApiInteractive {
  kind: 'buttons' | 'list';
  body: string;
  options: { id: string; title: string }[];
}

/**
 * Project a normalized `Conversation` (from `normalizeConversation`,
 * which has already flattened `contact.tags`) into the public shape.
 */
export function serializeConversation(conv: Conversation): ApiConversation {
  const c = conv.contact;
  return {
    id: conv.id,
    contact_id: conv.contact_id,
    status: conv.status,
    assigned_agent_id: conv.assigned_agent_id ?? null,
    last_message_text: conv.last_message_text ?? null,
    last_message_at: conv.last_message_at ?? null,
    unread_count: conv.unread_count ?? 0,
    created_at: conv.created_at,
    updated_at: conv.updated_at,
    contact: c
      ? {
          id: c.id,
          phone: c.phone,
          name: c.name ?? null,
          email: c.email ?? null,
          company: c.company ?? null,
          tags: (c.tags ?? []).map((t) => ({
            id: t.id,
            name: t.name,
            color: t.color,
          })),
        }
      : null,
  };
}

/** Project a stored interactive payload (buttons or a list) into the public shape. */
function serializeInteractive(payload: Message['interactive_payload']): ApiInteractive | null {
  if (!payload) return null;
  if (payload.kind === 'buttons') {
    return {
      kind: 'buttons',
      body: payload.body,
      options: payload.buttons.map((b) => ({ id: b.id, title: b.title })),
    };
  }
  return {
    kind: 'list',
    body: payload.body,
    options: payload.sections.flatMap((s) => s.rows.map((r) => ({ id: r.id, title: r.title }))),
  };
}

/** Project a `messages` row into the public shape. */
export function serializeMessage(
  m: Message,
  /** Team members' names by auth user id, from `senderNames`. */
  names: ReadonlyMap<string, string> = new Map()
): ApiMessage {
  return {
    id: m.id,
    conversation_id: m.conversation_id,
    // `customer` = inbound (from the contact); anything else is outbound.
    direction: m.sender_type === 'customer' ? 'inbound' : 'outbound',
    sender_type: m.sender_type,
    content_type: m.content_type,
    content_text: m.content_text ?? null,
    media_url: m.media_url ?? null,
    template_name: m.template_name ?? null,
    whatsapp_message_id: m.message_id ?? null,
    status: m.status,
    reply_to_message_id: m.reply_to_message_id ?? null,
    interactive_reply_id: m.interactive_reply_id ?? null,
    interactive: serializeInteractive(m.interactive_payload),
    sender_name: m.sender_type !== 'customer' && m.sender_id ? (names.get(m.sender_id) ?? null) : null,
    created_at: m.created_at,
  };
}
