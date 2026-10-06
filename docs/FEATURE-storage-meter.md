# Cloudflare storage meter (admin)

Hub administration shows a **Cloudflare storage** bar under the mail quota, and a **Storage** tab. Both compare usage with the free allowance, so you see it before Cloudflare starts charging.

- **R2 (all buckets of the account):**
  - Data stored and number of files, per bucket.
  - This month's Class A operations (writes: uploads, lists) and Class B operations (reads).
  - Read from the Cloudflare GraphQL Analytics API (`r2StorageAdaptiveGroups`, `r2OperationsAdaptiveGroups`).
- **Hub database (D1):** its size, read from the database itself.
- **Free allowance used:** 10 GB R2 storage, 1 M Class A and 10 M Class B operations a month, and 5 GB D1. If the plan changes, override them with `R2_FREE_GB`, `R2_FREE_CLASS_A`, `R2_FREE_CLASS_B` and `D1_FREE_GB`.
- **Alerts:** a daily check (after 09:00) notifies the administrators at **80 %** and again at **95 %** of any allowance, once per level each month.
- **Caching:** results are kept for 30 minutes. *Refresh* reads them again.

## Set-up (once)
1. Cloudflare → **My Profile → API Tokens → Create token** → *Custom token* → permission **Account · Account Analytics · Read**, for your account.
2. Workers → **operations-hub** → Settings → Variables and Secrets:
   - secret **CF_API_TOKEN** = the token
   - variable **CF_ACCOUNT_ID** = Account home → Account ID

Until then, the meter shows the database size and these steps.
