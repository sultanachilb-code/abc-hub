# ABCON — ABC Operations Control (the Hub Assistant, free AI)

The assistant is called **ABCON** (ABC + Control). It opens from the **✦ Ask ABCON** bubble at the bottom right of the landing page (icon only on phones, above the emergency button); the bubble hides inside tools and while the chat is open.

Runs on **Cloudflare Workers AI** — the `AI` binding in `wrangler.jsonc`. No API key, no card.

- **Model**: `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (the stronger free model), with `@cf/meta/llama-3.1-8b-instruct` as the backup. Set `AI_MODEL` to change it.

## What ABCON answers from
1. **Today's hub data** at the chosen flagship — only what that person can open in the hub (shifts, handover, deadlines, contractors, Quick Passes, patrol, GLA occupancy, Snaglist / incidents / restroom figures, open malfunctions, tenant feedback, meeting actions, contracts ending).
2. **The Policies & Procedures library** (docs/FEATURE-policies.md): for each question the hub finds the 4 best matching passages and gives them to ABCON. ABCON quotes the rule and cites it as P1, P2…; the chat shows each source (document · section · page) as a link that opens the reader on that page. An Arabic question is turned into English search words first (small model, very cheap).
3. General know-how (how to word a message, handle a situation) — ABCON says when that is general advice and not ABC policy.

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
