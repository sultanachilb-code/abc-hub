# Outlook sending — each user's own mailbox (Microsoft Graph, Oct 2026)

Removes the ~100 emails/day limit of the old mail relay (Google Apps Script). Code: `modules/outlook.js`.

## How it works
- **Profile → Outlook → "Connect my Outlook"**: Microsoft sign-in once (delegated `Mail.Send`, `User.Read`, `offline_access`, PKCE).
  The Microsoft account must be the same email as the hub account. The refresh token is stored AES-GCM encrypted (`ms_tokens`, key from SESSION_SECRET).
- Every hub email goes through `relay()` in worker.js:
  1. the person who pressed send (`from`) if connected → sent from their mailbox (Sent Items, replies to them);
  2. otherwise the **automatic sender** chosen in Admin (morning brief, End of Day, digests, sign-in codes…);
  3. otherwise the old mail relay (unchanged fallback).
- Microsoft throttling (429/5xx) → the email waits in `ms_queue`; the cron (every 2 min) sends max 25 per sender per run (~12/min, under Exchange's 30/min).
  `queueMail(env, sender, msgs)` is ready for bulk sends (e.g. "send reminder to 100 tenants"); progress: `GET /api/ms/batch?batch=`.
- If IT revokes consent or the user's sign-in is no longer valid, the user shows as disconnected (with the reason) and emails fall back to the relay.

## Set-up (once IT has registered the app)
Cloudflare → Workers & Pages → operations-hub → Settings → Variables and Secrets (type Secret):
`MS_TENANT_ID` (ae46b855-991f-4105-9c76-47a10e21d8ce) · `MS_CLIENT_ID` · `MS_CLIENT_SECRET`.
Entra app: single tenant, Web redirect URI `https://operations-hub.sultanachi-lb-61f.workers.dev/api/ms/callback`, delegated permissions above, admin consent.
Without the three secrets the feature is off and everything uses the old relay.

## Admin → Outlook sending (top of Hub administration)
Status, client secret expiry date (alerts to admins 30 / 7 / 1 days before, in the hub and by email), automatic sender, connected people, queue counts.
Secret renewal: paste the new value in `MS_CLIENT_SECRET` → Deploy, then update the date in Admin. Nobody reconnects.
