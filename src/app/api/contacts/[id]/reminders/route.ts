import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  createReminder,
  ReminderWriteError,
} from '@/lib/contacts/reminder-write';
import { getT } from '@/lib/i18n/translate';
import { contactHandle } from '@/lib/whatsapp/wa-identity';

const t = getT('Api');

function writeErrorResponse(error: ReminderWriteError): NextResponse {
  return NextResponse.json({ error: error.message }, { status: error.status });
}

/** Every callback reminder on one customer, soonest first. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id: contactId } = await params;

    // RLS decides which rows come back: an agent sees their own, an
    // admin sees everyone's.
    const { data, error } = await ctx.supabase
      .from('contact_reminders')
      .select('*')
      .eq('contact_id', contactId)
      .eq('account_id', ctx.accountId)
      .order('remind_at', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, reminders: data ?? [] });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id: contactId } = await params;

    const body = (await request.json().catch(() => null)) as {
      reason?: unknown;
      remind_at?: unknown;
      remind_at_tz?: unknown;
      conversation_id?: unknown;
    } | null;

    if (
      typeof body?.reason !== 'string' ||
      typeof body?.remind_at !== 'string' ||
      typeof body?.remind_at_tz !== 'string'
    ) {
      return NextResponse.json(
        { error: t('reminders.fieldsRequired') },
        { status: 400 }
      );
    }

    // The title is stored on the row because the pg_cron job that turns
    // it into a notification runs with no request — and so no locale —
    // of its own. Naming the customer here is what makes the alert
    // actionable without opening anything.
    const { data: contact } = await ctx.supabase
      .from('contacts')
      .select('id, name, phone')
      .eq('id', contactId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    const who = contact
      ? contact.name || contactHandle(contact)
      : t('reminders.unknownContact');

    const reminder = await createReminder(ctx.supabase, {
      accountId: ctx.accountId,
      agentId: ctx.userId,
      contactId,
      conversationId:
        typeof body.conversation_id === 'string' ? body.conversation_id : null,
      reason: body.reason,
      remindAt: body.remind_at,
      remindAtTz: body.remind_at_tz,
      notificationTitle: t('reminders.notificationTitle', { contact: who }),
    });

    return NextResponse.json({ ok: true, reminder });
  } catch (error) {
    if (error instanceof ReminderWriteError) {
      return writeErrorResponse(error);
    }
    return toErrorResponse(error);
  }
}
