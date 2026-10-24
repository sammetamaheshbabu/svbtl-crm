# SVBTL CRM — Customizations vs. upstream `wacrm`

This fork is based on **[ArnasDon/wacrm](https://github.com/ArnasDon/wacrm)**. This document
records **every change we made on top of upstream, how it works and why**, so that:

- anyone on the team can see what SVBTL CRM does beyond the open-source original,
- a future fork can reproduce (or skip) each customization deliberately, and
- pulling upstream updates is safe — you know which files we touched and what to re-check.

| | |
|---|---|
| Upstream | `https://github.com/ArnasDon/wacrm` (remote: `upstream`) |
| This fork | `https://github.com/sammetamaheshbabu/svbtl-crm` (remote: `origin`) |
| Live site | `https://crm.svbtechlabs.com` — every push to `main` deploys on Vercel |
| Supabase project | `yiheffhkyinnwhqahhdl` (production) |
| Upstream merged up to | `34bce1a` (synced 2026-10-24; original fork point `27c6bdf`) |
| Our divergence | 20 commits, 72 files (32 new, 40 changed) + this document |
| Last reviewed | 2026-10-24, at `main` = `1c01455` |

> **Scope.** This file documents **code** changes (tracked in git), the **database migrations**
> we run by hand, the **deployment configuration** and the **account data** we rely on. It
> intentionally contains **no secrets** — tokens, keys, passwords and connection strings live
> only in `.env.local` / Vercel env.

---

## Contents

- [At a glance](#at-a-glance)
- [Who can do what](#who-can-do-what)
- [1. Code customizations](#1-code-customizations-tracked-in-git) — sections A–R
- [2. Database migrations](#2-database-migrations)
- [3. Public API changes (for the mobile app)](#3-public-api-changes-for-the-mobile-app)
- [4. Deployment configuration](#4-deployment-configuration-not-in-git--recreate-per-deployment)
- [5. Account data](#5-account-data-not-in-git--lives-in-the-database)
- [6. Known gaps and follow-ups](#6-known-gaps-and-follow-ups)
- [7. Pulling updates from upstream](#7-pulling-updates-from-upstream)
- [8. Change log](#8-change-log)

---

## At a glance

| | Customization | What staff see | Live since | DB | Merge risk |
|---|---|---|---|---|---|
| A | Branding | "SVBTL CRM" name and descriptions | 2026-10-14 | — | Low |
| B | Invite-only sign-up | No public sign-up; only invite links | 2026-10-14 | — | Medium |
| C | Admin-only settings | Agents don't see WhatsApp, API keys, team, fields, deals settings | 2026-10-14 | — | Medium |
| D | Mobile chat composer | One row: ⊕ / message box / Send; all actions in a pop-up | 2026-10-15, reworked 2026-10-24 | — | Medium–High |
| E | Secret hardening + ops docs | — (repo hygiene, ops checklist) | 2026-10-14 | — | Low |
| F | API: interactive options | Mobile app shows a message's buttons | 2026-10-17 | — | Low–Medium |
| G | Who sent each reply | Sender's name on top of our bubbles | 2026-10-19 | — | Medium |
| H | Agents see their own chats | Agents see only their own + unassigned chats; replying claims a chat | 2026-10-19 | 900 | High |
| I | Handoff history | "X handed this chat to Y" lines; anyone can hand over | 2026-10-19 | 901 | Medium |
| J | New chat by number | Message a new customer with a template; opt-in recorded | 2026-10-24 | 902 | Medium |
| K | Quick replies "/" search | ⚡ button, `/` search, `{name}` filled in | 2026-10-24 | — | Medium |
| L | Show / hide password | Eye button on every password field | 2026-10-24 | — | Low |
| M | Upstream sync guard | Dashboard lists respect agent visibility | 2026-10-24 | 903 | Medium |
| N | Edit contact from chat | Edit name/email/company/custom fields, add/remove tags in the chat | 2026-10-24 | — | Medium |
| O | Quick replies: image + fill-ins | Image header on button messages; `{{1}}`… asked when picking | 2026-10-24 | — | Medium |
| P | Media Library | Pick already-uploaded files instead of uploading again | 2026-10-24 | — | Low–Medium |
| Q | Agent restrictions | Broadcasts / automations / flows read-only; scoped contacts; New chat warns + "Ask to hand over" | pending | 904 | Medium–High |

## Who can do what

Roles are upstream's (`owner`, `admin`, `agent`, `viewer`). What our customizations add:

| Action | Owner / Admin | Agent | Viewer |
|---|---|---|---|
| See chats (H) | All chats | Own + unassigned | Own + unassigned (read-only) |
| Reply to a chat assigned to someone else (H) | Yes | No (403) | No |
| Claim a chat by replying (H) | No (never claims) | Yes, if unassigned | — |
| Hand a chat to someone (I) | Yes | Yes, any chat they can see | No |
| Start a New chat by number (J) | Yes | Yes (claims it); warned + "Ask to hand over" if another agent's (Q) | No |
| See contacts (Q) | All | Own + unassigned chats' customers + contacts with no chat | Same as agent |
| Add / edit a contact, incl. in the chat (N, Q) | Yes | Yes | No |
| Import contacts (CSV) / delete contacts (Q) | Yes | No | No |
| Create / edit deals; delete deals (Q) | Yes / Yes | Yes / No | No |
| Broadcasts, Automations, Flows (Q) | Full | Read-only (lists, stats, logs, runs) | Read-only |
| Templates (Q) | Create, edit, submit, delete, sync | View + **Sync from Meta** | View |
| Use / create quick replies (K, O) | Yes | Yes | No |
| Pick from / upload to the Media Library (P) | Yes | Yes | No |
| Admin-only settings (C) | Yes | Hidden | Hidden |
| Dashboard queue & failed-message lists (M) | All chats | Own + unassigned | Own + unassigned |

---

## 1. Code customizations (tracked in git)

Diff them any time with:

```bash
git fetch upstream
git diff upstream/main...HEAD           # full patch of our divergence
git diff --stat upstream/main...HEAD    # just the file list
git log --oneline upstream/main..HEAD   # our commits
```

### Files we changed vs upstream

72 files (not counting this one). Section letters in brackets; `new` = file doesn't exist upstream.

```
.gitignore                                                    [E]
docs/security-and-backup.md                                   [E]  new
messages/en.json                                              [A, I, J, K, L, N, O, P]
messages/es.json, ko.json, pt.json                            [I, J, K, L, N, O, P]
src/app/(auth)/login/page.tsx                                 [B, L]
src/app/(auth)/reset-password/page.tsx                        [L]
src/app/(auth)/signup/page.tsx                                [B, L]
src/app/(dashboard)/inbox/page.tsx                            [J, N]
src/app/(dashboard)/settings/page.tsx                         [C]
src/app/layout.tsx                                            [A]
src/app/api/conversations/[conversationId]/assign/route.ts    [I]  new
src/app/api/v1/conversations/[id]/assignments/route.ts        [I]  new
src/app/api/v1/conversations/[id]/messages/route.ts           [G]
src/app/api/v1/conversations/[id]/route.ts                    [I]  (PATCH added)
src/app/api/v1/conversations/route.ts                         [H]
src/app/api/v1/members/route.ts                               [I]  new
src/app/api/v1/messages/route.ts                              [G, H, J]
src/app/api/v1/quick-replies/route.ts (+ route.test.ts)       [K]  new
src/app/api/whatsapp/send/route.ts (+ route.test.ts)          [G, H, I, J]
src/components/broadcasts/step3-personalize.tsx               [P]
src/components/contacts/contact-detail-view.tsx               [J]
src/components/inbox/contact-sidebar.tsx                      [N]
src/components/inbox/conversation-list.tsx                    [J]
src/components/inbox/message-bubble.tsx                       [D, G]
src/components/inbox/message-composer.tsx                     [D, K, O, P]
src/components/inbox/message-media.tsx                        [D]
src/components/inbox/message-thread.tsx                       [G, H, I, J, K, N, P]
src/components/inbox/new-chat-dialog.tsx                      [J]  new
src/components/inbox/quick-reply-fill-dialog.tsx              [O]  new
src/components/inbox/quick-reply-picker.tsx                   [K, D]
src/components/inbox/template-picker.tsx                      [J, P]
src/components/interactive/interactive-builder.tsx            [O, P]
src/components/interactive/interactive-preview.tsx            [O]
src/components/media/media-library-dialog.tsx                 [P]  new
src/components/settings/password-form.tsx                     [L]
src/components/settings/quick-replies-manager.tsx             [K, O]
src/components/settings/settings-rail.tsx                     [C]
src/components/settings/settings-sections.ts                  [C]
src/components/ui/password-input.tsx                          [L]  new
src/lib/api/v1/conversations.ts (+ .test.ts)                  [F, G, H, I]
src/lib/api/v1/sender.ts (+ .test.ts)                         [G, H]  new
src/lib/auth/redeem-invitation-migration.test.ts              [M]
src/lib/contacts/save-profile.ts (+ .test.ts)                 [N]  new
src/lib/conversations/assign.ts (+ .test.ts)                  [I]  new
src/lib/dashboard/agent-scope-migration.test.ts               [M]  new
src/lib/inbox/assignment-events.ts (+ .test.ts)               [I]  new
src/lib/quick-replies/placeholders.ts (+ .test.ts)            [K, O]  new
src/lib/quick-replies/fill-payload.ts (+ .test.ts)            [O]  new
src/lib/storage/media-library.ts (+ .test.ts)                 [P]  new
src/lib/webhooks/events.ts                                    [I]
src/lib/whatsapp/interactive.ts                               [O]
src/lib/whatsapp/meta-api.ts                                  [O]
src/lib/whatsapp/send-message.ts                              [G, H, O]
src/lib/whatsapp/send-message.assignment.test.ts              [H, I]  new
src/lib/whatsapp/start-chat.ts (+ .test.ts)                   [J]  new
supabase/migrations/900_agent_conversation_visibility.sql     [H]  new (was 047)
supabase/migrations/901_conversation_assignments.sql          [I]  new (was 048)
supabase/migrations/902_contact_whatsapp_opt_in.sql           [J]  new (was 049)
supabase/migrations/903_dashboard_agent_scope.sql             [M]  new
supabase/migrations/904_agent_restrictions.sql                [Q]  new
```

Section Q (branch `agent-restrictions`) also touches: the automation / flow / broadcast API routes
and pages, `src/app/(dashboard)/contacts/page.tsx`, `src/components/contacts/contact-form.tsx`,
`src/components/pipelines/deal-form.tsx`, `src/components/settings/template-manager.tsx`,
`src/app/api/whatsapp/templates/sync/route.ts`, `src/components/inbox/new-chat-dialog.tsx`,
`src/app/(dashboard)/notifications/page.tsx`, `src/types/index.ts`, and adds
`src/components/auth/admin-only-route.tsx`, `src/lib/contacts/number-lookup.ts`,
`src/lib/conversations/handover-request.ts`, `src/app/api/contacts/lookup/route.ts`,
`src/app/api/conversations/[conversationId]/handover-request/route.ts` (+ tests).

**Fork migrations are numbered 900+.** Upstream kept adding 047, 048, 049, so ours moved to a
range it won't reach: they always sort (and run, on a fresh setup) after upstream's. A new fork
migration takes the next 90x number. See [section 2](#2-database-migrations).

**Strings.** Every user-facing string we add goes into all four language files
(`messages/en|es|ko|pt.json`). Literal braces such as `{name}` or `{{1}}` are passed in as
values (`t("key", { example: "{{n}}" })`), because next-intl reads `{…}` as a placeholder. The dev
server loads these files once at start: **restart `npm run dev` after editing them.**

---

### A. Branding → "SVBTL CRM"
**Commits:** `57fcc9e`, `31b7b8f` (2026-10-14)
**Files:** `src/app/layout.tsx`, `messages/en.json`

**What staff see:** the app is called "SVBTL CRM" in the sidebar, browser tab and sign-up text.

**How it works**
- `layout.tsx` — page `<title>` default `"SVBTL CRM"`, template `"%s — SVBTL CRM"`.
- `messages/en.json` — `Sidebar.title`, `SignupPage.desc`, `Metadata.description` changed from
  "CRM Template for WhatsApp" to SVBTL branding.

**Why:** white-label the template as SVB Tech Labs' own product rather than the generic upstream name.
**Not yet done:** 8 strings still say "wacrm" (e.g. the team invite message "Join … on wacrm") —
see [Known gaps](#6-known-gaps-and-follow-ups).
**Upstream-merge risk:** *Low.* String/metadata only. If upstream edits the same JSON keys,
re-apply our values after merge.

### B. Private / invite-only sign-up
**Commit:** `57fcc9e` (2026-10-14)
**Files:** `src/app/(auth)/signup/page.tsx`, `src/app/(auth)/login/page.tsx`

**What staff see:** `/signup` without an invite shows an "invite-only" notice; the "Create account"
link appears on the login page only for someone who arrived through an invite link.

**How it works**
- `signup/page.tsx` — the form is gated behind a **valid invite token**, validated with upstream's
  existing `GET /api/invitations/<token>/peek` before the form is shown.
- `login/page.tsx` — the public sign-up link is shown only with an invite in the URL.

**Why:** upstream allows open self-registration, where every sign-up becomes the **owner of a new,
isolated workspace**. The CRM must be restricted to SVB staff.
**Deliberate non-change:** Supabase sign-ups are **not** disabled, because the team-invite flow
reuses the same `supabase.auth.signUp()` path (`/signup?invite=<token>`). The gate is at the UI /
invite layer.
**Residual risk (accepted):** the public Supabase key still permits a direct API-level `signUp`,
which would create an **empty, RLS-isolated** workspace with no access to SVB data.
**Upstream-merge risk:** *Medium.* Auth pages are core; watch for conflicts. Reuses upstream's
invite/peek endpoint, so no new backend surface.

### C. RBAC — hide admin-only settings from agents/viewers
**Commit:** `c49d331` (2026-10-14)
**Files:** `src/components/settings/settings-sections.ts`, `settings-rail.tsx`,
`src/app/(dashboard)/settings/page.tsx`

**What staff see:** agents and viewers don't see the WhatsApp, Fields & tags, Deals & currency,
Team members and API keys sections in Settings.

**How it works**
- `settings-sections.ts` — an `adminOnly?: boolean` flag on `SectionMeta` + `isAdminOnlySection()`;
  **whatsapp, fields, deals, members, api** are `adminOnly: true`.
- `settings-rail.tsx` — filters admin-only sections out of the rail via `useCan('edit-settings')`.
- `settings/page.tsx` — deep-link guard: a non-admin opening `?tab=whatsapp` lands on **Overview**.
- Upstream's newer **Inbox** section (reply-time target, 2026-10-24 sync) is deliberately left
  visible: agents see the target read-only; upstream already limits editing to admins.

**Why:** agents are telecalling / chat-support staff who must not see WhatsApp credentials, API
keys, team management, or account-wide fields/deals.
**Note:** this is **UI hardening**. Writes to those settings were already RLS-/route-gated to admin
upstream, and the WhatsApp access token never reaches the browser. Locking `whatsapp_config`
SELECT to admins was **not** done: the inbox reply path reads that row under the agent's session.
**Upstream-merge risk:** *Medium.* Re-check the section list and the `adminOnly` tagging after a
merge (upstream added `inbox` in the 2026-10-24 sync).

### D. Mobile chat composer
**Commits:** `78323a1`, `ea62f1a` (2026-10-15); reworked in `cc29ff3` (merged `9ff2f27`, 2026-10-24)
**Files:** `src/components/inbox/message-composer.tsx`, `quick-reply-picker.tsx`,
`message-bubble.tsx`, `message-media.tsx`, `messages/*.json` (`Inbox.composer`)

**What staff see**
- One row under the chat: **⊕**, the message box, a round **Send** button.
- **⊕** opens a pop-up with large buttons: Photo, Video, Document, Voice note, Library, Quick
  replies, Templates, Buttons / list, AI draft. On phones it slides up from the bottom; on wider
  screens it's a centred card.
- When the chat column is wide enough, the old inline row of buttons is shown instead.
- No sideways scrolling in a chat; the message box has no scrollbar arrows.

**How it works**
- The switch uses a **container query** on the composer (`@container`, inline buttons at
  `@xl` = 36rem / 576px), not the screen width — so a desktop chat squeezed between the list and
  the contact panel also gets ⊕.
- Message box: 16px text on phones (stops iOS zooming on focus), hidden scrollbar (still scrolls
  past 4 lines), short placeholder ("Type a message" on touch, "Type a message, or / for quick
  replies" with a mouse). The Enter / Shift+Enter hint is a tooltip on mouse devices. The "Tap ✨
  to draft a reply with AI" line under the box was removed.
- **Enter-to-send** only on fine-pointer devices (`matchMedia('(pointer: fine)')`). On touch
  devices Enter adds a new line and Send is the only way to send.
- Bubbles are capped to their row (`max-w-full`) and a document's file name truncates
  (`min-w-0`), so a long name can't push the thread sideways.
- The quick replies picker previews `{name}` filled in, and doesn't open the keyboard over the
  list on touch devices.

**Why:** upstream's composer squeezed the input on narrow screens and always sent on Enter, so
phone users couldn't add line breaks; a row of five icons under the box crowded the input.
**Upstreamed:** the first version (buttons wrap below the box, Enter = new line on touch) was
merged upstream as **[ArnasDon/wacrm#656](https://github.com/ArnasDon/wacrm/pull/656)** and came
back with the 2026-10-24 sync. Everything else here is still ours.
**Upstream-merge risk:** *Medium–High.* The composer is actively developed upstream; it's the file
most likely to conflict.

### E. Secret-leak hardening + ops docs
**Commits:** `57fcc9e`, `31b7b8f` (2026-10-14)
**Files:** `.gitignore`, `docs/security-and-backup.md`

- `.gitignore` — also ignores `*-credentials.env`, `atlas-credentials.env` (upstream now ignores
  `supabase/.temp/` itself).
- `docs/security-and-backup.md` — operational checklist: secrets, HTTPS, RBAC, Supabase
  backups/restore, logging, incident response.

**Why:** prevent accidental secret commits; document how to run the deployment safely.
**Upstream-merge risk:** *None/Low* (additive).

### F. Public API: interactive message options
**Commit:** `b81c75a` (merged `70cdd71`), tests `095ba76` (2026-10-17)
**File:** `src/lib/api/v1/conversations.ts`

**How it works**
- Each message in `GET /api/v1/conversations/{id}/messages` has an `interactive` field. For an
  interactive message it is `{ kind: "buttons" | "list", body, options: [{ id, title }] }` (buttons,
  or a list's rows flattened); for every other message `null`.
- The data is `messages.interactive_payload`, which the public API previously dropped. Additive:
  existing consumers are unaffected.

**Why:** the SVB mobile app shows the buttons an automated message offered, the same as the web inbox.
**Tests:** `conversations.test.ts` — buttons, list rows flattened, `null` for others, a customer
tap's `interactive_reply_id`.
**Upstream-merge risk:** *Low–Medium.* Keep the field if upstream changes `ApiMessage` /
`serializeMessage`.
**Consumer:** the mobile app (`SVB-CRM-APP` repository).

### G. Who sent each reply (sender names)
**Commits:** `52849c7`, `bb178f4` (merged `5b48072`, 2026-10-19)
**Files:** `src/lib/whatsapp/send-message.ts`, `src/app/api/whatsapp/send/route.ts`,
`src/app/api/v1/messages/route.ts`, `src/lib/api/v1/sender.ts`, `src/lib/api/v1/conversations.ts`,
`src/app/api/v1/conversations/[id]/messages/route.ts`, `src/components/inbox/message-bubble.tsx`,
`src/components/inbox/message-thread.tsx`

**What staff see:** our reply bubbles show the team member's name on top, like a WhatsApp group.

**How it works**
- Inbox sends record the signed-in user in `messages.sender_id`. (Upstream now also stores
  `sender_id`, since the 2026-10-24 sync; we additionally pass the sender's **role**, used by H.)
- `POST /api/v1/messages` accepts an optional `sender_user_id`; it must be a member of the key's
  account (checked in `profiles`), otherwise 400 naming `sender_user_id`.
- `GET /api/v1/conversations/{id}/messages` adds `sender_name` (the member's `full_name` for our
  messages, else `null`). The id itself isn't exposed.

**Why:** replies from the mobile app went through the shared API key, so the inbox couldn't tell
who replied.
**Tests:** `sender.test.ts`, `conversations.test.ts` (`sender_name`).
**Upstream-merge risk:** *Medium.* Shared send path and bubble. Keep `senderId` + `senderRole`
flowing into `sendMessageToConversation`.
**Consumer:** the mobile app's backend sends `sender_user_id`; the app shows `sender_name`.

### H. Agents see their own and unassigned chats; claim on reply
**Commit:** `b0a6af7` (merged `f765022`, 2026-10-19)
**Files:** `supabase/migrations/900_agent_conversation_visibility.sql`,
`src/lib/whatsapp/send-message.ts`, `src/app/api/whatsapp/send/route.ts`,
`src/app/api/v1/messages/route.ts`, `src/lib/api/v1/sender.ts`, `src/app/api/v1/conversations/route.ts`,
`src/lib/api/v1/conversations.ts`, `src/components/inbox/message-thread.tsx`

**What staff see:** an agent's inbox lists only chats assigned to them plus unassigned ones.
Replying to an unassigned chat makes it theirs. Admins see every chat.

**How it works**
- **Visibility (migration 900):** `conversations` RLS lets owners/admins see every chat; agents and
  viewers only chats assigned to them or unassigned. Messages and reactions follow, since their
  policies look the conversation up. An agent may still hand a chat they can see to someone else
  (separate `WITH CHECK`).
- **Claim on reply:** an agent's (or viewer's) reply to an unassigned chat assigns it to them, only
  if still unassigned (`claimConversation` → `assign_conversation`). Owners/admins never claim. An
  agent sending into someone else's chat gets 403 "This chat is assigned to someone else".
- `POST /api/v1/messages`: role comes from `sender_user_id`; the response adds
  `assigned_to_sender`. The dashboard send returns `claimed` and the thread updates the assignee.
- `GET /api/v1/conversations` accepts `?assigned_to=<user id>` and `&include_unassigned=true`.
- Upstream's AI auto-reply (migration 053) stops once a chat is assigned, so a claim also stops it.

**Why:** each department (Studio, web/Android, AIoT, EduSMS) has its own agent; agents see only
their chats plus unassigned ones, admins see everything. Department routing itself is configured
in Automations ("Tag added" → "Assign conversation"), not in code.
**Tests:** `send-message.assignment.test.ts`, `sender.test.ts`, `conversations.test.ts`.
**Upstream-merge risk:** *High.* RLS on a core table and the shared send path. If upstream changes
the `conversations` policies, re-apply 900's rule on top of theirs. Section M covers upstream's
dashboard function, which bypasses RLS.
**Consumer:** the mobile app's backend filters chats the same way for agents.

### I. Handoff history and handing chats over
**Commit:** `5b97baf` (merged `67e52d5`, 2026-10-19)
**Files:** `supabase/migrations/901_conversation_assignments.sql`, `src/lib/conversations/assign.ts`,
`src/app/api/conversations/[conversationId]/assign/route.ts`, `src/lib/inbox/assignment-events.ts`,
`src/components/inbox/message-thread.tsx`, `src/lib/whatsapp/send-message.ts`,
`src/lib/api/v1/conversations.ts`, `src/app/api/v1/conversations/[id]/route.ts` (PATCH),
`src/app/api/v1/conversations/[id]/assignments/route.ts`, `src/app/api/v1/members/route.ts`,
`src/lib/webhooks/events.ts`, `messages/*.json` (`Inbox.handoff`)

**What staff see:** lines between messages such as "Manas handed this chat to Mehveen · 16:40",
"Testing took this chat", "Admin unassigned this chat". Anyone can hand a chat they can see to a
teammate.

**How it works**
- **History (migration 901):** a trigger records every change of `assigned_agent_id` in
  `conversation_assignments` (from, to, actor, time), whichever path made it; readable by whoever
  can see the chat. `assign_conversation()` assigns and names the actor for service-role callers
  (sets `app.assignment_actor` for its transaction); signed-in users are named by `auth.uid()`,
  so the actor can't be spoofed.
- **Assigning:** the inbox's assignee picker posts to `/api/conversations/{id}/assign` (not a
  direct browser update), so the handoff is recorded and announced. Claim on reply uses the same
  function.
- **Webhook `conversation.assigned`:** sent when a person (inbox, API, claim) changes the assignee,
  with `from_agent_id`, `to_agent_id`, `actor_user_id`, `actor_name`, `contact_name`. Automation
  and Flow assignments are recorded but send no webhook (the customer's message already alerts).
- **Public API:** `PATCH /api/v1/conversations/{id}` `{assigned_agent_id, actor_user_id?}` (scope
  `messages:send` — existing keys can't gain new scopes), `GET /api/v1/conversations/{id}/assignments`,
  `GET /api/v1/members`.

**Why:** chats move between departments (Studio → EduSMS); the new owner is alerted on their phone
and the chat keeps a record of each handoff.
**Tests:** `assign.test.ts`, `assignment-events.test.ts`, `send-message.assignment.test.ts`.
**Upstream-merge risk:** *Medium.* New table and function; keep the picker going through the
assign route. Upstream's `redeem_invitation` needed a test exemption for this table (section M).

### J. New chat: message a new number with a template
**Commit:** `790536a` (merged `f5d4e0e`, 2026-10-24)
**Files:** `supabase/migrations/902_contact_whatsapp_opt_in.sql`, `src/lib/whatsapp/start-chat.ts`,
`src/app/api/whatsapp/send/route.ts`, `src/components/inbox/new-chat-dialog.tsx`,
`src/components/inbox/conversation-list.tsx`, `src/app/(dashboard)/inbox/page.tsx`,
`src/components/inbox/template-picker.tsx`, `src/components/inbox/message-thread.tsx`,
`src/components/contacts/contact-detail-view.tsx`, `src/app/api/v1/messages/route.ts`,
`messages/*.json` (`Inbox.newChat`, `Api.send`)

**What staff see:** a **New chat** button next to the inbox search. The dialog asks for:
- country code (+91 by default; Gulf, US/UK, Singapore, Malaysia, Australia, or "Other" for any
  `+…` number), mobile number, optional customer name;
- a required tick "This customer agreed to receive WhatsApp messages from SVB Tech Labs"
  (replaced by "Opt-in recorded on …" once recorded).

Then the template picker (approved templates only, variables filled in). The chat opens after
sending. An existing customer's number shows "Already a contact: …" and goes into their chat.

**How it works**
- `POST /api/whatsapp/send` takes `phone` (+ `name`, `opt_in_confirmed`) besides
  `conversation_id` / `contact_id`; only `message_type: 'template'` on this path.
- `resolveStartChat` checks the number (`parseInternationalPhone`), the opt-in and the assignee on
  the service role, then reuses `resolveConversationByPhone`. An existing contact's name is kept.
  An agent can't start a chat another member is handling (403 naming them); a chat an agent starts
  is claimed by them. The response includes `conversation_id` on every path.
- **Opt-in (migration 902):** `contacts.whatsapp_opt_in_at` / `whatsapp_opt_in_by`, set after a
  successful send, first confirmation only. `POST /api/v1/messages` takes `opt_in_confirmed: true`
  and records it the same way (by `sender_user_id`, if given).
- **Template media headers:** the template picker asks for a link to the header image / video /
  document when the template has none stored (true of templates synced from Meta) — in the inbox,
  New chat and the Contact page. The Media Library (P) can fill it.
- Also fixed: an agent sending a template from the Contact page to a customer whose chat belongs to
  someone else got a 500, now a 403; on narrow screens the conversation list widened past the
  screen and hid the New chat button (`min-w-0` on the list pane).

**Why:** the team could only reply; they need to reach a new customer first. Meta allows only an
approved template as a business-initiated first message and expects recorded opt-in.
**Tests:** `start-chat.test.ts`, `send/route.test.ts` (phone path: template only, opt-in recorded,
refusal before Meta).
**Upstream-merge risk:** *Medium.* Keep `phone` going through `resolveStartChat`.
**Consumer:** the mobile app can start chats with `POST /api/v1/messages` (`to` + template),
passing `opt_in_confirmed`.

### K. Quick replies: "/" search, `{name}`, public API
**Commit:** `790536a` (merged `f5d4e0e`, 2026-10-24)
**Files:** `src/components/inbox/message-composer.tsx`, `quick-reply-picker.tsx`, `message-thread.tsx`,
`src/components/settings/quick-replies-manager.tsx`, `src/lib/quick-replies/placeholders.ts`,
`src/app/api/v1/quick-replies/route.ts`, `messages/*.json` (`Inbox.composer`, `Settings.quickReplies`)

Upstream already had quick replies (table `quick_replies`, Settings → Quick replies, an entry in
the composer's unlabelled "+" menu). The table was empty and the entry hard to find.

**What staff see**
- A **⚡ Quick replies** button, and typing **`/`** at the start of the message opens a list
  filtered as you type (↑/↓ to choose, Enter or Tab to insert, Esc to close). The picker dialog has
  a search box. The list reloads each time it opens, so new replies appear without a page reload.
- `{name}` and `{first_name}` in a reply are filled from the contact. With no name (or only a
  phone number) they're dropped and the sentence tidied ("Hi {name}," → "Hi,").
- Quick replies are free-form messages, so — like typing — they're unavailable once the
  24-hour customer-service window has closed.

**Public API:** `GET /api/v1/quick-replies` (scope `messages:read`) lists
`{ id, title, kind, content_text, interactive_payload, updated_at }`; `?contact_id=` returns
`content_text` with `{name}` filled for that customer.
**Why:** agents retyped the same answers; the mobile app offers the same replies.
**Tests:** `placeholders.test.ts`, `v1/quick-replies/route.test.ts`.
**Upstream-merge risk:** *Medium* (the composer, see D).

### L. Show / hide password
**Commit:** `790536a` (merged `f5d4e0e`, 2026-10-24)
**Files:** `src/components/ui/password-input.tsx`, `src/app/(auth)/login/page.tsx`,
`signup/page.tsx`, `reset-password/page.tsx`, `src/components/settings/password-form.tsx`,
`messages/*.json` (`UiPrimitives.showPassword` / `hidePassword`)

**What staff see:** an eye button on every password field (login, sign-up, reset, Settings → change
password) to show or hide what was typed.
**How it works:** `PasswordInput` wraps `Input` and toggles `type` between `password` and `text`;
the button is labelled "Show password" / "Hide password" for screen readers.
**Why:** staff asked to check what they typed before signing in.
**Upstream-merge risk:** *Low.* Keep password fields as `PasswordInput` if upstream edits an auth page.

### M. Upstream sync 2026-10-24: keeping agents to their own chats
**Commit:** `c4848ac` (merge of upstream `34bce1a`)
**Files:** `supabase/migrations/903_dashboard_agent_scope.sql`,
`src/lib/dashboard/agent-scope-migration.test.ts`, `src/lib/auth/redeem-invitation-migration.test.ts`

The sync brought 40 upstream commits (inbound-media XSS fix, action-first dashboard, webhook /
flow / automation / AI integrity fixes, Node 22). Two upstream changes would have undone H:

- **Dashboard lists:** upstream's `dashboard_overview` (migration 059) runs as SECURITY DEFINER and
  listed customer names, numbers and previews from every chat in its "needs attention" queue and
  failed-messages list. **Migration 903** redefines the function unchanged except that, for anyone
  below admin, those two lists skip chats assigned to someone else. Counts and charts stay
  team-wide. 903 is generated from 059's text.
- **Accepting an invite:** upstream's `redeem_invitation` (047) deletes a user's old empty account
  only if every account table is empty; its test now exempts `conversation_assignments` (901), whose
  rows always belong to a conversation, which is already checked.

**Tests:** `agent-scope-migration.test.ts` fails if 903 stops being the last definition, loses
the filter, or drifts from upstream's function in any other way.
**Upstream-merge risk:** *Medium.* If upstream changes `dashboard_overview`, copy their new version
into a new 90x migration and re-apply the filter (the test will flag it).

### N. Edit tags and the customer profile from the chat
**Commit:** `388ce75` (merged `1c01455`, 2026-10-24)
**Files:** `src/components/inbox/contact-sidebar.tsx`, `src/lib/contacts/save-profile.ts`,
`src/app/(dashboard)/inbox/page.tsx`, `src/components/inbox/message-thread.tsx`,
`messages/*.json` (`Inbox.sidebar`, `Inbox.page.contactSheetTitle`, `Inbox.messageThread.openContact`)

**What staff see**
- **✎** next to the customer's name edits name, email, company and custom fields in place. The
  phone number is shown read-only ("can't be changed from a chat").
- **×** on each tag removes it; **+** opens a searchable list of the account's existing tags.
- On phones and screens under 1280px, tapping the customer's **name or avatar** in the chat header
  opens the contact panel as a sheet from the bottom (profile, tags, deals, notes).

**How it works**
- `saveContactProfile` validates the email, updates the contact, upserts filled custom values on
  `(contact_id, custom_field_id)` and deletes cleared ones. The new name appears in the list and
  header at once (`handleContactUpdated` in the inbox page).
- Tags go through `/api/contacts/{id}/tags` (`tag-api.ts`), so adding a tag **fires "Tag added"
  automations** — department routing — exactly as on the Contacts page. New tags are still created
  by admins in Settings → Fields & tags.
- Editing needs the agent role (`useCan('send-messages')`), matching the contacts RLS.
- The side panel now shows from `xl` (1280px) instead of `lg`: on 1024–1279px it squeezed the chat
  to ~190px. Below `xl`, the header tap opens the sheet; on desktop it reopens a hidden panel.

**Why:** staff tag and correct customers while chatting, on desktop and on phones.
**Tests:** `save-profile.test.ts`.
**Upstream-merge risk:** *Medium.* `contact-sidebar.tsx` was read-only upstream; keep the edit
form, tag controls and the `variant` prop.

### O. Quick replies with an image and fill-in details
**Commit:** `883d797` (merged `1c01455`, 2026-10-24)
**Files:** `src/lib/whatsapp/interactive.ts`, `meta-api.ts`, `send-message.ts`,
`src/components/interactive/interactive-builder.tsx`, `interactive-preview.tsx`,
`src/lib/quick-replies/placeholders.ts`, `fill-payload.ts`,
`src/components/inbox/quick-reply-fill-dialog.tsx`, `src/components/inbox/message-composer.tsx`,
`src/components/settings/quick-replies-manager.tsx`

**What staff see**
- A button message (quick reply or built in the chat) can have an **image at the top**: header
  **Text / Image**, then Upload, Library (P) or paste a link (JPEG/PNG, up to 5 MB).
- Picking a quick reply with **`{{1}}`, `{{2}}`…** opens a small form for each value with a live
  preview; "Use reply" stays off until all are filled. A button message then opens filled in,
  image and buttons included, for a final look before sending.
- Any message still containing `{{n}}` is refused: "Fill in every {{n}} before sending."

**How it works**
- `InteractiveButtonsPayload.header_image_url` (https only; can't be combined with a text header).
  The inbox send path passes it to Meta as `header: { type: "image", image: { link } }`
  (`sendInteractiveButtons`). Preview and chat bubble show it.
- The builder's image option is on only where the inbox send path is used (`allowImageHeader` in
  the composer and the quick replies manager); automations and flows send interactive messages
  through their own code, which doesn't carry the image.
- `numberedVariables` / `fillNumbered` / `hasUnfilledVariables` (`placeholders.ts`) and
  `mapPayloadText` / `payloadTexts` (`fill-payload.ts`) fill body, header, footer and button / list
  labels. `{name}` now fills in button messages too. The public API returns replies as written.

**Why:** the team sends the studio-website offer as a free quick reply once the customer has said
hi (open 24-hour window) instead of a paid Marketing template.
**Tests:** `placeholders.test.ts` (numbered), `fill-payload.test.ts`.
**Upstream-merge risk:** *Medium.* Keep `headerImageUrl` in `sendInteractiveButtons` and the
builder switch if upstream changes them.

### P. Media Library: reuse uploaded files
**Commit:** `c33abbf` (merged `1c01455`, 2026-10-24)
**Files:** `src/lib/storage/media-library.ts`, `src/components/media/media-library-dialog.tsx`,
`src/components/inbox/message-composer.tsx`, `message-thread.tsx`, `template-picker.tsx`,
`src/components/interactive/interactive-builder.tsx`, `src/components/broadcasts/step3-personalize.tsx`,
`messages/*.json` (`MediaLibrary.*`, `Inbox.composer.library`)

**What staff see:** a **Library** with two tabs — **Our files** (team uploads) and **Received from
customers** — with search, thumbnails, "Load more" and **Upload** (adds a file and uses it at once).
Offered in: chat attachments (📎 menu and the ⊕ pop-up), the button-message image header, the
template picker's media header, and the broadcast wizard's header media.

**How it works**
- Reads the public `chat-media` bucket: "Our files" = `account-<id>/` plus one level into each
  subfolder except `inbound` (e.g. `quick-replies/`); "Received" = `account-<id>/inbound/`.
- Shows only files the place can use (`fitsAccept`: kind, MIME type, Meta's size caps). Template
  headers via `acceptForHeader`: image JPEG/PNG, video MP4, document PDF.
- **Never deletes.** A library pick is staged without a storage `path`. The composer's discard
  cleanup and the thread's failed-send cleanup only delete one-off uploads (which have a `path`).
- No database change: members can list their own account folder (chat-media read policy,
  upstream migration 043) and the bucket is public so Meta can fetch the links.

**Why:** staff re-uploaded the same brochures and images; now they pick them again.
**Tests:** `media-library.test.ts` (kinds, names, accept rules, folder walk, inbound tab).
**Upstream-merge risk:** *Low–Medium.* Keep `path` optional and the delete guarded by it.

### Q. Agent restrictions, New chat lookup and handover requests
**Branch:** `agent-restrictions` (merged 2026-10-24, `a3926b2`)
**Migration:** `supabase/migrations/904_agent_restrictions.sql`

**What agents see**
- **Broadcasts, Automations, Flows — read-only.** The pages stay in the sidebar with their lists,
  statuses, broadcast stats, automation logs and flow runs. Create / edit / send / resume / on-off
  / duplicate / delete are hidden or locked ("Read-only — your role can't …"). Opening an editor
  (`/broadcasts/new`, `/automations/new`, `/automations/{id}/edit`, `/flows/{id}`) sends an agent
  to the read-only view (`AdminOnlyRoute`).
- **Templates:** agents can **Sync from Meta**; New template / Edit / Resubmit / Delete are
  hidden (their routes still require admin).
- **Contacts:** agents see customers whose chat is theirs or unassigned, plus contacts with no
  chat yet. They can **add and edit**; **Import CSV and Delete** (single and bulk) are admin-only.
- **Deals:** agents create and edit; **Delete deal** is admin-only.
- **New chat:** typing a number asks the server who it belongs to. For another agent's customer
  the dialog says *"Ravi Kumar is already a customer, handled by Mehveen."*, disables "Choose
  template", and offers **"Ask Mehveen to hand it over"**. That notifies the owning agent and the
  owners/admins (Notifications page; tap opens the chat to hand it over). One request per chat per
  hour. Add contact gives the same "handled by" message for such a number.

**How it works**
- **904 (database):** insert / update / delete on `broadcasts`, `automations`, `flows` and their
  child rows (`broadcast_recipients`, `automation_steps`, `flow_nodes`) need admin; `contacts`
  delete and `deals` delete need admin; `contacts_select` = member **and** `can_see_contact(id,
  account_id)`, a SECURITY DEFINER function (it must see every chat, or another agent's customer
  would look like a contact with no chat); notification type `handover_requested` is allowed.
  The automation and flow engines use the service role, so live automations keep running.
- **Routes:** every write in `api/automations/*`, `api/flows/*`, `api/whatsapp/broadcast/*` now
  `requireRole('admin')` (GETs unchanged). `api/whatsapp/templates/sync` accepts agents and writes
  `message_templates` with the service role, scoped to the account.
- **Lookup:** `GET /api/contacts/lookup?phone=+…` (agent+, service role) → `lookupNumber`:
  `{ exists, contactName, optedInAt, conversationId, handledBy, blocked }`. Only about the number
  given; it never lists contacts.
- **Handover request:** `POST /api/conversations/{id}/handover-request` (agent+, service role) →
  `requestHandover`: notifies the assignee + owners/admins, skips the requester, refuses repeats
  within an hour, and does nothing for an unassigned or own chat.
- Contact import is hidden in the app only: the database can't tell an import from adding contacts
  one by one.
- **Templates list fix:** Settings → Templates listed only templates the signed-in person created
  (`user_id` filter); it now lists the account's templates (RLS scopes them). Sync sets `user_id`
  only on insert, so an agent's sync no longer re-stamps everyone's templates as theirs.

**Side effects:** on Pipelines, an agent sees no customer name on a deal whose customer belongs to
another agent.
**Why:** agents are department staff; broadcasts, automations (routing rules) and flows affect the
whole account, and agents shouldn't browse or delete other departments' customers.
**Tests:** `agent-restrictions-migration.test.ts` (each policy admin-only and last defined by 904,
contact scope, notification type, admin-only write routes, agent sync), `number-lookup.test.ts`,
`handover-request.test.ts`.
**Upstream-merge risk:** *Medium–High.* If upstream changes these policies, re-apply 904 on top; if
it adds write routes or editor pages for these areas, gate them the same way.
**Applying the migration:** run 904 in the SQL editor when the code is deployed (either order is
safe: before it, agents' buttons are already hidden; after it, the database refuses agent writes).

### R. Automation priority and "Contact has any tag"
**Branch:** `automation-priority` (merged 2026-10-24, `4d32b0c`)
**Files:** `src/lib/automations/engine.ts` (`pickByKeywordPriority`, `any_tag` in
`evaluateCondition`), `src/types/index.ts` (`KeywordMatchTriggerConfig.priority`,
`KeywordPriority`, `ConditionSubject` `any_tag`), `src/lib/automations/validate.ts`,
`src/components/automations/automation-builder.tsx` (Priority dropdown under Match type; "Contact
has any tag" condition with no operand), `messages/*.json` (`Automations.builder.config.priority*`,
`subjects.any_tag`).

- **Keyword priority** — Normal (default) / Low / Lowest. Upstream runs *every* keyword automation
  that matches a message, so "Hello, I want wedding photography" got both the greeting menu and the
  wedding reply. Now, of the keyword automations that match one message, only those in the best tier
  run: a Normal match silences Low and Lowest; a Low match silences Lowest. Several Normal matches
  still all run, as before. Other trigger types are never filtered. Rows without `priority` are
  Normal, so existing automations behave as before.
  - Use: the greeting menu is **Lowest**; broad "studio / photography enquiry" questions are
    **Low**; replies to a named service are **Normal**.
- **"Contact has any tag" condition** — true when the contact carries at least one tag. The
  greeting uses it so a known customer (any department / stage tag) is not shown the
  "EduSMS / Studio / Other" menu again.

**Why:** customers who already said what they want, or are already tagged, were sent the generic
service menu again.
**Tests:** `engine.test.ts` (`pickByKeywordPriority`), `validate.test.ts` (`any_tag` needs no operand).
**Upstream-merge risk:** *Low–Medium.* The dispatch loop in `runAutomationsForTrigger` and
`evaluateCondition` are upstream code; if they change, re-apply the filter and the `any_tag` case.

---

## 2. Database migrations

The schema is upstream's migrations plus ours. **Everything is run by hand** in the Supabase SQL
editor of project `yiheffhkyinnwhqahhdl`; there is no automatic migration on deploy.

### Our fork migrations

| File | Section | What it does | Applied |
|---|---|---|---|
| `900_agent_conversation_visibility.sql` | H | `conversations` SELECT: admins all, others own + unassigned | 2026-10-19 (as 047) |
| `901_conversation_assignments.sql` | I | `conversation_assignments` table, trigger, `assign_conversation()` | 2026-10-19 (as 048) |
| `902_contact_whatsapp_opt_in.sql` | J | `contacts.whatsapp_opt_in_at`, `whatsapp_opt_in_by` | 2026-10-24 (as 049) |
| `903_dashboard_agent_scope.sql` | M | Agent-scoped lists in `dashboard_overview` | 2026-10-24 |
| `904_agent_restrictions.sql` | Q | Admin-only writes for broadcasts / automations / flows, contact delete, deal delete; scoped contacts; `handover_requested` notifications | not yet |

900–902 were applied under their old numbers; **don't run them again** on this database (they are
idempotent, but there's no need). On a fresh database run all upstream migrations in order, then
900–903.

### Upstream migrations applied by hand

| Upstream sync | Migrations run | Order notes |
|---|---|---|
| 2026-10-24 (`34bce1a`) | 047, 048, 049, 051, 052, 053, 054, 059 (no 050 / 055–058 exist) | Run before deploying the code; 049 replaces the broadcast function, so broadcasts fail between running it and deploying. Then our 903, after 059. |

Upstream's edits to old migrations (`uuid_generate_v4()` → `gen_random_uuid()` in 001, 006, 009,
010, 017, 027, 035) only matter for fresh installs and were not re-run.

### Checking what's applied

```sql
-- our columns / tables exist
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'contacts' and column_name like 'whatsapp_opt_in%';
select to_regclass('public.conversation_assignments');
-- 903 is the live dashboard function
select prosrc like '%v_sees_all%' from pg_proc where proname = 'dashboard_overview';
```

---

## 3. Public API changes (for the mobile app)

All under `/api/v1`, API-key auth. Additive: nothing upstream returns was removed.

| Endpoint | Change | Scope | Section |
|---|---|---|---|
| `GET /conversations/{id}/messages` | `interactive` (options), `sender_name` per message | `messages:read` | F, G |
| `GET /conversations` | `?assigned_to=<user id>&include_unassigned=true` | `conversations:read` | H |
| `PATCH /conversations/{id}` | `{ assigned_agent_id, actor_user_id? }` hand over | `messages:send` | I |
| `GET /conversations/{id}/assignments` | handoff history | `conversations:read` | I |
| `GET /members` | team members `{ user_id, name, role }` | `conversations:read` | I |
| `POST /messages` | `sender_user_id`, `opt_in_confirmed`; response `assigned_to_sender` | `messages:send` | G, H, J |
| `GET /quick-replies` | list replies; `?contact_id=` fills `{name}` | `messages:read` | K |

Dashboard (session) routes added for the web app: `GET /api/contacts/lookup`,
`POST /api/conversations/{id}/handover-request` (Q).

Webhook: `conversation.assigned` (I).

---

## 4. Deployment configuration (NOT in git — recreate per deployment)

- **Messaging:** official **Meta WhatsApp Cloud API**. A dedicated Meta app + a **permanent
  System-User token** (scopes `whatsapp_business_messaging` + `whatsapp_business_management`) with
  the **WhatsApp Business Account assigned as an asset**. Business Verification completed and the
  app Published.
- **Env vars** (names only — values in `.env.local` / Vercel, see `.env.local.example`):
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `ENCRYPTION_KEY`, `META_APP_SECRET`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_APP_LOCALE`.
- **Supabase:** see [section 2](#2-database-migrations). Auth → URL Configuration → **Site URL =
  the production domain** + Redirect URLs (so confirmation / reset emails don't use `localhost`).
  Storage bucket `chat-media` is public (Meta fetches media links from it).
- **Hosting:** Vercel, custom domain behind Cloudflare. Every push to `main` deploys.
  `NEXT_PUBLIC_*` are inlined at build, so changing one needs a redeploy.
- **Node:** upstream requires Node ≥ 22.12 (Vercel uses 22). Locally, `next build` under Node 25
  can crash with a segmentation fault at the end (upstream's worker-thread PostCSS); build with
  Node 22 (`npx -y node@22 node_modules/next/dist/bin/next build`).

## 5. Account data (NOT in git — lives in the database)

Created through the app, stored per account in Supabase, **not** version-controlled. A fresh
deployment recreates these in the UI.

- **Automations** — keyword-driven replies. Interactive payloads must respect WhatsApp limits (row
  titles ≤ 24, ≤ 10 list rows, ≤ 3 buttons, button labels ≤ 20). Keyword priority and the "Contact
  has any tag" condition are explained in section R. Studio routing was rebuilt on 2026-10-24:
  - **Greeting — "Categorise 1"** (Lowest): replies to hi / hii / hey / hello / namaste, whole words.
    A contact with **any tag** gets "Welcome back! … Our team will reply to you shortly." A contact
    with no tags gets the EduSMS / Studio / Other menu. It stays quiet when any other keyword
    automation matches the same message.
  - **Menu follow-ups** (Normal, unchanged): EduSMS Interest, Categorise 2 ("Other" → AioT / App
    Development / More Options), AioT Interest, App Development Interest, More Options, More Details,
    Arrange a Call Back, Arrange a Live Demo.
  - **14 studio service replies, "Studio · <service>"** (Normal, whole-word keywords plus synonyms,
    e.g. wedding / marriage / pelli / bride). There is one for each page under
    `https://studio.svbtechlabs.com/services/`: wedding, pre-wedding, Hindu wedding, Christian
    wedding, baby shower, maternity & newborn, birthday, anniversary, corporate event, real estate,
    food, fashion, product, portrait. Each one:
    - adds the tag **Studio Customer**;
    - replies with the service page link, the main website link and "Our team will contact you
      shortly", plus the buttons Arrange a Call Back / Arrange a Live Demo.

    Exceptions:
    - A contact tagged **Studio Owner**, or a message that mentions "website", gets the owner reply
      instead.
    - "Studio · Wedding Photography" stays silent when the message names a more specific service
      (pre-wedding, Hindu, Christian, traditional / Telugu / South Indian, anniversary), so only that
      service replies.
  - **"Studio · Photography enquiry"** (Low): matches studio / photography / photographer /
    photoshoot / shoot / photos / camera, including a tap on the menu's **Studio** button. It routes
    by tag:
    - Studio Owner → owner reply;
    - Studio Customer → services list;
    - no studio tag → asks "Book a photoshoot" / "Website for studio".
  - **"Studio · Book a photoshoot"** (Normal; this was "Studio End Customer Leads", same id): adds
    Studio Customer and sends a list of 10 services. The list text asks customers to type any service
    that isn't listed (food, fashion, Hindu / Christian wedding).
  - **"Studio web Key words"** — the owner reply (Normal, contains): matches studio website, SVB
    Studio, photography / photographer website, website for (my) studio, studio site, I'm / I am a
    photographer.
    - Adds the tags Follow-up Studio and **Studio Owner**.
    - Sends the website link and "Our team will contact you shortly", with the buttons Call Back /
      Live Demo / More Details.
  - **Tooling:** the setup was generated and checked with scripts kept outside the repo: a plan file,
    a simulator that replays sample messages and every button / row tap under four tag states, and
    an apply script that backs up all automations first. The last backup before the rebuild is
    `automations-backup-2026-10-24T17-52-13-175Z.json`. To rebuild by hand, follow the list above.
  - **Not covered yet:** "Tag added" → "Assign conversation" routing for studio leads, and a Pocket
    CRM reply (it currently gets the greeting menu).
- **Tags** — 17:
  - 15 department / stage tags (New / Follow-up / Done × Studio, AIoT, SVBTL, EduSMS, plus Our Team,
    Arrange a Call Back, Arrange a Live Demo);
  - **Studio Customer** (books photoshoots) and **Studio Owner** (wants a website for their studio),
    both added 2026-10-24 and set by the studio automations above. Contacts tagged earlier only with
    Follow-up Studio aren't back-filled; they get the two-button question once.
- **Message templates** — Utility templates approved by Meta (`inquiry_received`,
  `callback_scheduled`, `demo_confirmation`, `booking_confirmation`, `appointment_reminder`), Meta's
  sample `hello_world`, and `studio_website_intro_v1` (en) / `studio_website_intro_v1_te` (te)
  pending approval at last review.
- **Quick replies** (14):
  - 12 starter text replies added 2026-10-24: Greeting, Ask for details, Studio / App & website /
    AIoT / EduSMS enquiry, Quote coming, Offer a call back, Offer a live demo, Checking with team,
    Follow-up, Thank you — several using `{name}`.
  - **Studio website offer (English)** and **(Telugu)**, added 2026-10-24: button messages with the
    header image `chat-media/account-<id>/quick-replies/studio-website.jpg`, fill-ins `{{1}}` name,
    `{{2}}` sender, `{{3}}` city, `{{4}}` starting price, and three buttons with the same ids in both
    languages: `studio_site_interested`, `studio_site_not_interested`, `studio_site_more_details`.
- **Media** — uploads and mirrored customer media in `chat-media/account-<id>/` (section P).

## 6. Known gaps and follow-ups

- **"wacrm" in 8 strings** (`messages/en.json`, e.g. the invite message "Join … on wacrm",
  "Registered — Meta will deliver events to wacrm") — switch to SVBTL CRM.
- **`hello_world`** shows as approved but Meta refuses it from a live number ("only from the Public
  Test Numbers"); staff should use our own templates.
- **Not yet tested with an agent login:** the New chat button for agents and the 403 when an agent
  starts a chat owned by someone else (both covered by unit tests).
- **Not clicked through:** the Library button in the template picker and broadcast wizard — no
  template has a media header yet. A real send of an image quick reply hasn't happened yet.
- **Mobile app** (`SVB-CRM-APP`): can use `GET /api/v1/quick-replies` and `opt_in_confirmed`.
- **Merged branches** can be deleted (they're all in `main`).

---

## 7. Pulling updates from upstream

```bash
git fetch upstream
git log --oneline HEAD..upstream/main      # what's new upstream
git checkout -b upstream-sync-<date> main
git merge upstream/main                     # resolve conflicts on the branch, never on main
```

After merging, **re-check the medium/high-risk areas** — in likelihood order:

1. `supabase/migrations/` (H, I, J, M) — ours are 900+, so numbers no longer clash. If upstream
   changes the `conversations` policies, re-apply 900's rule on top; if it changes
   `dashboard_overview` or adds another SECURITY DEFINER function that lists chats, scope it like
   903. List the new upstream migrations and run them in the SQL editor, then any new 90x of ours.
2. `src/lib/whatsapp/send-message.ts`, `src/app/api/whatsapp/send/route.ts` (G, H, I, J, O) — keep
   `senderId` + `senderRole`, the who-may-send check, claim on reply, the `phone` path and
   `headerImageUrl`.
3. `src/components/inbox/message-composer.tsx` (D, K, O, P) — the container-query layout and ⊕
   sheet, ⚡ and the "/" list, the fill-in form, the Library, and `path`-guarded deletes.
4. `src/components/inbox/message-thread.tsx`, `message-bubble.tsx`, `message-media.tsx` (D, G, H, I,
   N, P) — sender name, handoff lines, assignee picker via the assign route, bubble width caps,
   the header tap, guarded media deletes.
5. `src/components/inbox/contact-sidebar.tsx`, `src/app/(dashboard)/inbox/page.tsx` (J, N) — edit
   form, tag controls, `xl` panel / sheet, New chat dialog wiring.
6. `src/components/interactive/*`, `template-picker.tsx`, `step3-personalize.tsx` (J, O, P) — image
   header, media header link, Library buttons.
7. `src/app/(auth)/*` (B, L), `src/components/settings/*` and `settings/page.tsx` (C).
8. `src/lib/api/v1/*` and the v1 routes (F, G, H, I, K) — the fields in section 3.
9. `messages/*.json`, `src/app/layout.tsx` (A and all) — branding and our strings in all four files.

Then verify (build with Node 22):

```bash
npm run typecheck && npm run lint && npm test
npx -y node@22 node_modules/next/dist/bin/next build
```

**Smoke test** on the local app (`npm run dev`, sign in) before merging to `main`:

- [ ] `/signup` without an invite shows the invite-only notice (B)
- [ ] an agent doesn't see admin settings tabs (C)
- [ ] phone width: one composer row, ⊕ opens the pop-up, Enter adds a new line, no sideways scroll (D)
- [ ] our replies show the sender's name (G)
- [ ] an agent sees only own + unassigned chats; replying to an unassigned chat claims it (H)
- [ ] handing a chat over shows a handoff line (I)
- [ ] New chat: +91 number → template → chat opens; opt-in recorded on the contact (J)
- [ ] `/` lists quick replies with the name filled in (K)
- [ ] the eye button shows/hides the password on login (L)
- [ ] an agent's dashboard lists only own + unassigned chats (M)
- [ ] ✎ saves a profile; + / × add and remove a tag; phone: tap the name opens the sheet (N)
- [ ] a `{{n}}` quick reply asks for the values; the image shows in the preview (O)
- [ ] Library lists both tabs; picking then discarding a file leaves it in storage (P)

If a customization has since landed upstream, drop ours to reduce drift.

---

## 8. Change log

| Date | Commits | Change |
|---|---|---|
| 2026-10-14 | `57fcc9e`, `c49d331`, `31b7b8f` | Branding, invite-only sign-up, admin-only settings, ops checklist (A, B, C, E) |
| 2026-10-15 | `78323a1`, `ea62f1a`, `b02e849`, `a332524` | First mobile composer fix (D); this document; PR #656 to upstream |
| 2026-10-17 | `b81c75a`, `095ba76`, `a663b2c` | API: interactive options (F) |
| 2026-10-19 | `52849c7`, `bb178f4`, `b0a6af7`, `5b97baf` | Sender names, agent visibility + claim, handoff history (G, H, I) |
| 2026-10-24 | `790536a` (`f5d4e0e`) | New chat + opt-in, quick replies "/" + `{name}` + API, password eye (J, K, L) |
| 2026-10-24 | `cc29ff3` (`9ff2f27`) | Mobile composer rework: one row + ⊕ sheet, no sideways scroll (D) |
| 2026-10-24 | `c4848ac` | Upstream sync to `34bce1a`; fork migrations → 900–902; dashboard scope 903 (M) |
| 2026-10-24 | `388ce75`, `883d797`, `c33abbf` (`1c01455`) | Edit contact in chat, quick reply image + fill-ins, Media Library (N, O, P) |
| 2026-10-24 | `c4eb34d`, `3c9398e` (`a3926b2`) | Agent restrictions, New chat lookup, handover requests (Q) |
| 2026-10-24 | `01dcc93` (`4d32b0c`) | Keyword priority, "Contact has any tag" condition (R); studio automations rebuilt (section 5) |
