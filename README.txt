ABC Operations Hub — Two-step login (30 Sep 2026) — separate package
Install: copy worker.js, index.html, modules/twofa.js (new), tools/qrcode.js (new), docs/ into the abc-hub folder (replace), then deploy.
No database steps — the tables are created on the first request. Nobody is affected until you turn it on.

Turn it on safely (recommended order)
1. Yourself first: Profile settings → Two-step login →
     on your phone (hub on the Home Screen, alerts on): "Use this phone"  → Face ID once → save the 8 backup codes
     and/or "Authenticator app → Set up" (QR on the laptop, or "Add to authenticator app" on the phone).
2. Sign out and sign in on the laptop: you get a number → tap the phone notification → pick the number → Face ID → green tick.
3. Hub administration → People & roles → Two-step login → tick the roles that must use it
   (suggested: Hub administrators, Property Advisor, Mall Directors, CDSO, Mall / Operations Managers). Save.
   People in those roles set it up at their next sign-in.
4. Lost or changed phone: People & roles → "Reset 2-step" on that person.

To go back: copy revert/worker.js and revert/index.html over the abc-hub folder and deploy (sign-in returns to password only).
