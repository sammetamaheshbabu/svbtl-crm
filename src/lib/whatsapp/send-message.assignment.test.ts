import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/webhooks/deliver', () => ({ dispatchWebhookEvent: vi.fn(async () => {}) }));
vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null }) };
      return q;
    },
  }),
}));

import {
  claimConversation,
  isAgentSender,
  sendMessageToConversation,
} from './send-message';

const ANN = 'user-ann';
const MANAS = 'user-manas';

/**
 * Serves one conversation for the account-scoped lookup, then throws on
 * any further query — enough to see whether a send is refused up front.
 * (The stub contact has no phone, so an allowed send stops at that check.)
 */
function dbWithConversation(assignedAgentId: string | null) {
  let lookups = 0;
  const db = {
    from: vi.fn(() => {
      if (lookups++ > 0) throw new Error('went past the assignment check');
      const q = {
        select: () => q,
        eq: () => q,
        single: async () => ({
          data: { id: 'cv-1', assigned_agent_id: assignedAgentId, contact: { id: 'ct-1' } },
          error: null,
        }),
      };
      return q;
    }),
  };
  return db as unknown as SupabaseClient;
}

const text = { conversationId: 'cv-1', messageType: 'text', contentText: 'Hi' };

/** The error a send ends with; allowed sends end at a later step. */
const outcome = (p: Promise<unknown>) => p.then(() => null, (e: { status?: number; message: string }) => e);
const notTheirs = /assigned to someone else/;

describe('who may send into a chat', () => {
  it('holds agents and viewers to their limits, not admins or owners', () => {
    expect(isAgentSender(ANN, 'agent')).toBe(true);
    expect(isAgentSender(ANN, 'viewer')).toBe(true);
    expect(isAgentSender(ANN, 'admin')).toBe(false);
    expect(isAgentSender(ANN, 'owner')).toBe(false);
    expect(isAgentSender(null, 'agent')).toBe(false);
    expect(isAgentSender(ANN, null)).toBe(false);
  });

  it("refuses an agent in a chat assigned to someone else", async () => {
    await expect(
      sendMessageToConversation(dbWithConversation(MANAS), 'acct-1', {
        ...text,
        senderId: ANN,
        senderRole: 'agent',
      })
    ).rejects.toMatchObject({ status: 403, message: expect.stringMatching(notTheirs) });
  });

  it('lets an admin reply in any chat', async () => {
    const err = await outcome(
      sendMessageToConversation(dbWithConversation(MANAS), 'acct-1', {
        ...text,
        senderId: ANN,
        senderRole: 'admin',
      })
    );
    expect(err?.message).not.toMatch(notTheirs);
  });

  it('lets an agent reply in their own or an unassigned chat', async () => {
    for (const assigned of [ANN, null]) {
      const err = await outcome(
        sendMessageToConversation(dbWithConversation(assigned), 'acct-1', {
          ...text,
          senderId: ANN,
          senderRole: 'agent',
        })
      );
      expect(err?.message).not.toMatch(notTheirs);
    }
  });
});

describe('claimConversation', () => {
  function claimDb(result: { changed: boolean } | null, error: { message: string } | null = null) {
    const rpc = vi.fn(async () => ({ data: error ? null : { ...result, from_agent_id: null }, error }));
    return { db: { rpc } as unknown as SupabaseClient, rpc };
  }

  it('assigns only a chat that is still unassigned, naming the agent as the one who took it', async () => {
    const { db, rpc } = claimDb({ changed: true });
    expect(await claimConversation(db, 'acct-1', 'cv-1', ANN)).toBe(true);
    expect(rpc).toHaveBeenCalledWith('assign_conversation', {
      p_account_id: 'acct-1',
      p_conversation_id: 'cv-1',
      p_agent_id: ANN,
      p_actor_id: ANN,
      p_only_if_unassigned: true,
    });
  });

  it('reports no claim when someone else took the chat first, or on error', async () => {
    expect(await claimConversation(claimDb({ changed: false }).db, 'acct-1', 'cv-1', ANN)).toBe(false);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await claimConversation(claimDb(null, { message: 'boom' }).db, 'acct-1', 'cv-1', ANN)).toBe(false);
    errSpy.mockRestore();
  });
});
