# SVBTL CRM — Customizations vs. upstream `wacrm`

This fork is based on **[ArnasDon/wacrm](https://github.com/ArnasDon/wacrm)**. This
document records **every change we made on top of upstream and why**, so that:

- a future fork can reproduce (or skip) each customization deliberately, and
- pulling upstream updates is safe — you know which files we touched and what to re-check.

| | |
|---|---|
| Upstream | `https://github.com/ArnasDon/wacrm` (remote: `upstream`) |
| This fork | `https://github.com/sammetamaheshbabu/svbtl-crm` (remote: `origin`) |
| Fork point (merge-base) | `27c6bdf` |
| Last reviewed | 2026-10-24 — fork is 16 commits (24 with merges) ahead of the fork point `27c6bdf` |

> **Scope.** This file documents **code** changes (tracked in git) plus the **deployment
> configuration** we rely on (not in git). It intentionally contains **no secrets** — tokens,
> keys, passwords and the DB connection string live only in `.env.local` / Vercel env.

---

## 1. Code customizations (tracked in git)

Diff them any time with:

```bash
git fetch upstream
git diff upstream/main...HEAD           # full patch of our divergence
git diff --stat upstream/main...HEAD    # just the file list
git log --oneline upstream/main..HEAD   # our commits
```

Files we changed vs upstream (55, not counting this file; section letter in brackets):

```
.gitignore                                                    [E]
docs/security-and-backup.md                                   [E]
messages/en.json                                              [A, I, J, K, L]
messages/es.json, ko.json, pt.json                            [I, J, K, L]
src/app/(auth)/login/page.tsx                                 [B, L]
src/app/(auth)/reset-password/page.tsx                        [L]
src/app/(auth)/signup/page.tsx                                [B, L]
src/app/(dashboard)/inbox/page.tsx                            [J]
src/app/(dashboard)/settings/page.tsx                         [C]
src/app/layout.tsx                                            [A]
src/app/api/conversations/[conversationId]/assign/route.ts    [I]  new
src/app/api/v1/conversations/[id]/assignments/route.ts        [I]  new
src/app/api/v1/conversations/[id]/messages/route.ts           [G]
src/app/api/v1/conversations/[id]/route.ts                    [I]  new
src/app/api/v1/conversations/route.ts                         [H]
src/app/api/v1/members/route.ts                               [I]  new
src/app/api/v1/messages/route.ts                              [G, H, J]
src/app/api/v1/quick-replies/route.ts (+ route.test.ts)       [K]  new
src/app/api/whatsapp/send/route.ts (+ route.test.ts)          [G, H, I, J]
src/components/contacts/contact-detail-view.tsx               [J]
src/components/inbox/conversation-list.tsx                    [J]
src/components/inbox/message-bubble.tsx                       [G]
src/components/inbox/message-composer.tsx                     [D, K]
src/components/inbox/message-thread.tsx                       [G, H, I, J, K]
src/components/inbox/new-chat-dialog.tsx                      [J]  new
src/components/inbox/quick-reply-picker.tsx                   [K]
src/components/inbox/template-picker.tsx                      [J]
src/components/settings/password-form.tsx                     [L]
src/components/settings/quick-replies-manager.tsx             [K]
src/components/settings/settings-rail.tsx                     [C]
src/components/settings/settings-sections.ts                  [C]
src/components/ui/password-input.tsx                          [L]  new
src/lib/api/v1/conversations.ts (+ .test.ts)                  [F, G, H, I]
src/lib/api/v1/sender.ts (+ .test.ts)                         [G, H]  new
src/lib/conversations/assign.ts (+ .test.ts)                  [I]  new
src/lib/inbox/assignment-events.ts (+ .test.ts)               [I]  new
src/lib/quick-replies/placeholders.ts (+ .test.ts)            [K]  new
src/lib/webhooks/events.ts                                    [I]
src/lib/whatsapp/send-message.ts                              [G, H, I]
src/lib/whatsapp/send-message.assignment.test.ts              [H, I]  new
src/lib/whatsapp/start-chat.ts (+ .test.ts)                   [J]  new
supabase/migrations/047_agent_conversation_visibility.sql     [H]  new
supabase/migrations/048_conversation_assignments.sql          [I]  new
supabase/migrations/049_contact_whatsapp_opt_in.sql           [J]  new
```

### A. Branding → "SVBTL CRM"
**Commits:** `57fcc9e`, `31b7b8f`
**Files:** `src/app/layout.tsx`, `messages/en.json`

- `layout.tsx` — page `<title>` default `"SVBTL CRM"`, template `"%s — SVBTL CRM"`.
- `messages/en.json` — `Sidebar.title`, `SignupPage.desc`, `Metadata.description` changed from
  "CRM Template for WhatsApp" to SVBTL branding.

**Why:** white-label the template as SVB Tech Labs' own product rather than the generic
upstream name.
**Upstream-merge risk:** *Low.* String/metadata only. If upstream edits the same JSON keys,
re-apply our values after merge.

### B. Private / invite-only sign-up
**Commit:** `57fcc9e`
**Files:** `src/app/(auth)/signup/page.tsx`, `src/app/(auth)/login/page.tsx`

- `signup/page.tsx` — the signup form is gated behind a **valid invite token**. With no token
  it renders an "invite-only" notice instead of the form; with a token it validates via the
  existing `GET /api/invitations/<token>/peek` before showing the form.
- `login/page.tsx` — the public "Create account" link is shown **only** when the visitor
  arrived via an invite link.

**Why:** upstream allows open self-registration, where every signup becomes the **owner of a
new, isolated workspace**. We need the CRM restricted to SVB staff.
**Deliberate non-change:** we did **not** disable Supabase sign-ups, because the team-invite
flow reuses the **same `supabase.auth.signUp()`** path (`/signup?invite=<token>`). Disabling it
would break invites. The gate is therefore at the UI/invite layer.
**Residual risk (accepted):** the public Supabase publishable key still technically permits a
direct API-level `signUp`, which would create an **empty, RLS-isolated** workspace with zero
access to SVB data.
**Upstream-merge risk:** *Medium.* Auth pages are core; watch for conflicts. Reuses upstream's
own invite/peek endpoint, so no new backend surface.

### C. RBAC — hide admin-only settings from agents/viewers
**Commit:** `c49d331`
**Files:** `settings-sections.ts`, `settings-rail.tsx`, `settings/page.tsx`

- `settings-sections.ts` — added an `adminOnly?: boolean` flag to `SectionMeta` + an
  `isAdminOnlySection()` helper; marked **whatsapp, fields, deals, members, api** as
  `adminOnly: true`.
- `settings-rail.tsx` — filters admin-only sections out of the rail via `useCan('edit-settings')`.
- `settings/page.tsx` — deep-link guard: a non-admin hitting `?tab=whatsapp` lands on **Overview**
  instead of the admin panel.

**Why:** agents are telecalling / chat-support staff who must not see WhatsApp credentials, API
keys, team management, or account-wide fields/deals.
**Note:** this is a **UI/visibility** hardening. Writes to those settings were already
RLS-/route-gated to admin+ upstream, and the WhatsApp access token is never sent to the browser.
A deeper change (locking the `whatsapp_config` SELECT to admins) was **not** done because the
inbox reply path reads that row under the agent's RLS session — locking it would break agent
replies.
**Upstream-merge risk:** *Medium.* Settings IA may evolve upstream; re-check the section list and
the `adminOnly` tagging after a merge.

### D. Mobile inbox composer
**Commits:** `78323a1`, `ea62f1a`; reworked on branch `mobile-composer` (2026-10-24)
**Files:** `src/components/inbox/message-composer.tsx`, `quick-reply-picker.tsx`,
`message-bubble.tsx`, `message-media.tsx`, `messages/*.json` (`Inbox.composer`)

- One row: ⊕, message box, Send. When the composer itself is narrower than 36rem (a phone, or a
  desktop thread between the list and the contact panel — a `@container` query, not the screen
  width), every action (photo, video, document, voice note, quick replies, templates,
  buttons/list, AI draft) lives in one sheet opened by ⊕: from the bottom on phones, a centred
  card on wider screens. Wider composers keep the inline buttons.
- The message box: 16px text on phones (no iOS zoom), hidden scrollbar, a short placeholder;
  the Enter / Shift+Enter hint is a tooltip on mouse devices. The "Tap ✨ to draft a reply" line
  under the box is gone.
- Bubbles are capped to their row and a document's file name truncates, so a long name no
  longer scrolls the thread sideways.
- Enter-to-send is gated to **fine-pointer** devices via `matchMedia('(pointer: fine)')`. On
  touch devices Enter inserts a **newline** and the Send button is the only way to send.

**Why:** upstream's composer squeezed the input on narrow screens, and Enter always sent — so
phone users couldn't add line breaks (no practical Shift+Enter on a phone).
**Upstream-merge risk:** *Medium–High.* The composer is actively developed upstream, so this file
is the most likely to conflict.
**Upstreamed:** submitted as **[ArnasDon/wacrm#656](https://github.com/ArnasDon/wacrm/pull/656)**.
If/when it's merged, pull it from upstream and **drop this customization** to remove the drift.

### E. Secret-leak hardening + ops docs
**Commits:** `57fcc9e`, `31b7b8f`
**Files:** `.gitignore`, `docs/security-and-backup.md`

- `.gitignore` — also ignore `*-credentials.env`, `atlas-credentials.env`, `supabase/.temp/`.
- `docs/security-and-backup.md` — a new operational checklist (secrets, HTTPS, RBAC, Supabase
  backups/restore, logging, incident response). New file; see it for the running ops checklist.

**Why:** prevent accidental secret commits; document how to run the deployment safely.
**Upstream-merge risk:** *None/Low* (additive).

### F. Public API: interactive message options
**Commits:** `b81c75a` (merged as `70cdd71`, 2026-10-17)
**File:** `src/lib/api/v1/conversations.ts`

- Each message in `GET /api/v1/conversations/{id}/messages` now has an `interactive` field.
  For an interactive message it is `{ kind: "buttons" | "list", body, options: [{ id, title }] }`:
  the buttons, or the rows of a list flattened into one array. For every other message it is `null`.
- The field is stored as `interactive_payload` in the database; the public API previously dropped it.
- Existing consumers are not affected: the field is additive.

**Why:** the SVB mobile app shows the buttons an automated message offered, so agents on the phone
see the same options as in the web inbox. The web already reads the payload from the database
directly; the public API did not expose it.
**Tests:** `conversations.test.ts` covers button messages, list rows flattened into options, a null
`interactive` for other messages, and the `interactive_reply_id` on a customer's tap.
**Upstream-merge risk:** *Low–Medium.* The serializer is small. If upstream changes `ApiMessage` or
`serializeMessage`, keep the new field and its type.
**Consumer:** the mobile app in the `SVB-CRM-APP` repository reads this field.

### G. Who sent each reply (sender names)
**Commits:** `52849c7`, `bb178f4` (branch `message-sender`, merged as `5b48072`, 2026-10-19)
**Files:** `src/lib/whatsapp/send-message.ts`, `src/app/api/whatsapp/send/route.ts`,
`src/app/api/v1/messages/route.ts`, `src/lib/api/v1/sender.ts`, `src/lib/api/v1/conversations.ts`,
`src/app/api/v1/conversations/[id]/messages/route.ts`, `src/components/inbox/message-bubble.tsx`,
`src/components/inbox/message-thread.tsx`

- Sends from the web inbox now record the signed-in agent in `messages.sender_id` (the column existed
  but nothing set it).
- `POST /api/v1/messages` accepts an optional `sender_user_id`. It must be a member of the key's
  account (checked in `profiles`); anything else is a 400 that names `sender_user_id`.
- `GET /api/v1/conversations/{id}/messages` adds `sender_name` to each message: the team member's
  `full_name` for our own messages, otherwise `null`. The id itself is not exposed.
- The inbox bubble names the sender on a line at the top of our messages, like a WhatsApp group.

**Why:** replies sent from the SVB mobile app went through the shared API key, so the inbox could
not tell which team member replied.
**Tests:** `sender.test.ts` (validation and name lookup) and `conversations.test.ts` (`sender_name`).
**Upstream-merge risk:** *Medium.* Touches the shared send path and the bubble footer. If upstream
changes `sendMessage`, keep passing `senderId` through to the insert.
**Consumer:** the mobile app's backend sends `sender_user_id`; the app shows `sender_name`.

### H. Agents see their own and unassigned chats; claim on reply
**Commit:** `b0a6af7` (branch `agent-visibility`, merged as `f765022`, 2026-10-19)
**Files:** `supabase/migrations/047_agent_conversation_visibility.sql`, `src/lib/whatsapp/send-message.ts`,
`src/app/api/whatsapp/send/route.ts`, `src/app/api/v1/messages/route.ts`, `src/lib/api/v1/sender.ts`,
`src/app/api/v1/conversations/route.ts`, `src/lib/api/v1/conversations.ts`,
`src/components/inbox/message-thread.tsx`

- **Visibility (migration 047):** the `conversations` RLS policies now let owners and admins see
  every chat, and agents and viewers only chats assigned to them or unassigned. Messages and
  reactions follow automatically, since their policies look the conversation up. An agent may still
  hand a chat they can see to someone else (separate `WITH CHECK`).
- **Claim on reply:** when an agent (or viewer) replies to an unassigned chat, the chat is assigned
  to them, only if still unassigned (`claimConversation`). Owners and admins never claim. An agent
  sending into someone else's chat gets a 403 "assigned to someone else".
- `POST /api/v1/messages`: the sender's role comes from `sender_user_id`; the response adds
  `assigned_to_sender`. The dashboard send returns `claimed`, and the thread updates the assignee.
- `GET /api/v1/conversations` accepts `?assigned_to=<user id>` and `&include_unassigned=true`.

**Why:** each department (Studio, web and Android, EduSMS) has its own agent; agents should see
only their chats plus unassigned ones, while admins see everything. Department assignment itself is
configured in Automations ("Tag added" → "Assign conversation"), not in code.
**Tests:** `send-message.assignment.test.ts` (who may send, claim), `sender.test.ts` (role),
`conversations.test.ts` (`assignmentFilter`).
**Upstream-merge risk:** *High.* Changes RLS on a core table and the shared send path. If upstream
changes `conversations` policies, re-apply the agent rule on top of theirs.
**Applying the migration:** run 047 in the Supabase SQL editor (the schema is otherwise
upstream's). It is safe to run before or after the code deploys.
**Consumer:** the mobile app's backend filters chats the same way for agents.

### I. Handoff history and handing chats over
**Commit:** `5b97baf` (branch `handoff-history`, merged as `67e52d5`, 2026-10-19)
**Files:** `supabase/migrations/048_conversation_assignments.sql`, `src/lib/conversations/assign.ts`,
`src/app/api/conversations/[conversationId]/assign/route.ts`, `src/lib/inbox/assignment-events.ts`,
`src/components/inbox/message-thread.tsx`, `src/lib/whatsapp/send-message.ts`, `src/lib/api/v1/conversations.ts`,
`src/app/api/v1/conversations/[id]/route.ts` (PATCH), `src/app/api/v1/conversations/[id]/assignments/route.ts`,
`src/app/api/v1/members/route.ts`, `src/lib/webhooks/events.ts`, `messages/*.json` (`Inbox.handoff`)

- **History (migration 048):** a trigger records every change of `assigned_agent_id` in
  `conversation_assignments` (from, to, who did it, when), whichever path made it. Readable by
  whoever can see the chat. `assign_conversation()` assigns and names the actor for service-role
  callers (it sets `app.assignment_actor` for its transaction); signed-in users are named by
  `auth.uid()`, so the actor cannot be spoofed.
- **Thread:** handoffs show between messages ("Manas handed this chat to Mehveen · 16:40").
- **Assigning:** the inbox's assignee picker now posts to `/api/conversations/{id}/assign` instead
  of updating the row from the browser, so the handoff is recorded and announced. Claim on reply
  uses the same function.
- **Webhook `conversation.assigned`:** sent when a person (inbox, API, claim) changes the assignee,
  with `from_agent_id`, `to_agent_id`, `actor_user_id`, `actor_name`, `contact_name`. Automations
  and Flows are recorded in the history but send no webhook (the customer's message alerts already).
- **Public API:** `PATCH /api/v1/conversations/{id}` `{assigned_agent_id, actor_user_id?}`
  (scope `messages:send`: handing over is part of working the inbox, and existing keys cannot gain
  a new scope), `GET /api/v1/conversations/{id}/assignments`, `GET /api/v1/members`.

**Why:** chats move between departments (Studio → EduSMS); everyone on the team can hand one over,
the new owner is alerted on their phone, and the chat keeps a record of each handoff.
**Tests:** `assign.test.ts`, `assignment-events.test.ts`, `send-message.assignment.test.ts`.
**Upstream-merge risk:** *Medium.* New table and function; the assignee picker and the send path
call them. If upstream changes the picker, keep it going through the assign route.
**Applying the migration:** run 048 in the Supabase SQL editor **before** deploying this code — the
assignee picker and claim on reply call `assign_conversation()`.
**Consumer:** the mobile app shows the history, assigns from the chat, and alerts the new owner.

### J. New chat: message a new number with a template
**Branch:** `new-chat-quick-replies` (2026-10-24)
**Files:** `supabase/migrations/049_contact_whatsapp_opt_in.sql`, `src/lib/whatsapp/start-chat.ts`,
`src/app/api/whatsapp/send/route.ts`, `src/components/inbox/new-chat-dialog.tsx`,
`src/components/inbox/conversation-list.tsx`, `src/app/(dashboard)/inbox/page.tsx`,
`src/components/inbox/template-picker.tsx`, `src/components/inbox/message-thread.tsx`,
`src/components/contacts/contact-detail-view.tsx`, `src/app/api/v1/messages/route.ts`,
`messages/*.json` (`Inbox.newChat`, `Api.send`)

- **Inbox → New chat** (next to the search box, for anyone who can send): country code (+91 by
  default), mobile number, optional name, and a required tick "This customer agreed to receive
  WhatsApp messages from SVB Tech Labs". Then the usual template picker: approved templates only,
  variables filled in. The new chat opens in the inbox.
- **Send route:** `POST /api/whatsapp/send` takes `phone` (+ `name`, `opt_in_confirmed`) besides
  `conversation_id` / `contact_id`. Only `message_type: 'template'` on this path. `resolveStartChat`
  checks the number, the opt-in and the assignee on the service role, then reuses
  `resolveConversationByPhone`, so an existing customer's number goes into their existing chat and
  their name is kept. An agent can't start a chat another member is handling (403 naming them);
  a new chat an agent starts is claimed by them, as with any reply. The response now includes
  `conversation_id` on every path.
- **Opt-in (migration 049):** `contacts.whatsapp_opt_in_at` / `whatsapp_opt_in_by`, set after a
  successful send, first confirmation only. Once recorded the dialog shows "Opt-in recorded on …"
  instead of the tick. `POST /api/v1/messages` takes `opt_in_confirmed: true` and records it the
  same way (by `sender_user_id`, if given).
- **Media headers:** the template picker asks for a link to the header image/video/document when
  the template has none stored (true of templates synced from Meta), in the inbox, Contact detail
  and New chat alike.
- Also fixed: an agent sending a template from Contact detail to a customer whose chat belongs to
  someone else got a 500; now a 403 "assigned to someone else".
- Also fixed: below the desktop breakpoint a long message preview widened the conversation list
  past the screen (pushing the New chat button out of view); the list pane now has `min-w-0`.
- Meta's sample `hello_world` template shows as approved but Meta refuses it from a live number
  ("only from the Public Test Numbers"); use one of our own templates.

**Why:** the team can only reply today; they need to reach a new customer first. Meta allows only
an approved template as the first message, and requires the customer's opt-in.
**Tests:** `start-chat.test.ts` (number, opt-in, assignee, name kept), `send/route.test.ts` (phone
path: template only, opt-in recorded, refusal before Meta).
**Upstream-merge risk:** *Medium.* Adds a path to the send route and a field to the template picker;
if upstream changes either, keep `phone` going through `resolveStartChat`.
**Applying the migration:** run 049 in the Supabase SQL editor **before** deploying this code — the
send route writes the new columns.
**Consumer:** the mobile app can start chats through `POST /api/v1/messages` with `to` + a
template, passing `opt_in_confirmed`.

### K. Quick replies: "/" search, {name}, public API
**Branch:** `new-chat-quick-replies` (2026-10-24)
**Files:** `src/components/inbox/message-composer.tsx`, `src/components/inbox/quick-reply-picker.tsx`,
`src/components/inbox/message-thread.tsx`, `src/components/settings/quick-replies-manager.tsx`,
`src/lib/quick-replies/placeholders.ts`, `src/app/api/v1/quick-replies/route.ts`,
`messages/*.json` (`Inbox.composer`, `Settings.quickReplies`)

Upstream already had quick replies (table `quick_replies`, Settings → Quick replies, and an entry in
the composer's unlabelled "+" menu). The table was empty and the entry hard to find, so:

- **Composer:** a Quick replies button (⚡) beside the template button, and typing `/` at the start
  of the message opens a list filtered as you type (↑/↓, Enter or Tab inserts, Esc closes). The
  picker dialog has a search box. Quick replies are free text, so like typing they're unavailable
  once the 24-hour window has closed.
- **Placeholders:** `{name}` and `{first_name}` are filled from the contact when inserted; with no
  name (or only a phone number) they're dropped and the sentence tidied. Settings shows the hint.
- **Public API:** `GET /api/v1/quick-replies` (scope `messages:read`, since existing keys can't gain
  a new scope) lists `{ id, title, kind, content_text, interactive_payload, updated_at }`;
  `?contact_id=` returns `content_text` filled for that customer.

**Why:** agents retype the same answers; the mobile app should offer the same replies.
**Tests:** `placeholders.test.ts`, `v1/quick-replies/route.test.ts`.
**Upstream-merge risk:** *Medium.* The composer is actively changed upstream (see D).
**Consumer:** the mobile app lists quick replies from the API.

### L. Show / hide password
**Branch:** `new-chat-quick-replies` (2026-10-24)
**Files:** `src/components/ui/password-input.tsx`, `src/app/(auth)/login/page.tsx`,
`signup/page.tsx`, `reset-password/page.tsx`, `src/components/settings/password-form.tsx`,
`messages/*.json` (`UiPrimitives.showPassword` / `hidePassword`)

- `PasswordInput` wraps `Input` with an eye button that switches the field between hidden and
  visible text. Every password field (login, sign-up, reset, Settings → change password) uses it.

**Why:** staff asked to check what they typed before signing in.
**Upstream-merge risk:** *Low.* If upstream edits an auth page, keep its password field a
`PasswordInput`.

---

## 2. Deployment configuration (NOT in git — recreate per deployment)

These are **not** code changes; they're how this instance is wired. A fresh fork must set its own.

- **Messaging:** official **Meta WhatsApp Cloud API** (not an unofficial WhatsApp-Web bridge).
  A dedicated Meta app + a **permanent System-User token** (scopes `whatsapp_business_messaging`
  + `whatsapp_business_management`) with the **WhatsApp Business Account assigned as an asset**.
  Business Verification completed and the app Published.
- **Env vars** (names only — values in `.env.local` / Vercel, see `.env.local.example`):
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `ENCRYPTION_KEY`, `META_APP_SECRET`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_APP_LOCALE`.
- **Supabase:** schema is **upstream's migrations, plus our `047_agent_conversation_visibility.sql`, `048_conversation_assignments.sql` and `049_contact_whatsapp_opt_in.sql`** (run by hand in the SQL editor). Deployment-specific config:
  Auth → URL Configuration → **Site URL = the production domain** + Redirect URLs (so confirmation
  / reset emails don't fall back to `localhost`).
- **Hosting:** Vercel, custom domain behind Cloudflare. `NEXT_PUBLIC_*` are inlined at build, so a
  change to them requires a redeploy.

## 3. Account data (NOT in git — lives in the database)

Created through the running app, stored in Supabase (per-account rows), **not** version-controlled:

- **Automations** — a keyword-driven menu tree (greeting → category → product/service → tag +
  acknowledgment). Interactive list/button payloads must respect WhatsApp limits (section/row
  titles ≤ 24 chars, ≤ 10 list rows, ≤ 3 buttons, button labels ≤ 20/25 chars).
- **Message templates** — Utility-category templates submitted to Meta for approval.
- **Quick replies** — 12 starter text replies seeded on 2026-10-24 (Greeting, Ask for details,
  Studio / App & website / AIoT / EduSMS enquiry, Quote coming, Offer a call back, Offer a live
  demo, Checking with team, Follow-up, Thank you), several using `{name}`. Edit them in
  Settings → Quick replies.

A fresh deployment recreates these in the UI (or via a seed script if one is added later).

---

## 4. Pulling updates from upstream

```bash
git fetch upstream
git log --oneline HEAD..upstream/main      # what's new upstream
git merge upstream/main                     # or: git rebase upstream/main
```

After merging, **re-check the medium/high-risk files** from Section 1 — in likelihood order:

1. `supabase/migrations/` (H, I, J) — if upstream adds a migration numbered 047–049, renumber ours,
   and if it changes the `conversations` policies, re-apply the agent rule on top of theirs.
2. `src/lib/whatsapp/send-message.ts` and `src/app/api/whatsapp/send/route.ts` (G, H, I, J) — keep
   `senderId`, the who-may-send check, claim on reply, and the `phone` path.
3. `src/components/inbox/message-composer.tsx` (D, K) — most actively changed upstream; keep the
   mobile layout, the Quick replies button and the "/" list.
4. `src/components/inbox/message-thread.tsx`, `message-bubble.tsx` (G, H, I) — sender name, handoff
   lines, and the assignee picker going through `/api/conversations/{id}/assign`.
5. `src/app/(auth)/signup/page.tsx`, `login/page.tsx` (B).
6. `src/components/settings/*` and `settings/page.tsx` (C).
7. `src/lib/api/v1/conversations.ts` and the v1 routes (F, G, H, I) — confirm `interactive`,
   `sender_name` and the assignment filter are still returned.
8. `messages/*.json`, `src/app/layout.tsx` (A, I, J, K) — confirm branding, `Inbox.handoff`,
   `Inbox.newChat` and the quick-reply strings survived.
9. `src/components/inbox/template-picker.tsx`, `conversation-list.tsx` (J) — the header media link
   and the New chat button.

Then verify:

```bash
npm run typecheck && npm run lint && npm run build && npm test
```

and smoke-test: invite-only signup gate, agent cannot see admin settings tabs, the mobile
composer (newline on Enter + full-width input), an agent sees only their own and unassigned chats,
replying to an unassigned chat claims it, our replies show the sender's name, handing a chat
over shows a handoff line in the thread, New chat sends a template to a typed number and records
the opt-in, and typing "/" in the composer lists quick replies with the name filled in. If a customization has since landed upstream,
drop ours to reduce drift.
