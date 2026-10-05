# ABC Hub in Outlook (add-in)

An **“ABC Hub”** button on every email (Outlook for Windows, Mac, Outlook on the web and the Outlook mobile app). It opens a side panel that can:

1. **Works form** — send the email's PDF attachments to Tenant Works Forms.
2. **Handover** — add the email as a line in today's shift handover (Today / Tomorrow / Scheduled works, ATT CCTV).
3. **Feedback** — log it as tenant feedback (tenant, type, description, action, details).
4. **Calendar** — add it to the Operations Calendar as a marketing event, ops activity or **expiry date**.

## First use (each person, once per Outlook)
Hub → your picture → **Profile settings → Outlook → Connect Outlook** → a 6-digit code (10 minutes).
In Outlook press **ABC Hub** → type your work email and the code → *Connect*. It stays connected 120 days (and follows you to your other Outlooks).
Disconnect from the panel, or from Profile settings → Outlook.
The connection can only add and read operations data — never administration, people or two-step settings.

## Install (IT — Microsoft 365 admin center, once for everyone)
1. Download the manifest: `https://operations-hub.sultanachi-lb-61f.workers.dev/outlook-addin/manifest.xml`
2. **admin.microsoft.com → Settings → Integrated apps → Upload custom apps** → *Office Add-in* → *Upload manifest file (.xml)* → choose the file.
3. Assign to: the operations users (or a group), *Fixed* deployment → Accept → Finish. It appears in Outlook within 6–24 hours.

Test alone first (no admin): Outlook on the web → open an email → **⋯ → Get Add-ins → My add-ins → Add a custom add-in → Add from file** → manifest.xml.

Files: `outlook-addin/manifest.xml`, `outlook-addin/taskpane.html`, icons · `modules/addin.js` (tables `addin_tokens`, `addin_codes`) · `POST /api/ops/handover/append`.
Test page without Outlook: `/outlook-addin/taskpane?demo=1`.
