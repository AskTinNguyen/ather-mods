// The calendar page: one self-contained HTML file, no external requests.

// ---------- colors ----------
// Rams palette: the accent marks the first group only; every other group is a
// quiet, low-chroma tone. Red is reserved for the no-commit indicator.
function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0, s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h *= 60
  }
  return [h, s * 100, l * 100]
}
export function buildColors(prefs, totals, blocks) {
const [accentH] = hexToHsl(prefs.accent)
const groups = prefs.colorBy === 'project'
  ? [...totals.map(t => t.project), ...new Set(blocks.filter(b => !totals.some(t => t.project === b.project)).map(b => b.project))]
  : [...new Set(blocks.map(b => b.taskType))].sort()
const colorOf = {}
groups.forEach((g, i) => {
  const h = Math.round((accentH + 180 + (i - 1) * 47) % 360)
  const step = (i - 1) % 4
  const chip = i === 0 ? prefs.accent
    : prefs.theme === 'dark' ? `hsl(${h} 14% ${48 + step * 7}%)` : `hsl(${h} 14% ${58 - step * 6}%)`
  colorOf[g] = { chip, fill: `color-mix(in srgb, ${chip} ${i === 0 ? 22 : 18}%, var(--bg))` }
})
return colorOf
}

// ---------- HTML ----------
// Less, but better: one typeface, hairline rules, flat tones, the accent once,
// red only where something needs attention.
export function renderHtml(d) {
  const dark = d.prefs.theme === 'dark'
  const [accentH] = hexToHsl(d.prefs.accent)
  const css = `
:root{--bg:${dark ? '#1b1b1a' : '#f2f1ed'};--ink:${dark ? '#e9e7e2' : '#1a1a1a'};--mute:${dark ? '#8a8883' : '#8a8780'};
--rule:${dark ? '#2e2e2c' : '#dddbd5'};--faint:${dark ? '#242423' : '#e9e8e3'};--panel:${dark ? '#222221' : '#fbfaf7'};--accent:${d.prefs.accent};--red:#e2401c}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--bg);color:var(--ink);font:13px/1.5 "Helvetica Neue",Helvetica,Arial,system-ui,sans-serif;
 font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}
.wrap{width:100%;padding:32px 16px 32px}
.lbl{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--mute)}
header{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;padding-bottom:20px;border-bottom:1px solid var(--rule)}
header h1{font-weight:400;font-size:22px;letter-spacing:-.01em;margin-top:6px}
.total{text-align:right}.total b{font-weight:300;font-size:44px;line-height:1;letter-spacing:-.03em}.total b small{font-size:16px;color:var(--mute);margin-left:2px}
.kpi{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px 24px;padding:20px 0;border-bottom:1px solid var(--rule)}
.kpi div{display:flex;flex-direction:column;gap:2px;min-width:0}.kpi b{font-weight:300;font-size:26px;line-height:1.1;letter-spacing:-.02em}
.kpi .k1 b{color:var(--accent)}.kpi span{color:var(--mute);font-size:11px}.kpi em{font-style:normal;color:var(--mute);font-size:11px}
.bar{display:flex;height:3px;margin:20px 0 12px;background:var(--faint)}.bar i{display:block;height:100%}
.legend{display:flex;flex-wrap:wrap;gap:8px 24px;padding-bottom:20px;border-bottom:1px solid var(--rule)}
.legend div{display:flex;align-items:baseline;gap:6px;min-width:0;max-width:340px}
.legend span{display:flex;align-items:center;gap:6px;color:var(--ink);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.legend b{font-weight:400;font-size:12px;color:var(--mute);white-space:nowrap}
.sw{width:8px;height:8px;border-radius:2px;flex:none}
.tabs{display:none;gap:4px;padding-top:16px;overflow-x:auto}
.tabs button{flex:1;min-width:44px;background:none;border:1px solid var(--rule);color:var(--mute);font:inherit;font-size:11px;padding:6px 0;border-radius:2px;cursor:pointer}
.tabs button.on{border-color:var(--accent);color:var(--ink)}
.cal{padding-top:20px}
.grid{display:grid;grid-template-columns:40px repeat(7,minmax(0,1fr))}
.dh{padding:0 8px 10px;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--mute)}
.dh b{display:block;font-size:18px;font-weight:300;letter-spacing:0;color:var(--ink);text-transform:none;margin-top:2px}
.dh em{font-style:normal;letter-spacing:0;text-transform:none;margin-left:6px}
.dh.today b{color:var(--accent)}
.hours{position:relative}.hl{position:absolute;right:8px;font-size:10px;color:var(--mute);transform:translateY(-50%)}
.day{position:relative;border-left:1px solid var(--rule)}
.rule{position:absolute;left:0;right:0;border-top:1px solid var(--faint)}
.now{position:absolute;left:0;right:0;border-top:1px solid var(--ink);z-index:2}
.tick{position:absolute;right:0;width:4px;background:var(--mute);opacity:.45;border-radius:1px}
.blk{position:absolute;border:0;border-radius:2px;padding:4px 6px;text-align:left;font:inherit;font-size:11px;line-height:1.3;cursor:pointer;overflow:hidden}
.blk .t{display:block;white-space:normal;overflow-wrap:break-word;overflow:hidden;padding-right:6px;font-weight:500}
.blk .m{display:block;opacity:.7;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.blk.cont .t{font-weight:400;opacity:.6}
.blk{box-shadow:inset 3px 0 0 var(--edge)}.blk.nc{box-shadow:inset 3px 0 0 var(--edge),inset 0 0 0 1px var(--red)}
.blk.nc::after{content:"";position:absolute;top:4px;right:4px;width:5px;height:5px;border-radius:50%;background:var(--red)}
.blk.ex{background:repeating-linear-gradient(135deg,transparent 0 4px,var(--faint) 4px 5px)!important;color:var(--mute)!important;box-shadow:inset 0 0 0 1px var(--rule)}
.blk.ex::after{display:none}
.btn{margin-top:16px;background:none;border:1px solid var(--rule);color:var(--ink);font:inherit;font-size:11px;padding:6px 10px;border-radius:2px;cursor:pointer}
.btn:hover{border-color:var(--ink)}.note{margin-top:8px;font-size:11px;color:var(--mute)}
.lnk{background:none;border:0;color:var(--mute);font:inherit;font-size:11px;cursor:pointer;text-decoration:underline;margin-top:10px}
.blk:hover{filter:brightness(${dark ? 1.15 : 0.95})}.blk.sel{outline:1px solid var(--ink);outline-offset:1px;z-index:3}
.lists{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:32px 48px;margin-top:40px;padding-top:24px;border-top:1px solid var(--rule)}
.lists section{min-width:0}
.drawer{position:fixed;top:0;right:0;bottom:0;width:min(440px,100%);background:var(--panel);border-left:1px solid var(--rule);padding:24px;overflow:auto;z-index:20;
 transform:translateX(100%);transition:transform .18s ease;box-shadow:-12px 0 32px rgba(0,0,0,${dark ? '.35' : '.08'})}
.drawer.open{transform:none}
.x{position:absolute;top:16px;right:16px;background:none;border:1px solid var(--rule);color:var(--mute);width:28px;height:28px;border-radius:2px;cursor:pointer;font:inherit;font-size:14px}
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
.dot{display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--red);margin-right:8px;vertical-align:middle}
footer{margin-top:48px;padding-top:16px;border-top:1px solid var(--rule);color:var(--mute);font-size:10px;letter-spacing:.08em;text-transform:uppercase}
@media (max-width:600px){.wrap{padding:24px 16px}.total b{font-size:36px}header{flex-direction:column;align-items:flex-start}.total{text-align:left}
 #meta{line-height:1.6}.legend div{max-width:100%}.tabs button{min-width:0}
 .tabs{display:flex}.grid{grid-template-columns:40px minmax(0,1fr)}.grid>.dh,.grid>.day{display:none}.grid>.dh.on,.grid>.day.on{display:block}}`
  const payload = JSON.stringify(d).replace(/</g, '\\u003c')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Week ${d.week.start}</title><style>${css}</style></head><body><div class="wrap">
<header><div><div class="lbl" id="wk"></div><h1 id="range"></h1></div>
<div class="total"><b id="tot"></b><div class="lbl" id="meta"></div></div></header>
<div class="kpi" id="kpi"></div><div class="bar" id="bar"></div><div class="legend" id="legend"></div>
<div class="tabs" id="tabs"></div>
<div class="cal"><div class="grid" id="grid"></div></div>
<div class="lists">
<section><div class="lbl">Merged PRs</div><ul class="nc-list" id="prs"></ul><button class="lnk" id="prtog" hidden></button></section>
<section><div class="lbl"><span class="dot"></span>No commit</div><ul class="nc-list" id="nc"></ul></section>
<section><div class="lbl">Excluded from totals</div><ul class="nc-list" id="ex"></ul></section></div>
<footer id="foot"></footer></div>
<aside class="drawer" id="drawer" aria-hidden="true"><button class="x" id="close" aria-label="Close">×</button><section id="detail"></section></aside>
<script>${clientScript(payload, accentH, dark)}</script></body></html>`
}

function clientScript(payload, accentH, dark) {
  return String.raw`
const D=${payload};
const ACCENT_H=${accentH},DARK=${dark};
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtT=t=>new Date(t).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false});
const fmtD=t=>new Date(t).toLocaleDateString([],{weekday:'short',day:'numeric',month:'short'});
const fmtH=h=>h>=1?h.toFixed(1)+' h':Math.round(h*60)+' min';
const short=s=>{const w=String(s||'').split(/\s+/).slice(0,5).join(' ');return w.length<String(s||'').length?w+'…':w};
const MIN=6e4;

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
let ov={};try{ov=JSON.parse(localStorage.getItem('wc-ov-'+D.week.start)||'{}')}catch{}
const isEx=id=>id in ov?ov[id]:!!D.sessions.find(s=>s.sessionId===id)?.excluded;
const saveOv=()=>{try{localStorage.setItem('wc-ov-'+D.week.start,JSON.stringify(ov))}catch{}};
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
 order.forEach((g,i)=>{const h=Math.round((ACCENT_H+i*137.5)%360);
  const chip=i===0?getComputedStyle(document.documentElement).getPropertyValue('--accent').trim():i<9?(DARK?'hsl('+h+' 32% 60%)':'hsl('+h+' 32% 45%)'):'var(--mute)';
  colorOf[g]={chip,fill:'color-mix(in srgb, '+chip+' '+(i===0?24:20)+'%, var(--bg))'};groupName[g]=nameOf(best[g])})}

function totals(){const bs=MB.filter(b=>!isEx(b.sessionId)&&!isAuto(b.sessionId));const by={};for(const b of bs)(by[groupOf(b)]=by[groupOf(b)]||[]).push([b.start,b.end]);
 return{all:union(bs.map(b=>[b.start,b.end])),list:Object.entries(by).map(([g,iv])=>({g,hours:union(iv)})).sort((a,b)=>b.hours-a.hours),
  n:new Set(bs.map(b=>b.sessionId)).size}}
function renderTotals(){const T=totals();
const nx=D.sessions.filter(s=>isEx(s.sessionId)&&!isAuto(s.sessionId)).length;
$('#tot').innerHTML=(D.machineHours?D.machineHours.busy:T.all).toFixed(1)+'<small>h</small>';
$('#meta').textContent=(D.machineHours?'Agent busy · '+fmtH(T.all)+' session time':'Session time')+' · '+T.n+' sessions'+(AUTO.size?' · '+AUTO.size+' automated runs apart':'')+(nx?' · '+nx+' excluded':'')+' · '+D.timeZone;
// group totals: one proportional rule, then the figures
const lead=T.list.slice(0,8),rest=T.list.slice(8);
const restH=rest.reduce((n,t)=>n+t.hours,0),sumH=T.list.reduce((n,t)=>n+t.hours,0)||1;
const swOf=g=>colorOf[g]?.chip||'var(--mute)';const lab=g=>byWork?groupName[g]||g:g;
$('#bar').innerHTML=lead.map(t=>'<i style="width:'+(t.hours/sumH*100)+'%;background:'+swOf(t.g)+'"></i>').join('')+(restH?'<i style="width:'+(restH/sumH*100)+'%;background:var(--rule)"></i>':'');
$('#legend').innerHTML=lead.map(t=>'<div title="'+esc(lab(t.g))+'"><span><i class="sw" style="background:'+swOf(t.g)+'"></i>'+esc(lab(t.g))+'</span><b>'+fmtH(t.hours)+'</b></div>').join('')+
 (rest.length?'<div><span><i class="sw" style="background:var(--rule)"></i>'+rest.length+' others</span><b>'+fmtH(restH)+'</b></div>':'')+
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
const dayHours=days.map((_,di)=>union(pieces.filter(p=>p.di===di&&!p.auto).map(p=>[p.sh,p.eh]))*36e5);
const todayKey=new Date().toDateString();
let sel=days.findIndex(d=>d.toDateString()===todayKey);if(sel<0)sel=dayHours.indexOf(Math.max(...dayHours));
const grid=$('#grid'),height=(h1-h0)*H;
grid.innerHTML='<div></div>'+days.map((d,di)=>'<div class="dh'+(d.toDateString()===todayKey?' today':'')+(di===sel?' on':'')+'">'+d.toLocaleDateString([],{weekday:'short'})+(dayHours[di]?'<em>'+fmtH(dayHours[di])+'</em>':'')+'<b>'+d.getDate()+'</b></div>').join('');
$('#tabs').innerHTML=days.map((d,di)=>'<button data-di="'+di+'"'+(di===sel?' class="on"':'')+'>'+d.toLocaleDateString([],{weekday:'short'})+' '+d.getDate()+'</button>').join('');
document.querySelectorAll('#tabs button').forEach(bt=>bt.onclick=()=>{sel=+bt.dataset.di;
 document.querySelectorAll('#tabs button').forEach(x=>x.classList.toggle('on',+x.dataset.di===sel));
 document.querySelectorAll('.grid>.dh').forEach((x,i)=>x.classList.toggle('on',i===sel));document.querySelectorAll('.grid>.day').forEach((x,i)=>x.classList.toggle('on',i===sel))});
const hours=document.createElement('div');hours.className='hours';hours.style.height=height+'px';
for(let h=h0;h<=h1;h+=2)hours.insertAdjacentHTML('beforeend','<div class="hl" style="top:'+((h-h0)*H)+'px">'+String(h).padStart(2,'0')+'</div>');
grid.appendChild(hours);
days.forEach((d,di)=>{const col=document.createElement('div');col.className='day'+(di===sel?' on':'');col.style.height=height+'px';
 for(let h=h0;h<=h1;h++)col.insertAdjacentHTML('beforeend','<div class="rule" style="top:'+((h-h0)*H)+'px"></div>');
 if(d.toDateString()===todayKey){const n=new Date(),nh=n.getHours()+n.getMinutes()/60;if(nh>=h0&&nh<=h1)col.insertAdjacentHTML('beforeend','<div class="now" style="top:'+((nh-h0)*H)+'px"></div>')}
 // automated runs: ticks on the column edge, out of the way of real work
 for(const p of pieces.filter(p=>p.di===di&&p.auto&&p.eh>h0&&p.sh<h1)){const t=document.createElement('div');t.className='tick';
  t.style.cssText='top:'+((Math.max(p.sh,h0)-h0)*H)+'px;height:'+Math.max(2,(p.eh-p.sh)*H)+'px';t.title=titleOf(p.b)+' · '+fmtT(p.b.start);col.appendChild(t)}
 const ps=pieces.filter(p=>p.di===di&&!p.auto).sort((a,b)=>a.sh-b.sh);const lanes=[],clusters=[];let cl=null,end=-1;
 for(const p of ps){if(p.sh>=end){cl=[];clusters.push(cl)}cl.push(p);end=Math.max(end,p.eh);let li=lanes.findIndex(e=>e<=p.sh);if(li<0){li=lanes.length;lanes.push(0)}lanes[li]=p.eh;p.lane=li}
 const seen=new Set();
 for(const c of clusters){const n=Math.max(...c.map(p=>p.lane))+1;for(const p of c){
  const k=colorOf[groupOf(p.b)]||{fill:'var(--rule)',chip:'var(--mute)'};const ht=Math.max(6,(p.eh-p.sh)*H-2);const cont=seen.has(p.b.sessionId);seen.add(p.b.sessionId);
  const el=document.createElement('button');el.className='blk'+(p.b.noCommit?' nc':'')+(isEx(p.b.sessionId)?' ex':'')+(cont?' cont':'');el.dataset.id=p.b.id;
  el.style.cssText='top:'+((p.sh-h0)*H+1)+'px;height:'+ht+'px;left:calc('+(p.lane/n*100)+'% + 2px);width:calc('+(100/n)+'% - 6px);background:'+k.fill+';color:var(--ink)'+(ht<22?';padding:0':'');el.style.setProperty('--edge',k.chip);
  const pr=prsOf(p.b);
  if(ht>=22)el.innerHTML='<span class="t">'+(cont?'↳ ':'')+esc(nameOf(p.b))+'</span>'+(ht>=40&&!cont?'<span class="m">'+fmtT(p.b.start)+'–'+fmtT(p.b.end)+(pr?' · '+esc(pr):'')+'</span>':'');
  el.title=titleOf(p.b)+'\n'+fmtT(p.b.start)+'–'+fmtT(p.b.end);el.onclick=()=>show(p.b.id);col.appendChild(el)}}
 grid.appendChild(col)});

// detail drawer
const drawer=$('#drawer');
const closeDrawer=()=>{drawer.classList.remove('open');drawer.setAttribute('aria-hidden','true');document.querySelectorAll('.blk.sel').forEach(e=>e.classList.remove('sel'))};
$('#close').onclick=closeDrawer;document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDrawer()});
function show(id){const b=blockById(id);if(!b)return;const ex=isEx(b.sessionId),sess=sessOf[b.sessionId];
 document.querySelectorAll('.blk').forEach(e=>e.classList.toggle('sel',e.dataset.id===id));
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
 drawer.classList.add('open');drawer.setAttribute('aria-hidden','false');drawer.scrollTop=0;
 $('#tog').onclick=()=>{const want=!ex;if(want===!!sess?.excluded)delete ov[b.sessionId];else ov[b.sessionId]=want;saveOv();
  document.querySelectorAll('.blk').forEach(e=>{const bb=blockById(e.dataset.id);e.classList.toggle('ex',isEx(bb.sessionId))});renderTotals();show(id)}}
const lastBlock=sid=>MB.filter(x=>x.sessionId===sid).pop();
function jump(id){const b=blockById(id);if(b){const di=days.findIndex(d=>d.toDateString()===new Date(b.start).toDateString());const t=document.querySelector('#tabs button[data-di="'+di+'"]');if(t&&getComputedStyle($('#tabs')).display!=='none')t.click()}
 show(id);document.querySelector('.blk[data-id="'+CSS.escape(id)+'"]')?.scrollIntoView({block:'center',behavior:'smooth'})}
function renderLists(){
const ncs=D.sessions.filter(s=>s.noCommit&&!isEx(s.sessionId)&&!isAuto(s.sessionId)).sort((a,b)=>b.minutes-a.minutes||b.end-a.end);
const autos=D.sessions.filter(s=>isAuto(s.sessionId));const autoH=marked&&D.machineHours?D.machineHours.automated:union(MB.filter(b=>isAuto(b.sessionId)).map(b=>[b.start,b.end]));
$('#nc').innerHTML=(ncs.length?ncs.map(s=>{const b=lastBlock(s.sessionId);
 return '<li data-id="'+esc(b.id)+'"><span class="n">'+esc(nameOf(s))+'</span><span class="s">'+fmtD(s.end)+', '+fmtT(s.end)+' · '+fmtH(s.minutes/60)+'</span></li>'}).join(''):'<li class="none">None this week.</li>')+
 (autos.length?'<li class="sum"><span class="n">'+autos.length+' automated runs</span><span class="s">'+fmtH(autoH)+' · ticks on the right edge of each day</span></li>':'');
const exs=D.sessions.filter(s=>isEx(s.sessionId)&&!isAuto(s.sessionId)).sort((a,b)=>b.minutes-a.minutes);
$('#ex').innerHTML=exs.length?exs.map(s=>{const b=lastBlock(s.sessionId);
 return '<li data-id="'+esc(b.id)+'"><span class="n">'+esc(nameOf(s))+'</span><span class="s">'+fmtH(s.minutes/60)+' · '+esc(s.sessionId in ov?'this browser':s.excludeReason?.split(':')[0]||'')+'</span></li>'}).join(''):'<li class="none">None.</li>';
document.querySelectorAll('#nc li[data-id],#ex li[data-id]').forEach(li=>li.onclick=()=>jump(li.dataset.id))}

// merged PRs: yours first. The build knows your GitHub login; for a calendar built before it did,
// you are the author with the most merged PRs your sessions touched.
const prs=D.prsMerged||[];const ac={};for(const p of prs)if(p.sessions?.length)ac[p.author]=(ac[p.author]||0)+1;
const ME=String(D.githubLogin||Object.keys(ac).sort((a,b)=>ac[b]-ac[a])[0]||'').toLowerCase();
const isMine=p=>typeof p.yours==='boolean'?p.yours:String(p.author||'').toLowerCase()===ME;
const mine=prs.filter(isMine),others=prs.filter(p=>!isMine(p));
// a session's busy hours are shared across the PRs it touched (the build does this; older calendars did not)
const share={};for(const p of prs)for(const s of p.sessions||[])share[s]=(share[s]||0)+1;
const agentH=p=>'yours' in p?p.agentHours||0:(p.sessions||[]).reduce((n,s)=>n+((sessOf[s]?.busyHours||0)/(share[s]||1)),0);
const prLi=p=>'<li><a class="n" href="'+esc(p.url)+'" style="color:inherit;text-decoration:none">'+esc(p.title)+'</a><span class="s">#'+p.number+(!isMine(p)?' · '+esc(p.author):'')+' · '+fmtD(Date.parse(p.mergedAt))+(agentH(p)>=.05?' · '+fmtH(agentH(p))+' agent':'')+'</span></li>';
let showOthers=false;
function renderPrs(){$('#prs').innerHTML=(mine.length?mine.map(prLi).join(''):'<li class="none">None of yours this week.</li>')+(showOthers?others.map(prLi).join(''):'');
 const t=$('#prtog');t.hidden=!others.length;t.textContent=(showOthers?'Hide':'Show')+' '+others.length+' teammate PRs you committed to'}
$('#prtog').onclick=()=>{showOthers=!showOthers;renderPrs()};renderPrs();

// machine figures (from the build; the browser toggles above do not change them)
const M=D.machineHours||{},K=D.metrics||{};const pct=v=>v==null?'—':Math.round(v*100)+'%';
// the build counts automated time outside busy time; a calendar built before it marked routine runs adds them up here
const autoHours=marked?M.automated||0:Math.max(M.automated||0,union(MB.filter(b=>isAuto(b.sessionId)).map(b=>[b.start,b.end])));
$('#kpi').innerHTML=D.machineHours?[
 ['k1','PRs merged',String(mine.length),others.length?'+'+others.length+' teammate PRs':''],
 ['k1','Productive time',pct(M.productiveUtilization),'of '+fmtH(M.available||0)+' available'],
 ['','Session time',fmtH(totals().all),'blocks, parallel sessions once'],
 ['','Waiting on you',fmtH(M.waitingOnPerson||0),''],
 ['','Automated',fmtH(autoHours),AUTO.size+' runs'],
 ['','Cost',K.costUsd!=null?'$'+Math.round(K.costUsd).toLocaleString():'—',K.commits!=null?K.commits+' commits':'']
].map(([c,l,v,s])=>'<div class="'+c+'"><span>'+l+'</span><b>'+v+'</b><em>'+esc(s)+'</em></div>').join(''):'';
renderTotals();
$('#foot').textContent='Generated '+new Date(D.generatedAt).toLocaleString([],{hour12:false})+' · '+(D.machine||'')+' · Parallel sessions counted once';
`
}
