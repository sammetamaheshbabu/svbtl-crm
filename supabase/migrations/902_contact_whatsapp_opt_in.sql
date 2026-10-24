-- ============================================================
-- 902 (SVBTL fork; was 049) — Record a contact's WhatsApp opt-in
--
-- Meta requires a customer's permission before a business messages
-- them first. When a team member starts a chat by typing a number
-- (inbox → New chat), they confirm the customer agreed, and we keep
-- who confirmed it and when.
--
-- Both columns stay NULL for contacts who wrote to us first. The
-- existing contacts policies cover reads and writes.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
