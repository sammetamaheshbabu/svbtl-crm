-- ============================================================
-- 906 (SVBTL fork) — Callback reminders: who to ring back, when, and why
--
-- Telecallers end calls on a promise — "call me back by 5:30", "get back
-- to me after three days". Until now the only way to record that was to
-- move a Follow-up tag by hand, which carries no time and tells nobody,
-- so the promise lived in the agent's head and customers went quiet.
--
-- A reminder belongs to the agent who made it: they are the one who gave
-- their word, so they are the one notified. Owners and admins can see
-- everyone's, the same rule migrations 900 and 904 already apply to
-- conversations and contacts. There is no unassigned reminder, so the
-- "IS NULL" arm those policies carry has no counterpart here.
--
-- remind_at is the absolute instant. remind_at_tz records the zone the
-- agent picked it in, so a reminder set as "5:30 pm" still reads as
-- 5:30 pm to a colleague whose laptop is on another clock — the same
-- reason the time_of_day automation condition stores its own timezone.
--
-- notification_title is composed and stored when the reminder is
-- created, because the job below runs with no request context and every
-- user-facing string has to come from messages/*.json. A title built by
-- concatenating in SQL could never be translated.
--
-- Re-runnable: every policy is dropped before it is created, and the
-- schedule is replaced rather than added to.
-- ============================================================

CREATE TABLE IF NOT EXISTS contact_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  -- Lets the notification deep-link straight into the chat. Nullable so a
  -- reminder outlives a deleted conversation.
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  -- The agent who set it: owner, and the one notified.
  agent_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  remind_at TIMESTAMPTZ NOT NULL,
  remind_at_tz TEXT NOT NULL DEFAULT 'UTC',
  notification_title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'notified', 'done', 'cancelled')),
  notified_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The drain index for the job below, mirroring idx_automation_pending_due.
CREATE INDEX IF NOT EXISTS idx_contact_reminders_due
  ON contact_reminders (remind_at) WHERE status = 'pending';

-- The Callbacks page: one agent's list, newest deadline first.
CREATE INDEX IF NOT EXISTS idx_contact_reminders_agent
  ON contact_reminders (account_id, agent_id, status, remind_at);

-- The contact panel reads every reminder for one customer.
CREATE INDEX IF NOT EXISTS idx_contact_reminders_contact
  ON contact_reminders (contact_id, remind_at);

ALTER TABLE contact_reminders ENABLE ROW LEVEL SECURITY;

-- Admins and owners see every reminder; an agent sees only their own.
DROP POLICY IF EXISTS contact_reminders_select ON contact_reminders;
CREATE POLICY contact_reminders_select ON contact_reminders FOR SELECT USING (
  is_account_member(account_id, 'admin')
  OR (is_account_member(account_id) AND agent_id = auth.uid())
);

-- Setting a reminder is operational work, so agents may do it (viewers
-- may not). agent_id = auth.uid() stops anyone filing work under someone
-- else's name — reminders are deliberately not assignable.
DROP POLICY IF EXISTS contact_reminders_insert ON contact_reminders;
CREATE POLICY contact_reminders_insert ON contact_reminders FOR INSERT WITH CHECK (
  is_account_member(account_id, 'agent') AND agent_id = auth.uid()
);

-- Marking done, rescheduling, cancelling: your own, or an admin's reach.
DROP POLICY IF EXISTS contact_reminders_update ON contact_reminders;
CREATE POLICY contact_reminders_update ON contact_reminders FOR UPDATE USING (
  is_account_member(account_id, 'admin')
  OR (is_account_member(account_id, 'agent') AND agent_id = auth.uid())
);

DROP POLICY IF EXISTS contact_reminders_delete ON contact_reminders;
CREATE POLICY contact_reminders_delete ON contact_reminders FOR DELETE USING (
  is_account_member(account_id, 'admin')
  OR (is_account_member(account_id, 'agent') AND agent_id = auth.uid())
);

-- ---- Notifications: a third kind -----------------------------------
-- The whitelist is a CHECK, not an enum, so it is dropped and rebuilt
-- with every value. 904 owns the previous version; this supersedes it,
-- so 904 has to have been applied first.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'handover_requested', 'reminder_due'));

-- ---- The job that makes a reminder go off ---------------------------
-- Claims and notifies in one statement. The UPDATE ... RETURNING is the
-- claim: a row leaves 'pending' in the same statement that notifies on
-- it, so two overlapping runs cannot both pick it up — the same
-- compare-and-set claimPendingExecution() uses for automations.
--
-- SECURITY DEFINER because clients cannot write notifications at all:
-- migration 027 grants them UPDATE (read_at) and nothing more.
CREATE OR REPLACE FUNCTION public.notify_due_reminders()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH due AS (
    UPDATE contact_reminders
    SET status = 'notified', notified_at = now(), updated_at = now()
    WHERE status = 'pending' AND remind_at <= now()
    RETURNING account_id, agent_id, conversation_id, contact_id,
              notification_title, reason
  ), inserted AS (
    INSERT INTO notifications
      (account_id, user_id, type, conversation_id, contact_id, title, body)
    SELECT account_id, agent_id, 'reminder_due', conversation_id, contact_id,
           notification_title, reason
    FROM due
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM inserted;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_due_reminders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_due_reminders() TO service_role;

-- Run it every five minutes. Guarded because pg_cron is not installed in
-- the throwaway Postgres that CI replays these migrations against, and
-- an unguarded cron.schedule() would fail the whole run. On the hosted
-- database, enable pg_cron once from the Supabase dashboard
-- (Database -> Extensions) and re-run this migration; until then
-- reminders are recorded and listed correctly but never fire.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notify-due-reminders') THEN
      PERFORM cron.unschedule('notify-due-reminders');
    END IF;
    PERFORM cron.schedule(
      'notify-due-reminders',
      '*/5 * * * *',
      'SELECT public.notify_due_reminders();'
    );
  ELSE
    RAISE NOTICE
      'pg_cron is not installed; enable it and re-run 906 or reminders will never fire';
  END IF;
END
$$;
