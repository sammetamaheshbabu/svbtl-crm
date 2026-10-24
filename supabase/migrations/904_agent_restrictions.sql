-- ============================================================
-- 904 (SVBTL fork) — What agents may change
--
-- Owners and admins keep every right they had. For agents (and
-- viewers):
--   1. Broadcasts, automations and flows become read-only: changing
--      them, their recipients, steps or nodes needs admin. The engines
--      that run them use the service role, so live automations and
--      flows keep working.
--   2. Contacts: an agent sees a customer when the customer's chat is
--      theirs or unassigned, or the customer has no chat yet — the same
--      line the inbox draws (migration 900). Deleting a contact needs
--      admin; adding and editing stay open to agents.
--   3. Deleting a deal needs admin.
--   4. Notifications gain a 'handover_requested' type (inbox → New chat
--      → "Ask … to hand it over").
-- Re-runnable: every policy is dropped before it is created.
-- ============================================================

-- ---- 1. Broadcasts, automations, flows: admin to change ----------

DROP POLICY IF EXISTS broadcasts_insert ON broadcasts;
CREATE POLICY broadcasts_insert ON broadcasts FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS broadcasts_update ON broadcasts;
CREATE POLICY broadcasts_update ON broadcasts FOR UPDATE USING (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS broadcasts_delete ON broadcasts;
CREATE POLICY broadcasts_delete ON broadcasts FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS broadcast_recipients_modify ON broadcast_recipients;
CREATE POLICY broadcast_recipients_modify ON broadcast_recipients FOR ALL USING (
  EXISTS (SELECT 1 FROM broadcasts b WHERE b.id = broadcast_recipients.broadcast_id AND is_account_member(b.account_id, 'admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM broadcasts b WHERE b.id = broadcast_recipients.broadcast_id AND is_account_member(b.account_id, 'admin'))
);

DROP POLICY IF EXISTS automations_insert ON automations;
CREATE POLICY automations_insert ON automations FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS automations_update ON automations;
CREATE POLICY automations_update ON automations FOR UPDATE USING (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS automations_delete ON automations;
CREATE POLICY automations_delete ON automations FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS automation_steps_modify ON automation_steps;
CREATE POLICY automation_steps_modify ON automation_steps FOR ALL USING (
  EXISTS (SELECT 1 FROM automations a WHERE a.id = automation_steps.automation_id AND is_account_member(a.account_id, 'admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM automations a WHERE a.id = automation_steps.automation_id AND is_account_member(a.account_id, 'admin'))
);

DROP POLICY IF EXISTS flows_insert ON flows;
CREATE POLICY flows_insert ON flows FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS flows_update ON flows;
CREATE POLICY flows_update ON flows FOR UPDATE USING (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS flows_delete ON flows;
CREATE POLICY flows_delete ON flows FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS flow_nodes_modify ON flow_nodes;
CREATE POLICY flow_nodes_modify ON flow_nodes FOR ALL USING (
  EXISTS (SELECT 1 FROM flows f WHERE f.id = flow_nodes.flow_id AND is_account_member(f.account_id, 'admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM flows f WHERE f.id = flow_nodes.flow_id AND is_account_member(f.account_id, 'admin'))
);

-- ---- 2. Contacts: who sees whom, and who deletes ------------------

-- Runs as the owner so it sees every chat: under the caller's own
-- rights a chat owned by someone else would be invisible and the
-- customer would look as if they had no chat at all.
CREATE OR REPLACE FUNCTION public.can_see_contact(p_contact_id UUID, p_account_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_account_member(p_account_id, 'admin')
    OR NOT EXISTS (SELECT 1 FROM conversations c WHERE c.contact_id = p_contact_id)
    OR EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.contact_id = p_contact_id
        AND (c.assigned_agent_id IS NULL OR c.assigned_agent_id = auth.uid())
    );
$$;

REVOKE ALL ON FUNCTION public.can_see_contact(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_contact(UUID, UUID) TO authenticated;

DROP POLICY IF EXISTS contacts_select ON contacts;
CREATE POLICY contacts_select ON contacts FOR SELECT USING (
  is_account_member(account_id) AND can_see_contact(id, account_id)
);
DROP POLICY IF EXISTS contacts_delete ON contacts;
CREATE POLICY contacts_delete ON contacts FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ---- 3. Deals: admin to delete -----------------------------------

DROP POLICY IF EXISTS deals_delete ON deals;
CREATE POLICY deals_delete ON deals FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ---- 4. Handover requests as notifications -----------------------

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'handover_requested'));
