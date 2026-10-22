# Follow-ups — personal flags from Outlook (Oct 2026)

Each person's own assistant: flag an email from the Outlook add-in, the hub reminds them and shows it on the home page.

## Outlook add-in (outlook-addin/taskpane.html, pinnable)
- Purple banner with the ABC logo (no flagship). First time: choose the flagship (pre-selected from the hub account; remembered in Outlook's roaming settings; "Change flagship" in the footer).
- Three tabs: **🚩 Follow up** (default) · **🗂 My flags (n)** — all open follow-ups: Overdue / Today / Tomorrow / This week / Later, then 📝 Notes; tap = open the email in Outlook (`displayMessageForm`), ✓ = done · **⚡ One tap**.
- **Follow up**: the email's subject filled in · Due: Today / Tomorrow / Monday / 📅 Pick a date (opens a date field) / 📝 Note (no due date, no reminder) · Priority: High (red) / Medium (orange) / Low (yellow) → "🚩 Flag".
  Flagged emails show a card with Done / Change / Remove. Flagging the same email again changes its date/priority.
- **One tap, nothing to type**:
  Works = all PDF attachments → Tenant Works Forms · Handover = "sender: subject" in today's handover ·
  Calendar = Ops activity on the follow-up date (or today) · Feedback = tenant feedback (tenant found as a whole word in subject/body/sender's company domain, else "To check (from Outlook)"; Operations Violation · Other — edit in the hub).

## Hub
- Table `followups` (personal: only the owner can see or change them). Routes `/api/fu/{list,all,item,save,done,later,remove}` (hub session or add-in token).
- Notes (no due date) are listed under **📝 Notes** in the same section (folded when there are dated items); "Remind tomorrow" gives a note a date.
- Home page **"Action needed · your follow-ups"** between Day to Day and All tools: overdue + today, then tomorrow; High first; Done / +1 day / Open email. Hidden when nothing is due.
- Reminders (hub notification + phone push, only to the owner): the day before and on the due day, from 09:00 Beirut (checked hourly 09:00–21:00).
- Done follow-ups are deleted after 90 days.

## Not yet (needs Mail.ReadWrite from IT)
Setting Outlook's own red flag on the email, and "tell me if no reply".
