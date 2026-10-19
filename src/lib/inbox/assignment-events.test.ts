import { describe, expect, it } from 'vitest';
import { describeAssignment, placeAssignments, type AssignmentEvent } from './assignment-events';

const names: Record<string, string> = { manas: 'Manas', mehveen: 'Mehveen', admin: 'Admin' };
const nameOf = (id: string) => names[id] ?? 'A team member';

function event(partial: Partial<AssignmentEvent>): AssignmentEvent {
  return {
    id: 'e1',
    from_agent_id: null,
    to_agent_id: null,
    actor_user_id: null,
    created_at: '2026-10-19T10:00:00Z',
    ...partial,
  };
}

describe('describeAssignment', () => {
  it('says who handed the chat to whom', () => {
    expect(
      describeAssignment(event({ from_agent_id: 'manas', to_agent_id: 'mehveen', actor_user_id: 'manas' }), nameOf)
    ).toEqual({ key: 'handedOver', values: { actor: 'Manas', to: 'Mehveen' } });
  });

  it('tells an admin assigning someone else apart from a handover', () => {
    expect(
      describeAssignment(event({ from_agent_id: 'manas', to_agent_id: 'mehveen', actor_user_id: 'admin' }), nameOf)
    ).toEqual({ key: 'assigned', values: { actor: 'Admin', to: 'Mehveen' } });
  });

  it('says when someone took a chat themselves, by reply or by hand', () => {
    expect(describeAssignment(event({ to_agent_id: 'manas', actor_user_id: 'manas' }), nameOf)).toEqual({
      key: 'took',
      values: { to: 'Manas' },
    });
  });

  it('marks changes nobody made by hand as automatic', () => {
    expect(describeAssignment(event({ to_agent_id: 'manas' }), nameOf)).toEqual({
      key: 'assignedAuto',
      values: { to: 'Manas' },
    });
    expect(describeAssignment(event({ from_agent_id: 'manas' }), nameOf)).toEqual({
      key: 'unassignedAuto',
      values: {},
    });
  });

  it('says who unassigned a chat', () => {
    expect(describeAssignment(event({ from_agent_id: 'manas', actor_user_id: 'admin' }), nameOf)).toEqual({
      key: 'unassigned',
      values: { actor: 'Admin' },
    });
  });

  it('falls back for people no longer on the team', () => {
    expect(describeAssignment(event({ to_agent_id: 'gone', actor_user_id: 'admin' }), nameOf).values.to).toBe(
      'A team member'
    );
  });
});

describe('placeAssignments', () => {
  const messages = [
    { id: 'm1', created_at: '2026-10-19T09:00:00Z' },
    { id: 'm2', created_at: '2026-10-19T11:00:00Z' },
  ];

  it('puts each handoff after the last message before it', () => {
    const before = event({ id: 'early', created_at: '2026-10-19T08:00:00Z' });
    const between = event({ id: 'mid', created_at: '2026-10-19T10:00:00Z' });
    const after = event({ id: 'late', created_at: '2026-10-19T12:00:00Z' });
    const placed = placeAssignments(messages, [after, between, before]);
    expect(placed.leading.map((e) => e.id)).toEqual(['early']);
    expect(placed.afterMessage.get('m1')?.map((e) => e.id)).toEqual(['mid']);
    expect(placed.afterMessage.get('m2')?.map((e) => e.id)).toEqual(['late']);
  });

  it('keeps several handoffs after one message in time order', () => {
    const a = event({ id: 'a', created_at: '2026-10-19T12:00:00Z' });
    const b = event({ id: 'b', created_at: '2026-10-19T12:05:00Z' });
    expect(placeAssignments(messages, [b, a]).afterMessage.get('m2')?.map((e) => e.id)).toEqual(['a', 'b']);
  });
});
