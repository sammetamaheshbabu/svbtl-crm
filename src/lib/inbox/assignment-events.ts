// ============================================================
// Handoff lines in the chat thread — pure, no I/O.
//
// A chat's assignment history (conversation_assignments, migration
// 048) is shown between messages: "Manas handed this chat to Mehveen".
// These helpers pick the wording and where each line goes.
// ============================================================

export interface AssignmentEvent {
  id: string;
  from_agent_id: string | null;
  to_agent_id: string | null;
  actor_user_id: string | null;
  created_at: string;
}

/** A key under `Inbox.handoff` plus its values. */
export interface HandoffText {
  key: 'took' | 'handedOver' | 'assigned' | 'assignedAuto' | 'unassigned' | 'unassignedAuto';
  values: Record<string, string>;
}

export function describeAssignment(
  event: AssignmentEvent,
  nameOf: (userId: string) => string
): HandoffText {
  const { from_agent_id: from, to_agent_id: to, actor_user_id: actor } = event;
  if (!to) {
    return actor
      ? { key: 'unassigned', values: { actor: nameOf(actor) } }
      : { key: 'unassignedAuto', values: {} };
  }
  if (!actor) return { key: 'assignedAuto', values: { to: nameOf(to) } };
  if (actor === to) return { key: 'took', values: { to: nameOf(to) } };
  if (actor === from) return { key: 'handedOver', values: { actor: nameOf(actor), to: nameOf(to) } };
  return { key: 'assigned', values: { actor: nameOf(actor), to: nameOf(to) } };
}

/**
 * Places each handoff after the last message sent at or before it.
 * Handoffs older than every message go in `leading`.
 */
export function placeAssignments(
  messages: Array<{ id: string; created_at: string }>,
  events: AssignmentEvent[]
): { leading: AssignmentEvent[]; afterMessage: Map<string, AssignmentEvent[]> } {
  const leading: AssignmentEvent[] = [];
  const afterMessage = new Map<string, AssignmentEvent[]>();
  const sorted = [...events].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const event of sorted) {
    const at = Date.parse(event.created_at);
    let anchor: string | null = null;
    for (const m of messages) {
      if (Date.parse(m.created_at) <= at) anchor = m.id;
      else break;
    }
    if (!anchor) {
      leading.push(event);
    } else {
      afterMessage.set(anchor, [...(afterMessage.get(anchor) ?? []), event]);
    }
  }
  return { leading, afterMessage };
}
