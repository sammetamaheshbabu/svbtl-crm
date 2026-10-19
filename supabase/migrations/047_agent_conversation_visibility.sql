-- ============================================================
-- 047 — Agents see their own chats and unassigned ones
--
-- Owners and admins keep seeing every conversation in the account.
-- Agents and viewers see a conversation only while it is unassigned
-- or assigned to them, so each department's chats stay with the
-- person handling them.
--
-- Messages and reactions need no change: their policies look the
-- conversation up, and that lookup is itself filtered by this policy.
-- Service-role paths (webhook, automations, public API) bypass RLS
-- as before.
-- ============================================================

DROP POLICY IF EXISTS conversations_select ON conversations;
CREATE POLICY conversations_select ON conversations FOR SELECT USING (
  is_account_member(account_id, 'admin')
  OR (
    is_account_member(account_id)
    AND (assigned_agent_id IS NULL OR assigned_agent_id = auth.uid())
  )
);

-- An agent may still hand a chat they can see to someone else, after
-- which they no longer see it; hence the separate, wider WITH CHECK.
DROP POLICY IF EXISTS conversations_update ON conversations;
CREATE POLICY conversations_update ON conversations FOR UPDATE
  USING (
    is_account_member(account_id, 'admin')
    OR (
      is_account_member(account_id, 'agent')
      AND (assigned_agent_id IS NULL OR assigned_agent_id = auth.uid())
    )
  )
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS conversations_delete ON conversations;
CREATE POLICY conversations_delete ON conversations FOR DELETE USING (
  is_account_member(account_id, 'admin')
  OR (
    is_account_member(account_id, 'agent')
    AND (assigned_agent_id IS NULL OR assigned_agent_id = auth.uid())
  )
);

CREATE INDEX IF NOT EXISTS idx_conversations_account_assigned
  ON conversations (account_id, assigned_agent_id);
