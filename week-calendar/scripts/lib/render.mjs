// The calendar page: one self-contained HTML file, no external requests.

// ---------- colors ----------
// Ather's lime marks the group with the most hours; every other group takes a fixed colour that
// stays apart from its neighbours in both themes. Red is reserved for the no-commit mark.
export const LIME = '#DDFF00'
const PALETTE = {
  dark: ['#6f9bff', '#b58cff', '#4fc4b0', '#f0a050', '#e98fc0', '#5bc0eb', '#c9a97a', '#98a2b3'],
  light: ['#3d6fe0', '#8a5cd6', '#1e9a86', '#c87420', '#c4508f', '#2290c4', '#9c7c4c', '#6b7485'],
}
// Lime reads on dark; on a light page its marks and text take deeper shades of the same hue.
const ACCENT = { dark: { edge: LIME, ink: LIME }, light: { edge: '#a3bf00', ink: '#566600' } }
export const paletteOf = theme => PALETTE[theme === 'light' ? 'light' : 'dark']

const chipOf = (theme, i) => i === 0 ? ACCENT[theme === 'light' ? 'light' : 'dark'].edge : paletteOf(theme)[i - 1] || 'var(--mute)'

export function buildColors(prefs, totals, blocks) {
  let groups
  if (prefs.colorBy === 'project') {
    groups = [...totals.map(t => t.project), ...new Set(blocks.filter(b => !totals.some(t => t.project === b.project)).map(b => b.project))]
  } else {
    // task types by hours, so lime lands on the type the legend lists first
    const hrs = {}
    for (const b of blocks) if (!b.excluded) hrs[b.taskType] = (hrs[b.taskType] || 0) + (b.end - b.start)
    groups = [...new Set(blocks.map(b => b.taskType))].sort((a, b) => (hrs[b] || 0) - (hrs[a] || 0) || String(a).localeCompare(String(b)))
  }
  const colorOf = {}
  groups.forEach((g, i) => {
    const chip = chipOf(prefs.theme, i)
    colorOf[g] = { chip, fill: `color-mix(in srgb, ${chip} ${i === 0 ? 22 : 18}%, var(--bg))` }
  })
  return colorOf
}

// ---------- daily figures ----------
// Per day of the week (local time): hours of counted blocks, of productive ones, of no-commit ones,
// and your PRs merged. Parallel sessions count once. The chart draws these for this week and the last.
const unionMs = iv => {
  const xs = iv.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])
  let t = 0, cs = -1, ce = -1
  for (const [a, b] of xs) { if (a > ce) { if (ce > cs) t += ce - cs; cs = a; ce = b } else ce = Math.max(ce, b) }
  if (ce > cs) t += ce - cs
  return t
}
export function dailySeries(d) {
  const days = [...Array(8)].map((_, i) => { const x = new Date(d.week.startMs); x.setDate(x.getDate() + i); return x.getTime() })
  const counted = (d.blocks || []).filter(b => !b.excluded && !b.automated)
  const hoursOn = (bs, i) => +(unionMs(bs.map(b => [Math.max(b.start, days[i]), Math.min(b.end, days[i + 1])])) / 36e5).toFixed(2)
  const me = String(d.githubLogin || '').toLowerCase()
  const mine = (d.prsMerged || []).filter(p => typeof p.yours === 'boolean' ? p.yours : String(p.author || '').toLowerCase() === me)
  const out = { session: [], productive: [], noCommit: [], prs: [] }
  for (let i = 0; i < 7; i++) {
    out.session.push(hoursOn(counted, i))
    out.productive.push(hoursOn(counted.filter(b => b.productive), i))
    out.noCommit.push(hoursOn(counted.filter(b => b.noCommit), i))
    out.prs.push(mine.filter(p => { const t = Date.parse(p.mergedAt); return t >= days[i] && t < days[i + 1] }).length)
  }
  return out
}

// ---------- HTML ----------
// Less, but better: one typeface, hairline rules, flat tones, Ather's lime once,
// red only where something needs attention.
export function renderHtml(d) {
  const dark = d.prefs.theme !== 'light'
  const acc = ACCENT[dark ? 'dark' : 'light']
  const css = `
:root{--bg:${dark ? '#1b1b1a' : '#f2f1ed'};--ink:${dark ? '#e9e7e2' : '#1a1a1a'};--mute:${dark ? '#8a8883' : '#7d7a73'};
--rule:${dark ? '#2e2e2c' : '#dddbd5'};--faint:${dark ? '#242423' : '#e9e8e3'};--panel:${dark ? '#222221' : '#fbfaf7'};
--accent:${LIME};--accent-edge:${acc.edge};--accent-ink:${acc.ink};--prev:${dark ? '#4a4945' : '#c4c1b9'};--red:#e2401c;
--spring:cubic-bezier(.32,1.28,.48,1)}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--bg);color:var(--ink);font:13px/1.5 "Helvetica Neue",Helvetica,Arial,system-ui,sans-serif;
 font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}
button{font:inherit;color:inherit}
:focus-visible{outline:1px solid var(--accent-edge);outline-offset:2px}
.wrap{width:100%;padding:32px 16px 32px}
.lbl{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--mute)}
header{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;padding-bottom:20px}
header h1{font-weight:400;font-size:22px;letter-spacing:-.01em;margin-top:6px}
.wipe{animation:wipe .7s cubic-bezier(.2,.7,.2,1) both}
@keyframes wipe{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}
.total{text-align:right}.total b{font-weight:300;font-size:44px;line-height:1;letter-spacing:-.03em}.total b small{font-size:16px;color:var(--mute);margin-left:2px}
/* measures: four tabs drive one chart; this week against the last */
.ktabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-top:1px solid var(--rule);position:relative}
.ktabs button{background:none;border:0;padding:14px 12px 12px 0;text-align:left;cursor:pointer;display:flex;flex-direction:column;gap:2px;min-width:0;color:var(--mute)}
.ktabs .k{font-size:11px}
.ktabs b{font-weight:300;font-size:26px;line-height:1.1;letter-spacing:-.02em;color:var(--ink)}
.ktabs b small{font-size:13px;color:var(--mute);margin-left:2px}
.ktabs em{font-style:normal;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ktabs em.up{color:var(--ink)}
.ktabs button[aria-selected="true"] b{color:var(--accent-ink)}
.ktabs .ul{position:absolute;top:-1px;left:0;height:2px;background:var(--accent-edge);transition:left .4s var(--spring),width .4s var(--spring)}
.facts{display:flex;flex-wrap:wrap;gap:4px 18px;font-size:11px;color:var(--mute);padding:2px 0 14px}
.facts b{font-weight:400;color:var(--ink)}
.chart{min-height:140px}.chart svg{display:block;width:100%;height:auto;overflow:visible}
.chart .now{fill:var(--accent-edge);transition:y .45s var(--spring),height .45s var(--spring),opacity .2s}
.chart .was{fill:var(--prev);transition:y .45s var(--spring),height .45s var(--spring),opacity .2s}
.chart text{fill:var(--mute);font-size:10px}
.chart .v{fill:var(--ink)}
.chart .g{stroke:var(--faint)}.chart .base{stroke:var(--rule)}
.ctl{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:8px;padding-bottom:20px;border-bottom:1px solid var(--rule)}
.toggle{display:inline-flex;align-items:center;gap:8px;font-size:11px;color:var(--mute);cursor:pointer;background:none;border:0}
.toggle i{width:24px;height:14px;border-radius:7px;background:var(--rule);position:relative;transition:background .2s}
.toggle i::after{content:"";position:absolute;top:2px;left:2px;width:10px;height:10px;border-radius:50%;background:var(--panel);transition:left .3s var(--spring)}
.toggle[aria-pressed="true"] i{background:var(--accent-edge)}.toggle[aria-pressed="true"] i::after{left:12px}
.key{display:flex;gap:14px;font-size:11px;color:var(--mute)}.key span{display:inline-flex;align-items:center;gap:6px}
.bar{display:flex;height:6px;margin:20px 0 12px;background:var(--faint);border-radius:1px;overflow:hidden}.bar i{display:block;height:100%}
.legend{display:flex;flex-wrap:wrap;gap:8px 24px;padding-bottom:20px;border-bottom:1px solid var(--rule)}
.legend div{display:flex;align-items:baseline;gap:6px;min-width:0;max-width:340px}
.legend span{display:flex;align-items:center;gap:6px;color:var(--ink);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.legend b{font-weight:400;font-size:12px;color:var(--mute);white-space:nowrap}
.sw{width:8px;height:8px;border-radius:2px;flex:none}
/* days: one card per day; a day's sessions and its 24-hour ring */
.days{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px;padding-top:20px}
.days button{background:var(--panel);border:1px solid var(--rule);border-radius:3px;padding:8px 8px 9px;text-align:left;cursor:pointer;display:flex;flex-direction:column;gap:1px;min-width:0;color:var(--mute);transition:border-color .2s}
.days button:hover{border-color:var(--mute)}
.days .w{font-size:10px;letter-spacing:.12em;text-transform:uppercase}
.days b{font-weight:300;font-size:18px;color:var(--ink);line-height:1.2}
.days .s{font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.days .today b{color:var(--accent-ink)}
.days button[aria-pressed="true"]{border-color:var(--accent-edge);box-shadow:inset 0 0 0 1px var(--accent-edge)}
.daypane{display:grid;grid-template-columns:minmax(0,1fr) 220px;gap:28px;padding:16px 0 20px;border-bottom:1px solid var(--rule)}
.dlist{display:flex;flex-direction:column;gap:4px;min-width:0;overflow:hidden}
.ses{display:grid;grid-template-columns:86px 6px minmax(0,1fr) auto;gap:10px;align-items:center;padding:6px 8px;border:1px solid var(--rule);border-radius:3px;background:var(--panel);cursor:pointer;text-align:left;width:100%}
.ses:hover{border-color:var(--mute)}
.ses .tm{font-size:11px;color:var(--mute)}
.ses .swb{width:6px;height:20px;border-radius:2px}
.ses .ti{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px}
.ses .hr{font-size:11px;color:var(--mute)}
.ses .nc{color:var(--red)}
.from-l{animation:froml .32s var(--spring) both}.from-r{animation:fromr .32s var(--spring) both}
@keyframes froml{from{transform:translateX(-16px);opacity:0}to{transform:none;opacity:1}}
@keyframes fromr{from{transform:translateX(16px);opacity:0}to{transform:none;opacity:1}}
.ring{display:flex;flex-direction:column;align-items:center;gap:6px}
.ring svg{width:100%;max-width:200px;height:auto}
.ring p{font-size:11px;color:var(--mute);text-align:center;max-width:220px}.ring p b{font-weight:400;color:var(--ink)}
/* the week grid */
.cal{padding-top:20px}
.grid{display:grid}
.dh{padding:0 8px 10px;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--mute);min-width:0;white-space:nowrap;overflow:hidden}
.dh b{display:block;font-size:18px;font-weight:300;letter-spacing:0;color:var(--ink);text-transform:none;margin-top:2px}
.dh em{font-style:normal;letter-spacing:0;text-transform:none;margin-left:6px}
.dh.today b{color:var(--accent-ink)}
.dh.on{color:var(--ink)}
.hours{position:relative}.hl{position:absolute;right:8px;font-size:10px;color:var(--mute);transform:translateY(-50%)}
.day{position:relative;border-left:1px solid var(--rule);min-width:0}
.day.on{background:color-mix(in srgb,var(--faint) 55%,transparent)}
.rule{position:absolute;left:0;right:0;border-top:1px solid var(--faint)}
.now{position:absolute;left:0;right:0;border-top:1px solid var(--ink);z-index:2}
.now::before{content:"";position:absolute;left:-3px;top:-3px;width:5px;height:5px;border-radius:50%;background:var(--ink)}
.tick{position:absolute;right:0;width:3px;background:var(--mute);opacity:.75;border-radius:1px}
.blk{position:absolute;border:0;border-radius:2px;padding:4px 6px;text-align:left;font-size:11px;line-height:1.3;cursor:pointer;overflow:hidden;container-type:inline-size}
.blk .t{display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:break-word;padding-right:6px;font-weight:500}
.blk .m{display:block;opacity:.7;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@container (max-width:92px){.blk .m{display:none}}
.blk.cont .t{font-weight:400}
.blk{box-shadow:inset 3px 0 0 var(--edge)}.blk.nc{box-shadow:inset 3px 0 0 var(--edge),inset 0 0 0 1px var(--red)}
.blk.nc::after{content:"";position:absolute;top:4px;right:4px;width:5px;height:5px;border-radius:50%;background:var(--red)}
.blk.ex{background:repeating-linear-gradient(135deg,transparent 0 4px,var(--faint) 4px 5px)!important;color:var(--mute)!important;box-shadow:inset 0 0 0 1px var(--rule)}
.blk.ex::after{display:none}
.blk.thin{padding:0}
.stack{position:absolute;z-index:4;left:2px;transform:translateY(-50%);background:var(--panel);border:1px solid var(--rule);border-radius:8px;padding:1px 7px;font-size:10px;color:var(--ink);cursor:pointer;white-space:nowrap}
.stack:hover{border-color:var(--ink)}
.btn{margin-top:16px;background:none;border:1px solid var(--rule);color:var(--ink);font-size:11px;padding:6px 10px;border-radius:2px;cursor:pointer}
.btn:hover{border-color:var(--ink)}.note{margin-top:8px;font-size:11px;color:var(--mute)}
.lnk{background:none;border:0;color:var(--mute);font-size:11px;cursor:pointer;text-decoration:underline;margin-top:10px}
.blk:hover{filter:brightness(${dark ? 1.15 : 0.95})}.blk.sel{outline:1px solid var(--ink);outline-offset:1px;z-index:3}
.lists{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:32px 48px;margin-top:40px;padding-top:24px;border-top:1px solid var(--rule)}
.lists section{min-width:0}
.drawer{position:fixed;top:0;right:0;bottom:0;width:min(440px,100%);background:var(--panel);border-left:1px solid var(--rule);padding:24px;overflow:auto;z-index:20;
 transform:translateX(100%);visibility:hidden;transition:transform .22s cubic-bezier(.2,.7,.2,1),visibility 0s .22s;box-shadow:-12px 0 32px rgba(0,0,0,${dark ? '.35' : '.08'})}
.drawer.open{transform:none;visibility:visible;transition:transform .22s cubic-bezier(.2,.7,.2,1)}
.ghost{position:fixed;z-index:19;border-radius:2px;pointer-events:none;transition:all .26s cubic-bezier(.2,.7,.2,1)}
.x{position:absolute;top:16px;right:16px;background:none;border:1px solid var(--rule);color:var(--mute);width:28px;height:28px;border-radius:2px;cursor:pointer;font-size:14px}
.x:hover{color:var(--ink);border-color:var(--ink)}
.drawer h2{font-weight:400;font-size:16px;margin:8px 40px 16px 0;line-height:1.35}
dl{display:grid;grid-template-columns:72px 1fr;gap:6px 12px}dt{color:var(--mute)}dd{word-break:break-word}
.sec{margin-top:20px}.sec .lbl{display:block;margin-bottom:6px}
.quote{border-left:1px solid var(--rule);padding-left:12px;white-space:pre-wrap;max-height:160px;overflow:auto}
.cm{display:flex;gap:10px;padding:3px 0}.cm code{font:11px/1.6 ui-monospace,Menlo,Consolas,monospace;color:var(--mute)}
.files{list-style:none;font:11px/1.7 ui-monospace,Menlo,Consolas,monospace;color:var(--mute);max-height:200px;overflow:auto;word-break:break-all}
.none{color:var(--mute)}
.nc-list{list-style:none;margin-top:12px}.nc-list li{padding:10px 0;border-top:1px solid var(--rule);cursor:pointer}
.nc-list li:last-child{border-bottom:1px solid var(--rule)}.nc-list li:hover .n{text-decoration:underline}
.nc-list .s{display:block;color:var(--mute);font-size:11px}
.nc-list li.sum{cursor:default;color:var(--mute)}.nc-list li.sum:hover .n{text-decoration:none}
/* no-commit triage: a reason per session, copied to Claude in one line */
.why{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.why button{background:none;border:1px solid var(--rule);border-radius:10px;padding:1px 8px;font-size:10.5px;color:var(--mute);cursor:pointer}
.why button:hover{border-color:var(--mute);color:var(--ink)}
.why button[aria-pressed="true"]{border-color:var(--accent-edge);color:var(--ink);background:color-mix(in srgb,var(--accent) 14%,transparent)}
.why button.exb[aria-pressed="true"]{border-color:var(--mute);background:var(--faint)}
.tray{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px;padding:8px 10px;border:1px solid var(--accent-edge);border-radius:3px;font-size:11px}
.tray button{background:var(--accent);color:#141513;border:0;border-radius:2px;padding:5px 10px;font-size:11px;font-weight:600;cursor:pointer}
.tray textarea{width:100%;margin-top:8px;font:11px/1.5 ui-monospace,Menlo,Consolas,monospace;background:var(--panel);color:var(--ink);border:1px solid var(--rule);padding:6px}
.dot{display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--red);margin-right:8px;vertical-align:middle}
footer{margin-top:48px;padding-top:16px;border-top:1px solid var(--rule);color:var(--mute);font-size:10px;letter-spacing:.08em;text-transform:uppercase}
@media (max-width:760px){.daypane{grid-template-columns:minmax(0,1fr)}.ring{order:-1}}
@media (max-width:600px){.wrap{padding:24px 16px}.total b{font-size:36px}header{flex-direction:column;align-items:flex-start}.total{text-align:left}
 #meta{line-height:1.6}.legend div{max-width:100%}
 .ktabs{grid-template-columns:repeat(2,minmax(0,1fr))}.ktabs .ul{display:none}.ktabs button[aria-selected="true"]{box-shadow:inset 0 2px 0 var(--accent-edge)}
 .days{grid-template-columns:repeat(4,minmax(0,1fr))}.ses{grid-template-columns:72px 6px minmax(0,1fr) auto}
 .grid{grid-template-columns:40px minmax(0,1fr)!important}.grid>.dh,.grid>.day{display:none}.grid>.dh.on,.grid>.day.on{display:block}.day.on{background:none}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:1ms!important;animation-delay:0ms!important;transition-duration:1ms!important}}`
  const payload = JSON.stringify(d).replace(/</g, '\\u003c')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Week ${d.week.start}</title><style>${css}</style></head><body><div class="wrap">
<header><div><div class="lbl" id="wk"></div><h1 id="range" class="wipe"></h1></div>
<div class="total"><b id="tot"></b><div class="lbl" id="meta"></div></div></header>
<div class="ktabs" id="ktabs" role="tablist" aria-label="Measures"></div>
<div class="facts" id="facts"></div>
<div class="chart" id="chart"></div>
<div class="ctl"><button class="toggle" id="cmp" aria-pressed="true"><i></i><span></span></button><div class="key" id="key"></div></div>
<div class="bar" id="bar"></div><div class="legend" id="legend"></div>
<div class="days" id="days" role="group" aria-label="Days"></div>
<div class="daypane"><div class="dlist" id="dlist" aria-live="polite"></div><div class="ring"><svg id="ring" viewBox="0 0 220 220" role="img"></svg><p id="ringcap"></p></div></div>
<div class="cal"><div class="grid" id="grid"></div></div>
<div class="lists">
<section><div class="lbl">Merged PRs</div><ul class="nc-list" id="prs"></ul><button class="lnk" id="prtog" hidden></button></section>
<section><div class="lbl"><span class="dot"></span>No commit</div><ul class="nc-list" id="nc"></ul><div id="tray"></div></section>
<section><div class="lbl">Excluded from totals</div><ul class="nc-list" id="ex"></ul></section></div>
<footer id="foot"></footer></div>
<aside class="drawer" id="drawer" aria-hidden="true"><button class="x" id="close" aria-label="Close">×</button><section id="detail"></section></aside>
<script>${clientScript(payload, dark)}</script></body></html>`
}

function clientScript(payload, dark) {
  return String.raw`
const D=${payload};
const DARK=${dark},PAL=${JSON.stringify(paletteOf(dark ? 'dark' : 'light'))};
const REDUCE=matchMedia('(prefers-reduced-motion: reduce)').matches;
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtT=t=>new Date(t).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false});
const fmtD=t=>new Date(t).toLocaleDateString([],{weekday:'short',day:'numeric',month:'short'});
const fmtH=h=>h>=1?h.toFixed(1)+' h':Math.round(h*60)+' min';
const short=s=>{const w=String(s||'').split(/\s+/).slice(0,5).join(' ');return w.length<String(s||'').length?w+'…':w};
const MIN=6e4;
const countTo=(el,to,dec)=>{if(REDUCE){el.textContent=to.toFixed(dec);return}const t0=performance.now();
 const f=t=>{const p=Math.min(1,(t-t0)/600),e=1-Math.pow(1-p,3);el.textContent=(to*e).toFixed(dec);if(p<1)requestAnimationFrame(f)};requestAnimationFrame(f)};

// titles: drop the machine name and the leading status icons; split off the PR list after " · "
// The machine word is the first word most titles share (session namers prefix it), or the machine name itself.
const first={};for(const s of D.sessions){const w=String(s.title||'').trim().split(/\s+/)[0];if(w)first[w]=(first[w]||0)+1}
const topW=Object.keys(first).sort((a,b)=>first[b]-first[a])[0]||'';
const MACH=(first[topW]>D.sessions.length/2&&/^[\p{L}\p{N}_-]+$/u.test(topW)?topW:String(D.machine||'')).toLowerCase();
function clean(t){let s=String(t||'').trim();if(MACH&&s.toLowerCase().startsWith(MACH))s=s.slice(MACH.length);
 return s.replace(/^[^\p{L}\p{N}#]+/u,'').trim()}
const nameOf=x=>{const c=clean(x.title)||short(x.sessionFirstMessage||x.firstMessage)||'Untitled';return c.split(' · ')[0]};
const prsOf=x=>clean(x.title).split(' · ').slice(1).join(' · ');
const titleOf=x=>clean(x.title)||short(x.sessionFirstMessage||x.firstMessage)||'Untitled';

// routine runs (schedulers, butlers, loops) are drawn as ticks, not blocks. The build marks them; for a
// calendar built before it did, the same rule: short commitless runs that recur or nobody typed in.
const keyT=s=>nameOf(s).toLowerCase().replace(/\(.*?\)/g,'').replace(/\s+/g,' ').trim();
const rep={};for(const s of D.sessions)rep[keyT(s)]=(rep[keyT(s)]||0)+1;
const marked=D.sessions.some(s=>'automated' in s);
const AUTO=new Set(D.sessions.filter(s=>marked?s.automated&&/^Automated/.test(s.excludeReason||''):s.noCommit&&s.minutes<=3&&(rep[keyT(s)]>=5||(s.humanTurns||0)===0)).map(s=>s.sessionId));
const isAuto=id=>AUTO.has(id);

// header
const ws=new Date(D.week.startMs),we=new Date(D.week.endMs-1);
const isoWeek=d=>{const t=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));const n=t.getUTCDay()||7;t.setUTCDate(t.getUTCDate()+4-n);
 return Math.ceil(((t-new Date(Date.UTC(t.getUTCFullYear(),0,1)))/864e5+1)/7)};
$('#wk').textContent='Week '+isoWeek(new Date(D.week.startMs+3*864e5));
$('#range').textContent=ws.toLocaleDateString([],{day:'numeric',month:'long'})+' – '+we.toLocaleDateString([],{day:'numeric',month:'long',year:'numeric'});
// exclusions: the build's decision, overridden per session in this browser
const store=(k,v)=>{try{if(v===undefined)return JSON.parse(localStorage.getItem(k)||'{}');localStorage.setItem(k,JSON.stringify(v))}catch{return{}}};
const ov=store('wc-ov-'+D.week.start);
const isEx=id=>id in ov?ov[id]:!!D.sessions.find(s=>s.sessionId===id)?.excluded;
const saveOv=()=>store('wc-ov-'+D.week.start,ov);
const union=iv=>{const xs=iv.slice().sort((a,b)=>a[0]-b[0]);let t=0,cs=-1,ce=-1;for(const[a,b]of xs){if(a>ce){if(ce>cs)t+=ce-cs;cs=a;ce=b}else ce=Math.max(ce,b)}if(ce>cs)t+=ce-cs;return t/36e5};

// blocks: one session's segments less than 30 min apart become one bar
const MB=[];{const bySess={};for(const b of D.blocks)(bySess[b.sessionId]=bySess[b.sessionId]||[]).push(b);
 for(const bs of Object.values(bySess)){bs.sort((a,b)=>a.start-b.start);let cur=null;
  for(const b of bs){if(cur&&b.start-cur.end<30*MIN){cur.end=Math.max(cur.end,b.end);cur.commits=cur.commits.concat(b.commits);cur.files=[...new Set(cur.files.concat(b.files))];cur.noCommit=cur.noCommit&&b.noCommit;cur.productive=cur.productive||b.productive}
   else{cur={...b,commits:b.commits.slice(),files:b.files.slice()};MB.push(cur)}}}}
const blockById=id=>MB.find(x=>x.id===id);

// groups: projects when there are several, otherwise workstreams (sessions sharing a PR or a title)
const projects=new Set(D.blocks.filter(b=>!isAuto(b.sessionId)).map(b=>b.project));
const byWork=D.prefs.colorBy==='project'&&projects.size<=1;
const wsKey=s=>{const m=String(s.title||'').match(/#(\d{3,})/);return m?'#'+m[1]:keyT(s)};
const sessOf={};for(const s of D.sessions)sessOf[s.sessionId]=s;
const groupOf=b=>byWork?wsKey(sessOf[b.sessionId]||b):D.prefs.colorBy==='project'?b.project:b.taskType;
let colorOf=D.colorOf,groupName={};
if(byWork){const hrs={},best={};
 for(const b of MB){if(isAuto(b.sessionId))continue;const g=groupOf(b);(hrs[g]=hrs[g]||[]).push([b.start,b.end]);
  const s=sessOf[b.sessionId];if(!best[g]||s.minutes>best[g].minutes)best[g]=s}
 const order=Object.keys(hrs).sort((a,b)=>union(hrs[b])-union(hrs[a]));colorOf={};
 order.forEach((g,i)=>{const chip=i===0?getComputedStyle(document.documentElement).getPropertyValue('--accent-edge').trim():PAL[i-1]||'var(--mute)';
  colorOf[g]={chip,fill:'color-mix(in srgb, '+chip+' '+(i===0?24:20)+'%, var(--bg))'};groupName[g]=nameOf(best[g])})}
const kOf=b=>colorOf[groupOf(b)]||{fill:'var(--rule)',chip:'var(--mute)'};

function totals(){const bs=MB.filter(b=>!isEx(b.sessionId)&&!isAuto(b.sessionId));const by={};for(const b of bs)(by[groupOf(b)]=by[groupOf(b)]||[]).push([b.start,b.end]);
 return{all:union(bs.map(b=>[b.start,b.end])),list:Object.entries(by).map(([g,iv])=>({g,hours:union(iv)})).sort((a,b)=>b.hours-a.hours),
  n:new Set(bs.map(b=>b.sessionId)).size}}
let firstTotals=true;
function renderTotals(){const T=totals();
const nx=D.sessions.filter(s=>isEx(s.sessionId)&&!isAuto(s.sessionId)).length;
const tot=D.machineHours?D.machineHours.busy:T.all;
$('#tot').innerHTML='<span>'+tot.toFixed(1)+'</span><small>h</small>';if(firstTotals){countTo($('#tot span'),tot,1);firstTotals=false}
$('#meta').textContent=(D.machineHours?'Agent busy · '+fmtH(T.all)+' session time':'Session time')+' · '+T.n+' sessions'+(AUTO.size?' · '+AUTO.size+' automated runs apart':'')+(nx?' · '+nx+' excluded':'')+' · '+D.timeZone;
// group totals: one proportional rule, then the figures
const lead=T.list.slice(0,8),rest=T.list.slice(8);
const restH=rest.reduce((n,t)=>n+t.hours,0),sumH=T.list.reduce((n,t)=>n+t.hours,0)||1;
const swOf=g=>colorOf[g]?.chip||'var(--mute)';const lab=g=>byWork?groupName[g]||g:g;
$('#bar').innerHTML=lead.map(t=>'<i style="width:'+(t.hours/sumH*100)+'%;background:'+swOf(t.g)+'"></i>').join('')+(restH?'<i style="width:'+(restH/sumH*100)+'%;background:var(--rule)"></i>':'');
$('#legend').innerHTML=lead.map(t=>'<div title="'+esc(lab(t.g))+'"><span><i class="sw" style="background:'+swOf(t.g)+'"></i>'+esc(lab(t.g))+'</span><b>'+fmtH(t.hours)+'</b></div>').join('')+
 (rest.length?'<div><span><i class="sw" style="background:var(--rule)"></i>'+rest.length+' more</span><b>'+fmtH(restH)+'</b></div>':'')+
 (byWork?'<div><span class="none" style="color:var(--mute)">'+esc([...projects][0]||'')+'</span></div>':'');
renderLists()}

// calendar
const H=44;let h0=24,h1=0;
const days=[...Array(7)].map((_,i)=>{const d=new Date(D.week.startMs);d.setDate(d.getDate()+i);return d});
const pieces=[];
for(const b of MB){let s=b.start;while(s<b.end){const d=new Date(s);const mid=new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime();
 const e=Math.min(b.end,new Date(d.getFullYear(),d.getMonth(),d.getDate()+1).getTime());
 const di=days.findIndex(x=>x.toDateString()===d.toDateString());
 if(di>=0){const sh=(s-mid)/36e5,eh=sh+(e-s)/36e5,auto=isAuto(b.sessionId);if(!auto){h0=Math.min(h0,Math.floor(sh));h1=Math.max(h1,Math.ceil(eh))}pieces.push({b,di,sh,eh,auto})}s=e}}
if(h0>h1){h0=8;h1=18}
// counted hours per day, as the chart counts them; a day with any session keeps a full column
const dayHours=days.map((_,di)=>union(pieces.filter(p=>p.di===di&&!p.auto&&!isEx(p.b.sessionId)).map(p=>[p.sh,p.eh]))*36e5);
const hasWork=days.map((_,di)=>pieces.some(p=>p.di===di&&!p.auto));
const todayKey=new Date().toDateString();
let sel=days.findIndex(d=>d.toDateString()===todayKey);if(sel<0)sel=dayHours.indexOf(Math.max(...dayHours));
const grid=$('#grid'),height=(h1-h0)*H;
// a day without sessions gets a narrow column, so the week's real days have the room
grid.style.gridTemplateColumns='40px '+hasWork.map(w=>w?'minmax(0,1fr)':'minmax(0,.4fr)').join(' ');
grid.innerHTML='<div></div>'+days.map((d,di)=>'<div class="dh'+(d.toDateString()===todayKey?' today':'')+(di===sel?' on':'')+'">'+d.toLocaleDateString([],{weekday:'short'})+(dayHours[di]?'<em>'+fmtH(dayHours[di])+'</em>':'')+'<b>'+d.getDate()+'</b></div>').join('');
const hours=document.createElement('div');hours.className='hours';hours.style.height=height+'px';
for(let h=h0;h<=h1;h+=2)hours.insertAdjacentHTML('beforeend','<div class="hl" style="top:'+((h-h0)*H)+'px">'+String(h).padStart(2,'0')+'</div>');
grid.appendChild(hours);
const stacks={};
days.forEach((d,di)=>{const col=document.createElement('div');col.className='day'+(di===sel?' on':'');col.style.height=height+'px';
 for(let h=h0;h<=h1;h++)col.insertAdjacentHTML('beforeend','<div class="rule" style="top:'+((h-h0)*H)+'px"></div>');
 if(d.toDateString()===todayKey){const n=new Date(),nh=n.getHours()+n.getMinutes()/60;if(nh>=h0&&nh<=h1)col.insertAdjacentHTML('beforeend','<div class="now" style="top:'+((nh-h0)*H)+'px"></div>')}
 // automated runs: ticks on the column edge, out of the way of real work
 for(const p of pieces.filter(p=>p.di===di&&p.auto&&p.eh>h0&&p.sh<h1)){const t=document.createElement('div');t.className='tick';
  t.style.cssText='top:'+((Math.max(p.sh,h0)-h0)*H)+'px;height:'+Math.max(2,(p.eh-p.sh)*H)+'px';t.title=titleOf(p.b)+' · '+fmtT(p.b.start);col.appendChild(t)}
 const ps=pieces.filter(p=>p.di===di&&!p.auto).sort((a,b)=>a.sh-b.sh);const lanes=[],clusters=[];let cl=null,end=-1;
 for(const p of ps){if(p.sh>=end){cl=[];clusters.push(cl)}cl.push(p);end=Math.max(end,p.eh);let li=lanes.findIndex(e=>e<=p.sh);if(li<0){li=lanes.length;lanes.push(0)}lanes[li]=p.eh;p.lane=li}
 const seen=new Set();
 clusters.forEach((c,ci)=>{const n=Math.max(...c.map(p=>p.lane))+1;
  // three or more at once: thin strips without words, and one label that opens them all
  const thin=n>=3;
  if(thin){const key=di+':'+ci;stacks[key]=c.map(p=>p.b.id);const top=Math.min(...c.map(p=>p.sh));
   col.insertAdjacentHTML('beforeend','<button class="stack" data-stack="'+key+'" style="top:'+((top-h0)*H+1)+'px">'+new Set(c.map(p=>p.b.sessionId)).size+' at once</button>')}
  for(const p of c){
  const k=kOf(p.b);const ht=Math.max(6,(p.eh-p.sh)*H-2);const cont=seen.has(p.b.sessionId);seen.add(p.b.sessionId);
  const el=document.createElement('button');el.className='blk'+(p.b.noCommit?' nc':'')+(isEx(p.b.sessionId)?' ex':'')+(cont?' cont':'')+(thin||ht<22?' thin':'');el.dataset.id=p.b.id;
  el.style.cssText='top:'+((p.sh-h0)*H+1)+'px;height:'+ht+'px;left:calc('+(p.lane/n*100)+'% + 2px);width:calc('+(100/n)+'% - '+(thin?3:6)+'px);background:'+k.fill+';color:var(--ink)';el.style.setProperty('--edge',k.chip);
  const pr=prsOf(p.b),meta=ht>=40&&!cont,lines=Math.max(1,Math.floor((ht-8-(meta?13:0))/14.3));
  if(!thin&&ht>=22)el.innerHTML='<span class="t" style="-webkit-line-clamp:'+lines+'">'+(cont?'↳ ':'')+esc(nameOf(p.b))+'</span>'+(meta?'<span class="m">'+fmtT(p.b.start)+'–'+fmtT(p.b.end)+(pr?' · '+esc(pr):'')+'</span>':'');
  el.title=titleOf(p.b)+'\n'+fmtT(p.b.start)+'–'+fmtT(p.b.end);el.onclick=()=>show(p.b.id,el);col.appendChild(el)}});
 grid.appendChild(col)});
$$('.stack').forEach(b=>b.onclick=()=>showStack(stacks[b.dataset.stack],b));

// measures: four tabs and one chart of the week's days, beside the last saved week
const DY=D.daily||{session:dayHours,productive:[0,0,0,0,0,0,0],noCommit:[0,0,0,0,0,0,0],prs:[0,0,0,0,0,0,0]};
const PV=D.prev?.daily||null;
const sum=a=>a.reduce((x,y)=>x+y,0);
const M=D.machineHours||{},K=D.metrics||{};const pct=v=>v==null?'—':Math.round(v*100)+'%';
const prList=D.prsMerged||[];const ac={};for(const p of prList)if(p.sessions?.length)ac[p.author]=(ac[p.author]||0)+1;
const ME=String(D.githubLogin||Object.keys(ac).sort((a,b)=>ac[b]-ac[a])[0]||'').toLowerCase();
const isMine=p=>typeof p.yours==='boolean'?p.yours:String(p.author||'').toLowerCase()===ME;
const mine=prList.filter(isMine),others=prList.filter(p=>!isMine(p));
const MS=[
 {key:'session',k:'Session time',unit:'h',dec:1,sub:'parallel sessions once'},
 {key:'productive',k:'Productive',unit:'h',dec:1,sub:'pushed or on GitHub'},
 {key:'prs',k:'PRs merged',unit:'',dec:0,sub:others.length?'+'+others.length+' teammate PRs':'yours'},
 {key:'noCommit',k:'No commit',unit:'h',dec:1,sub:'sessions without a commit',lessIsBetter:true}];
const prevWeek=D.prev?String(D.prev.isoWeek||'').replace(/^\d{4}-W0?/,'week '):'';
const delta=m=>{if(!PV)return{t:m.sub,c:''};const d=sum(DY[m.key])-sum(PV[m.key]);
 if(Math.abs(d)<(m.dec?.05:1))return{t:'same as '+prevWeek,c:''};
 const better=m.lessIsBetter?d<0:d>0;return{t:(d>0?'▲ up ':'▼ down ')+Math.abs(d).toFixed(m.dec)+(m.unit?' '+m.unit:'')+' on '+prevWeek,c:better?'up':''}};
let msel=0,cmp=!!PV;
$('#ktabs').innerHTML=MS.map((m,i)=>{const dl=delta(m);return '<button role="tab" aria-selected="'+(i===0)+'" data-i="'+i+'"><span class="k">'+m.k+'</span><b><span>'+sum(DY[m.key]).toFixed(m.dec)+'</span>'+(m.unit?'<small>'+m.unit+'</small>':'')+'</b><em class="'+dl.c+'">'+esc(dl.t)+'</em></button>'}).join('')+'<span class="ul" aria-hidden="true"></span>';
const moveUl=()=>{const b=$('#ktabs [aria-selected="true"]'),u=$('#ktabs .ul');if(b&&u){u.style.left=b.offsetLeft+'px';u.style.width=(b.offsetWidth-12)+'px'}};
$$('#ktabs button').forEach((b,i)=>b.onclick=()=>{msel=i;$$('#ktabs button').forEach(x=>x.setAttribute('aria-selected',x===b));moveUl();drawChart();
 const v=b.querySelector('b span');countTo(v,sum(DY[MS[i].key]),MS[i].dec)});
$$('#ktabs b span').forEach((v,i)=>countTo(v,sum(DY[MS[i].key]),MS[i].dec));
$('#facts').innerHTML=D.machineHours?[['Productive',pct(M.productiveUtilization)+' of '+fmtH(M.available||0)+' available'],['Waiting on you',fmtH(M.waitingOnPerson||0)],
 ['Automated',fmtH(marked?M.automated||0:Math.max(M.automated||0,union(MB.filter(b=>isAuto(b.sessionId)).map(b=>[b.start,b.end]))))+' · '+AUTO.size+' runs'],
 ['Cost',K.costUsd!=null?'$'+Math.round(K.costUsd).toLocaleString()+(K.commits!=null?' · '+K.commits+' commits':''):'—']].map(([k,v])=>'<span>'+k+' <b>'+esc(v)+'</b></span>').join(''):'';
const cmpBtn=$('#cmp');cmpBtn.hidden=!PV;cmpBtn.setAttribute('aria-pressed',cmp);cmpBtn.querySelector('span').textContent='Compare with '+prevWeek;
cmpBtn.onclick=()=>{cmp=!cmp;cmpBtn.setAttribute('aria-pressed',cmp);drawChart()};
$('#key').innerHTML='<span><i class="sw" style="background:var(--accent-edge)"></i>This week</span>'+(PV?'<span><i class="sw" style="background:var(--prev)"></i>'+esc(prevWeek[0].toUpperCase()+prevWeek.slice(1))+'</span>':'<span>No saved calendar for last week yet</span>');
// drawn at the box's own width, so its labels stay 10px on a phone and on a wide screen
const P={l:34,r:4,t:16,b:20};
function drawChart(){const m=MS[msel],now=DY[m.key],was=cmp&&PV?PV[m.key]:null;
 const CW=Math.max(280,$('#chart').clientWidth||760),CH=CW<600?140:180;
 const max=Math.max(...now,...(was||[0]),m.dec?1:2);const step=m.dec?(max>12?4:max>6?2:1):Math.max(1,Math.ceil(max/4));const top=Math.ceil(max/step)*step;
 const y=v=>P.t+(CH-P.t-P.b)*(1-v/top),cw=(CW-P.l-P.r)/7,bw=Math.min(36,was?cw*.3:cw*.44);
 let s='<svg viewBox="0 0 '+CW+' '+CH+'" role="img" aria-label="'+esc(m.k)+' per day">';
 for(let v=0;v<=top;v+=step)s+='<line class="'+(v?'g':'base')+'" x1="'+P.l+'" x2="'+(CW-P.r)+'" y1="'+y(v)+'" y2="'+y(v)+'"/><text x="'+(P.l-6)+'" y="'+(y(v)+3.5)+'" text-anchor="end">'+v+(m.unit&&v?m.unit:'')+'</text>';
 days.forEach((d,i)=>{const x=P.l+cw*i+cw/2,nx=was?x+1:x-bw/2;
  if(was)s+='<rect class="was" x="'+(x-bw-1)+'" width="'+bw+'" y="'+y(was[i])+'" height="'+(y(0)-y(was[i]))+'" rx="1"><title>'+esc(prevWeek)+': '+was[i].toFixed(m.dec)+m.unit+'</title></rect>';
  s+='<rect class="now" x="'+nx+'" width="'+bw+'" y="'+y(now[i])+'" height="'+(y(0)-y(now[i]))+'" rx="1" style="opacity:'+(i===sel?1:.6)+'"><title>'+d.toLocaleDateString([],{weekday:'short'})+': '+now[i].toFixed(m.dec)+m.unit+'</title></rect>';
  if(now[i])s+='<text class="v" x="'+(nx+bw/2)+'" y="'+(y(now[i])-4)+'" text-anchor="middle">'+now[i].toFixed(m.dec)+'</text>';
  s+='<text x="'+x+'" y="'+(CH-5)+'" text-anchor="middle">'+d.toLocaleDateString([],{weekday:'short'})+'</text>'});
 $('#chart').innerHTML=s+'</svg>'}

// days: a card per day; picking one shows its sessions and its 24-hour ring
$('#days').innerHTML=days.map((d,di)=>'<button data-di="'+di+'" aria-pressed="'+(di===sel)+'"'+(d.toDateString()===todayKey?' class="today"':'')+'><span class="w">'+d.toLocaleDateString([],{weekday:'short'})+'</span><b>'+d.getDate()+'</b><span class="s">'+(dayHours[di]?fmtH(dayHours[di]):'—')+(DY.prs[di]?' · '+DY.prs[di]+' PR'+(DY.prs[di]>1?'s':''):'')+'</span></button>').join('');
$$('#days button').forEach(bt=>bt.onclick=()=>pickDay(+bt.dataset.di));
function pickDay(di,quiet){const dir=di-sel;sel=di;
 $$('#days button').forEach(x=>x.setAttribute('aria-pressed',+x.dataset.di===sel));
 $$('.grid>.dh').forEach((x,i)=>x.classList.toggle('on',i===sel));$$('.grid>.day').forEach((x,i)=>x.classList.toggle('on',i===sel));
 drawDay(quiet?0:dir);drawChart()}
function drawDay(dir){const mine=MB.filter(b=>{const s=new Date(b.start);return s.toDateString()===days[sel].toDateString()&&!isAuto(b.sessionId)}).sort((a,b)=>a.start-b.start);
 const anim=dir&&!REDUCE?(dir<0?'from-l':'from-r'):'';
 $('#dlist').innerHTML=mine.length?mine.map((b,i)=>'<button class="ses '+anim+'" style="animation-delay:'+(i*30)+'ms" data-id="'+esc(b.id)+'"><span class="tm">'+fmtT(b.start)+'–'+fmtT(b.end)+'</span><span class="swb" style="background:'+kOf(b).chip+'"></span><span class="ti">'+esc(nameOf(b))+(b.noCommit?' <span class="nc">· no commit</span>':'')+(isEx(b.sessionId)?' <span class="none">· excluded</span>':'')+'</span><span class="hr">'+fmtH((b.end-b.start)/36e5)+'</span></button>').join(''):'<p class="none">No sessions on '+days[sel].toLocaleDateString([],{weekday:'long'})+'.</p>';
 $$('#dlist .ses').forEach(x=>x.onclick=()=>jump(x.dataset.id));
 drawRing()}
// around the clock: busy arcs on a 24-hour ring, the night side shaded, routine runs as ticks outside
function drawRing(){const cx=110,cy=110,R=80,day0=new Date(days[sel]).getTime(),day1=day0+864e5;
 const pt=(h,r)=>{const a=h/24*Math.PI*2-Math.PI/2;return[cx+r*Math.cos(a),cy+r*Math.sin(a)]};
 const arc=(a,b,r)=>{const p=pt(a,r),q=pt(Math.min(b,a+23.999),r);return 'M'+p[0].toFixed(1)+' '+p[1].toFixed(1)+' A'+r+' '+r+' 0 '+(b-a>12?1:0)+' 1 '+q[0].toFixed(1)+' '+q[1].toFixed(1)};
 let s='<circle cx="'+cx+'" cy="'+cy+'" r="'+R+'" fill="none" stroke="var(--faint)" stroke-width="16"/>'+
  '<path d="'+arc(19,24,R)+'" fill="none" stroke="var(--rule)" stroke-width="16"/><path d="'+arc(0,7,R)+'" fill="none" stroke="var(--rule)" stroke-width="16"/>';
 const iv=[];let night=0;
 for(const b of MB){const a=Math.max(b.start,day0),e=Math.min(b.end,day1);if(e<=a)continue;const ha=(a-day0)/36e5,he=(e-day0)/36e5;
  if(isAuto(b.sessionId)){const p=pt(ha,R+11),q=pt(ha,R+15);s+='<line x1="'+p[0].toFixed(1)+'" y1="'+p[1].toFixed(1)+'" x2="'+q[0].toFixed(1)+'" y2="'+q[1].toFixed(1)+'" stroke="var(--mute)" stroke-width="1.5"/>';continue}
  if(isEx(b.sessionId))continue;
  iv.push([ha,he]);s+='<path d="'+arc(ha,he,R)+'" fill="none" stroke="'+kOf(b).chip+'" stroke-width="16"/>'}
 const tot=union(iv.map(([a,b])=>[a*36e5,b*36e5]));night=union(iv.map(([a,b])=>[a*36e5,Math.min(b,7)*36e5]).filter(x=>x[1]>x[0]))+union(iv.map(([a,b])=>[Math.max(a,19)*36e5,b*36e5]).filter(x=>x[1]>x[0]));
 for(let t=0;t<24;t++){const p=pt(t,R-11),q=pt(t,R-(t%6?14:18));s+='<line x1="'+p[0].toFixed(1)+'" y1="'+p[1].toFixed(1)+'" x2="'+q[0].toFixed(1)+'" y2="'+q[1].toFixed(1)+'" stroke="var(--rule)"/>'}
 [0,6,12,18].forEach(h=>{const p=pt(h,R+24);s+='<text x="'+p[0].toFixed(1)+'" y="'+(p[1]+3.5).toFixed(1)+'" text-anchor="middle" style="fill:var(--mute);font-size:10px">'+String(h).padStart(2,'0')+'</text>'});
 const nowD=new Date();if(nowD.toDateString()===days[sel].toDateString()){const h=nowD.getHours()+nowD.getMinutes()/60,p=pt(h,R-8),q=pt(h,R+8);s+='<line x1="'+p[0].toFixed(1)+'" y1="'+p[1].toFixed(1)+'" x2="'+q[0].toFixed(1)+'" y2="'+q[1].toFixed(1)+'" stroke="var(--ink)" stroke-width="2"/>'}
 s+='<text x="'+cx+'" y="'+(cy+2)+'" text-anchor="middle" style="fill:var(--ink);font-size:24px;font-weight:300">'+fmtH(tot)+'</text><text x="'+cx+'" y="'+(cy+20)+'" text-anchor="middle" style="fill:var(--mute);font-size:10px;letter-spacing:.1em">'+days[sel].toLocaleDateString([],{weekday:'short',day:'numeric'}).toUpperCase()+'</text>';
 const svg=$('#ring');svg.innerHTML=s;svg.setAttribute('aria-label','Sessions on '+days[sel].toLocaleDateString([],{weekday:'long'})+' around the clock');
 $('#ringcap').innerHTML=tot?'<b>'+fmtH(night)+'</b> of it ran between 19:00 and 07:00 (shaded).':'Nothing ran this day.'}

// detail drawer: it grows out of the block that was clicked
const drawer=$('#drawer');
const closeDrawer=()=>{drawer.classList.remove('open');drawer.setAttribute('aria-hidden','true');$$('.blk.sel').forEach(e=>e.classList.remove('sel'))};
$('#close').onclick=closeDrawer;document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDrawer()});
function openDrawer(from){const was=drawer.classList.contains('open');
 if(from&&!was&&!REDUCE){const r=from.getBoundingClientRect(),g=document.createElement('div');g.className='ghost';
  g.style.cssText='left:'+r.left+'px;top:'+r.top+'px;width:'+r.width+'px;height:'+r.height+'px;background:'+getComputedStyle(from).backgroundColor;
  document.body.appendChild(g);requestAnimationFrame(()=>{g.style.cssText+=';left:'+(innerWidth-Math.min(440,innerWidth))+'px;top:0;width:'+Math.min(440,innerWidth)+'px;height:'+innerHeight+'px;opacity:.0'});
  setTimeout(()=>g.remove(),300)}
 drawer.classList.add('open');drawer.setAttribute('aria-hidden','false');drawer.scrollTop=0;if(!was)$('#close').focus({preventScroll:true})}
function showStack(ids,from){const bs=ids.map(blockById).filter(Boolean);
 $('#detail').innerHTML='<div class="lbl">'+bs.length+' sessions at once</div><h2>'+fmtD(bs[0].start)+', '+fmtT(Math.min(...bs.map(b=>b.start)))+' – '+fmtT(Math.max(...bs.map(b=>b.end)))+'</h2><ul class="nc-list">'+
  bs.map(b=>'<li data-id="'+esc(b.id)+'"><span class="n"><i class="sw" style="display:inline-block;margin-right:8px;background:'+kOf(b).chip+'"></i>'+esc(nameOf(b))+'</span><span class="s">'+fmtT(b.start)+'–'+fmtT(b.end)+' · '+esc(b.project)+(b.noCommit?' · no commit':'')+'</span></li>').join('')+'</ul>';
 $$('#detail li[data-id]').forEach(li=>li.onclick=()=>show(li.dataset.id));openDrawer(from)}
function show(id,from){const b=blockById(id);if(!b)return;const ex=isEx(b.sessionId),sess=sessOf[b.sessionId];
 $$('.blk').forEach(e=>e.classList.toggle('sel',e.dataset.id===id));
 const commits=!b.isGitRepo?'<p class="none">Not a git repository.</p>':b.commits.length?b.commits.map(c=>'<div class="cm"><code>'+c.short+'</code><span>'+esc(c.subject)+(c.pushed===false?' <span class="none">· local only</span>':'')+'</span></div>').join(''):'<p class="none">None.</p>';
 const files=b.files.length?'<ul class="files">'+b.files.map(f=>'<li>'+esc(f)+'</li>').join('')+'</ul>':'<p class="none">None.</p>';
 const pr=prsOf(b);
 $('#detail').innerHTML='<div class="lbl">'+(isAuto(b.sessionId)?'Automated · ':ex?'Excluded · ':b.noCommit?'<span class="dot"></span>No commit · ':'')+esc(b.taskType)+'</div><h2>'+esc(nameOf(b))+'</h2><dl>'+
 (pr?'<dt>PRs</dt><dd>'+esc(pr)+'</dd>':'')+'<dt>Project</dt><dd>'+esc(b.project)+'</dd><dt>This bar</dt><dd>'+fmtD(b.start)+', '+fmtT(b.start)+' – '+fmtT(b.end)+'</dd>'+
 (sess?'<dt>Session</dt><dd>'+fmtD(sess.start)+' – '+fmtD(sess.end)+' · '+fmtH(sess.minutes/60)+(sess.busyHours!=null?', '+fmtH(sess.busyHours)+' busy':'')+'</dd>':'')+
 '<dt>Model</dt><dd>'+esc(b.models.join(', ')||'—')+'</dd><dt>Pushed</dt><dd>'+(b.productive?'Yes, productive':'No')+'</dd>'+(sess?.costUsd!=null?'<dt>Cost</dt><dd>$'+sess.costUsd.toFixed(2)+'</dd>':'')+'<dt>Folder</dt><dd class="none">'+esc(b.cwd)+'</dd></dl>'+
 '<div class="sec"><span class="lbl">First message</span><div class="quote">'+esc(b.firstMessage||'—')+'</div></div>'+
 '<div class="sec"><span class="lbl">Commits '+b.commits.length+'</span>'+commits+'</div>'+
 '<div class="sec"><span class="lbl">Files '+b.files.length+'</span>'+files+'</div>'+
 '<div class="sec"><span class="lbl">Totals</span>'+(ex?esc(b.sessionId in ov?'Excluded in this browser':sess?.excludeReason||'Excluded'):'Counted · '+(sess?.humanTurns??0)+' typed, '+(sess?.autoTurns??0)+' automated turns')+
 '<br><button class="btn" id="tog">'+(ex?'Count in totals':'Exclude from totals')+'</button>'+
 (b.sessionId in ov?'<p class="note">Saved in this browser only. To apply it to reports, ask Claude to '+(ex?'exclude':'include')+' “'+esc(nameOf(b))+'” in the week calendar.</p>':'')+'</div>';
 openDrawer(from);
 $('#tog').onclick=()=>{setEx(b.sessionId,!ex);show(id)}}
function setEx(sid,want){if(want===!!sessOf[sid]?.excluded)delete ov[sid];else ov[sid]=want;saveOv();
 $$('.blk').forEach(e=>{const bb=blockById(e.dataset.id);e.classList.toggle('ex',isEx(bb.sessionId))});renderTotals();drawDay(0)}
const lastBlock=sid=>MB.filter(x=>x.sessionId===sid).pop();
function jump(id){const b=blockById(id);if(b){const di=days.findIndex(d=>d.toDateString()===new Date(b.start).toDateString());if(di>=0&&di!==sel)pickDay(di,true)}
 const el=document.querySelector('.blk[data-id="'+CSS.escape(id)+'"]');show(id,el);el?.scrollIntoView({block:'center',behavior:REDUCE?'auto':'smooth'})}

// no commit: pick why each stopped (the weekly survey's reasons) or exclude it, then copy one line for Claude
const REASONS=['blocked','exploratory','abandoned','parked'];
const saved=D.survey?.noCommitReasons||{};
const picks=store('wc-why-'+D.week.start);
const savePicks=()=>store('wc-why-'+D.week.start,picks);
function renderLists(){
const ncs=D.sessions.filter(s=>s.noCommit&&!isEx(s.sessionId)&&!isAuto(s.sessionId)).sort((a,b)=>b.minutes-a.minutes||b.end-a.end);
const autos=D.sessions.filter(s=>isAuto(s.sessionId));const autoH=marked&&D.machineHours?D.machineHours.automated:union(MB.filter(b=>isAuto(b.sessionId)).map(b=>[b.start,b.end]));
$('#nc').innerHTML=(ncs.length?ncs.map(s=>{const b=lastBlock(s.sessionId),r=picks[s.sessionId]??saved[s.sessionId];
 return '<li data-id="'+esc(b.id)+'"><span class="n">'+esc(nameOf(s))+'</span><span class="s">'+fmtD(s.end)+', '+fmtT(s.end)+' · '+fmtH(s.minutes/60)+(saved[s.sessionId]?' · saved: '+esc(saved[s.sessionId]):'')+'</span>'+
 '<div class="why" data-sid="'+esc(s.sessionId)+'">'+REASONS.map(x=>'<button data-r="'+x+'" aria-pressed="'+(r===x)+'">'+x[0].toUpperCase()+x.slice(1)+'</button>').join('')+'<button class="exb" data-r="exclude" aria-pressed="false">Exclude</button></div></li>'}).join(''):'<li class="none">None this week.</li>')+
 (autos.length?'<li class="sum"><span class="n">'+autos.length+' automated runs</span><span class="s">'+fmtH(autoH)+' · ticks on the right edge of each day</span></li>':'');
const exs=D.sessions.filter(s=>isEx(s.sessionId)&&!isAuto(s.sessionId)).sort((a,b)=>b.minutes-a.minutes);
$('#ex').innerHTML=exs.length?exs.map(s=>{const b=lastBlock(s.sessionId);
 return '<li data-id="'+esc(b.id)+'"><span class="n">'+esc(nameOf(s))+'</span><span class="s">'+fmtH(s.minutes/60)+' · '+esc(s.sessionId in ov?'this browser':s.excludeReason?.split(':')[0]||'')+'</span></li>'}).join(''):'<li class="none">None.</li>';
$$('#nc li[data-id],#ex li[data-id]').forEach(li=>li.onclick=e=>{if(!e.target.closest('.why'))jump(li.dataset.id)});
$$('#nc .why button').forEach(bt=>bt.onclick=()=>{const sid=bt.parentElement.dataset.sid,r=bt.dataset.r;
 if(r==='exclude'){setEx(sid,true);return}
 const cur=picks[sid]??saved[sid];if(cur===r||r===saved[sid])delete picks[sid];else picks[sid]=r;savePicks();renderLists()});
renderTray()}
function renderTray(){const reasons=Object.fromEntries(Object.entries(picks).filter(([sid,r])=>r&&sessOf[sid]));
 const exs=Object.keys(ov).filter(sid=>ov[sid]!==!!sessOf[sid]?.excluded&&sessOf[sid]);
 const n=Object.keys(reasons).length+exs.length;
 if(!n){$('#tray').innerHTML='';return}
 const parts=[];
 if(Object.keys(reasons).length)parts.push('save these no-commit reasons for '+(D.survey?.isoWeek||D.week.isoWeek)+': '+JSON.stringify(reasons));
 if(exs.length)parts.push(exs.map(sid=>(ov[sid]?'exclude':'include')+' “'+nameOf(sessOf[sid])+'” ('+sid+')').join(', '));
 const text='Week calendar: '+parts.join('; and ')+'.';
 $('#tray').innerHTML='<div class="tray"><span>'+n+' change'+(n>1?'s':'')+' saved in this browser only</span><button id="copy">Copy for Claude</button></div>';
 $('#copy').onclick=async()=>{const bt=$('#copy');try{await navigator.clipboard.writeText(text);bt.textContent='Copied'}catch{
  $('#tray .tray').insertAdjacentHTML('afterend','<textarea rows="4" readonly>'+esc(text)+'</textarea>');const ta=$('#tray textarea');ta.focus();ta.select()}}}

// merged PRs: yours first. The build knows your GitHub login; for a calendar built before it did,
// you are the author with the most merged PRs your sessions touched.
// a session's busy hours are shared across the PRs it touched (the build does this; older calendars did not)
const share={};for(const p of prList)for(const s of p.sessions||[])share[s]=(share[s]||0)+1;
const agentH=p=>'yours' in p?p.agentHours||0:(p.sessions||[]).reduce((n,s)=>n+((sessOf[s]?.busyHours||0)/(share[s]||1)),0);
const prLi=p=>'<li><a class="n" href="'+esc(p.url)+'" style="color:inherit;text-decoration:none">'+esc(p.title)+'</a><span class="s">#'+p.number+(!isMine(p)?' · '+esc(p.author):'')+' · '+fmtD(Date.parse(p.mergedAt))+(agentH(p)>=.05?' · '+fmtH(agentH(p))+' agent':'')+'</span></li>';
let showOthers=false;
function renderPrs(){$('#prs').innerHTML=(mine.length?mine.map(prLi).join(''):'<li class="none">None of yours this week.</li>')+(showOthers?others.map(prLi).join(''):'');
 const t=$('#prtog');t.hidden=!others.length;t.textContent=(showOthers?'Hide':'Show')+' '+others.length+' teammate PRs you committed to'}
$('#prtog').onclick=()=>{showOthers=!showOthers;renderPrs()};renderPrs();

renderTotals();drawDay(0);drawChart();requestAnimationFrame(moveUl);
let rz=0;addEventListener('resize',()=>{cancelAnimationFrame(rz);rz=requestAnimationFrame(()=>{moveUl();drawChart()})});
$('#foot').textContent='Generated '+new Date(D.generatedAt).toLocaleString([],{hour12:false})+' · '+(D.machine||'')+' · Parallel sessions counted once';
`
}
