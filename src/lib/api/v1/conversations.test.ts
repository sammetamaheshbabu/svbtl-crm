import { describe, it, expect } from 'vitest';
import type { Conversation, Message } from '@/types';
import { assignmentFilter, serializeConversation, serializeMessage } from './conversations';

describe('serializeConversation', () => {
  it('projects public fields + nested contact/tags and drops internals', () => {
    const conv = {
      id: 'conv1',
      user_id: 'internal-user',
      account_id: 'internal-acct',
      contact_id: 'c1',
      status: 'open',
      last_message_text: 'hi',
      last_message_at: '2026-01-01T00:00:00Z',
      unread_count: 2,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      contact: {
        id: 'c1',
        phone: '+1',
        name: 'Jane',
        tags: [{ id: 't1', name: 'vip', color: '#fff' }],
      },
    } as unknown as Conversation;

    const out = serializeConversation(conv);
    expect(out).not.toHaveProperty('user_id');
    expect(out).not.toHaveProperty('account_id');
    expect(out.contact?.tags).toEqual([{ id: 't1', name: 'vip', color: '#fff' }]);
    expect(out.unread_count).toBe(2);
  });
});

describe('serializeMessage', () => {
  it('maps message_id → whatsapp_message_id and derives direction', () => {
    const inbound = {
      id: 'm1',
      conversation_id: 'conv1',
      sender_type: 'customer',
      content_type: 'text',
      content_text: 'hello',
      message_id: 'wamid.123',
      status: 'delivered',
      created_at: '2026-01-01T00:00:00Z',
    } as unknown as Message;
    const outMsg = serializeMessage(inbound);
    expect(outMsg.direction).toBe('inbound');
    expect(outMsg.whatsapp_message_id).toBe('wamid.123');
    expect(outMsg).not.toHaveProperty('message_id');

    const agent = { ...inbound, sender_type: 'agent' } as unknown as Message;
    expect(serializeMessage(agent).direction).toBe('outbound');
  });

  describe('interactive field', () => {
    const base = {
      id: 'm2',
      conversation_id: 'conv1',
      sender_type: 'agent',
      content_type: 'interactive',
      content_text: 'How can we help?',
      message_id: 'wamid.456',
      status: 'sent',
      created_at: '2026-01-01T00:00:00Z',
    };

    it('projects a button message into kind, body and options', () => {
      const msg = {
        ...base,
        interactive_payload: {
          kind: 'buttons',
          body: 'How can we help?',
          buttons: [
            { id: 'call', title: 'Arrange a Call Back' },
            { id: 'demo', title: 'Arrange a Live Demo' },
          ],
        },
      } as unknown as Message;

      expect(serializeMessage(msg).interactive).toEqual({
        kind: 'buttons',
        body: 'How can we help?',
        options: [
          { id: 'call', title: 'Arrange a Call Back' },
          { id: 'demo', title: 'Arrange a Live Demo' },
        ],
      });
    });

    it('flattens the rows of every list section into one options array', () => {
      const msg = {
        ...base,
        interactive_payload: {
          kind: 'list',
          body: 'Pick a service',
          button: 'Choose',
          sections: [
            { title: 'Web', rows: [{ id: 'site', title: 'Website' }] },
            {
              title: 'Apps',
              rows: [
                { id: 'ios', title: 'iOS app' },
                { id: 'android', title: 'Android app' },
              ],
            },
          ],
        },
      } as unknown as Message;

      expect(serializeMessage(msg).interactive).toEqual({
        kind: 'list',
        body: 'Pick a service',
        options: [
          { id: 'site', title: 'Website' },
          { id: 'ios', title: 'iOS app' },
          { id: 'android', title: 'Android app' },
        ],
      });
    });

    it('is null for a message that has no interactive payload', () => {
      const msg = { ...base, content_type: 'text', interactive_payload: null } as unknown as Message;
      expect(serializeMessage(msg).interactive).toBeNull();
    });

    it('does not leak the stored payload itself', () => {
      const msg = {
        ...base,
        interactive_payload: { kind: 'buttons', body: 'x', buttons: [{ id: 'a', title: 'A' }] },
      } as unknown as Message;
      expect(serializeMessage(msg)).not.toHaveProperty('interactive_payload');
    });

    it('passes the tapped option id through as interactive_reply_id on a customer reply', () => {
      const tap = {
        ...base,
        sender_type: 'customer',
        content_type: 'interactive',
        content_text: 'Arrange a Live Demo',
        interactive_reply_id: 'demo',
      } as unknown as Message;
      const out = serializeMessage(tap);
      expect(out.direction).toBe('inbound');
      expect(out.interactive_reply_id).toBe('demo');
    });
  });
});

describe('serializeMessage sender_name', () => {
  const base = {
    id: 'm9',
    conversation_id: 'conv1',
    content_type: 'text',
    content_text: 'On my way',
    status: 'sent',
    created_at: '2026-01-01T00:00:00Z',
  };
  const names = new Map([['u-ann', 'Ann Agent']]);

  it('names the team member who sent our message', () => {
    const msg = { ...base, sender_type: 'agent', sender_id: 'u-ann' } as unknown as Message;
    expect(serializeMessage(msg, names).sender_name).toBe('Ann Agent');
    expect(serializeMessage(msg, names)).not.toHaveProperty('sender_id');
  });

  it('is null for customers, unknown senders and sends with no person recorded', () => {
    expect(serializeMessage({ ...base, sender_type: 'customer', sender_id: 'u-ann' } as unknown as Message, names).sender_name).toBeNull();
    expect(serializeMessage({ ...base, sender_type: 'agent', sender_id: 'u-gone' } as unknown as Message, names).sender_name).toBeNull();
    expect(serializeMessage({ ...base, sender_type: 'agent' } as unknown as Message, names).sender_name).toBeNull();
    expect(serializeMessage({ ...base, sender_type: 'agent', sender_id: 'u-ann' } as unknown as Message).sender_name).toBeNull();
  });
});

describe('assignmentFilter', () => {
  const ANN = '11111111-1111-4111-8111-111111111111';
  const params = (q: string) => new URLSearchParams(q);

  it("is null without assigned_to", () => {
    expect(assignmentFilter(params(''))).toBeNull();
  });

  it("filters to one agent's chats, or theirs plus unassigned ones", () => {
    expect(assignmentFilter(params(`assigned_to=${ANN}`))).toBe(`assigned_agent_id.eq.${ANN}`);
    expect(assignmentFilter(params(`assigned_to=${ANN}&include_unassigned=true`))).toBe(
      `assigned_agent_id.eq.${ANN},assigned_agent_id.is.null`
    );
  });

  it('refuses anything but a user id, keeping the filter grammar safe', () => {
    expect(() => assignmentFilter(params('assigned_to=x,id.neq.0'))).toThrow('user id');
  });
});
