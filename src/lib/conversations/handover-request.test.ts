import { beforeEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { requestHandover } from './handover-request';

let conversation: Record<string, unknown> | null;
let recent: { id: string }[];
let inserted: Record<string, unknown>[];

function makeDb(): SupabaseClient {
  return {
    from(table: string) {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        gte: () => b,
        limit: () => Promise.resolve({ data: table === 'notifications' ? recent : [], error: null }),
        maybeSingle: () => Promise.resolve({ data: conversation, error: null }),
        insert: (rows: Record<string, unknown>[]) => {
          inserted.push(...rows);
          return Promise.resolve({ error: null });
        },
        then: (resolve: (v: unknown) => unknown) =>
          resolve({
            data:
              table === 'profiles'
                ? [
                    { user_id: 'agent-1', full_name: 'Testing', account_role: 'agent' },
                    { user_id: 'agent-2', full_name: 'Mehveen', account_role: 'agent' },
                    { user_id: 'admin-1', full_name: 'Admin', account_role: 'owner' },
                  ]
                : [],
            error: null,
          }),
      };
      return b;
    },
  } as unknown as SupabaseClient;
}

const input = {
  accountId: 'acct',
  conversationId: 'conv-1',
  requesterId: 'agent-1',
  title: 'Handover requested',
  body: ({ requester, contact }: { requester: string; contact: string }) =>
    `${requester} asks you to hand over the chat with ${contact}.`,
};

beforeEach(() => {
  conversation = {
    id: 'conv-1',
    assigned_agent_id: 'agent-2',
    contact_id: 'c1',
    contact: { name: 'Ravi Kumar', phone: '919876543210' },
  };
  recent = [];
  inserted = [];
});

describe('requestHandover', () => {
  it('notifies the owner and the admins, not the requester', async () => {
    const result = await requestHandover(makeDb(), input);
    expect(result).toEqual({ status: 'sent', notified: 2 });
    expect(inserted.map((r) => r.user_id).sort()).toEqual(['admin-1', 'agent-2']);
    expect(inserted[0]).toMatchObject({
      type: 'handover_requested',
      conversation_id: 'conv-1',
      actor_user_id: 'agent-1',
      body: 'Testing asks you to hand over the chat with Ravi Kumar.',
    });
  });

  it('sends nothing twice within the hour', async () => {
    recent = [{ id: 'n1' }];
    expect(await requestHandover(makeDb(), input)).toEqual({ status: 'already_requested' });
    expect(inserted).toHaveLength(0);
  });

  it('needs no request for an unassigned or own chat', async () => {
    conversation = { ...conversation!, assigned_agent_id: null };
    expect((await requestHandover(makeDb(), input)).status).toBe('not_needed');
    conversation = { ...conversation!, assigned_agent_id: 'agent-1' };
    expect((await requestHandover(makeDb(), input)).status).toBe('not_needed');
    expect(inserted).toHaveLength(0);
  });

  it('reports a chat outside the account', async () => {
    conversation = null;
    expect(await requestHandover(makeDb(), input)).toEqual({ status: 'not_found' });
  });
});
