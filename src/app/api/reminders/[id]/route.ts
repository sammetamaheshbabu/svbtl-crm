import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  deleteReminder,
  ReminderWriteError,
  updateReminder,
} from '@/lib/contacts/reminder-write';
import { getT } from '@/lib/i18n/translate';

const t = getT('Api');

function writeErrorResponse(error: ReminderWriteError): NextResponse {
  return NextResponse.json({ error: error.message }, { status: error.status });
}

/** Mark done or cancelled, push the time out, or reword the reason. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id: reminderId } = await params;

    const body = (await request.json().catch(() => null)) as {
      status?: unknown;
      remind_at?: unknown;
      remind_at_tz?: unknown;
      reason?: unknown;
    } | null;

    if (
      body?.status !== undefined &&
      body.status !== 'done' &&
      body.status !== 'cancelled'
    ) {
      return NextResponse.json(
        { error: t('reminders.invalidStatus') },
        { status: 400 }
      );
    }

    const reminder = await updateReminder(ctx.supabase, {
      accountId: ctx.accountId,
      reminderId,
      status: body?.status as 'done' | 'cancelled' | undefined,
      remindAt: typeof body?.remind_at === 'string' ? body.remind_at : undefined,
      remindAtTz:
        typeof body?.remind_at_tz === 'string' ? body.remind_at_tz : undefined,
      reason: typeof body?.reason === 'string' ? body.reason : undefined,
    });

    return NextResponse.json({ ok: true, reminder });
  } catch (error) {
    if (error instanceof ReminderWriteError) {
      return writeErrorResponse(error);
    }
    return toErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id: reminderId } = await params;

    await deleteReminder(ctx.supabase, {
      accountId: ctx.accountId,
      reminderId,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ReminderWriteError) {
      return writeErrorResponse(error);
    }
    return toErrorResponse(error);
  }
}
