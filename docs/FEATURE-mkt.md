# Marketing Participation (Upcoming - Testing)

The operations team sends marketing activation memos to tenants on behalf of Marketing and collects a Yes/No answer.

- **New activation** — title, message, activity dates, start (send) day, reply-by day, memo PDF (optional, 8 MB).
- **Audience** — open tenants of the chosen flagships (GLA, Leasing, not vacant/warehouse), filtered by **sub-category** (GLA department).
  Emails come from the **Tenants Directory** contacts, filtered by **position** (e.g. CRM, Marketing, Store Manager — none selected = all contacts).
  The preview lists every tenant: untick to leave one out, type an email where one is missing.
- **Email** — branded, with the memo link and two buttons **✓ Participating / ✗ Not participating** (personal links `/mk/<token>?a=yes|no`, no account).
  The tap records the answer; the page then asks (optional) for the offer + details + contact, or a reason + comment. The tenant can switch until the reply-by date.
- **Reminders** — every day at 09:00 from the start day to the reply-by day to tenants who haven't answered, plus **🔔 Remind no-reply** (all or one flagship) and 🔔 per tenant.
- **Dashboard** — per flagship: % participating (÷ tenants invited), % answered, yes / no / no reply. Filters (All, Participating, Not, No reply, No email), ✎ edit emails or record an answer given by phone, 🔗 copy the tenant link, CSV export, change reply-by, close.
- After the reply-by date: one summary alert per flagship to the operations team ("mkt-ops").
- Emails: Outlook automatic sender queue when set, otherwise the mail relay.
- Code: `modules/mkt.js`, `tools/mkt.html`, `tools/mktenant.html`; cron `mkRun` once a day from 09:00.

## Email design & tenant page colours (26 Oct 2026)
- Admin Control → **Tenant pages & emails**:
  - Marketing email design: **A Classic memo · B Branded card (default) · C Executive minimal** — live previews of the first email and the daily reminder, optional Arabic line. Buttons are Outlook-safe table cells.
  - Pages behind tenant / visitor links (marketing answer page, PM upload page, Quick Access Pass): **Light (default) · Dark · Follow the device** (`/api/ext-cfg`, `meta ext:cfg`).
