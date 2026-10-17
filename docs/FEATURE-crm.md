# CRM handhelds (Operations Tools)

`/tools/crm` — the CRM sheet (CRM_2026_Sheet.xlsx, Verdun Mall) kept as it is, in the hub. Open to MM, OM, SMS, MS, MO and leadership; the operations team and management edit (not Warehouse).

## Tabs
- **Handhelds** — one line per device, the sheet's columns: Floor · Tenant name · SKU · CRM · Status · Delivery date · Serial number (S/N) · Model · Connection · CRM app user name · CRM app password · Stamp. A tenant with two devices has a second "↳ 2nd device" line (＋ on a line adds one).
- **Retrieved H.H.** — the second sheet: Tenant · SKU · CRM · H.H. status · Retrieved date · S/N · Model · Connection · Given to.
- Totals at the top replace the sheet's COUNTIF cells: CRM Yes / No · Zebra · A07 · Wi-Fi · 3G · handhelds with an S/N · lines not linked to the hub.
- Filters: floor, CRM Yes / No, not linked; search by tenant, SKU, S/N. **Excel** downloads the table.

## Tenant names
- The bold name is the **real name from the hub's GLA** (the linked unit; the badge shows the unit code).
- **Sheet:** the name from the sheet is kept underneath and stays editable. Changing it re-links the line automatically (unless it was linked by hand).
- Lines are linked by name (exact, contained, or close spelling; same floor wins; the sheet's LG = the GLA's LGF). Tap the badge to link by hand, or choose "Not a hub tenant".
- At import, 158 of 163 tenants were linked automatically; the rest show "Not linked".

## Passwords
The CRM app password is masked (••••); 👁 shows it. Only people who can open CRM see the page.

Technical: `modules/crm.js` (+ `crm-seed.js` from the sheet, imported once per flagship), tables `crm_rows` and `crm_retrieved`, routes `/api/ops/crm/list|save|link|add|remove|rsave|relink|radd|rremove`.
