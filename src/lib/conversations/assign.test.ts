import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const dispatch = vi.fn(async (...args: unknown[]) => void args);
vi.mock('@/lib/webhooks/deliver', () => ({
  dispatchWebhookEvent: (...args: unknown[]) => dispatch(...args),
}));

// Names the webhook carries: the actor's profile and the contact.
vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({
          data:
            table === 'profiles'
              ? { full_name: 'Manas' }
              : { name: 'Asha', phone: '+919100000000' },
        }),
      };
      return q;
    },
  }),
}));

import { assignConversation } from './assign';

function rpcDb(data: unknown, error: { message: string } | null = null) {
  const rpc = vi.fn(async () => ({ data, error }));
  return { db: { rpc } as unknown as SupabaseClient, rpc };
}

describe('assignConversation', () => {
  beforeEach(() => dispatch.mockClear());

  it('assigns through the database function, naming who did it', async () => {
    const { db, rpc } = rpcDb({ changed: true, from_agent_id: 'u-manas', contact_id: 'k1' });
    const result = await assignConversation(db, 'acct-1', {
      conversationId: 'cv-1',
      agentId: 'u-mehveen',
      actorUserId: 'u-manas',
    });
    expect(result).toEqual({ changed: true, fromAgentId: 'u-manas' });
    expect(rpc).toHaveBeenCalledWith('assign_conversation', {
      p_account_id: 'acct-1',
      p_conversation_id: 'cv-1',
      p_agent_id: 'u-mehveen',
      p_actor_id: 'u-manas',
      p_only_if_unassigned: false,
    });
  });

  it('tells integrations about the handoff, with names for a notification', async () => {
    const { db } = rpcDb({ changed: true, from_agent_id: 'u-manas', contact_id: 'k1' });
    await assignConversation(db, 'acct-1', {
      conversationId: 'cv-1',
      agentId: 'u-mehveen',
      actorUserId: 'u-manas',
    });
    expect(dispatch).toHaveBeenCalledWith(expect.anything(), 'acct-1', 'conversation.assigned', {
      conversation_id: 'cv-1',
      contact_id: 'k1',
      from_agent_id: 'u-manas',
      to_agent_id: 'u-mehveen',
      actor_user_id: 'u-manas',
      actor_name: 'Manas',
      contact_name: 'Asha',
    });
  });

  it('sends nothing when the assignee did not change', async () => {
    const { db } = rpcDb({ changed: false, from_agent_id: 'u-mehveen', contact_id: 'k1' });
    const result = await assignConversation(db, 'acct-1', {
      conversationId: 'cv-1',
      agentId: 'u-mehveen',
      actorUserId: 'u-manas',
    });
    expect(result.changed).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('fails loudly when the database refuses', async () => {
    const { db } = rpcDb(null, { message: 'permission denied' });
    await expect(
      assignConversation(db, 'acct-1', { conversationId: 'cv-1', agentId: null, actorUserId: 'u-manas' })
    ).rejects.toThrow('permission denied');
  });
});
