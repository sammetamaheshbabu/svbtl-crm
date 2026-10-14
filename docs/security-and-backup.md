# SVBTL CRM — Security & Backup Checklist

Operational security and backup guide for the SVB Tech Labs WhatsApp CRM
deployment (Next.js on **Vercel** → `crm.svbtechlabs.com`, backed by
**Supabase** Postgres/Auth/Storage, messaging via the **official Meta
WhatsApp Cloud API**).

Last reviewed: 2026-10-14.

---

## 1. Secrets & credentials

| Secret | Where it lives | Rule |
|---|---|---|
| `ENCRYPTION_KEY` (64 hex) | Vercel env + local `.env.local` | Encrypts WhatsApp tokens at rest (AES-256-GCM). **Never rotate without re-encrypting** `whatsapp_config` rows, or saved tokens become unreadable. |
| `SUPABASE_SERVICE_ROLE_KEY` (`sb_secret_…`) | Vercel env (server only) | Bypasses RLS — full DB access. Never ship to the browser, never put in `NEXT_PUBLIC_*`, never commit. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` (`sb_publishable_…`) | Vercel env | Public by design; safe in the browser. RLS is what protects data. |
| `META_APP_SECRET` | Vercel env (server only) | Verifies webhook HMAC signatures. |
| WhatsApp access token | **Encrypted in DB** (`whatsapp_config`), not in env | Use a **System-User (permanent) token**, not the 24-hour API-Setup token. |
| DB password | Nowhere in the repo | Only used ad-hoc for `supabase db push`; URL-encode special chars. |

**Checklist**
- [x] `.env*` is gitignored (`!.env.example` / `!.env.local.example` kept as templates).
- [x] `*-credentials.env` gitignored (no stray secret files committed).
- [ ] Confirm no secret ever appears in `NEXT_PUBLIC_*` (those are inlined into client JS at build).
- [ ] Rotate the WhatsApp token only via the CRM Settings → WhatsApp panel (re-encrypts automatically); do not edit the DB row by hand.
- [ ] If any secret is suspected leaked: rotate in Vercel → redeploy; for the service-role/anon keys, roll them in Supabase → Settings → API.

## 2. HTTPS & network

- [x] Served over HTTPS via Vercel + Cloudflare (`crm.svbtechlabs.com`).
- [ ] Cloudflare SSL/TLS mode = **Full (strict)** (not Flexible — Flexible leaves Cloudflare→origin unencrypted).
- [ ] HSTS enabled.
- [x] Webhook endpoint (`/api/whatsapp/webhook`) verifies Meta's HMAC signature using `META_APP_SECRET` — reject unsigned/forged callbacks.
- [ ] WhatsApp verify token is a strong random value (stored encrypted, matched on the webhook GET handshake).

## 3. Access control (who can see/do what)

- [x] **Private / invite-only.** Public self-signup is gated — `/signup` requires a valid invite token; the public signup link is hidden on `/login`.
- [x] **RBAC** — roles owner > admin > agent > viewer. Agents (telecallers / chat support) cannot view or edit WhatsApp connection, API keys, Team members, Fields & tags, or Deals (hidden in the rail **and** blocked on deep-link).
- [x] Writes to sensitive settings are RLS/route-gated to admin+ (not just UI-hidden).
- [x] WhatsApp access token is never sent to the browser — admins see only a masked value.
- [x] Row-Level Security isolates every workspace; a member of one account cannot read another's data.
- [ ] Review the member list periodically (Settings → Team members); remove people who leave.
- [ ] Keep the owner account (`crm@svbtechlabs.com`) on a strong, unique password; enable 2FA on that Google mailbox.

## 4. Backups (Supabase Postgres)

- [ ] **Confirm automatic daily backups** are on: Supabase → Database → Backups. (Daily backups + retention depend on plan; Free plan = limited/none — consider Pro for Point-in-Time Recovery.)
- [ ] **Monthly manual snapshot** as belt-and-suspenders:
  ```bash
  # Full logical dump (run from a trusted machine; URL-encode the password)
  pg_dump "postgresql://postgres:<ENCODED_PW>@db.yiheffhkyinnwhqahhdl.supabase.co:5432/postgres" \
    --no-owner --format=custom --file "svbtl-crm-$(date +%F).dump"
  ```
  Store the dump encrypted, off-platform (not in the repo).
- [ ] **Test a restore** at least once so the backup is proven, not assumed:
  ```bash
  pg_restore --no-owner --dbname "postgresql://…/restore_test" svbtl-crm-YYYY-MM-DD.dump
  ```
- [ ] Note what is **not** in a Postgres dump: Supabase **Storage** objects (chat media) and **Auth** users live in separate schemas — include `auth` + the storage buckets, or export them separately.

## 5. Logging & monitoring

- [ ] Vercel → project → **Logs/Observability**: watch function errors on `/api/whatsapp/*`.
- [ ] Supabase → **Logs** (Postgres, Auth, Edge): review auth failures and unusual query volume.
- [ ] Meta → WhatsApp Manager: monitor **message quality rating** and template status; a drop in quality throttles sending.
- [ ] Set up an alert (email/Slack) for webhook 4xx/5xx spikes = inbound messages silently dropping.
- [ ] Do **not** log message bodies, tokens, or customer PII to stdout/Vercel logs.

## 6. WhatsApp / Meta hygiene

- [x] Official Cloud API (not an unofficial WhatsApp-Web bridge) → no ban/session risk, no QR files to leak.
- [ ] Permanent System-User token in use (not the 24h temp token).
- [ ] Only **Utility/Authentication** templates for proactive sends unless Marketing is intended; keep templates compliant to protect the quality rating.
- [ ] Respect the 24-hour customer-service window for free-form replies.

## 7. Deployment resilience

- [x] Vercel auto-redeploys on push to `main`; builds are immutable and roll back instantly if needed.
- [ ] Keep `main` protected; review before merging.
- [ ] Docker/self-host path documented in `docs/docker.md` as a fallback (HTTPS via reverse proxy, persistent volume for Postgres, `restart: unless-stopped`).

## 8. Incident quick-reference

1. **Token compromised** → rotate in Settings → WhatsApp; revoke the old System-User token in Meta Business Settings.
2. **Service-role/anon key leaked** → roll keys in Supabase → Settings → API; update Vercel env; redeploy.
3. **Unexpected account appears** → enumerate users (Supabase Auth); signup is invite-only, so investigate how it was created; delete the stray workspace row then the auth user.
4. **Data loss** → restore latest Supabase backup / manual dump; verify row counts against last known-good.

---

*Boxes left unchecked (`[ ]`) are actions still to confirm or schedule.*
