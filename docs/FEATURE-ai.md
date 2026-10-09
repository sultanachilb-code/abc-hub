# Hub Assistant (free AI)

Runs on **Cloudflare Workers AI** — the `AI` binding in `wrangler.jsonc`. No API key, no card, nothing to pay.

- **Free allowance**: 10,000 Neurons a day for the Cloudflare account (resets 00:00 UTC). When it is used up, the assistant says so until the next day — nothing is charged. Each person can ask 25 questions a day so the allowance lasts for the team.
- **Model**: `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (the stronger free model), with `@cf/meta/llama-3.1-8b-instruct` as the backup. Set `AI_MODEL` to change it.

## Chat (AI button → Hub Assistant)
Questions about today at a flagship, in English or Arabic. The hub gives the model a short summary of only what that person can open in the hub (shifts, handover, deadlines, contractors, Quick Passes, patrol, GLA occupancy, Snaglist / incidents / restroom figures, open malfunctions, tenant feedback, meeting actions, contracts ending). The model is told to answer only from it.

## Shift summary (Shift Handover → ✦ AI shift summary)
A short summary of the shift in English and Arabic from the day's hub data and the Incident system. Check it, then **Add to the handover notes**.

Technical: `modules/ai.js`, routes `GET /api/ai/status`, `POST /api/ai/chat`, `POST /api/ai/summary`.
If the GitHub deploy ever fails on the AI binding, give the Cloudflare API token used by the deploy the **Workers AI** permission.

## When it does not answer
- The admin sees Cloudflare's own error message in the chat (everyone else: "try again in a minute").
- Open `/api/ai/status?test=1` signed in as admin for a one-tap check (`"ok": true` = working).
- If the first model fails, the hub tries a second free model (`@cf/meta/llama-3.2-3b-instruct`) once.
