/* =====================================================================
   Small spreadsheet reader for the Worker (no library): .xlsx (first sheet) and .csv
   → array of rows (arrays of strings / numbers). Used by the email inbox (contracts report).
   ===================================================================== */
const td = new TextDecoder();
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

async function inflate(bytes) {
  const ds = new DecompressionStream("deflate-raw");
  const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}
/* zip → { name: Uint8Array } for the names asked */
async function unzip(b, want) {
  let e = b.length - 22;
  while (e >= 0 && u32(b, e) !== 0x06054b50) e--;
  if (e < 0) throw new Error("Not an Excel file (.xlsx)");
  const n = u16(b, e + 10); let p = u32(b, e + 16);
  const out = {};
  for (let i = 0; i < n; i++) {
    if (u32(b, p) !== 0x02014b50) break;
    const method = u16(b, p + 10), csize = u32(b, p + 20), nl = u16(b, p + 28), xl = u16(b, p + 30), cl = u16(b, p + 32), lo = u32(b, p + 42);
    const name = td.decode(b.subarray(p + 46, p + 46 + nl));
    p += 46 + nl + xl + cl;
    if (!want(name)) continue;
    const start = lo + 30 + u16(b, lo + 26) + u16(b, lo + 28);
    const data = b.subarray(start, start + csize);
    out[name] = method === 0 ? data : method === 8 ? await inflate(data) : null;
  }
  return out;
}
const ent = s => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, k) => ({ lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" }[k.toLowerCase()]
  ?? String.fromCodePoint(k[1].toLowerCase() === "x" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10))));
const texts = xml => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => ent(m[1])).join("");
const colIdx = ref => { const L = ref.replace(/\d+/g, ""); let n = 0; for (const c of L) n = n * 26 + (c.charCodeAt(0) - 64); return n - 1; };

export async function readXlsx(bytes) {
  const files = await unzip(bytes, n => n === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(n) || n === "xl/workbook.xml" || n === "xl/_rels/workbook.xml.rels");
  const ss = files["xl/sharedStrings.xml"] ? [...td.decode(files["xl/sharedStrings.xml"]).matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => texts(m[1])) : [];
  /* first sheet in the workbook order */
  let sheet = "";
  try {
    const wb = td.decode(files["xl/workbook.xml"]), rels = td.decode(files["xl/_rels/workbook.xml.rels"]);
    const rid = (/<sheet\b[^>]*r:id="([^"]+)"/.exec(wb) || [])[1];
    const tgt = (new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels) || new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels) || [])[1];
    if (tgt) sheet = "xl/" + tgt.replace(/^\/?xl\//, "").replace(/^\//, "");
  } catch {}
  if (!files[sheet]) sheet = Object.keys(files).filter(n => /worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)))[0];
  if (!sheet) throw new Error("No sheet found in the Excel file");
  const xml = td.decode(files[sheet]);
  const rows = [];
  for (const rm of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row = [];
    for (const cm of (rm[1] || "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], inner = cm[2] || "";
      const ref = (/\br="([A-Z]+\d+)"/.exec(attrs) || [])[1];
      const t = (/\bt="([^"]+)"/.exec(attrs) || [])[1] || "";
      const v = (/<v>([\s\S]*?)<\/v>/.exec(inner) || [])[1];
      let val = "";
      if (t === "s") val = ss[Number(v)] ?? "";
      else if (t === "inlineStr") val = texts(inner);
      else if (t === "str" || t === "e") val = v != null ? ent(v) : "";
      else if (t === "b") val = v === "1";
      else val = v != null && v !== "" ? Number(v) : "";
      row[ref ? colIdx(ref) : row.length] = val;
    }
    rows.push(Array.from(row, x => x ?? ""));
  }
  return rows;
}
export function readCsv(text) {
  const rows = []; let row = [], cur = "", q = false;
  const sep = (text.split("\n")[0].match(/;/g) || []).length > (text.split("\n")[0].match(/,/g) || []).length ? ";" : text.includes("\t") && !text.includes(",") ? "\t" : ",";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur.replace(/\r$/, "")); rows.push(row); row = []; cur = ""; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur.replace(/\r$/, "")); rows.push(row); }
  return rows;
}
export async function readSheet(name, b64) {
  const bin = Uint8Array.from(atob(String(b64).replace(/^data:[^,]*,/, "").replace(/\s+/g, "")), c => c.charCodeAt(0));
  if (/\.csv$/i.test(name) || /\.txt$/i.test(name)) return readCsv(new TextDecoder().decode(bin));
  if (bin[0] === 0x50 && bin[1] === 0x4b) return readXlsx(bin);
  if (/\.html?$/i.test(name) || /<table/i.test(new TextDecoder().decode(bin.subarray(0, 4000)))) {   // also the report inside an email body   // "Excel" exports that are really HTML tables (Salesforce)
    const html = new TextDecoder().decode(bin);
    return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(r => [...r[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => ent(c[1].replace(/<[^>]+>/g, "")).trim()));
  }
  throw new Error(`${name}: only .xlsx or .csv files can be read (save old .xls files as .xlsx)`);
}
