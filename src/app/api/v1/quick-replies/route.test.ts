import { beforeEach, describe, expect, it, vi } from 'vitest';

// Rows the stub returns per table.
let replies: Array<Record<string, unknown>> = [];
let contact: { name: string | null } | null = null;
const filters: Array<[string, string, unknown]> = [];

function makeDb() {
  return {
    from(table: string) {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (col: string, val: unknown) => {
          filters.push([table, col, val]);
          return b;
        },
        order: () => Promise.resolve({ data: replies, error: null }),
        maybeSingle: () => Promise.resolve({ data: contact, error: null }),
      };
      return b;
    },
  };
}

vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: vi.fn(async () => ({ supabase: makeDb(), accountId: 'acct-1' })),
}));

import { GET } from './route';

const CONTACT_ID = '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f';

beforeEach(() => {
  filters.length = 0;
  contact = { name: 'Ravi Kumar' };
  replies = [
    {
      id: 'qr-1',
      title: 'Greeting',
      kind: 'text',
      content_text: 'Hi {name}, how can we help?',
      interactive_payload: null,
      updated_at: '2026-10-24T10:00:00Z',
    },
    {
      id: 'qr-2',
      title: 'Menu',
      kind: 'interactive',
      content_text: null,
      interactive_payload: { type: 'button' },
      updated_at: '2026-10-24T10:00:00Z',
    },
  ];
});

describe('GET /api/v1/quick-replies', () => {
  it('lists the account\'s replies with placeholders as written', async () => {
    const res = await GET(new Request('http://localhost/api/v1/quick-replies'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(2);
    expect(json.data[0]).toEqual({
      id: 'qr-1',
      title: 'Greeting',
      kind: 'text',
      content_text: 'Hi {name}, how can we help?',
      interactive_payload: null,
      updated_at: '2026-10-24T10:00:00Z',
    });
    expect(filters).toContainEqual(['quick_replies', 'account_id', 'acct-1']);
  });

  it('fills the name for a contact', async () => {
    const res = await GET(
      new Request(`http://localhost/api/v1/quick-replies?contact_id=${CONTACT_ID}`)
    );
    const json = await res.json();

    expect(json.data[0].content_text).toBe('Hi Ravi Kumar, how can we help?');
    expect(filters).toContainEqual(['contacts', 'account_id', 'acct-1']);
  });

  it('404s for a contact outside the account', async () => {
    contact = null;
    const res = await GET(
      new Request(`http://localhost/api/v1/quick-replies?contact_id=${CONTACT_ID}`)
    );
    expect(res.status).toBe(404);
  });

  it('400s for a malformed contact id', async () => {
    const res = await GET(new Request('http://localhost/api/v1/quick-replies?contact_id=abc'));
    expect(res.status).toBe(400);
  });
});
