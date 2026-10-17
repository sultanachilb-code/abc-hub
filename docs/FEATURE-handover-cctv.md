# PM handover → CCTV room emails (Oct 2026)

The PM shift handover is also sent to the flagship's CCTV room.

**Set up (admin):** Hub administration → People → the flagship → **ABC Operations Groups** → *CCTV emails · PM handover*.
Up to 5 addresses, comma separated (e.g. the 3 CCTV room emails). Save group. Kept in `meta 'opsgroups'` as `cctv` per flagship.

**What happens**
- When the **PM** handover is submitted and the hub emails it automatically, the CCTV emails are added to **To** (next to the group email; managers stay in Cc). The submit confirmation shows them.
- *Email this handover* with **PM** selected: the Outlook draft (`.eml`) and the "copy + new email" option open with the CCTV emails already in **To**; the dialog shows them under the subject.
- AM / Mid / Night handovers are not sent to CCTV.
- `GET /api/ops/handover/mailto?site=&shift=PM` returns the recipients including `cctv`.


## Update

- The **Email in Outlook** button was removed from the Shift Handover page. The handover email is still sent automatically on submit (PM also to the CCTV emails).
- The handover page and email now include a **Cleaning schedule** section from Cleaning Control (see FEATURE-cleaning-app.md).
