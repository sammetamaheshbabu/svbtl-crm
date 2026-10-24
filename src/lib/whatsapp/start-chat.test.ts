import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const findExistingContact = vi.fn();
const resolveConversationByPhone = vi.fn();

vi.mock('@/lib/contacts/dedupe', () => ({
  findExistingContact: (...args: unknown[]) => findExistingContact(...args),
}));
vi.mock('@/lib/whatsapp/resolve-conversation', () => ({
  resolveConversationByPhone: (...args: unknown[]) => resolveConversationByPhone(...args),
}));

import { resolveStartChat } from './start-chat';
import { SendMessageError } from './send-message';

// Scripted per table: the chat's assignee and the assignee's name.
let assignedTo: string | null = null;
let assigneeName: string | null = null;

function makeDb(): SupabaseClient {
  return {
    from(table: string) {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        order: () => b,
        limit: () =>
          Promise.resolve({
            data: table === 'conversations' ? [{ assigned_agent_id: assignedTo }] : [],
            error: null,
          }),
        maybeSingle: () =>
          Promise.resolve({ data: { full_name: assigneeName }, error: null }),
      };
      return b;
    },
  } as unknown as SupabaseClient;
}

const base = {
  phone: '+91 98765 43210',
  name: 'Ravi',
  optInConfirmed: true,
  senderId: 'agent-1',
  senderRole: 'agent' as const,
};

async function failure(input = base): Promise<SendMessageError> {
  try {
    await resolveStartChat(makeDb(), 'acct-1', input);
  } catch (err) {
    return err as SendMessageError;
  }
  throw new Error('expected a failure');
}

beforeEach(() => {
  findExistingContact.mockReset().mockResolvedValue(null);
  resolveConversationByPhone
    .mockReset()
    .mockResolvedValue({ conversationId: 'conv-1', contactId: 'contact-1', contactCreated: true });
  assignedTo = null;
  assigneeName = null;
});

describe('resolveStartChat', () => {
  it('creates the chat for a new number and records the opt-in', async () => {
    const target = await resolveStartChat(makeDb(), 'acct-1', base);
    expect(target).toEqual({ conversationId: 'conv-1', contactId: 'contact-1', recordOptIn: true });
    expect(resolveConversationByPhone).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      '+919876543210',
      'Ravi'
    );
  });

  it('refuses a number without a country code', async () => {
    const err = await failure({ ...base, phone: '9876543210' });
    expect(err.status).toBe(400);
    expect(resolveConversationByPhone).not.toHaveBeenCalled();
  });

  it('needs the opt-in confirmed for a contact without one', async () => {
    const err = await failure({ ...base, optInConfirmed: false });
    expect(err.code).toBe('opt_in_required');
    expect(resolveConversationByPhone).not.toHaveBeenCalled();
  });

  it('accepts an earlier opt-in and does not record it again', async () => {
    findExistingContact.mockResolvedValue({
      id: 'contact-1',
      phone: '919876543210',
      name: 'Ravi Kumar',
      whatsapp_opt_in_at: '2026-10-01T10:00:00Z',
    });
    const target = await resolveStartChat(makeDb(), 'acct-1', { ...base, optInConfirmed: false });
    expect(target.recordOptIn).toBe(false);
  });

  it('keeps an existing contact\'s name', async () => {
    findExistingContact.mockResolvedValue({ id: 'contact-1', phone: '919876543210', name: 'Ravi Kumar' });
    await resolveStartChat(makeDb(), 'acct-1', { ...base, name: 'Someone else' });
    expect(resolveConversationByPhone.mock.calls[0][3]).toBeNull();
  });

  it('stops an agent at a chat another member is handling', async () => {
    findExistingContact.mockResolvedValue({ id: 'contact-1', phone: '919876543210' });
    assignedTo = 'agent-2';
    assigneeName = 'Mehveen';
    const err = await failure();
    expect(err.status).toBe(403);
    expect(err.message).toContain('Mehveen');
    expect(resolveConversationByPhone).not.toHaveBeenCalled();
  });

  it('lets an agent continue their own chat', async () => {
    findExistingContact.mockResolvedValue({ id: 'contact-1', phone: '919876543210' });
    assignedTo = 'agent-1';
    await expect(resolveStartChat(makeDb(), 'acct-1', base)).resolves.toMatchObject({
      conversationId: 'conv-1',
    });
  });

  it('lets an admin message a chat assigned to someone else', async () => {
    findExistingContact.mockResolvedValue({ id: 'contact-1', phone: '919876543210' });
    assignedTo = 'agent-2';
    await expect(
      resolveStartChat(makeDb(), 'acct-1', { ...base, senderRole: 'admin' })
    ).resolves.toMatchObject({ conversationId: 'conv-1' });
  });
});
