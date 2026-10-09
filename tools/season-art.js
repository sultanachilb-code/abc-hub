/* Seasonal decorations — the artwork (original drawings), shared by the home page and tools/seasons.html.
   SEASON_ART.hang(design, side, width) → HTML of the pieces hanging on ropes in a side space of `width` px.
   See docs/FEATURE-seasons.md */
(function () {
  const G = "#E8C66A";
  const SANTA = `<svg width="54" height="70" viewBox="0 0 92 120">
    <path d="M46 4 L70 30 Q74 38 66 38 L26 38 Q18 38 22 30 Z" fill="#D7263D"/><circle cx="70" cy="30" r="7" fill="#fff"/><rect x="20" y="34" width="52" height="9" rx="4.5" fill="#fff"/>
    <circle cx="46" cy="52" r="15" fill="#F6C9A8"/><circle cx="40" cy="50" r="2" fill="#3A2A2A"/><circle cx="52" cy="50" r="2" fill="#3A2A2A"/><circle cx="46" cy="56" r="3" fill="#E89A8A"/>
    <path d="M28 56 Q46 92 64 56 Q60 66 46 68 Q32 66 28 56 Z" fill="#fff"/>
    <path d="M24 74 Q46 66 68 74 L72 108 Q46 116 20 108 Z" fill="#D7263D"/><rect x="20" y="92" width="52" height="7" fill="#2A1A1A"/><rect x="42" y="91" width="9" height="9" rx="2" fill="#E8C66A"/>
    <path d="M24 76 L12 66" stroke="#D7263D" stroke-width="9" stroke-linecap="round"/><circle cx="11" cy="64" r="6" fill="#fff"/>
    <path d="M68 76 L80 66" stroke="#D7263D" stroke-width="9" stroke-linecap="round"/><circle cx="81" cy="64" r="6" fill="#fff"/></svg>`;
  const LANTERN = (c = G) => `<svg width="34" height="58" viewBox="0 0 56 96"><path d="M28 0 L28 8" stroke="${c}" stroke-width="2"/><path d="M18 8 h20 l-4 8 h-12z" fill="${c}"/>
    <path d="M12 16 h32 l4 10 v34 l-4 10 h-32 l-4 -10 v-34z" fill="rgba(232,198,106,.18)" stroke="${c}" stroke-width="2.5"/>
    <path d="M20 16 v54 M28 16 v54 M36 16 v54" stroke="${c}" stroke-width="1.2" opacity=".7"/><ellipse class="sa-glow" cx="28" cy="43" rx="8" ry="13" fill="#FFD978"/>
    <path d="M16 70 h24 l-5 9 h-14z" fill="${c}"/><circle cx="28" cy="84" r="4" fill="${c}"/><path d="M28 88 v8" stroke="${c}" stroke-width="2"/></svg>`;
  const CRESCENT = `<svg width="46" height="46" viewBox="0 0 80 80"><path d="M52 8 A32 32 0 1 0 60 70 A26 26 0 1 1 52 8 Z" fill="#F3D57E"/><path d="M62 30 l3 7 7 1 -5 5 1 7 -6 -4 -6 4 1 -7 -5 -5 7 -1z" fill="#F3D57E"/></svg>`;
  const BAUBLE = c => `<svg width="26" height="32" viewBox="0 0 44 54"><rect x="16" y="0" width="12" height="8" rx="2" fill="#B08A2E"/><circle cx="22" cy="30" r="20" fill="${c}"/><path d="M8 26 Q22 18 36 26" stroke="#fff" stroke-width="2.5" fill="none" opacity=".6"/><circle cx="15" cy="22" r="4" fill="#fff" opacity=".5"/></svg>`;
  const STAR = (c = "#F3D57E", s = 24) => `<svg width="${s}" height="${s}" viewBox="0 0 40 40"><path d="M20 2 l5 12 13 1 -10 8 3 13 -11 -7 -11 7 3 -13 -10 -8 13 -1z" fill="${c}"/></svg>`;
  const CEDAR = `<svg width="48" height="54" viewBox="0 0 80 90"><path d="M40 4 L58 24 H48 L66 42 H50 L72 62 H8 L30 42 H14 L32 24 H22 Z" fill="#2E8B57"/><rect x="36" y="62" width="8" height="16" fill="#8A5A1F"/></svg>`;
  const FLAG = `<svg width="58" height="39" viewBox="0 0 96 64"><rect width="96" height="16" fill="#E5484D"/><rect y="16" width="96" height="32" fill="#fff"/><rect y="48" width="96" height="16" fill="#E5484D"/>
    <path d="M48 20 L56 30 H51 L59 39 H37 L45 30 H40 Z" fill="#2E8B57"/><rect x="46" y="39" width="4" height="5" fill="#2E8B57"/><rect width="96" height="64" fill="none" stroke="#ddd"/></svg>`;
  const EGG = c => `<svg width="26" height="34" viewBox="0 0 40 52"><ellipse cx="20" cy="28" rx="17" ry="22" fill="${c}"/><path d="M4 24 Q12 18 20 24 T36 24" stroke="#fff" stroke-width="3" fill="none" opacity=".75"/><path d="M5 34 Q12 30 20 34 T35 34" stroke="#fff" stroke-width="2" fill="none" opacity=".6"/></svg>`;
  const HEART = (c = "#E5484D", s = 26) => `<svg width="${s}" height="${s}" viewBox="0 0 40 40"><path d="M20 36 C-4 20 6 2 20 12 C34 2 44 20 20 36 Z" fill="${c}"/></svg>`;
  const FLOWER = c => `<svg width="30" height="30" viewBox="0 0 40 40">${[0, 72, 144, 216, 288].map(a => `<ellipse cx="20" cy="9" rx="6" ry="9" fill="${c}" transform="rotate(${a} 20 20)"/>`).join("")}<circle cx="20" cy="20" r="6" fill="#F3D57E"/></svg>`;
  const SUN = `<svg width="46" height="46" viewBox="0 0 60 60"><g class="sa-spin" style="transform-origin:30px 30px">${[...Array(12)].map((_, k) => `<line x1="30" y1="30" x2="${30 + Math.cos(k * .5236) * 28}" y2="${30 + Math.sin(k * .5236) * 28}" stroke="#F7C948" stroke-width="3" stroke-linecap="round"/>`).join("")}</g><circle cx="30" cy="30" r="14" fill="#F7C948"/></svg>`;
  const SPARK = c => `<svg width="34" height="34" viewBox="0 0 40 40"><g class="sa-pop" style="transform-origin:20px 20px">${[...Array(10)].map((_, k) => `<line x1="20" y1="20" x2="${20 + Math.cos(k * .628) * 18}" y2="${20 + Math.sin(k * .628) * 18}" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/>`).join("")}</g></svg>`;
  /* each kit: pieces [x (0–1 of the side space), rope length px, delay s, art] for the left and the right side */
  const KITS = {
    christmas: { snow: true, l: [[.42, 170, 0, SANTA], [.82, 90, 1, BAUBLE("#D7263D")]], r: [[.25, 80, .5, BAUBLE("#E8C66A")], [.55, 150, 1.2, STAR()], [.82, 110, .2, BAUBLE("#2E8B57")]] },
    lanterns: { l: [[.2, 130, 0, LANTERN()], [.5, 80, .8, LANTERN("#C9A24A")], [.8, 180, 1.5, LANTERN()]], r: [[.3, 100, .4, CRESCENT], [.62, 180, 1.1, LANTERN()], [.88, 70, 1.9, STAR()]] },
    eid: { l: [[.3, 100, 0, CRESCENT], [.7, 160, .9, LANTERN()]], r: [[.3, 140, .3, STAR()], [.6, 80, 1.1, STAR("#fff", 16)], [.85, 120, .6, STAR()]] },
    independence: { bunting: true, l: [[.42, 140, 0, CEDAR], [.82, 80, .9, STAR()]], r: [[.55, 120, .5, FLAG]] },
    easter: { l: [[.3, 110, 0, EGG("#F7B2D9")], [.7, 160, .7, EGG("#A7E3C9")]], r: [[.35, 90, .4, EGG("#FFE08A")], [.75, 150, 1.2, FLOWER("#F7B2D9")]] },
    hearts: { l: [[.3, 120, 0, HEART()], [.7, 70, .8, HEART("#FF8FA3", 20)]], r: [[.35, 150, .4, HEART("#FF8FA3")], [.75, 90, 1.1, HEART()]] },
    flowers: { l: [[.3, 100, 0, FLOWER("#F7B2D9")], [.7, 150, .8, FLOWER("#C9A8F0")]], r: [[.4, 130, .4, FLOWER("#FFB27A")], [.8, 80, 1.1, FLOWER("#F7B2D9")]] },
    summer: { l: [[.45, 110, 0, SUN]], r: [[.4, 90, .5, STAR("#7FD1FF")], [.78, 140, 1, STAR()]] },
    fireworks: { l: [[.3, 90, 0, SPARK("#F3D57E")], [.72, 150, .7, SPARK("#E5484D")]], r: [[.4, 120, .3, SPARK("#7FD1FF")], [.8, 70, 1.2, STAR()]] }
  };
  const one = (x, len, d, art, w) => `<div class="sa-hang" style="left:${Math.round(x * w)}px;animation-delay:${d}s"><div class="sa-rope" style="height:${len}px"></div><div class="sa-art" style="top:${len - 2}px">${art}</div></div>`;
  window.SEASON_ART = {
    kits: KITS,
    hang(design, side, w) { const k = KITS[design]; return k ? k[side].map(p => one(p[0], p[1], p[2], p[3], w)).join("") : ""; },
    extras(design) { const k = KITS[design] || {};
      return (k.bunting ? `<svg class="sa-bunt" viewBox="0 0 1600 22" preserveAspectRatio="none">${[...Array(48)].map((_, i) => `<path d="M${i * 34} 0 h34 l-17 20 z" fill="${i % 2 ? "#fff" : "#E5484D"}" stroke="#eee"/>`).join("")}</svg>` : "")
        + (k.snow ? `<div class="sa-snow">${[...Array(40)].map((_, i) => `<i style="left:${(i * 37) % 100}%;animation-duration:${7 + (i % 5)}s;animation-delay:-${(i * .7) % 7}s;opacity:${.35 + (i % 4) * .15}"></i>`).join("")}</div>` : ""); },
    thumb(design) { const k = KITS[design]; return k ? k.l.concat(k.r).slice(0, 2).map(p => p[3]).join("") : ""; },
    css: `.sa-hang{position:absolute;top:0;transform-origin:50% 0;animation:saSway 4.2s ease-in-out infinite}
.sa-rope{position:absolute;left:50%;top:0;width:1.5px;margin-left:-.75px;background:linear-gradient(#E8C66A,#B08A2E)}
.sa-art{position:absolute;left:50%;transform:translateX(-50%)}.sa-art svg{display:block}
.sa-glow{animation:saGlow 2.2s ease-in-out infinite}.sa-spin{animation:saSpin 24s linear infinite}.sa-pop{animation:saPop 2.6s ease-out infinite}
.sa-bunt{position:absolute;left:0;right:0;top:0;width:100%;height:20px}
.sa-snow{position:absolute;left:0;right:0;top:0;height:640px;overflow:hidden}.sa-snow i{position:absolute;top:-10px;width:6px;height:6px;border-radius:50%;background:#CFE3F5;animation:saFall linear infinite}
@keyframes saSway{0%,100%{transform:rotate(-5deg)}50%{transform:rotate(5deg)}}@keyframes saGlow{50%{opacity:.45}}@keyframes saSpin{to{transform:rotate(360deg)}}
@keyframes saPop{0%{transform:scale(.3);opacity:0}25%{opacity:1}100%{transform:scale(1.15);opacity:0}}@keyframes saFall{to{transform:translate(26px,640px)}}
@media (prefers-reduced-motion:reduce){.sa-hang,.sa-glow,.sa-spin,.sa-pop,.sa-snow i{animation:none!important}.sa-snow{display:none}}`
  };
})();
