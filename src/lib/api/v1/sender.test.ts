import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveSenderId, senderNames } from './sender';

const ACCOUNT = 'acc-1';
const ANN = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const OTHER_ACCOUNT_USER = '33333333-3333-4333-8333-333333333333';

/** A tiny stand-in for the profiles table that understands eq / in / maybeSingle. */
function fakeDb() {
  const rows = [
    { user_id: ANN, account_id: ACCOUNT, full_name: 'Ann Agent' },
    { user_id: BOB, account_id: ACCOUNT, full_name: 'Bob Admin' },
    { user_id: OTHER_ACCOUNT_USER, account_id: 'acc-2', full_name: 'Someone Else' },
  ];
  return {
    from: () => {
      const filters: Array<(r: (typeof rows)[number]) => boolean> = [];
      const q = {
        select: () => q,
        eq: (col: string, val: string) => (filters.push((r) => (r as Record<string, string>)[col] === val), q),
        in: (col: string, vals: string[]) => (filters.push((r) => vals.includes((r as Record<string, string>)[col])), q),
        maybeSingle: async () => ({ data: rows.find((r) => filters.every((f) => f(r))) ?? null }),
        then: (resolve: (v: { data: typeof rows }) => void) => resolve({ data: rows.filter((r) => filters.every((f) => f(r))) }),
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

describe('resolveSenderId', () => {
  it('is null when no sender is given', async () => {
    expect(await resolveSenderId(fakeDb(), ACCOUNT, undefined)).toBeNull();
    expect(await resolveSenderId(fakeDb(), ACCOUNT, '')).toBeNull();
  });

  it('accepts a member of the account', async () => {
    expect(await resolveSenderId(fakeDb(), ACCOUNT, ANN)).toBe(ANN);
  });

  it('refuses a malformed id', async () => {
    await expect(resolveSenderId(fakeDb(), ACCOUNT, 'not-a-uuid')).rejects.toMatchObject({ status: 400 });
    await expect(resolveSenderId(fakeDb(), ACCOUNT, 42)).rejects.toMatchObject({ status: 400 });
  });

  it("refuses a user from another account, so messages can't be pinned on outsiders", async () => {
    await expect(resolveSenderId(fakeDb(), ACCOUNT, OTHER_ACCOUNT_USER)).rejects.toMatchObject({ status: 400 });
  });
});

describe('senderNames', () => {
  it("returns this account's members' names, skipping blanks and outsiders", async () => {
    const names = await senderNames(fakeDb(), ACCOUNT, [ANN, BOB, ANN, null, OTHER_ACCOUNT_USER]);
    expect(Object.fromEntries(names)).toEqual({ [ANN]: 'Ann Agent', [BOB]: 'Bob Admin' });
  });

  it('makes no lookup for a page with no senders', async () => {
    expect((await senderNames(fakeDb(), ACCOUNT, [null, undefined])).size).toBe(0);
  });
});
