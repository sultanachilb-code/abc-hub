# Report mailbox (Oct 2026)

The Salesforce reports arrive by email in an ABC Microsoft 365 mailbox, `opsverdunmall@abc.com.lb`. Each subscription sends one report per email and covers all flagships. Every morning the Hub imports them and splits each report per flagship.

## Set up (once)
1. In the mailbox, create a folder **Hub Reports**. Add an Outlook rule: from the Salesforce sender / IT → move to **Hub Reports**.
2. Go to Admin Control Center → **Report mailbox** and connect the mailbox:
   - **Sign in as opsverdunmall@abc.com.lb** if it has its own password; this uses Mail.Read.
   - Or **sign in as myself** if you open it as a shared mailbox with Full Access; this uses Mail.Read.Shared.
3. Microsoft asks to allow "Read mail". If it says *Need admin approval*, IT approves the Hub app (Microsoft Graph delegated Mail.Read and Mail.Read.Shared).
4. Press **Test read (no import)**. It shows each email, the report found, its rows and the count per flagship. Nothing is saved.
5. Press **Import now**, then tick **Import automatically every morning**.

## How it runs
- **Window:** 07:00–08:00 Beirut. The folder is read every 10 minutes, covering the last 3 days, so a report that arrives late is imported the next morning. Each email is imported once (`mb_log`). **Import now** also retries the emails that failed.
- **Read only:** nothing is sent, moved or deleted in the mailbox.
- **Report types:** the same imports as the Gmail inbox and the page upload:
  - portal reports VR / BP / NR / MKT / CP and Active Users (`portalImport`);
  - Contracts near ending (`contractsImport`);
  - the report inside the email body when there is no attachment.
- **08:05 missing check:** each expected report that has no import today, from any source (mailbox, Gmail or upload), triggers a notification to the administrators and an event on each flagship.
- **Errors:** if the mailbox cannot be read, the administrators get one notification per day.

## Code
- `modules/mailbox.js` (`mbSchema`, `mbRun`, `mbRoute`, `mbPass`)
- `modules/outlook.js` (`rmb*`: separate sign-in with scope `offline_access User.Read Mail.Read Mail.Read.Shared`, the token sealed in `meta rmb:tok`)
- `tools/admin.html` page `mb`
- Settings: `meta mb:cfg`
- Routes: `/api/admin/cc/mailbox` (GET), `…/save`, `…/connect`, `…/disconnect`, `…/test`, `…/run`
