-- ============================================================
-- 048 — Handoff history: who assigned each chat to whom, and when
--
-- Every change of conversations.assigned_agent_id is recorded by a
-- trigger, whichever path made it (the inbox, claim on reply, an
-- automation, a Flow, the public API), so the thread can show each
-- handoff between departments.
--
-- The actor is the signed-in user (auth.uid()). Service-role callers,
-- which have no user, name the actor through assign_conversation(),
-- which sets app.assignment_actor for its transaction. A change with
-- neither (an automation or Flow) is recorded with no actor.
-- ============================================================

CREATE TABLE IF NOT EXISTS conversation_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  from_agent_id UUID,
  to_agent_id UUID,
  actor_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversation_assignments_conversation
  ON conversation_assignments (conversation_id, created_at);

ALTER TABLE conversation_assignments ENABLE ROW LEVEL SECURITY;

-- Readable by whoever can see the chat: the lookup below is itself
-- filtered by the conversations policy (047). Rows are written only by
-- the trigger, so there is no insert/update policy.
DROP POLICY IF EXISTS conversation_assignments_select ON conversation_assignments;
CREATE POLICY conversation_assignments_select ON conversation_assignments FOR SELECT USING (
  EXISTS (SELECT 1 FROM conversations c WHERE c.id = conversation_assignments.conversation_id)
);

CREATE OR REPLACE FUNCTION record_conversation_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.assigned_agent_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_actor := COALESCE(
    auth.uid(),
    NULLIF(current_setting('app.assignment_actor', true), '')::UUID
  );

  INSERT INTO conversation_assignments
    (account_id, conversation_id, from_agent_id, to_agent_id, actor_user_id)
  VALUES (
    NEW.account_id,
    NEW.id,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.assigned_agent_id END,
    NEW.assigned_agent_id,
    v_actor
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_record_conversation_assignment ON conversations;
CREATE TRIGGER trg_record_conversation_assignment
  AFTER INSERT OR UPDATE OF assigned_agent_id ON conversations
  FOR EACH ROW EXECUTE FUNCTION record_conversation_assignment();

-- Assigns a chat and names who did it. Runs as the caller (RLS applies
-- to signed-in users; for them auth.uid() wins over p_actor_id, so the
-- actor cannot be spoofed). With p_only_if_unassigned, a chat someone
-- else already took is left alone ("claim on reply").
-- Returns { changed, from_agent_id, contact_id }.
CREATE OR REPLACE FUNCTION assign_conversation(
  p_account_id UUID,
  p_conversation_id UUID,
  p_agent_id UUID,
  p_actor_id UUID DEFAULT NULL,
  p_only_if_unassigned BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_from UUID;
  v_contact UUID;
BEGIN
  PERFORM set_config('app.assignment_actor', COALESCE(p_actor_id::TEXT, ''), true);

  SELECT assigned_agent_id, contact_id INTO v_from, v_contact
  FROM conversations
  WHERE id = p_conversation_id AND account_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_from IS NOT DISTINCT FROM p_agent_id
     OR (p_only_if_unassigned AND v_from IS NOT NULL) THEN
    RETURN jsonb_build_object('changed', false, 'from_agent_id', v_from, 'contact_id', v_contact);
  END IF;

  UPDATE conversations
  SET assigned_agent_id = p_agent_id, updated_at = now()
  WHERE id = p_conversation_id AND account_id = p_account_id;

  RETURN jsonb_build_object('changed', true, 'from_agent_id', v_from, 'contact_id', v_contact);
END;
$$;

REVOKE ALL ON FUNCTION assign_conversation(UUID, UUID, UUID, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assign_conversation(UUID, UUID, UUID, UUID, BOOLEAN) TO authenticated, service_role;
