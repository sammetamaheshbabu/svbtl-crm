import { beforeEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { ProfileError, saveContactProfile } from './save-profile';

// Records each call per table so tests can assert what was written.
type Call = { table: string; op: string; payload?: unknown; filters: unknown[][] };
let calls: Call[] = [];
let updateError: unknown = null;

function makeDb(): SupabaseClient {
  return {
    from(table: string) {
      const call: Call = { table, op: 'select', filters: [] };
      calls.push(call);
      const b: Record<string, unknown> = {
        update: (payload: unknown) => ((call.op = 'update'), (call.payload = payload), b),
        upsert: (payload: unknown, opts: unknown) => (
          (call.op = 'upsert'), (call.payload = { payload, opts }), Promise.resolve({ error: null })
        ),
        delete: () => ((call.op = 'delete'), b),
        eq: (...f: unknown[]) => (call.filters.push(['eq', ...f]), b),
        in: (...f: unknown[]) => (call.filters.push(['in', ...f]), Promise.resolve({ error: null })),
        select: () => b,
        single: () =>
          Promise.resolve(
            updateError
              ? { data: null, error: updateError }
              : { data: { id: 'c1', ...(call.payload as object) }, error: null }
          ),
      };
      return b;
    },
  } as unknown as SupabaseClient;
}

beforeEach(() => {
  calls = [];
  updateError = null;
});

describe('saveContactProfile', () => {
  it('trims fields and stores empty ones as null', async () => {
    const contact = await saveContactProfile(makeDb(), 'c1', {
      name: '  Ravi Kumar ',
      email: '',
      company: ' SVB ',
      customValues: {},
    });
    expect(contact).toMatchObject({ name: 'Ravi Kumar', email: null, company: 'SVB' });
    expect(calls).toHaveLength(1);
    expect(calls[0].filters).toContainEqual(['eq', 'id', 'c1']);
  });

  it('upserts filled custom values and deletes cleared ones', async () => {
    await saveContactProfile(makeDb(), 'c1', {
      name: 'Ravi',
      email: 'ravi@example.com',
      company: '',
      customValues: { f1: ' Gold ', f2: '  ' },
    });
    const upsert = calls.find((c) => c.op === 'upsert')!;
    expect(upsert.payload).toEqual({
      payload: [{ contact_id: 'c1', custom_field_id: 'f1', value: 'Gold' }],
      opts: { onConflict: 'contact_id,custom_field_id' },
    });
    const del = calls.find((c) => c.op === 'delete')!;
    expect(del.filters).toEqual([
      ['eq', 'contact_id', 'c1'],
      ['in', 'custom_field_id', ['f2']],
    ]);
  });

  it('refuses a malformed email before writing', async () => {
    await expect(
      saveContactProfile(makeDb(), 'c1', { name: '', email: 'not-an-email', company: '', customValues: {} })
    ).rejects.toThrow(ProfileError);
    expect(calls).toHaveLength(0);
  });

  it('reports a failed update', async () => {
    updateError = { message: 'denied' };
    await expect(
      saveContactProfile(makeDb(), 'c1', { name: 'x', email: '', company: '', customValues: {} })
    ).rejects.toThrow('save_failed');
  });
});
