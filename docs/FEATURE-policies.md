# Policies & Procedures library (ABCON reads it)

`/tools/policies` — folder *Policies & Procedures*. Everyone in the hub can open it and search it; ABCON answers from it for everyone.

## Collections
Owner · Assist · ABC General Policies · Verdun Tenant Manual · SOPs · Emergency Procedures · Contacts · FAQ (`POL_COLLS` in `modules/policies.js`).

## Upload (Admin, Mall Manager / Senior Mall Manager, Operations Manager / Deputy)
1. **+ Upload policy** → PDF or Word (.docx), up to 25 MB → collection, title, version.
2. The browser reads the text (pdf.js for PDF, mammoth for Word, from cdnjs) page by page, finds the headings ("7.2 Deliveries…", "SECTION 4", "Chapter 3") and cuts the text into passages of about 900 characters, each with its page and section.
3. The passages go to the hub database (`pol_chunks` + the search index `pol_fts`, SQLite FTS5 with English stemming: "delivery" finds "deliveries"). The original file goes to the R2 bucket **abc-hub-files** (binding `FILES`). The document goes live only when both are stored.
4. **New version** replaces the old document (and its file) when the new one is live.
5. A scanned PDF (a photo of pages) has no text: it is marked "no text — ABCON cannot read it". Upload the text version instead.

## Meaning search
After an upload the hub embeds every passage (Workers AI `@cf/baai/bge-m3`, multilingual; a few Neurons per document, counted in ABCON's daily allowance). Vectors are stored in `pol_vec` (8-bit) and searched in memory; results are merged with the word search. If the allowance is low, the cron finishes the embeddings later (the list shows "meaning search: N passages to go").

## Reading and search
- **Search** across every document (or one collection): best passages first, with the words highlighted, the document, section and page.
- **Read**: the document's text page by page (works on every phone and for Word files), opened on the page ABCON cited; **Open original PDF** opens the file on that page.
- The documents are in English, so search in English; ABCON understands Arabic questions (it searches with English words).

## Technical
- `modules/policies.js`: `polSchema`, `polRoute` (routes `/api/pol/list|search|doc|file|save|remove`), `polSearch` (used by ABCON in `modules/ai.js`).
- Access: `policies` in `APP_ACCESS` / `apps.js` is open to every title; changes: `role ADMIN or MANAGER`.
- Deploy: `.github/workflows/deploy.yml` creates the bucket `abc-hub-files` before the hub deploy (ignored when it exists).
- The Drive backup skips the search index (`pol_fts*`); it is rebuilt from `pol_chunks` on the next upload.
