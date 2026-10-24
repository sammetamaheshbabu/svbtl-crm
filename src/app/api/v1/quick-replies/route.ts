// ============================================================
// GET /api/v1/quick-replies — the account's saved quick replies
// (scope: messages:read), so the mobile app offers the same replies
// as the web inbox.
//
// Text replies may contain {name} / {first_name}. They come back as
// written, unless `?contact_id=<uuid>` names the customer, in which
// case `content_text` is already filled for them.
//
// Response: { data: [{ id, title, kind, content_text,
//                      interactive_payload, updated_at }], next_cursor }
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { fillPlaceholders } from '@/lib/quick-replies/placeholders';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface QuickReplyRow {
  id: string;
  title: string;
  kind: 'text' | 'interactive';
  content_text: string | null;
  interactive_payload: unknown;
  updated_at: string;
}

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'messages:read');

    const contactId = new URL(request.url).searchParams.get('contact_id');
    let contact: { name: string | null } | null = null;
    if (contactId) {
      if (!UUID_RE.test(contactId)) {
        return fail('bad_request', "'contact_id' must be a UUID", 400);
      }
      const { data } = await ctx.supabase
        .from('contacts')
        .select('name')
        .eq('id', contactId)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      if (!data) return fail('not_found', 'Contact not found', 404);
      contact = data;
    }

    const { data, error } = await ctx.supabase
      .from('quick_replies')
      .select('id, title, kind, content_text, interactive_payload, updated_at')
      .eq('account_id', ctx.accountId)
      .order('title', { ascending: true });
    if (error) {
      console.error('[api/v1/quick-replies] list error:', error);
      return fail('internal', 'Failed to list quick replies', 500);
    }

    const rows = (data ?? []) as QuickReplyRow[];
    return okList(
      rows.map((r) => ({
        id: r.id,
        title: r.title,
        kind: r.kind,
        content_text:
          contact && r.content_text ? fillPlaceholders(r.content_text, contact) : r.content_text,
        interactive_payload: r.interactive_payload ?? null,
        updated_at: r.updated_at,
      })),
      null
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
