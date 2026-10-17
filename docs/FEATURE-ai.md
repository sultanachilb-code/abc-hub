# ABCON — ABC Operations Control (the Hub Assistant, free AI)

The assistant is called **ABCON** (ABC + Control). It opens from the **✦ Ask ABCON** bubble at the bottom right of the landing page (icon only on phones, above the emergency button); the bubble hides inside tools and while the chat is open.

Runs on **Cloudflare Workers AI** — the `AI` binding in `wrangler.jsonc`. No API key, no card.

- **Model**: `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (the stronger free model), with `@cf/meta/llama-3.1-8b-instruct` as the backup. Set `AI_MODEL` to change it.

## What ABCON answers from
1. **Today's hub data** at the chosen flagship — only what that person can open in the hub (shifts, handover, deadlines, contractors, Quick Passes, patrol, GLA occupancy, Snaglist / incidents / restroom figures, open malfunctions, tenant feedback, meeting actions, contracts ending).
2. **The Policies & Procedures library** (docs/FEATURE-policies.md): for each question the hub finds the 4 best matching passages (by meaning and by words) and gives them to ABCON. ABCON quotes the rule and cites it as P1, P2…; the chat shows each source (document · section · page) as a link that opens the reader on that page. An Arabic question is turned into English search words first (small model, very cheap).
3. General know-how (how to word a message, handle a situation) — ABCON says when that is general advice and not ABC policy.

## The window (Oct 2026)
- **Logo**: the ABC|ON wordmark (ABC logo + ABC**ON** in gold + green "online" light) in the header; the ABC mark with the green light on the home bubble and next to each answer.
- **Tabs**: Chat · Teach (Admin, Mall Manager, Operations Manager; a red number = 👎 answers waiting) · History (your chats, 30 days, only you see them).
- **Structured answers**: ABCON answers in a fixed format — title, a type label (Policy · Live data · General advice · Mixed), bullets, tables for times and figures, numbered steps, the exact rule in a gold box. The window turns it into a card.
- **Written word by word** (streaming, `/api/ai/chat` with `stream: true` returns Server-Sent Events).
- **Source cards** under the answer: policy (document · section · page → opens the reader on that page). Taught facts are used silently — never shown or cited to the user.
- Under each answer: Copy · Share (phone share sheet or email) · 👍 · 👎 (with "what was wrong?"), then 3 follow-up questions to tap.
- ⤢ expands to a tall side panel on desktop; full screen on phones; ↺ starts a new chat.

## Other ABC databases (read-only, Oct 2026)
The hub Worker has four more D1 bindings that ABCON only reads (`modules/extdb.js`, SELECT queries only):

| Binding | Database | System | ABCON gets | Who |
|---|---|---|---|---|
| `SNAG_DB` | abc-snaglist | Snaglist Manager | open snags by list type, oldest open, solved in 7 days, places with repeated snags | can open Snaglist |
| `INC_DB` | abc-incidents | Incident Report System | incidents 30 days by type / severity, still open, overdue post-incident reports, blacklist counts (no names) | can open Incidents |
| `RR_DB` | abc-restroom-db | Restroom Inspection | today's inspections and cleaning checks, most repeated problems in 7 days | can open Restroom |
| `AUDIT_DB` | abc-audit-db | ABC Audit | latest audit, open findings by grade, overdue and repeat findings | management and leadership |

Not connected on purpose: `abc-dashboard-users` (logins only) and the wedding-venue database (not ABC). No visitor names or contact details are ever given to ABCON.

## Smarter and faster
- **Teach ABCON** (`ai_facts`): managers add facts for one flagship or all flagships; ABCON reads them before every answer and trusts them above everything else (cited as T1, T2…).
- **Review 👎** (`ai_feedback`): every 👎 lands in Teach → "Answers to review"; write the correct answer → **Teach ABCON** turns it into a fact (or Dismiss).
- **Meaning search**: every policy passage gets an embedding (`@cf/baai/bge-m3`, multilingual) stored in D1 (`pol_vec`, 8-bit); questions are matched by meaning and by words together, so "can shops get stock in the afternoon?" finds the delivery rule, and Arabic questions find English rules. New uploads are embedded right after upload; the cron finishes anything left.
- **30 days of memory**: repeated malfunctions (same asset and place), how long each open malfunction has been open, tenants with repeated feedback / violations.
- **Fast routing**: short, simple questions go to `@cf/meta/llama-3.1-8b-instruct-fp8-fast` (about 1/7 of the cost); analysis, lists and drafting go to the 70B model. The big model takes over if the fast one fails.

## Usage guard — never pay anything
Cloudflare gives **10,000 free Neurons a day** per account (resets 00:00 UTC = 03:00 Beirut). On the Workers Paid plan anything above is billed, so ABCON guards it:

| Limit | Value | What the person sees |
|---|---|---|
| Team | ABCON closes at **80 %** of the free allowance (8,000 Neurons) | "ABCON is resting … back on Sun 18 Oct at 03:00 (Beirut time)" |
| Person, per day | **15 questions** (Admin: no personal limit) | "You have asked your 15 questions for today … back on …" |
| Person, asking again and again | **4 questions in 5 minutes** | "You are asking very quickly … back at 16:57" |
| Same question again (15 min) | answered from memory — free, not counted | "Same question as at 16:52 — same answer, not counted" |

- Every answer's real use is counted from Cloudflare's token counts (Neurons per million tokens from the Workers AI price list, in `RATES` in `modules/ai.js`). Before each answer the hub also checks that the answer cannot cross the line.
- If Cloudflare itself reports the allowance is used up (e.g. another app on the account used it), ABCON closes for the day at once.
- The chat shows "N of 15 questions left today" and a small bar with the team's use. The admin sees the Neurons in `/api/ai/status`.
- Settings: `FREE_NEURONS`, `CLOSE_AT`, `USER_DAILY`, `USER_BURST`, `USER_WINDOW`, `CACHE_MIN` at the top of `modules/ai.js`; the `AI_DAILY_NEURONS` variable overrides the free allowance figure.
- Note: the allowance is per Cloudflare account. Other Workers on the account that use AI share it; ABCON only counts its own use (plus Cloudflare's "used up" signal).

## Shift summary (Shift Handover → ✦ ABCON · shift summary)
A short summary of the shift in English and Arabic from the day's hub data and the Incident system. It counts as one question. Check it, then **Add to the handover notes**.

Technical: `modules/ai.js`, routes `GET /api/ai/status`, `POST /api/ai/chat`, `POST /api/ai/summary`.
If the GitHub deploy ever fails on the AI binding, give the Cloudflare API token used by the deploy the **Workers AI** permission.

## When it does not answer
- The admin sees Cloudflare's own error message in the chat (everyone else: "try again in a minute").
- Open `/api/ai/status?test=1` signed in as admin for a one-tap check (`"ok": true` = working).
- If the first model fails, the hub tries the backup model once.
