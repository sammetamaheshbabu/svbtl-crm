import type { ContactReminder } from '@/types';

/**
 * Client calls for callback reminders. Writes go through the API rather
 * than straight to Supabase so the notification title is composed from
 * the locale files server-side — the pg_cron job that fires the
 * notification has no request to translate in. Same shape as
 * `tag-api.ts`.
 */

async function request<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
  } & T;
  if (!response.ok) {
    throw new Error(body.error ?? 'Failed to update the reminder');
  }
  return body;
}

export function listContactReminders(
  contactId: string
): Promise<{ reminders: ContactReminder[] }> {
  return request(`/api/contacts/${contactId}/reminders`, { method: 'GET' });
}

export function createContactReminder(
  contactId: string,
  input: {
    reason: string;
    remindAt: Date;
    remindAtTz: string;
    conversationId?: string | null;
  }
): Promise<{ reminder: ContactReminder }> {
  return request(`/api/contacts/${contactId}/reminders`, {
    method: 'POST',
    body: JSON.stringify({
      reason: input.reason,
      remind_at: input.remindAt.toISOString(),
      remind_at_tz: input.remindAtTz,
      conversation_id: input.conversationId ?? null,
    }),
  });
}

export function updateContactReminder(
  reminderId: string,
  input: {
    status?: 'done' | 'cancelled';
    remindAt?: Date;
    remindAtTz?: string;
    reason?: string;
  }
): Promise<{ reminder: ContactReminder }> {
  return request(`/api/reminders/${reminderId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: input.status,
      remind_at: input.remindAt?.toISOString(),
      remind_at_tz: input.remindAtTz,
      reason: input.reason,
    }),
  });
}

export function deleteContactReminder(reminderId: string): Promise<void> {
  return request(`/api/reminders/${reminderId}`, { method: 'DELETE' });
}
