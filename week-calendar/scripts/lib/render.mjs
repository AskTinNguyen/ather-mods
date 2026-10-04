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
  const css = `
:root{--bg:${dark ? '#1b1b1a' : '#f2f1ed'};--ink:${dark ? '#e9e7e2' : '#1a1a1a'};--mute:${dark ? '#8a8883' : '#8a8780'};
--rule:${dark ? '#2e2e2c' : '#dddbd5'};--faint:${dark ? '#242423' : '#e9e8e3'};--accent:${d.prefs.accent};--red:#e2401c}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--bg);color:var(--ink);font:13px/1.5 "Helvetica Neue",Helvetica,Arial,system-ui,sans-serif;
 font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}
.wrap{max-width:1440px;margin:0 auto;padding:48px 48px 32px}
.lbl{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--mute)}
header{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;padding-bottom:24px;border-bottom:1px solid var(--rule)}
header h1{font-weight:400;font-size:22px;letter-spacing:-.01em;margin-top:6px}
.total{text-align:right}.total b{font-weight:300;font-size:48px;line-height:1;letter-spacing:-.03em}.total b small{font-size:16px;color:var(--mute);margin-left:2px}
.bar{display:flex;height:3px;margin:24px 0 16px;background:var(--faint)}.bar i{display:block;height:100%}
.projects{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px 24px;padding-bottom:24px;border-bottom:1px solid var(--rule)}
.projects div{display:flex;flex-direction:column;gap:2px;min-width:0}
.projects span{display:flex;align-items:center;gap:6px;color:var(--mute);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.projects b{font-weight:400;font-size:15px}
.kpi{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px 24px;padding:24px 0;border-bottom:1px solid var(--rule)}
.kpi div{display:flex;flex-direction:column;gap:2px}.kpi b{font-weight:300;font-size:28px;line-height:1.1;letter-spacing:-.02em}
.kpi .k1 b{color:var(--accent)}.kpi span{color:var(--mute);font-size:11px}
.sw{width:6px;height:6px;border-radius:50%;flex:none}
main{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:48px;padding-top:24px}
.cal{overflow-x:auto}
.grid{display:grid;grid-template-columns:40px repeat(7,minmax(96px,1fr));min-width:740px}
.dh{padding:0 8px 12px;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--mute)}
.dh b{display:block;font-size:18px;font-weight:300;letter-spacing:0;color:var(--ink);text-transform:none;margin-top:2px}
.dh.today b{color:var(--accent)}
.hours{position:relative}.hl{position:absolute;right:8px;font-size:10px;color:var(--mute);transform:translateY(-50%)}
.day{position:relative;border-left:1px solid var(--rule)}
.rule{position:absolute;left:0;right:0;border-top:1px solid var(--faint)}
.now{position:absolute;left:0;right:0;border-top:1px solid var(--ink);z-index:2}
.blk{position:absolute;border:0;border-radius:2px;padding:4px 6px;text-align:left;font:inherit;font-size:11px;line-height:1.3;cursor:pointer;overflow:hidden}
.blk .t{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:6px}.blk .m{display:block;opacity:.7;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.blk{box-shadow:inset 2px 0 0 var(--edge)}.blk.nc{box-shadow:inset 2px 0 0 var(--edge),inset 0 0 0 1px var(--red)}
.blk.nc::after{content:"";position:absolute;top:4px;right:4px;width:5px;height:5px;border-radius:50%;background:var(--red)}
.blk.ex{background:repeating-linear-gradient(135deg,transparent 0 4px,var(--faint) 4px 5px)!important;color:var(--mute)!important;box-shadow:inset 0 0 0 1px var(--rule)}
.blk.ex::after{display:none}
.btn{margin-top:16px;background:none;border:1px solid var(--rule);color:var(--ink);font:inherit;font-size:11px;padding:6px 10px;border-radius:2px;cursor:pointer}
.btn:hover{border-color:var(--ink)}.note{margin-top:8px;font-size:11px;color:var(--mute)}
.blk:hover{filter:brightness(${dark ? 1.15 : 0.95})}.blk.sel{outline:1px solid var(--ink);outline-offset:1px;z-index:3}
aside{display:flex;flex-direction:column;gap:40px;min-width:0}
aside h2{font-weight:400;font-size:15px;margin:8px 0 16px;line-height:1.35}
dl{display:grid;grid-template-columns:72px 1fr;gap:6px 12px}dt{color:var(--mute)}dd{word-break:break-word}
.sec{margin-top:20px}.sec .lbl{display:block;margin-bottom:6px}
.quote{border-left:1px solid var(--rule);padding-left:12px;white-space:pre-wrap;max-height:140px;overflow:auto}
.cm{display:flex;gap:10px;padding:3px 0}.cm code{font:11px/1.6 ui-monospace,Menlo,Consolas,monospace;color:var(--mute)}
.files{list-style:none;font:11px/1.7 ui-monospace,Menlo,Consolas,monospace;color:var(--mute);max-height:180px;overflow:auto;word-break:break-all}
.none{color:var(--mute)}
.nc-list{list-style:none;margin-top:12px}.nc-list li{padding:10px 0;border-top:1px solid var(--rule);cursor:pointer}
.nc-list li:last-child{border-bottom:1px solid var(--rule)}.nc-list li:hover .n{text-decoration:underline}
.nc-list .s{display:block;color:var(--mute);font-size:11px}
.dot{display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--red);margin-right:8px;vertical-align:middle}
footer{margin-top:48px;padding-top:16px;border-top:1px solid var(--rule);color:var(--mute);font-size:10px;letter-spacing:.08em;text-transform:uppercase}
@media (max-width:960px){main{grid-template-columns:1fr}}
@media (max-width:600px){.wrap{padding:24px 16px}.total b{font-size:36px}header{flex-direction:column;align-items:flex-start}.total{text-align:left}}`
  const payload = JSON.stringify(d).replace(/</g, '\\u003c')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Week ${d.week.start}</title><style>${css}</style></head><body><div class="wrap">
<header><div><div class="lbl" id="wk"></div><h1 id="range"></h1></div>
<div class="total"><b id="tot"></b><div class="lbl" id="meta"></div></div></header>
<div class="kpi" id="kpi"></div><div class="bar" id="bar"></div><div class="projects" id="projects"></div>
<main><div class="cal"><div class="grid" id="grid"></div></div>
<aside><section id="detail"><div class="lbl">Detail</div><h2 class="none">Select a block.</h2></section>
<section><div class="lbl">Merged PRs</div><ul class="nc-list" id="prs"></ul></section>
<section><div class="lbl"><span class="dot"></span>No commit</div><ul class="nc-list" id="nc"></ul></section>
<section><div class="lbl">Excluded from totals</div><ul class="nc-list" id="ex"></ul></section></aside></main>
<footer id="foot"></footer></div>
<script>${clientScript(payload)}</script></body></html>`
}

function clientScript(payload) {
  return String.raw`
const D=${payload};
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtT=t=>new Date(t).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false});
const fmtD=t=>new Date(t).toLocaleDateString([],{weekday:'short',day:'numeric',month:'short'});
const fmtH=h=>h>=1?h.toFixed(1)+' h':Math.round(h*60)+' min';
const groupOf=b=>D.prefs.colorBy==='project'?b.project:b.taskType;
const short=s=>{const w=String(s||'').split(/\s+/).slice(0,5).join(' ');return w.length<String(s||'').length?w+'…':w};
const titleOf=b=>b.title||short(b.sessionFirstMessage)||'Untitled';

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
function totals(){const bs=D.blocks.filter(b=>!isEx(b.sessionId));const by={};for(const b of bs)(by[b.project]=by[b.project]||[]).push([b.start,b.end]);
 return{all:union(bs.map(b=>[b.start,b.end])),list:Object.entries(by).map(([project,iv])=>({project,hours:union(iv)})).sort((a,b)=>b.hours-a.hours),
  n:new Set(bs.map(b=>b.sessionId)).size}}
function renderTotals(){const T=totals();
$('#tot').innerHTML=T.all.toFixed(1)+'<small>h</small>';
const nx=D.sessions.length-T.n;
$('#meta').textContent='Session time · '+T.n+' sessions'+(nx?' · '+nx+' excluded':'')+' · '+D.timeZone;

// project totals: one proportional rule, then the figures
const lead=T.list.slice(0,7),rest=T.list.slice(7);
const restH=rest.reduce((n,t)=>n+t.hours,0),sumH=T.list.reduce((n,t)=>n+t.hours,0)||1;
const swOf=p=>D.prefs.colorBy==='project'?(D.colorOf[p]?.chip||'var(--mute)'):'var(--mute)';
$("#bar").innerHTML=lead.map(t=>'<i style="width:'+(t.hours/sumH*100)+'%;background:'+swOf(t.project)+'"></i>').join('')+(restH?'<i style="width:'+(restH/sumH*100)+'%;background:var(--rule)"></i>':'');
$("#projects").innerHTML=lead.map(t=>'<div><span><i class="sw" style="background:'+swOf(t.project)+'"></i>'+esc(t.project)+'</span><b>'+fmtH(t.hours)+'</b></div>').join('')+
 (rest.length?'<div><span><i class="sw" style="background:var(--rule)"></i>'+rest.length+' others</span><b>'+fmtH(restH)+'</b></div>':'')+
 (D.prefs.colorBy==='task'?'<div style="grid-column:1/-1;flex-direction:row;flex-wrap:wrap;gap:16px">'+Object.entries(D.colorOf).map(([g,c])=>'<span><i class="sw" style="background:'+c.chip+'"></i>'+esc(g)+'</span>').join('')+'</div>':'');
renderLists()}

// calendar
const H=44;let h0=24,h1=0;
const days=[...Array(7)].map((_,i)=>{const d=new Date(D.week.startMs);d.setDate(d.getDate()+i);return d});
const pieces=[];
for(const b of D.blocks){let s=b.start;while(s<b.end){const d=new Date(s);const mid=new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime();
 const e=Math.min(b.end,new Date(d.getFullYear(),d.getMonth(),d.getDate()+1).getTime());
 const di=days.findIndex(x=>x.toDateString()===d.toDateString());
 if(di>=0){const sh=(s-mid)/36e5,eh=sh+(e-s)/36e5;h0=Math.min(h0,Math.floor(sh));h1=Math.max(h1,Math.ceil(eh));pieces.push({b,di,sh,eh})}s=e}}
if(h0>h1){h0=8;h1=18}
const grid=$('#grid'),todayKey=new Date().toDateString(),height=(h1-h0)*H;
grid.innerHTML='<div></div>'+days.map(d=>'<div class="dh'+(d.toDateString()===todayKey?' today':'')+'">'+d.toLocaleDateString([],{weekday:'short'})+'<b>'+d.getDate()+'</b></div>').join('');
const hours=document.createElement('div');hours.className='hours';hours.style.height=height+'px';
for(let h=h0;h<=h1;h+=2)hours.insertAdjacentHTML('beforeend','<div class="hl" style="top:'+((h-h0)*H)+'px">'+String(h).padStart(2,'0')+'</div>');
grid.appendChild(hours);
days.forEach((d,di)=>{const col=document.createElement('div');col.className='day';col.style.height=height+'px';
 for(let h=h0;h<=h1;h++)col.insertAdjacentHTML('beforeend','<div class="rule" style="top:'+((h-h0)*H)+'px"></div>');
 if(d.toDateString()===todayKey){const n=new Date(),nh=n.getHours()+n.getMinutes()/60;if(nh>=h0&&nh<=h1)col.insertAdjacentHTML('beforeend','<div class="now" style="top:'+((nh-h0)*H)+'px"></div>')}
 const ps=pieces.filter(p=>p.di===di).sort((a,b)=>a.sh-b.sh);const lanes=[],clusters=[];let cl=null,end=-1;
 for(const p of ps){if(p.sh>=end){cl=[];clusters.push(cl)}cl.push(p);end=Math.max(end,p.eh);let li=lanes.findIndex(e=>e<=p.sh);if(li<0){li=lanes.length;lanes.push(0)}lanes[li]=p.eh;p.lane=li}
 for(const c of clusters){const n=Math.max(...c.map(p=>p.lane))+1;for(const p of c){
  const k=D.colorOf[groupOf(p.b)]||{fill:'var(--rule)',ink:'var(--ink)'};const ht=Math.max(6,(p.eh-p.sh)*H-2);
  const el=document.createElement('button');el.className='blk'+(p.b.noCommit?' nc':'')+(isEx(p.b.sessionId)?' ex':'');el.dataset.id=p.b.id;
  el.style.cssText='top:'+((p.sh-h0)*H+1)+'px;height:'+ht+'px;left:calc('+(p.lane/n*100)+'% + 2px);width:calc('+(100/n)+'% - 4px);background:'+k.fill+';color:var(--ink)'+(ht<22?';padding:0':'');el.style.setProperty('--edge',k.chip||'var(--mute)');
  if(ht>=22)el.innerHTML='<span class="t">'+esc(titleOf(p.b))+'</span>'+(ht>=40?'<span class="m">'+fmtT(p.b.start)+' · '+esc(p.b.project)+'</span>':'');
  el.title=titleOf(p.b)+' — '+p.b.project+', '+fmtT(p.b.start)+'–'+fmtT(p.b.end);el.onclick=()=>show(p.b.id);col.appendChild(el)}}
 grid.appendChild(col)});

// detail
let shown=null;
function show(id){const b=D.blocks.find(x=>x.id===id);if(!b)return;shown=id;const ex=isEx(b.sessionId),sess=D.sessions.find(s=>s.sessionId===b.sessionId);
 document.querySelectorAll('.blk').forEach(e=>e.classList.toggle('sel',e.dataset.id===id));
 const commits=!b.isGitRepo?'<p class="none">Not a git repository.</p>':b.commits.length?b.commits.map(c=>'<div class="cm"><code>'+c.short+'</code><span>'+esc(c.subject)+(c.pushed===false?' <span class="none">· local only</span>':'')+'</span></div>').join(''):'<p class="none">None.</p>';
 const files=b.files.length?'<ul class="files">'+b.files.map(f=>'<li>'+esc(f)+'</li>').join('')+'</ul>':'<p class="none">None.</p>';
 $('#detail').innerHTML='<div class="lbl">'+(ex?'Excluded · ':b.noCommit?'<span class="dot"></span>No commit · ':'')+esc(b.taskType)+'</div><h2>'+esc(titleOf(b))+'</h2><dl>'+
 '<dt>Project</dt><dd>'+esc(b.project)+'</dd><dt>Start</dt><dd>'+fmtD(b.start)+', '+fmtT(b.start)+'</dd><dt>End</dt><dd>'+fmtD(b.end)+', '+fmtT(b.end)+'</dd>'+
 '<dt>Model</dt><dd>'+esc(b.models.join(', ')||'—')+'</dd><dt>Pushed</dt><dd>'+(b.productive?'Yes, productive':'No')+'</dd><dt>Folder</dt><dd class="none">'+esc(b.cwd)+'</dd></dl>'+
 '<div class="sec"><span class="lbl">First message</span><div class="quote">'+esc(b.firstMessage||'—')+'</div></div>'+
 '<div class="sec"><span class="lbl">Commits '+b.commits.length+'</span>'+commits+'</div>'+
 '<div class="sec"><span class="lbl">Files '+b.files.length+'</span>'+files+'</div>'+
 '<div class="sec"><span class="lbl">Totals</span>'+(ex?esc(b.sessionId in ov?'Excluded in this browser':sess?.excludeReason||'Excluded'):'Counted · '+(sess?.humanTurns??0)+' typed, '+(sess?.autoTurns??0)+' automated turns')+
 '<br><button class="btn" id="tog">'+(ex?'Count in totals':'Exclude from totals')+'</button>'+
 (b.sessionId in ov?'<p class="note">Saved in this browser only. To apply it to reports, ask Claude to '+(ex?'exclude':'include')+' “'+esc(titleOf(b))+'” in the week calendar.</p>':'')+'</div>';
 $('#tog').onclick=()=>{const want=!ex;if(want===!!sess?.excluded)delete ov[b.sessionId];else ov[b.sessionId]=want;saveOv();
  document.querySelectorAll('.blk').forEach(e=>{const bb=D.blocks.find(x=>x.id===e.dataset.id);e.classList.toggle('ex',isEx(bb.sessionId))});renderTotals();show(id)}}
function renderLists(){
const ncs=D.sessions.filter(s=>s.noCommit&&!isEx(s.sessionId)).sort((a,b)=>b.end-a.end);
$('#nc').innerHTML=ncs.length?ncs.map(s=>{const b=D.blocks.filter(x=>x.sessionId===s.sessionId).pop();
 return '<li data-id="'+esc(b.id)+'"><span class="n">'+esc(s.title||short(s.firstMessage)||'Untitled')+'</span><span class="s">'+esc(s.project)+' · '+fmtD(s.end)+', '+fmtT(s.end)+' · '+s.minutes+' min</span></li>'}).join(''):'<li class="none">None this week.</li>';
const exs=D.sessions.filter(s=>isEx(s.sessionId)).sort((a,b)=>b.minutes-a.minutes);
$('#ex').innerHTML=exs.length?exs.map(s=>{const b=D.blocks.filter(x=>x.sessionId===s.sessionId).pop();
 return '<li data-id="'+esc(b.id)+'"><span class="n">'+esc(s.title||short(s.firstMessage)||'Untitled')+'</span><span class="s">'+esc(s.project)+' · '+fmtH(s.minutes/60)+' · '+esc(s.sessionId in ov?'this browser':s.excludeReason?.split(':')[0]||'')+'</span></li>'}).join(''):'<li class="none">None.</li>';
document.querySelectorAll('#nc li[data-id],#ex li[data-id]').forEach(li=>li.onclick=()=>{show(li.dataset.id);document.querySelector('.blk[data-id="'+CSS.escape(li.dataset.id)+'"]')?.scrollIntoView({block:'center',behavior:'smooth'})})}
// machine figures (from the build; the browser toggles above do not change them)
const M=D.machineHours||{},K=D.metrics||{};const pct=v=>v==null?'—':Math.round(v*100)+'%';
$('#kpi').innerHTML=D.machineHours?[
 ['k1','PRs merged',String(K.prsMerged??0)],['k1','Productive time',pct(M.productiveUtilization)],
 ['','Agent busy · '+pct(M.utilization),fmtH(M.busy||0)],['','Waiting on a person',fmtH(M.waitingOnPerson||0)],
 ['','Idle machine',fmtH(M.idle||0)],['','Automated',fmtH(M.automated||0)]
].map(([c,l,v])=>'<div class="'+c+'"><span>'+l+'</span><b>'+v+'</b></div>').join(''):'';
const prs=D.prsMerged||[];
$('#prs').innerHTML=prs.length?prs.map(p=>'<li><a class="n" href="'+esc(p.url)+'" style="color:inherit;text-decoration:none">'+esc(p.title)+'</a><span class="s">'+esc(p.repo)+' #'+p.number+' · '+fmtD(Date.parse(p.mergedAt))+(p.agentHours?' · '+fmtH(p.agentHours)+' agent':'')+'</span></li>').join(''):'<li class="none">None this week.</li>';
renderTotals();
$('#foot').textContent='Generated '+new Date(D.generatedAt).toLocaleString([],{hour12:false})+' · '+esc(D.machine||'')+' · Parallel sessions counted once';
`
}
