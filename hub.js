/**
 * ABC Operations Hub connector for the Incident Reporting system.
 *
 *   GET /api/hubstats?site=VRM   — badge + daily-brief figures for the hub
 *                                  (server-to-server, needs the x-hub-key header)
 *   GET /api/sso?token=…         — one-minute pass from the hub → signs the
 *                                  person in with their OWN incident account
 *
 * The hub only vouches for WHO the person is (same email). Their role,
 * flagships and permissions still come from this system's users table.
 */
import { json } from '../http.js';
import { signJwt } from '../auth.js';
import { FLAGSHIPS } from '../policy.js';

/* Hub flagship codes → this system's flagship names */
const HUB_SITES = {
  VRM: 'Verdun Mall',
  ACM: 'Achrafieh Mall',
  DBS: 'Dbayeh Mall',
  ACS: 'Achrafieh DS',
  VRS: 'Verdun DS'
};

/* Where the Incident web app keeps its sign-in in the browser.
   Check: open the Incident system, F12 → Application → Local storage →
   your site address, and make these two names match what you see there. */
const TOKEN_KEY = 'abcops.token';
const USER_KEY = 'abcops.user';

const enc = new TextEncoder();
function b64url(bytes) {
  let s = '';
  new Uint8Array(bytes).forEach(b => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
}
function same(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
/* JSON string literal that is safe inside <script> */
const safe = v => JSON.stringify(v).replace(/</g, '\\u003c');
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

/* ---------- figures for the hub ---------- */
export async function hubStats(request, env) {
  if (!env.HUB_KEY || !same(request.headers.get('x-hub-key'), env.HUB_KEY)) {
    return json({ ok: false, error: 'Not authorised' }, 403);
  }
  const url = new URL(request.url);
  const code = String(url.searchParams.get('site') || 'ALL').toUpperCase();
  const flagship = HUB_SITES[code] && FLAGSHIPS.includes(HUB_SITES[code]) ? HUB_SITES[code] : 'ALL';
  const now = new Date().toISOString();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Beirut' });

  const [inc, bl] = await Promise.all([
    env.DB.prepare(`
      SELECT
        SUM(CASE WHEN status IN ('Open','In Progress') THEN 1 ELSE 0 END) AS open_n,
        SUM(CASE WHEN pir_due_at IS NOT NULL AND pir_submitted_at IS NULL THEN 1 ELSE 0 END) AS pir_n,
        SUM(CASE WHEN pir_due_at IS NOT NULL AND pir_submitted_at IS NULL AND pir_due_at < ?1 THEN 1 ELSE 0 END) AS pir_late,
        SUM(CASE WHEN incident_date = ?2 THEN 1 ELSE 0 END) AS today_n
      FROM incidents WHERE (?3 = 'ALL' OR flagship = ?3)
    `).bind(now, today, flagship).first(),
    env.DB.prepare(`
      SELECT COUNT(*) AS n FROM blacklist
      WHERE access_status = 'Pending review' AND (?1 = 'ALL' OR flagship = ?1)
    `).bind(flagship).first()
  ]);

  const open = Number(inc.open_n || 0);
  const pir = Number(inc.pir_n || 0);
  const pirLate = Number(inc.pir_late || 0);
  const todayN = Number(inc.today_n || 0);
  const blPending = Number(bl.n || 0);

  const badge = pir
    ? { count: pir, label: pir === 1 ? 'Level 2/3 awaiting report' : 'Level 2/3 awaiting reports', tone: pirLate ? 'alert' : 'warn' }
    : open ? { count: open, label: open === 1 ? 'open incident' : 'open incidents', tone: 'warn' } : null;

  return json({ ok: true, data: {
    badge,
    brief: [
      { label: 'Open incidents', value: open, tone: open ? 'warn' : 'ok' },
      { label: 'Level 2/3 awaiting report', value: pir, tone: pirLate ? 'alert' : pir ? 'warn' : 'ok' },
      { label: 'Logged today', value: todayN },
      { label: 'Blacklist pending review', value: blPending, tone: blPending ? 'warn' : 'ok' }
    ]
  } });
}

/* ---------- sign-in from the hub ---------- */
export async function hubSignIn(request, env) {
  const url = new URL(request.url);
  const toLogin = () => new Response(null, { status: 302, headers: { Location: '/', 'Cache-Control': 'no-store' } });
  try {
    if (!env.HUB_KEY || !env.JWT_SECRET) return toLogin();
    const [body, sig] = String(url.searchParams.get('token') || '').split('.');
    if (!body || !sig || !same(await hmac(env.HUB_KEY, body), sig)) return toLogin();
    const p = JSON.parse(new TextDecoder().decode(unb64url(body)));
    if (p.aud !== 'incidents' || !p.exp || p.exp < Date.now()) return toLogin();

    const row = await env.DB.prepare('SELECT * FROM users WHERE email = ?')
      .bind(String(p.e || '').trim().toLowerCase()).first();
    if (!row || row.active === 0) return toLogin();

    /* Same claims as a normal password sign-in (routes/auth.js → login) */
    const scope = String(row.flagship_scope || '').trim();
    const isAll = scope.toUpperCase() === 'ALL' || ['Admin', 'Property Advisor', 'Security Manager'].includes(row.role);
    const flagships = isAll ? ['ALL'] : scope.split(',').map(s => s.trim()).filter(s => FLAGSHIPS.includes(s));
    const claims = {
      uid: row.id, email: row.email, name: row.full_name, role: row.role,
      flagships, active: true, mustChangePassword: !!row.must_change_password
    };
    const token = await signJwt(claims, env.JWT_SECRET, 12 * 3600);

    /* The web app keeps its sign-in in local storage, so hand it over with a
       tiny page that stores it and opens the app. */
    const html = `<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer">
<title>Signing in…</title><body style="font-family:system-ui;color:#6D6479;display:grid;place-items:center;height:100vh;margin:0">Signing in…
<script>
try {
  localStorage.setItem(${safe(TOKEN_KEY)}, ${safe(token)});
  localStorage.setItem(${safe(USER_KEY)}, ${safe(JSON.stringify(claims))});
} catch (e) {}
location.replace('/');
</script>`;
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
    });
  } catch (e) {
    return toLogin();
  }
}

/* ---------- events for the hub's notification bell & push alerts ---------- */
const CODE_OF = Object.fromEntries(Object.entries(HUB_SITES).map(([code, name]) => [name, code]));
const SEV_TONE = s => String(s || '').includes('Level 3') ? 'alert' : String(s || '').includes('Level 2') ? 'warn' : 'info';

export async function hubNotify(request, env) {
  if (!env.HUB_KEY || !same(request.headers.get('x-hub-key'), env.HUB_KEY)) {
    return json({ ok: false, error: 'Not authorised' }, 403);
  }
  const url = new URL(request.url);
  const code = String(url.searchParams.get('site') || 'ALL').toUpperCase();
  const flagship = HUB_SITES[code] && FLAGSHIPS.includes(HUB_SITES[code]) ? HUB_SITES[code] : 'ALL';
  const since = String(url.searchParams.get('since') || new Date(Date.now() - 7 * 864e5).toISOString());
  const scope = flagship === 'ALL' ? '' : ' AND flagship = ?2';
  const q = (sql) => env.DB.prepare(sql + scope + ' ORDER BY 1 DESC LIMIT 60').bind(since, ...(flagship === 'ALL' ? [] : [flagship])).all();

  const [logged, breach, pirLate, black] = await Promise.all([
    q(`SELECT logged_at AS at, ref, flagship, type, severity FROM incidents WHERE logged_at > ?1`),
    q(`SELECT breach_alert_sent_at AS at, ref, flagship, type, severity FROM incidents WHERE breach_alert_sent_at > ?1`),
    q(`SELECT pir_overdue_alert_sent_at AS at, ref, flagship, type, severity FROM incidents WHERE pir_overdue_alert_sent_at > ?1`),
    q(`SELECT date_added AS at, id, name, flagship, reason FROM blacklist WHERE date_added > ?1`)
  ]);
  const events = [
    ...(logged.results || []).map(r => ({ id: `new-${r.ref}`, at: r.at, site: CODE_OF[r.flagship] || '',
      title: `New incident · ${r.type}`, body: `${r.ref} · ${r.flagship} · ${r.severity}`, tone: SEV_TONE(r.severity) })),
    ...(breach.results || []).map(r => ({ id: `sla-${r.ref}`, at: r.at, site: CODE_OF[r.flagship] || '',
      title: 'Escalation SLA breached', body: `${r.ref} · ${r.flagship} · ${r.type}`, tone: 'alert' })),
    ...(pirLate.results || []).map(r => ({ id: `pir-${r.ref}`, at: r.at, site: CODE_OF[r.flagship] || '',
      title: 'Post-incident report overdue', body: `${r.ref} · ${r.flagship} · ${r.severity}`, tone: 'alert' })),
    ...(black.results || []).map(r => ({ id: `bl-${r.id}`, at: r.at, site: CODE_OF[r.flagship] || '',
      title: 'Blacklist card added — pending review', body: `${r.name || 'Unnamed'} · ${r.flagship}`, tone: 'warn' }))
  ].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 100);
  return json({ ok: true, data: { events } });
}
