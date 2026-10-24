import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const findExistingContact = vi.fn();
vi.mock('@/lib/contacts/dedupe', () => ({
  findExistingContact: (...args: unknown[]) => findExistingContact(...args),
}));

import { lookupNumber } from './number-lookup';

let assignedTo: string | null = null;

function makeDb(): SupabaseClient {
  return {
    from(table: string) {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        order: () => b,
        limit: () =>
          Promise.resolve({
            data: table === 'conversations' ? [{ id: 'conv-1', assigned_agent_id: assignedTo }] : [],
            error: null,
          }),
        maybeSingle: () => Promise.resolve({ data: { full_name: 'Mehveen' }, error: null }),
      };
      return b;
    },
  } as unknown as SupabaseClient;
}

const agent = { userId: 'agent-1', role: 'agent' as const };

beforeEach(() => {
  assignedTo = null;
  findExistingContact.mockReset().mockResolvedValue({
    id: 'c1',
    phone: '919876543210',
    name: 'Ravi Kumar',
    whatsapp_opt_in_at: '2026-10-24T10:00:00Z',
  });
});

describe('lookupNumber', () => {
  it('reports a new number', async () => {
    findExistingContact.mockResolvedValue(null);
    const r = await lookupNumber(makeDb(), 'acct', '919876543210', agent);
    expect(r).toMatchObject({ exists: false, blocked: false, handledBy: null });
  });

  it('lets an agent continue an unassigned customer', async () => {
    const r = await lookupNumber(makeDb(), 'acct', '919876543210', agent);
    expect(r).toMatchObject({
      exists: true,
      contactName: 'Ravi Kumar',
      optedInAt: '2026-10-24T10:00:00Z',
      conversationId: 'conv-1',
      handledBy: null,
      blocked: false,
    });
  });

  it('lets an agent continue their own customer', async () => {
    assignedTo = 'agent-1';
    const r = await lookupNumber(makeDb(), 'acct', '919876543210', agent);
    expect(r.blocked).toBe(false);
  });

  it("blocks an agent at another agent's customer and names the owner", async () => {
    assignedTo = 'agent-2';
    const r = await lookupNumber(makeDb(), 'acct', '919876543210', agent);
    expect(r).toMatchObject({
      blocked: true,
      contactName: 'Ravi Kumar',
      handledBy: { userId: 'agent-2', name: 'Mehveen' },
    });
  });

  it('never blocks an admin', async () => {
    assignedTo = 'agent-2';
    const r = await lookupNumber(makeDb(), 'acct', '919876543210', { userId: 'admin-1', role: 'admin' });
    expect(r.blocked).toBe(false);
  });
});
