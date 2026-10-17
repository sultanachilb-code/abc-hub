# Cleaning Control + the cleaner app

Cleaning schedule, before / after photos and compliance for the 5 flagships (VRM, VDS, ACH, ADS, DDS).

## Pieces

| Piece | Where | Who |
|---|---|---|
| Cleaner app (EN / AR / বাংলা) | `cleaning-worker/` → worker `abc-cleaning` (`abc-cleaning.sultanachi-lb-61f.workers.dev`) | cleaning supervisors and the cleaning company manager, on paired phones |
| Hub object **Cleaning Control** | `tools/cleanctl.html` (folder *Upcoming - Testing*) | MM, OM, SMS, MS, MO, LEAD |
| Shared logic | `modules/cleanctl.js` (+ `cleanctl-seed.js`, Verdun v3 schedule) | both workers |

Both workers use the same D1 database (`hub-db`). Photos live in the R2 bucket `abc-cleaning-photos`, which only the cleaning worker can reach; the hub shows them through signed links (secret kept in `meta` key `cc:sign`, made automatically — no secrets to set).

## Cleaner app

1. Operations pair the phone once from **Phones** (QR / link, valid 30 minutes). Two kinds:
   - **Cleaner phone**: up to 10 people, each with a 4-digit PIN and a language.
   - **Manager phone**: one per flagship for the cleaning company manager; shows the day's progress, what is late, by supervisor, specials and photos.
2. Person taps their name → PIN → today's list, late first, done last; floor chips; Daily / Deep tabs. Special tasks show on top.
3. Area → **before** photo → **after** photo → sent. Photos are shrunk on the phone (1024 px, quality 0.6, plus a 320 px thumbnail).
4. No signal: jobs and photos wait in the phone and send themselves when it is back.

Removing or re-pairing a phone cuts the old phone off at once.

## Hub object tabs

- **Today**: progress, late / missed / coming up, by floor.
- **Schedule**: week table for daily tasks (click a cell to set times, e.g. `07:00, 15:00`); month calendar for deep cleaning (weekly, monthly, every N days, or exact dates). Add, edit, remove tasks.
- **Photos**: before / after per area for a day; Print = daily photo report; monthly pack link.
- **Analysis**: compliance against the schedule, per day, per floor, most missed areas, per supervisor, headcount (from Cleaning Headcount) vs contract. Counting starts the day the first phone was paired at that flagship.
- **Special tasks**: one-off jobs with an optional photo; they appear first on the cleaner phones and close themselves when done.
- **Phones**: pair, edit users and PINs, remove.

Verdun is seeded once from the v3 schedule; the other 4 flagships build theirs in the Schedule tab.

## Status rules

- Late = 60 minutes after the scheduled time and not done. Earlier past items are "due".
- Compliance today = done ÷ due so far; past days = done ÷ scheduled.

## Retention and monthly pack

- Photos are deleted after 90 days (cleaning worker cron, 00:30 UTC). The job record stays.
- On the 1st of each month the hub raises "Monthly cleaning pack · <month> is ready" per flagship; the pack is listed in **Downloads → Monthly cleaning packs** and opens ready to print / save as PDF.

## Shift Handover

A **Cleaning schedule** section (page and email): late items grouped by floor, in-progress jobs, what is coming up, and special tasks.

## Deploy

GitHub Actions creates the R2 bucket (if R2 is enabled on the account), builds and deploys `abc-cleaning`. These steps are `continue-on-error`, so a cleaning problem never blocks the hub deploy.
