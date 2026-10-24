// ============================================================
// Save a contact's profile from the inbox (name, email, company and
// custom fields). The phone number is not editable here: changing it
// under an open chat would redirect the conversation.
//
// Custom values are written per field: filled ones are upserted on
// (contact_id, custom_field_id), cleared ones are deleted, and fields
// the form didn't show are left alone.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Contact } from '@/types';

export interface ProfileInput {
  name: string;
  email: string;
  company: string;
  /** custom_field_id → value, for the fields the form showed. */
  customValues: Record<string, string>;
}

export class ProfileError extends Error {}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function saveContactProfile(
  db: SupabaseClient,
  contactId: string,
  input: ProfileInput
): Promise<Contact> {
  const email = input.email.trim();
  if (email && !EMAIL_RE.test(email)) {
    throw new ProfileError('invalid_email');
  }

  const { data: contact, error } = await db
    .from('contacts')
    .update({
      name: input.name.trim() || null,
      email: email || null,
      company: input.company.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', contactId)
    .select('*')
    .single();
  if (error || !contact) throw new ProfileError('save_failed');

  const filled = Object.entries(input.customValues)
    .map(([fieldId, value]) => [fieldId, value.trim()] as const)
    .filter(([, value]) => value);
  const cleared = Object.entries(input.customValues)
    .filter(([, value]) => !value.trim())
    .map(([fieldId]) => fieldId);

  if (filled.length > 0) {
    const { error: upsertError } = await db.from('contact_custom_values').upsert(
      filled.map(([fieldId, value]) => ({
        contact_id: contactId,
        custom_field_id: fieldId,
        value,
      })),
      { onConflict: 'contact_id,custom_field_id' }
    );
    if (upsertError) throw new ProfileError('save_failed');
  }
  if (cleared.length > 0) {
    const { error: deleteError } = await db
      .from('contact_custom_values')
      .delete()
      .eq('contact_id', contactId)
      .in('custom_field_id', cleared);
    if (deleteError) throw new ProfileError('save_failed');
  }

  return contact as Contact;
}
