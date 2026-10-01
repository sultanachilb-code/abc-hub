# Tenant Works Forms

RDM sends a tenant works form (PDF). A supervisor forwards the email to the flagship's hub address; the PDF lands in **Tenant Works Forms** (Tenant Management) and the team signs it in the hub.

## Forms and steps
| Form | Code | Steps in the hub |
|---|---|---|
| Approval to Start on Site | F06.5 | Operations **acknowledge** (no signature box for Operations) |
| Handover to Beneficiary (C&S / DS) | F06.2 | **Operations Rep** signs → **Beneficiary** (tenant) signs on our device |
| Approval to Trade | F08.2 | Operations **acknowledge** (Operations Manager is in Cc) |
| Return of Area to ABC | F09.1 | **Operation Manager** box — a supervisor or the manager signs |

Steps live in `WORK_TYPES` (modules/works.js) — change them there.

## Flow
1. Forward the RDM email to `<hub gmail>+works-<vrm|acm|dbs|vrs|acs>-<TAG>@gmail.com`.
2. The Gmail script (`hub-works-inbox.gs`, every 5 min) posts the PDF to `POST /api/inbox/works` with the `x-inbox-key` header (secret `INBOX_KEY`). Only active hub users with access to that flagship are accepted; PDF only, 8 MB max; the same email is never added twice.
3. The hub raises a notification (pushed to phones): "Tenant work form received".
4. In the hub: the form type and tenant are detected from the PDF (title / form code; any GLA tenant name found in the text, file name or subject). The tenant list includes every GLA tenant — open, fit-out, closed, terminated.
5. Signing: the signature pad → the hub finds the form's own box ("Operations Rep", "Beneficiary Name", "Operation Manager") and stamps the signature, name and date/time; the signer checks it and confirms (or taps "Move"). Scanned PDFs: tap where to sign.
6. Completed → notification "Tenant work form completed". The signed PDF stays in the hub (download any time; the original is kept too).

## Technical
- Tables `works_forms`, `works_blobs` (PDF stored as base64 chunks; original v0 + latest signed version). Blobs are left out of the weekly backup.
- Stamping runs in the browser with pdf-lib (`tools/pdf-lib.min.js`, MIT); text positions come from pdf.js.
- Who can sign/acknowledge: supervisors and managers of the flagship. Delete: managers.
- "+ Add form" uploads a PDF directly (no email needed).
