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
| Last reviewed | 2026-10-17 — fork is 9 commits ahead of the fork point `27c6bdf` |

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

Files we changed vs upstream (11):

```
.gitignore
docs/security-and-backup.md
messages/en.json
src/app/(auth)/login/page.tsx
src/app/(auth)/signup/page.tsx
src/app/(dashboard)/settings/page.tsx
src/app/layout.tsx
src/components/inbox/message-composer.tsx
src/components/settings/settings-rail.tsx
src/components/settings/settings-sections.ts
src/lib/api/v1/conversations.ts
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
**Commits:** `78323a1`, `ea62f1a`
**File:** `src/components/inbox/message-composer.tsx`

- Responsive layout: on mobile the four action buttons (attach / more / template / AI) wrap to
  their own row **below** the textarea (`flex-wrap` + `basis-full` + `order`), giving the input
  full width; `sm+` keeps the original single inline row.
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
**Branch:** `message-sender` (2026-10-19)
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
**Branch:** `agent-visibility` (2026-10-19)
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
- **Supabase:** schema is **upstream's migrations, plus our `047_agent_conversation_visibility.sql`** (run by hand in the SQL editor). Deployment-specific config:
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

A fresh deployment recreates these in the UI (or via a seed script if one is added later).

---

## 4. Pulling updates from upstream

```bash
git fetch upstream
git log --oneline HEAD..upstream/main      # what's new upstream
git merge upstream/main                     # or: git rebase upstream/main
```

After merging, **re-check the medium/high-risk files** from Section 1 — in likelihood order:

1. `src/components/inbox/message-composer.tsx` (D) — most actively changed upstream.
2. `src/app/(auth)/signup/page.tsx`, `login/page.tsx` (B).
3. `src/components/settings/*` and `settings/page.tsx` (C).
4. `messages/en.json`, `src/app/layout.tsx` (A) — confirm branding strings survived.
5. `src/lib/api/v1/conversations.ts` (F) — confirm the `interactive` field is still returned.

Then verify:

```bash
npm run typecheck && npm run lint && npm run build && npm test
```

and smoke-test: invite-only signup gate, agent cannot see admin settings tabs, and the mobile
composer (newline on Enter + full-width input). If a customization has since landed upstream,
drop ours to reduce drift.
