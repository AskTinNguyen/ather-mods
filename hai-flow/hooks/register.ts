import type { EngineInterface as Engine, Register, RenderElement } from 'claude-code'
import { A5, freshTurn, gitTargets, newLines, norm, under, type A5Config, type Decision, type Located, type Places, type Proof, type Turn } from './a5.ts'
import { bareTitle, hasMark, isDirectorCallLine, isFindingsFile, isPending, markedTitle, pendingLine, readMarker, type Marker } from './decision.ts'
import { FREE_RAM_PROBE, PIE_MIN_FREE_GB, isEditorStartStop, lockProblem, mcpKind, parseEditorLock } from './editor.ts'
import { icon, sealSvg, type Motion } from './icons.ts'
import { A5_LOOK, STATUS, noHits, recolor, replaceKeyed, rulesFooter, withSeal, type RuleHits } from './theme.ts'
import { SYNC_PROMPT, VITALS_PROBE, editorTile, lockLine, mainTile, memoryTile, parseLockView, parseVitals, ramBand, tilesRow, toMin, type LockView, type Sync, type Vitals } from './watch.ts'

// Hai's S2 flow beside Ather Automata, which it never changes:
// - A5 (a5.ts, a5/config.json), only while `/a5 on`: refuses or asks before risky tool calls, records
//   edits and checks, and at Stop keeps the agent going until its report is honest. Fitted to Ather's
//   intent flow: rules about the shared checkout skip a worker's own worktree; a worker (subagent) never
//   asks Hai, it reports; with an intent tracked, `Verified:` is held to Ather's proof for it.
// - The shared Editor (editor.ts), always: PIE, saves and Unreal MCP writes need this session to hold
//   the lock; PIE needs 5 GB free RAM; save-all is refused.
// - 🟥 / ⏯️ (decision.ts), always: the title is marked and unread set. A 🟥 that relays an intent's director
//   call (a worker added it to findings.md, intent skill) is in Ather's Needs you already; any other 🟥 gets
//   one PENDING.md line, so no decision is lost.
// - Ather's pane (theme.ts, watch.ts, icons.ts): its home view gains Editor · Memory · Branch tiles with
//   pixel icons; with A5 on, the accent turns gold, a red seal joins the brand, the five rules sit at the foot.
//   Icons move only when a state turns over (a dither reveal) or a sync runs (a dither sweep).
// Every refusal reads the same: "hai-flow · <gate> — <why> → <what next>".
// Module variables are this session's (one process per session); a reload starts them over.

type Opts = { a5WhenPresent: string; editorLock: string; pendingFile: string; motion: string }
type Input = Record<string, unknown>

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])
const ALLOW_ONCE = 'Cho chạy lần này'
const ALLOW_SESSION = 'Cho cả session này'
const ATHER_PANE = 'ather'
const EDITOR_PERIOD_MS = 60_000
const SYNC_STALE_MS = 3 * 60_000
const MOTION_MS = 2_500 // a state change animates in renders within this window
const RULE_NAMES: Record<string, string> = { D1: 'Yêu Tổ quốc', D2: 'Học tập tốt', D3: 'Kỷ luật tốt', D4: 'Vệ sinh', D5: 'Thật thà' }
const INK = '#ECE9E2'

let engine: A5 | null = null
let rulesA5 = ''
let rulesFlow = ''
let places: Places = {}
let turn: Turn = freshTurn()
let mcpWrote = false // an Unreal MCP write this turn: a read-back after it is proof
const where = new Map<string, Located>()
const approved = new Set<string>()
const rootOf = new Map<string, string | null>()
const isLinked = new Map<string, boolean>() // git root -> a linked worktree (one session's own), not the shared checkout
let wroteDirectorCall = false // this turn added an open director call to an intent's findings.md
let markedFrom: string | null = null // the title before this session marked it, put back when Hai answers
let a5On = false
let a5FlipAt = 0
let hits: RuleHits = noHits()
let isS2 = false
let lockView: LockView | undefined
let vitals: Vitals | undefined
let nowMin = 0
let lastLockKey = ''
let lowBand = 'ok'
let sync: Sync | undefined
let syncAt = 0
let isReadingGit = false
let isSyncRunning = false
let isStatusShown = false
const seen = new Map<string, { sig: string; color: string; at: number; from: string }>() // each tile's state, and when it last turned over
let chain: string[] | null = null // the plugins beneath this one on a tool call: Ather there means the pane can be wrapped

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const parentOf = (p: string): string => {
  const i = p.lastIndexOf('/')
  return i < 0 ? '' : p.slice(0, i)
}
const s2Root = (opts: Opts): string => parentOf(parentOf(norm(opts.editorLock)))
const hhmm = (d: Date): string => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
const stampOf = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${hhmm(d)}`
const count = (rule: string) => {
  for (const id of rule.match(/D[1-5]/g) ?? []) hits[id as keyof RuleHits] += 1
}
const gateOf = (rule: string): string => `A5 ${rule} ${rule.split('/').map(r => RULE_NAMES[r]).filter(Boolean).join(' / ')}`
/** The one shape of every refusal: which gate, why, and what to do instead. */
const blocked = (gate: string, why: string, next: string): string => `hai-flow · ${gate} — ${why} → ${next}`

async function load($: Engine): Promise<A5> {
  if (engine) return engine
  const root = $.plugin.root.replace(/\\/g, '/')
  const cfg = JSON.parse(await $.fs.read(`${root}/a5/config.json`)) as A5Config
  const local = await $.env.get('LOCALAPPDATA')
  places = {
    KIT: root,
    HOME: await $.env.get('USERPROFILE'),
    USERPROFILE: await $.env.get('USERPROFILE'),
    TEMP: await $.env.get('TEMP'),
    TMP: await $.env.get('TMP'),
    LOCALAPPDATA: local,
    HERMES_HOME: (await $.env.get('HERMES_HOME')) ?? (local ? `${local}/hermes` : undefined),
    PROJECT: await $.session.root(),
  }
  rulesA5 = await $.fs.read(`${root}/a5/rules-a5.md`).catch(() => '')
  rulesFlow = await $.fs.read(`${root}/a5/rules-flow.md`).catch(() => '')
  engine = new A5(cfg, places)
  return engine
}

/** Whether A5 is on: Hai's switch, kept across sessions in this plugin's store. Notes when it just came on. */
async function readA5($: Engine): Promise<boolean> {
  const v = (await $.store.get('a5').catch(() => null)) as { on?: boolean } | null
  const on = v?.on === true
  if (on && !a5On) a5FlipAt = await $.clock.now()
  a5On = on
  return a5On
}

/** The git project a file lives in (walks up to a `.git`), cached per folder. */
async function locate($: Engine, a5: A5, path: string): Promise<Located> {
  const p = norm(path, await $.session.cwd())
  const known = a5.roots.find(r => under(p, r))
  if (known) return { root: known, rel: p.slice(known.length + 1) }
  const walked: string[] = []
  let root: string | null = null
  for (let d = parentOf(p); d; d = parentOf(d)) {
    const k = d.toLowerCase()
    if (rootOf.has(k)) {
      root = rootOf.get(k) ?? null
      break
    }
    walked.push(k)
    if (await $.fs.exists(`${d}/.git`)) {
      root = d
      break
    }
  }
  for (const k of walked) rootOf.set(k, root)
  return root ? { root, rel: p.slice(root.length + 1) } : { root: null, rel: null }
}

/** Whether a git root is a shared checkout (a main working tree: `.git` is a folder) and not a linked
 * worktree that one session or worker owns (`.git` is a file naming its gitdir). Unknown counts as shared. */
async function isSharedRoot($: Engine, root: string | null): Promise<boolean> {
  if (!root) return true
  const k = root.toLowerCase()
  if (!isLinked.has(k)) isLinked.set(k, !(await $.fs.exists(`${root}/.git/HEAD`)) && (await $.fs.exists(`${root}/.git`)))
  return isLinked.get(k) !== true
}

/** For a shell command: is each folder its git segments run in (the working directory, each `-C`) shared? */
async function sharedTest($: Engine, a5: A5, command: string, cwd: string): Promise<(dir: string) => boolean> {
  const known = new Map<string, boolean>()
  for (const dir of [cwd, ...gitTargets(command)]) {
    const p = norm(dir, cwd)
    known.set(p.toLowerCase(), await isSharedRoot($, (await locate($, a5, `${p}/_`)).root))
  }
  return dir => known.get(norm(dir || cwd, cwd).toLowerCase()) ?? true
}

type AtherStatus = { role?: string; tracked?: { slug?: string; directorCalls?: string[] } | null; evidence?: Proof['evidence'] }

/** Ather's live state (its read-only `status` tool), or null without Ather. */
async function atherStatus($: Engine): Promise<AtherStatus | null> {
  try {
    return JSON.parse(await callTool($, { tool: 'mcp__ather-automata__status' })) as AtherStatus
  } catch {
    return null
  }
}

/** Ather's proof for the intent this session tracks, or null with no intent tracked. */
const proofOf = (s: AtherStatus | null): Proof | null =>
  s?.tracked?.slug ? { intent: s.tracked.slug, role: s.role ?? '', evidence: s.evidence ?? {} } : null

/** Whether an answer relays one of the tracked intent's open director calls by its id (Ather lists it under Needs you). */
const namesDirectorCall = (s: AtherStatus | null, answer: string): boolean =>
  (s?.tracked?.directorCalls ?? []).some(call => {
    const id = (call.split(':')[0] ?? '').trim()
    return id !== '' && new RegExp(`(^|[^\\w-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(answer)
  })

async function scopeGlobs($: Engine): Promise<string[]> {
  const text: string = await $.fs.read(`${$.plugin.root}/a5/scope`).catch(() => '')
  return text.split(/\r?\n/).map(x => x.trim()).filter(x => x && !x.startsWith('#'))
}

/** [path, old text, new text] per write; Write's old text is the file now. */
async function editParts($: Engine, tool: string, e: Input): Promise<[string, string, string][]> {
  const path = str(e.file_path) || str(e.notebook_path)
  if (tool === 'Write') return [[path, await $.fs.read(path).catch(() => ''), str(e.content)]]
  if (tool === 'MultiEdit') return ((e.edits as Input[] | undefined) ?? []).map(x => [path, str(x.old_string), str(x.new_string)])
  if (tool === 'NotebookEdit') return [[path, '', str(e.new_source)]]
  return [[path, str(e.old_string), str(e.new_string)]]
}

const isUnrealMcp = (tool: string): boolean => tool.startsWith('mcp__') && /unreal/i.test(tool)

/** The Editor gate: null when the call may touch the Editor, else why not and what to do. */
async function editorProblem($: Engine, opts: Opts, tool: string, e: Input): Promise<string | null> {
  const kind = isUnrealMcp(tool) ? mcpKind(JSON.stringify(e).slice(0, 4000)) : SHELL_TOOLS.has(tool) && isEditorStartStop(str(e.command)) ? 'startstop' : null
  if (!kind || kind === 'read') return null
  if (kind === 'save-all') return 'save-all saves every dirty package, other lanes\' included → list the dirty packages and save each one by exact path'
  const raw = await $.fs.read(opts.editorLock).catch(() => null)
  if (raw === null && !(await $.fs.exists(s2Root(opts)))) return null // no S2 checkout on this machine
  const now = new Date()
  const why = lockProblem(parseEditorLock(raw, now.getHours() * 60 + now.getMinutes()), (await $.session.id()).slice(0, 8).toLowerCase())
  if (why) return why.replace(/\s+(Take the lock first:|If this session|Never drive)/, ' → $1')
  if (kind === 'pie') {
    const probe = await $.process.run(FREE_RAM_PROBE, { timeoutMs: 20_000 }).catch(() => null)
    const gb = Number(probe?.stdout.trim())
    if (Number.isFinite(gb) && gb > 0 && gb < PIE_MIN_FREE_GB)
      return `free RAM is ${gb} GB, under the ${PIE_MIN_FREE_GB} GB PIE start gate (fixed, never lowered) → free memory or wait, then start PIE`
  }
  return null
}

/** An A5 'ask': Hai answers in a dialog. Resolves 'allow' or the refusal the model reads. */
async function askHai($: Engine, opts: Opts, d: Decision, what: string): Promise<string> {
  const gate = gateOf(d.rule)
  if (opts.a5WhenPresent === 'deny') return blocked(gate, d.why, 'needs Hai\'s approval: ask Hai to run it')
  try {
    const answer = await $.ui.ask(`${gate}: ${d.why} Cho chạy \`${what.slice(0, 160)}\`?`, {
      options: [ALLOW_ONCE, ALLOW_SESSION, 'Không'],
      header: `A5 ${d.rule}`,
    })
    if (answer === ALLOW_ONCE) return 'allow'
    if (answer === ALLOW_SESSION) {
      approved.add(d.key)
      return 'allow'
    }
    return blocked(gate, d.why, `Hai said no${answer && answer !== 'Không' ? ` ("${answer}")` : ''}: do not retry it; ask Hai or do other work`)
  } catch {
    return blocked(gate, d.why, 'nobody could approve it now (an Ather away window, a closed dialog, or no one to ask): do not retry it; do other work, and if an away window is open set that ledger entry\'s Choice to "parked for the director"')
  }
}

/** A tool call made by the mod itself (the desktop app's session tools); '' when refused or missing. */
async function callTool($: Engine, input: Input): Promise<string> {
  const ran = await $.tool.call(input as never)
  return ran.deny === undefined ? (ran.text ?? '') : ''
}

async function sessionTitle($: Engine): Promise<string> {
  try {
    return str((JSON.parse(await callTool($, { tool: 'mcp__ccd_session_mgmt__get_session', session_id: 'self' })) as Input).title)
  } catch {
    return ''
  }
}

async function retitle($: Engine, text: string): Promise<string> {
  return callTool($, { tool: 'mcp__ccd_session_mgmt__set_session_title', session_id: 'self', title: text })
}

async function applyMarker($: Engine, opts: Opts, m: NonNullable<Marker>, isInFindings: boolean): Promise<void> {
  const now = await sessionTitle($).catch(() => '')
  if (m.kind === 'decision') {
    // An intent's director call (its worker added it to findings.md) is in Ather's Needs you already;
    // anything else gets one PENDING.md line, the only list outside Ather.
    if (!isInFindings) {
      const label = bareTitle(now) || (await $.session.id()).slice(0, 8)
      const file = opts.pendingFile || `${(places.USERPROFILE ?? '').replace(/\\/g, '/')}/.claude/PENDING.md`
      const pending = await $.fs.read(file).catch(() => '')
      if (!isPending(pending, m.question)) await $.fs.write(file, `${pending.replace(/\s*$/, '')}\n${pendingLine(stampOf(new Date()), label, m.question, m.fallback)}\n`)
    }
    if (a5On) $.ui.toast(`🟥 Waiting on Hai${isInFindings ? ' (Ather: Needs you)' : ''}: ${m.question.slice(0, 80)}`, { timeoutMs: 12_000 })
    await callTool($, { tool: 'mcp__ccd_sidebar__set_unread', session_id: 'self', unread: true }).catch(() => '')
  }
  const sign = m.kind === 'decision' ? '🟥' : '⏯️'
  if (now && !now.startsWith(sign)) {
    markedFrom ??= bareTitle(now)
    await retitle($, markedTitle(now, sign)).catch(() => '')
  }
}

async function lastAssistantText($: Engine): Promise<string> {
  const rows = await $.session.messages()
  if (!Array.isArray(rows)) return ''
  return [...rows].reverse().find(r => r.role === 'assistant')?.text ?? ''
}

/** The line under the prompt says only what the pane would not tell at a glance: ★ A5 while it is on, and
 * an Editor lease run over or RAM under the PIE gate. The normal state is silence (the pane has it). */
function showStatus($: Engine): void {
  // A5 off: the status line is Ather's alone (D1); a line this mod set earlier is taken down once.
  if (!a5On) {
    if (isStatusShown) $.ui.status(undefined)
    isStatusShown = false
    return
  }
  const end = toMin(lockView?.until)
  const isOver = Boolean(lockView && !lockView.isFree && !lockView.isMissing && end !== undefined && end < nowMin)
  const parts = [
    a5On ? '★ A5' : '',
    isS2 && isOver ? `Editor: ${lockView?.who ?? 'held'} over its lease` : '',
    isS2 && vitals && ramBand(vitals.freeGb) !== 'ok' ? `RAM ${vitals.freeGb} GB free` : '',
  ].filter(Boolean)
  $.ui.status(parts.length ? parts.join(' · ') : undefined)
  isStatusShown = parts.length > 0
}

/** The lock and the machine, every minute in an S2 session; a toast when the Editor comes free or RAM falls. */
async function refreshEditor($: Engine, opts: Opts): Promise<void> {
  // A5 off: nothing is probed, drawn or toasted (D1).
  if (!(await readA5($))) {
    showStatus($)
    return
  }
  const [raw, probe, now] = await Promise.all([
    $.fs.read(opts.editorLock).catch(() => null),
    $.process.run(VITALS_PROBE, { timeoutMs: 15_000 }).catch(() => null),
    $.clock.now(),
  ])
  const d = new Date(now)
  nowMin = d.getHours() * 60 + d.getMinutes()
  lockView = parseLockView(raw)
  const key = lockView.isMissing ? 'missing' : lockView.isFree ? `free ${lockView.freeSince ?? ''}` : `${lockView.who ?? ''} ${lockView.until ?? ''}`
  // One toast when the Editor comes free (someone waiting can take it); hand-overs between lanes stay quiet.
  if (lastLockKey !== '' && key !== lastLockKey && lockView.isFree) $.ui.toast(lockLine(lockView))
  lastLockKey = key
  vitals = probe ? parseVitals(probe.stdout) : undefined
  if (vitals) {
    const band = ramBand(vitals.freeGb)
    if (band !== lowBand && band !== 'ok')
      $.ui.toast(band === 'below-abort' ? `Free RAM ${vitals.freeGb} GB: under 3 GB, abort PIE` : `Free RAM ${vitals.freeGb} GB: under 5 GB, do not start PIE`)
    lowBand = band
  }
  showStatus($)
  $.ui.invalidate('ui.render')
}

/** The branch against origin/main, read cheaply (no status, no fetch), one git call at a time. */
async function refreshSync($: Engine, opts: Opts): Promise<void> {
  if (isReadingGit) return
  isReadingGit = true
  try {
    const repo = s2Root(opts)
    const git = async (args: string[]): Promise<string> => {
      const r = await $.process.run(['git', '-C', repo, ...args], { timeoutMs: 30_000 }).catch(() => null)
      return r && r.exitCode === 0 ? r.stdout.trim() : ''
    }
    const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'])
    const counts = (await git(['rev-list', '--left-right', '--count', 'HEAD...origin/main'])).split(/\s+/).map(Number)
    const mainHead = await git(['log', '-1', '--format=%h · %cr', 'origin/main'])
    const lastMerge = await git(['log', '-1', '--merges', '--first-parent', '--grep=main', '--format=%h · %cr', 'HEAD'])
    const now = await $.clock.now()
    const fetched = await $.fs.stat(`${repo}/.git/FETCH_HEAD`).catch(() => null)
    const flags: string[] = []
    if (await $.fs.exists(`${repo}/.git/MERGE_HEAD`)) flags.push('a merge is in progress (MERGE_HEAD)')
    const lock = await $.fs.stat(`${repo}/.git/index.lock`).catch(() => null)
    if (lock) flags.push(`.git/index.lock for ${Math.round((now - lock.mtimeMs) / 60_000)} min`)
    sync = {
      branch,
      ahead: counts.length === 2 && Number.isFinite(counts[0]) ? (counts[0] ?? null) : null,
      behind: counts.length === 2 && Number.isFinite(counts[1]) ? (counts[1] ?? null) : null,
      mainHead,
      fetchedMinAgo: fetched ? Math.max(0, Math.round((now - fetched.mtimeMs) / 60_000)) : null,
      lastMerge,
      flags,
      checkedAt: hhmm(new Date(now)),
    }
    syncAt = now
  } finally {
    isReadingGit = false
  }
  $.ui.invalidate('ui.render')
}

const keyOf = (node: unknown): string => {
  const props = (node as { props?: { key?: unknown } } | null)?.props
  return typeof props?.key === 'string' ? props.key : ''
}

/** How a tile's icon moves this render: a dither reveal right after its state (`sig`) turned over, from its
 * last color (or from the border grey when the color stayed), a sweep while `running`, still otherwise
 * (or always, with motion off). */
function motionFor(key: string, sig: string, color: string, now: number, running: boolean, opts: Opts): Motion {
  const last = seen.get(key)
  if (!last) seen.set(key, { sig, color, at: 0, from: color })
  else if (last.sig !== sig) seen.set(key, { sig, color, at: now, from: last.color !== color ? last.color : '#3a3c36' })
  if (opts.motion === 'off') return { kind: 'still' }
  if (running) return { kind: 'sweep' }
  const s = seen.get(key)
  return s && s.at > 0 && now - s.at < MOTION_MS ? { kind: 'reveal', from: s.from, ms: 700 } : { kind: 'still' }
}

/** Ather's pane as Ather drew it. Its home view gains one row of tiles (Editor, Memory, Branch) right under
 * Ather's own summary strip; with A5 on, the accent turns gold, a red seal joins the brand and the five
 * rules sit at the foot. Nothing else of Ather's is moved or hidden. */
async function drawPane($: Engine, opts: Opts, e: { surface: string; props: { bodyColumns?: number } }, tree: RenderElement): Promise<RenderElement> {
  const on = await readA5($)
  if (!on) return tree // A5 off: Ather's pane exactly as Ather drew it (D1)
  const el = $.ui.resolve(e as never) as never as Parameters<typeof icon>[0] & Parameters<typeof tilesRow>[0]
  const isDesktop = e.surface === 'desktop'
  const now = await $.clock.now()
  const root = tree as unknown as { children?: unknown[] }
  if (!Array.isArray(root.children)) return on ? recolor(tree) : tree
  let kids = [...root.children]
  const stripAt = kids.findIndex(k => keyOf(k) === 'strip')
  if (isS2 && stripAt >= 0) {
    if (now - syncAt > SYNC_STALE_MS) $.clock.after(10, () => void refreshSync($, opts))
    const onSync = () => {
      $.ui.toast('Sync main: preflight and report sent to the session')
      void $.prompt.submit({ text: SYNC_PROMPT }).then(() => {
        isSyncRunning = true
        $.ui.invalidate('ui.render')
      })
    }
    const onRefresh = () => {
      syncAt = 0
      void refreshSync($, opts)
      void refreshEditor($, opts)
    }
    const me8 = (await $.session.id()).slice(0, 8).toLowerCase()
    const tiles = [editorTile({ lock: lockView, vitals, me8, nowMin }), memoryTile(el, vitals), mainTile(el, sync, onSync, onRefresh, isDesktop, isSyncRunning)]
    const names = { editor: 'editor', memory: 'memory', main: 'branch' } as const
    for (const t of tiles) {
      const name = names[t.key as keyof typeof names]
      const color = t.dot ?? (t.key === 'memory' ? STATUS.ok : INK)
      t.icon = icon(el, name, color, motionFor(t.key, `${t.value}|${color}`, color, now, t.key === 'main' && isSyncRunning, opts), isDesktop)
    }
    kids.splice(stripAt + 1, 0, tilesRow(el, tiles, isDesktop))
  }
  if (on) {
    // The pixel seal only while it stamps in on the desktop; the crisp text seal the rest of the time.
    const stamp = opts.motion !== 'off' && now - a5FlipAt < MOTION_MS
    const sealEl = stamp && isDesktop && el.Svg ? el.Svg({ source: sealSvg(A5_LOOK.sealBg, A5_LOOK.sealText, true), alt: 'A5 on', width: 27, height: 14, isInteractive: true }) : undefined
    kids = kids.map(k => replaceKeyed(k, 'head-words', words => withSeal(el, words, sealEl)))
    const footAt = kids.findIndex(k => keyOf(k) === 'foot')
    kids.splice(footAt < 0 ? kids.length : footAt, 0, rulesFooter(el, hits))
  }
  const out = { ...(tree as object), children: kids } as unknown as RenderElement
  return on ? recolor(out) : out
}

export const register: Register = (on, options) => {
  const opts = options as unknown as Opts

  on('session.start', async ($, e, next) => {
    const res = await next(e)
    await $.command.register({ name: 'a5', description: 'A5: /a5 on · /a5 off · /a5 status (on: the five rules, the report gate, the red seal and gold accent)' })
    await readA5($)
    a5FlipAt = 0 // a session that starts with A5 already on does not stamp the seal
    isS2 = await $.fs.exists(`${(await $.session.root()).replace(/\\/g, '/')}/S2.uproject`)
    if (isS2) {
      await refreshEditor($, opts)
      $.clock.every(EDITOR_PERIOD_MS, () => void refreshEditor($, opts))
    } else showStatus($)
    return res
  })

  on('command.run', { command: 'a5' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'on' || arg === 'off') {
      await $.store.set('a5', { on: arg === 'on' })
      if (arg === 'on' && !a5On) a5FlipAt = await $.clock.now()
      a5On = arg === 'on'
      if (a5On) hits = noHits()
      showStatus($)
      $.ui.invalidate('ui.render')
      return {
        text: a5On
          ? '★ A5 on: the five rules and the report gate apply in every session from its next tool call; Ather\'s pane takes the red seal and the gold accent.'
          : 'A5 off: the rules, the report gate, the Editor holder, RAM and Sync main gates stop; Ather\'s pane, status line and toasts are Ather\'s own again. The 🟥/⏯️ title marks stay.',
      }
    }
    await readA5($)
    const where2 = chain === null ? 'not seen yet (no tool call so far)' : chain.includes('ather-automata') ? 'above ather-automata: its pane gets the tiles' : `beneath ather-automata (${chain.join(' → ') || 'nothing'} below): the pane cannot be wrapped from here; put hai-flow first in CLAUDE_CODE_PLUGIN_DIRS`
    return { text: `A5 is ${a5On ? 'ON' : 'off'}. Hits this session: ${Object.entries(hits).map(([k, v]) => `${k} ${v}`).join(' · ')}. hai-flow sits ${where2}.` }
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const input = e as unknown as Input
    const a5 = await load($)
    const isOn = await readA5($)

    // The Editor gate is A5's (D1): with A5 off nothing of hai-flow's refuses an Editor call.
    const editor = isOn ? await editorProblem($, opts, tool, input) : null
    if (editor) return { deny: blocked('Editor lock', editor.split(' → ')[0] ?? editor, editor.split(' → ').slice(1).join(' → ') || 'wait for the Editor') }

    let d: Decision | null = null
    let what = ''
    let parts: [string, string, string][] = []
    const locs: Located[] = []
    if (SHELL_TOOLS.has(tool)) {
      what = str(input.command)
      if (isOn) {
        const cwd = await $.session.cwd()
        d = a5.preShell(what, cwd, places, 0, await sharedTest($, a5, what, cwd))
      }
    } else if (EDIT_TOOLS.has(tool)) {
      parts = await editParts($, tool, input)
      const scope = isOn ? await scopeGlobs($) : []
      for (const [path, old, neu] of parts) {
        const loc = await locate($, a5, path)
        locs.push(loc)
        if (isOn) d ??= a5.preEdit(path, old, neu, loc, scope, await isSharedRoot($, loc.root))
        what = path
      }
    }
    if (d) count(d.rule)
    if (d?.kind === 'deny') return { deny: blocked(gateOf(d.rule), d.why, 'not allowed under A5: do it another way, or ask Hai to turn A5 off for it') }
    if (d?.kind === 'ask' && !approved.has(d.key)) {
      // A worker stops and reports on such an action (intent skill); the session that briefed it decides, or asks Hai.
      if (e.agentId !== undefined)
        return { deny: blocked(gateOf(d.rule), d.why, 'a worker does not ask Hai: leave it undone, stop and report it to the session that briefed you; that session decides or asks Hai') }
      const verdict = await askHai($, opts, d, what)
      if (verdict !== 'allow') return { deny: verdict }
    }

    const ran = await next(e)
    if (chain === null) {
      // Where this plugin sits: Ather beneath means its pane can be wrapped. Kept outside the plugin
      // folder (a write inside it would reload the mod), for /a5 status and for checking by hand.
      chain = next.trace.map(t => t.plugin).filter(p => p !== 'engine')
      const me8 = (await $.session.id()).slice(0, 8)
      await $.fs.write(`${(places.TEMP ?? '').replace(/\\/g, '/')}/hai-flow/chain-${me8}.json`, JSON.stringify({ beneath: chain })).catch(() => undefined)
    }
    if (ran.deny !== undefined) return ran
    if (EDIT_TOOLS.has(tool) && ran.isError !== true) {
      parts.forEach(([path, old, neu], n) => {
        const added = newLines(old, neu)
        if (isFindingsFile(path) && added.some(isDirectorCallLine)) wroteDirectorCall = true
        // The report covers this loop's own edits; a worker reports its own (intent skill: progress.md).
        if (e.agentId !== undefined) return
        where.set(norm(path).toLowerCase(), locs[n] ?? { root: null, rel: null })
        a5.recordEdit(turn, path, added)
      })
    } else if (SHELL_TOOLS.has(tool)) {
      a5.recordShell(turn, what, ran.text ?? '', ran.isError !== true, input.run_in_background === true)
    } else if (isUnrealMcp(tool)) {
      // Proof Ather counts for a tech artist counts for A5 too: a PIE start, or a read-back after a write.
      const kind = mcpKind(JSON.stringify(input).slice(0, 4000))
      const ok = ran.isError !== true
      if (kind === 'write' && ok) mcpWrote = true
      if (kind === 'pie') a5.recordProof(turn, 'PIE started (Ather proof)', ok)
      else if (kind === 'read' && mcpWrote && ok) a5.recordProof(turn, 'MCP read-back after a write (Ather proof)', true)
    }
    return ran
  })

  on('classic.Stop', async ($, e, next) => {
    const res = await next(e)
    if (res.block) return res
    const a5 = await load($)
    const reset = () => {
      turn = freshTurn()
      mcpWrote = false
    }
    if (!(await readA5($))) {
      reset()
      return res
    }
    const current = new Map<string, string>()
    for (const [k, { path }] of turn.edits) current.set(k, await $.fs.read(path).catch(() => ''))
    const text = e.last_assistant_message || (await lastAssistantText($))
    // With an intent tracked, Ather's proof for it is the record `Verified:` answers to (one status read).
    const proof = turn.edits.size ? proofOf(await atherStatus($)) : null
    const probs = a5.gate(turn, text, where, current, proof)
    if (!probs.length) {
      reset()
      return res
    }
    probs.forEach(p => count(p.slice(0, 2)))
    turn.blocks = e.stop_hook_active ? turn.blocks + 1 : 1
    if (turn.blocks > a5.cfg.max_gate_blocks) {
      $.ui.toast(`A5 report gate gave up after ${a5.cfg.max_gate_blocks} tries: ${probs[0] ?? ''}`, { timeoutMs: 12_000 })
      reset()
      return res
    }
    return { ...res, block: `hai-flow · A5 report — the final answer is not ready → fix these, then give it again:\n- ${probs.join('\n- ')}` }
  })

  on('turn.complete', async ($, e, next) => {
    const res = await next(e)
    if (e.agentId === undefined) {
      if (isSyncRunning) {
        isSyncRunning = false
        $.ui.invalidate('ui.render')
      }
      const wrote = wroteDirectorCall
      wroteDirectorCall = false
      if (e.reason === 'answer') {
        const m = readMarker(e.answer)
        // A 🟥 that relays a director call (added to findings.md this turn, or named by its F-<n>) is in Ather already.
        const isInFindings = m?.kind === 'decision' && (wrote || namesDirectorCall(await atherStatus($), e.answer))
        if (m) await applyMarker($, opts, m, isInFindings).catch(err => $.ui.log(`marker: ${String(err)}`))
      }
    }
    return res
  })

  // Hai typed: the marker has been seen, so the title goes back.
  on('prompt.submit', async ($, e, next) => {
    if (markedFrom !== null && (e.origin.kind === 'composer' || e.origin.kind === 'bridge')) {
      const was = markedFrom
      markedFrom = null
      if (hasMark(await sessionTitle($))) await retitle($, was).catch(() => '')
    }
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const res = await next(e)
    await load($)
    const isOn = await readA5($)
    const me8 = (await $.session.id()).slice(0, 8)
    const text = [rulesFlow, isOn ? rulesA5 : ''].filter(Boolean).join('\n\n').replaceAll('{SESSION8}', me8)
    if (!text) return res
    return { ...res, sections: [...res.sections, { id: 'hai-flow:rules', text, scope: 'session' as const }] }
  })

  // Ather's pane: drawn by Ather beneath; this wraps what it drew.
  on('ui.render', { component: 'Pane', requestId: ATHER_PANE }, async ($, e, next) => drawPane($, opts, e, await next(e)))
}
