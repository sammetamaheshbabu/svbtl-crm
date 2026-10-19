// ============================================================
// GET /api/v1/members — the account's team members (scope:
// conversations:read), so an integration can offer "assign to…".
// Returns { user_id, name, role } only; no emails.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'conversations:read');
    const { data, error } = await ctx.supabase
      .from('profiles')
      .select('user_id, full_name, account_role')
      .eq('account_id', ctx.accountId)
      .order('full_name', { ascending: true });
    if (error) {
      console.error('[api/v1/members] list error:', error);
      return fail('internal', 'Failed to list members', 500);
    }
    const rows = (data ?? []) as Array<{ user_id: string; full_name: string | null; account_role: string }>;
    return okList(
      rows.map((r) => ({ user_id: r.user_id, name: r.full_name?.trim() || null, role: r.account_role })),
      null
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
