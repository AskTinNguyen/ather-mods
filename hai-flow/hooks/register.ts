import type { EngineInterface as Engine, Register, RenderElement } from 'claude-code'
import { A5, freshTurn, gitTargets, newLines, norm, under, type A5Config, type Decision, type Located, type Places, type Proof, type Turn } from './a5.ts'
import { bareTitle, hasMark, isDirectorCallLine, isFindingsFile, isPending, markedTitle, pendingLine, readMarker, type Marker } from './decision.ts'
import { FREE_RAM_PROBE, PIE_MIN_FREE_GB, isEditorStartStop, lockProblem, mcpKind, parseEditorLock } from './editor.ts'
import {
  DIR, HEARTBEAT_STALE_MS, IDLE_RELEASE_MS, LEASE_WARN_MS, NOTICES, PIE_ABORT_GB, DISK_MIN_GB, YIELD_EVERY_MS, atNearest, blankSession, cleanupPlan, decide, editorPid, freeLine, gatesOf,
  heldLine, hhmm as clockOf, isIntentFile, isLockPath, mayAskYield, noticeIds, parseLockLine, parseProbe, parseSessionFile, parseSyncFile, parseTouch, queueOf, ramProbe,
  addsNotice, safeWord, syncPhase, ueRequestLine, writesLock, ymd, type Decision as GrantDecision, type Gates, type GrantInput, type LaneBeat, type LockLine, type Notice, type Probe,
  type SessionFile, type SyncFile, type Touch, type Want,
} from './coord.ts'
import { icon, sealSvg, type Motion } from './icons.ts'
import { A5_LOOK, STATUS, noHits, recolor, replaceKeyed, rulesFooter, withSeal, type RuleHits } from './theme.ts'
import { SYNC_PROMPT, editorTile, lockLine, mainTile, memoryTile, parseLockView, ramBand, tilesRow, toMin, type LockView, type Sync, type Vitals } from './watch.ts'

// Hai's S2 flow beside Ather Automata, which it never changes. With A5 off it draws nothing into Ather's
// pane, status line or toasts and gates nothing; only the 🟥 / ⏯️ title marks stay (D1).
// - A5 (a5.ts, a5/config.json), only while `/a5 on`: refuses or asks before risky tool calls, records
//   edits and checks, and at Stop keeps the agent going until its report is honest. Fitted to Ather's
//   intent flow: rules about the shared checkout skip a worker's own worktree; a worker (subagent) never
//   asks Hai, it reports; with an intent tracked, `Verified:` is held to Ather's proof for it.
// - A5's coordination (coord.ts) for the sessions sharing one S2 checkout and one machine: the Editor
//   holder (model tool `editor`: a queue computed alike by every session from Saved/HaiFlow files, a lease
//   with a hard end, the lock written in the S2 standard's lines), RAM (safe cleanup before a grant, the
//   launch gate, PIE 5/3 GB fixed) and the Sync main holder (`/a5 sync`, model tool `sync`: cutoff, freeze,
//   conflicts to their owners). One minute timer reads files and probes; it wakes the model only for an
//   event addressed to this session. Notices start "hai-flow ·" and are never logged in docs/intent.
// - 🟥 / ⏯️ (decision.ts), always: the title is marked and unread set. A 🟥 that relays an intent's director
//   call (a worker added it to findings.md, intent skill) is in Ather's Needs you already; any other 🟥 gets
//   one PENDING.md line, so no decision is lost.
// - Ather's pane (theme.ts, watch.ts, icons.ts), A5 on only: its home view gains Editor holder · Memory ·
//   Sync main tiles with pixel icons; the accent turns gold, a red seal joins the brand, the five rules sit
//   at the foot. Icons move only when a state turns over (a dither reveal) or a sync runs (a dither sweep).
// Every refusal reads the same: "hai-flow · <gate> — <why> → <what next>".
// Module variables are this session's (one process per session); a reload starts them over, and what must
// survive one (the request, the lease, delivered notice ids) lives in this session's own file.

type Opts = { a5WhenPresent: string; editorLock: string; pendingFile: string; motion: string; launchGatePieGb?: number; launchGateGb?: number }
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

// A5's coordination: what this session last read from the files and the machine (coord.ts decides).
const EDITOR_TOOL = 'mcp__hai-flow__editor'
const SYNC_TOOL = 'mcp__hai-flow__sync'
const CLEANUP_EVERY_MS = 5 * 60_000 // while a slot waits on RAM, the safe cleanup runs at most this often
const PIE_STOP = /StopPIE|EndPIE|StopPlayInEditor|EndPlayMap|RequestEndPlayMap/i
const EDITOR_WORK = /Build\.(bat|sh|cmd)\b|UnrealEditor|RunUAT/i
let hasTools = false
let me: SessionFile | null = null // this session's own file (Saved/HaiFlow/editor/<id8>.json), as last written
let me8 = ''
let peers: SessionFile[] = [] // every other session's file
let lanes: LaneBeat[] = [] // Ather's lane heartbeats
let lockRaw: string | null = null
let lock: LockLine = parseLockLine(null)
let probe: Probe | null = null
let gates: Gates & { source: string } = gatesOf(null, undefined, undefined)
let syncFile: SyncFile | null = null
let touches: Touch[] = []
const touched = new Set<string>() // repo-relative paths this session and its workers edited in the shared checkout
let pending: Notice[] = []
const delivered = new Set<string>()
let isBusy = false // a main-loop turn runs: notices ride its next tool result instead of a prompt
let tickChain: Promise<void> = Promise.resolve()
let lastEditorUseAt = 0
let isPieRunning = false // this session started PIE and no stop was seen
let isPieLow = false
let pieLowSince = 0
let cleanupNote = ''
let cleanupAt = 0
let decision: GrantDecision | null = null

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
  const why = lockProblem(parseEditorLock(raw, now.getHours() * 60 + now.getMinutes()), (await $.session.id()).slice(0, 8).toLowerCase(), `Take the lock first: ask for it with ${EDITOR_TOOL} (action request) and retry once it is granted.`)
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

// ---------- A5 coordination: files, the minute tick, notices ----------
const hfDir = (opts: Opts): string => `${s2Root(opts)}/${DIR}`
const sameRoot = (a: string, b: string): boolean => norm(a).toLowerCase().replace(/\/$/, '') === norm(b).toLowerCase().replace(/\/$/, '')

/** This session's own file, read back after a reload (its request, lease and delivered notices survive). */
async function restoreMe($: Engine, opts: Opts): Promise<SessionFile> {
  const id = await $.session.id()
  const id8 = id.slice(0, 8).toLowerCase()
  if (me && me.id8 === id8) return me
  me8 = id8
  const dir = hfDir(opts)
  const file = parseSessionFile(await $.fs.read(`${dir}/editor/${id8}.json`).catch(() => null))
  const title = file?.title || (await sessionTitle($).catch(() => ''))
  me = file ?? blankSession(id, safeWord(bareTitle(title) || `session-${id8}`), bareTitle(title), await $.clock.now())
  for (const d of me.delivered) delivered.add(d)
  for (const p of parseTouch(await $.fs.read(`${dir}/touch/${id8}.json`).catch(() => null))?.paths ?? []) touched.add(p)
  return me
}

/** Writes this session's file (its heartbeat with it); one writer: this session. */
async function saveMe($: Engine, opts: Opts, at?: number): Promise<void> {
  if (!me) return
  const now = at ?? (await $.clock.now())
  me = { ...me, heartbeatAt: now, delivered: [...delivered].slice(-200), yieldAsks: me.yieldAsks.filter(a => now - a.at < YIELD_EVERY_MS) }
  await $.fs.write(`${hfDir(opts)}/editor/${me.id8}.json`, JSON.stringify(me)).catch(err => $.ui.log(`hai-flow: session file not written: ${String(err)}`, { to: 'debug' }))
}

async function readJson($: Engine, path: string): Promise<string | null> {
  return $.fs.read(path).catch(() => null)
}

/** Everything the decisions read: the lock, every session file, Ather's lanes, the sync plan, the touch files
 * and the machine probe. */
async function readWorld($: Engine, opts: Opts): Promise<void> {
  const root = s2Root(opts)
  const dir = hfDir(opts)
  const [raw, list, laneList, syncText, touchList, ran] = await Promise.all([
    $.fs.read(opts.editorLock).catch(() => null),
    $.fs.list(`${dir}/editor`).catch(() => []),
    $.fs.list(`${root}/Saved/AtherAutomata/lanes`).catch(() => []),
    readJson($, `${dir}/sync.json`),
    $.fs.list(`${dir}/touch`).catch(() => []),
    $.process.run(ramProbe(root.slice(0, 1)), { timeoutMs: 20_000 }).catch(() => null),
  ])
  lockRaw = raw
  lock = parseLockLine(raw)
  const jsons = <T>(entries: { name: string; kind: string }[]) => entries.filter(f => f.kind === 'file' && f.name.endsWith('.json')) as T[]
  const files = await Promise.all(jsons<{ name: string }>(list).map(async f => parseSessionFile(await readJson($, `${dir}/editor/${f.name}`))))
  peers = files.filter((f): f is SessionFile => f !== null && f.id8 !== me8)
  lanes = (
    await Promise.all(
      jsons<{ name: string; mtimeMs: number }>(laneList).map(async f => {
        try {
          const v = JSON.parse((await readJson($, `${root}/Saved/AtherAutomata/lanes/${f.name}`)) ?? '') as { sessionId?: string; hasEnded?: boolean }
          return { sessionId: String(v.sessionId ?? f.name.replace(/\.json$/, '')), hasEnded: v.hasEnded === true, mtimeMs: f.mtimeMs }
        } catch {
          return null // a half-written heartbeat; the next tick reads it
        }
      }),
    )
  ).filter((l): l is LaneBeat => l !== null)
  syncFile = parseSyncFile(syncText)
  touches = (await Promise.all(jsons<{ name: string }>(touchList).map(async f => parseTouch(await readJson($, `${dir}/touch/${f.name}`))))).filter((t): t is Touch => t !== null && t.id8 !== me8)
  probe = ran ? parseProbe(ran.stdout) : null
}

/** Queues a notice for this session, once per id (D6). */
function push(n: Notice): void {
  if (delivered.has(n.id) || pending.some(p => p.id === n.id)) return
  pending.push(n)
}

/** The queued notices' texts, now marked delivered. */
function drain(): string[] {
  const out = pending.map(n => n.text)
  for (const n of pending) delivered.add(n.id)
  pending = []
  return out
}

/** An idle session with a notice that needs action gets one prompt for all it has queued (D6). */
async function deliverIdle($: Engine, opts: Opts): Promise<void> {
  if (isBusy || !pending.some(n => n.isActionable)) return
  const texts = drain()
  isBusy = true
  await saveMe($, opts)
  await $.prompt.submit({ text: texts.join('\n\n') }).catch(err => $.ui.log(`hai-flow: notice prompt not queued: ${String(err)}`, { to: 'debug' }))
}

/** The model tools, registered the first time A5 is seen on in this session (D1: none while it is off). */
async function ensureTools($: Engine): Promise<void> {
  if (hasTools) return
  hasTools = true
  await $.tool.register({
    name: 'editor',
    description:
      'hai-flow A5 Editor holder for the shared S2 checkout: the only way to take or give the Unreal Editor while A5 is on. ' +
      '"request" asks for a slot (minutes, pie, build, what): sessions are served in the order they asked, a slot must end before the next sync cutoff, and launching needs the RAM launch gate; ' +
      'you are granted at once when you are at the head and the lock is free, else you get your place and are told when it is yours. ' +
      '"release" gives it back (stop PIE and every background process of yours that could call MCP first; list packages to discard in dont_save). ' +
      '"extend" adds minutes before your lease ends, if it still fits. "status" reads the holder, the queue, RAM and the next sync. Never write Saved/EDITOR_OWNER.txt yourself.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['request', 'release', 'extend', 'status'] },
        minutes: { type: 'number', description: 'request: how long you need the Editor (5–180, default 30; ≤ 20 without a build may ask the holder to yield). extend: how many more minutes.' },
        pie: { type: 'boolean', description: 'request: the slot starts PIE (the launch gate is higher).' },
        build: { type: 'boolean', description: 'request: the Editor must be closed for a build (one window ≤ 45 min).' },
        what: { type: 'string', description: 'request: what the slot is for, one line.' },
        lane: { type: 'string', description: 'request: the lane name written into the lock (default: this session\'s title).' },
        mode: { type: 'string', enum: ['interactive', 'unattended'] },
        pausable: { type: 'boolean', description: 'request: whether you can yield at a safe point (default true).' },
        next_safe: { type: 'string', description: 'request: your next safe point, HH:MM or "after save".' },
        note: { type: 'string', description: 'release: one line for the lock note.' },
        dont_save: { type: 'array', items: { type: 'string' }, description: 'release: dirty packages to discard (Don\'t-Save), each confirmed by its owning lane.' },
        pie_stopped: { type: 'boolean', description: 'release: PIE this session started has ended (needed only when no stop was seen).' },
      },
      required: ['action'],
    },
  }).catch(err => $.ui.log(`hai-flow: editor tool not registered: ${String(err)}`, { to: 'debug' }))
}

/** One minute tick, serialized with the tool's own runs: read, decide, write this session's files, notify. */
function runTick($: Engine, opts: Opts): Promise<void> {
  tickChain = tickChain.then(() => tick($, opts)).catch(err => $.ui.log(`hai-flow tick: ${String(err)}`, { to: 'debug' }))
  return tickChain
}

async function tick($: Engine, opts: Opts): Promise<void> {
  if (!(await readA5($))) {
    showStatus($)
    return
  }
  if (!(await $.fs.exists(s2Root(opts)))) return // no S2 checkout on this machine
  await ensureTools($)
  await restoreMe($, opts)
  const now = await $.clock.now()
  await readWorld($, opts)
  gates = gatesOf(await $.store.get('gates').catch(() => null), opts.launchGatePieGb, opts.launchGateGb)
  await editorStep($, opts, now)
  ramStep(opts, now)
  await saveMe($, opts, now)
  showMachine($, now)
  await deliverIdle($, opts)
  showStatus($)
  $.ui.invalidate('ui.render')
}

const grantInput = (now: number): GrantInput => ({ me8, lock, files: me ? [me, ...peers] : peers, lanes, now, sync: syncFile, probe, gates })
const holdsLock = (): boolean => lock.id8 === me8 && me8 !== '' && (lock.kind === 'held' || lock.kind === 'handed')

/** The lock written by read-compare-write: only if it still reads as when this session decided, then read back
 * (no compare-and-set exists; one more writer between the two reads loses, and the next tick decides again). */
async function writeLock($: Engine, opts: Opts, line: string): Promise<boolean> {
  const before = await $.fs.read(opts.editorLock).catch(() => null)
  if (before !== lockRaw) {
    lockRaw = before
    lock = parseLockLine(before)
    return false
  }
  await $.fs.write(opts.editorLock, `${line}\n`)
  const after = await $.fs.read(opts.editorLock).catch(() => null)
  lockRaw = after
  lock = parseLockLine(after)
  return (after ?? '').trim() === line
}

/** The holder's side (lease end, overrun, idle, yield asks) and the waiter's (recover, cleanup, grant, yield). */
async function editorStep($: Engine, opts: Opts, now: number): Promise<void> {
  if (!me) return
  if (holdsLock()) {
    if (!me.holding) me = { ...me, holding: { since: atNearest(lock.since.slice(0, 5), now) ?? now, end: atNearest(lock.end, now) ?? now + 30 * 60_000, extended: 0 } }
    const h = me.holding ?? { since: now, end: now, extended: 0 }
    if (now >= h.end - LEASE_WARN_MS && now < h.end) push({ id: noticeIds.leaseEnding(h.since, h.end), text: NOTICES.leaseEnding(h.end), isActionable: true })
    if (now >= h.end) push({ id: noticeIds.overrun(h.since, h.end), text: NOTICES.overrun(h.end), isActionable: true })
    if (!isPieRunning && me.want?.mode !== 'unattended' && now - Math.max(lastEditorUseAt, h.since) >= IDLE_RELEASE_MS)
      push({ id: noticeIds.idle(h.since), text: NOTICES.idle(Math.round((now - Math.max(lastEditorUseAt, h.since)) / 60_000)), isActionable: true })
    for (const f of peers)
      for (const a of f.yieldAsks)
        if (a.holder === me8 && a.via === 'file' && a.at >= h.since - 60_000 && now - a.at < YIELD_EVERY_MS) push({ id: noticeIds.yield(f.id8, a.at), text: NOTICES.yield(f.lane, a.minutes), isActionable: true })
    decision = { kind: 'mine' }
    return
  }
  if (me.holding) me = { ...me, holding: null, want: null } // the lock no longer names this session
  if (!me.want) {
    decision = null
    return
  }
  let d = decide(grantInput(now))
  if (d.kind === 'recover') {
    const line = freeLine({ since: now, by: me.lane, note: `stale lease of ${lock.lane || 'a lane'} (session-${d.holder}): its lane is gone and no UnrealEditor runs`, background: 'unknown' })
    if (await writeLock($, opts, line)) push({ id: noticeIds.recovered(d.holder, now), text: NOTICES.recovered(d.holder), isActionable: false })
    d = decide(grantInput(now))
  }
  if (d.kind === 'grant' || (d.kind === 'wait' && d.code === 'ram')) {
    const plan = probe ? cleanupPlan(probe) : null
    if (plan && (plan.reap || plan.stopLiveCoding.length > 0) && (d.kind === 'grant' || now - cleanupAt >= CLEANUP_EVERY_MS)) {
      await runCleanup($, opts, plan, now)
      d = decide(grantInput(now))
    } else if (plan && !cleanupAt) cleanupNote = plan.report.join('; ')
  }
  if (d.kind === 'grant') await takeLock($, opts, d, now)
  else if (d.kind === 'wait' && d.code === 'held') await askYield($, now)
  else if (d.kind === 'wait' && d.code === 'gone-editor') {
    const pid = editorPid(probe) ?? 0
    push({ id: noticeIds.goneEditor(lock.id8, pid), text: NOTICES.goneEditor(`${lock.lane || 'the holder'} (session ${lock.id8})`, pid), isActionable: true })
  }
  decision = holdsLock() ? { kind: 'mine' } : d
}

async function takeLock($: Engine, opts: Opts, d: { end: number; reuse: number | null }, now: number): Promise<void> {
  const w = me?.want
  if (!me || !w) return
  const line = heldLine({ lane: me.lane, sessionName: me.title || me.lane, id8: me8, since: now, pid: d.reuse, end: d.end, mode: w.mode, pausable: w.pausable, nextSafe: w.nextSafe, note: `${w.what}${w.pie ? ' (PIE)' : ''}${w.build ? ' (build)' : ''}` })
  if (!(await writeLock($, opts, line))) return
  me = { ...me, holding: { since: now, end: d.end, extended: 0 } }
  lastEditorUseAt = now
  push({ id: noticeIds.granted(now), text: NOTICES.granted(d.end, w.pie, d.reuse, now - cleanupAt < 60_000 ? cleanupNote : ''), isActionable: true })
}

/** A short request without a build asks the holder to yield, once per holder per hour: through the holder's own
 * hai-flow (a field in this session's file it reads), or the standard `UE request:` line to a holder without it. */
async function askYield($: Engine, now: number): Promise<void> {
  const want = me?.want
  const y = want ? mayAskYield(grantInput(now)) : null
  if (!me || !want || !y) return
  const withMod = peers.some(f => f.id8 === y.holder && now - f.heartbeatAt <= HEARTBEAT_STALE_MS)
  if (!withMod) {
    const lane = lanes.find(l => l.sessionId.toLowerCase().startsWith(y.holder))
    if (!lane) return // no address for it: the waiter is told its place, nothing is sent
    const until = atNearest(lock.end, now) ?? now + 60 * 60_000
    const sent = await $.session.send({ to: { sessionId: lane.sessionId }, text: ueRequestLine(me.lane, want.minutes, want.what, Math.max(until, now + 15 * 60_000)) }).catch(err => ({ isDelivered: false as const, reason: String(err) }))
    if (!sent.isDelivered) $.ui.log(`hai-flow: UE request to ${y.holder} not delivered: ${sent.reason}`, { to: 'debug' })
  }
  me = { ...me, yieldAsks: [...me.yieldAsks, { holder: y.holder, at: now, via: withMod ? 'file' : 'send', minutes: want.minutes, lane: me.lane }] }
}

/** The safe cleanup before a grant: the S2 orphan-git reaper under 14 GB, LiveCodingConsole stopped only while
 * no Editor runs (checked again by a fresh probe); every other process is named and left alone. */
async function runCleanup($: Engine, opts: Opts, plan: ReturnType<typeof cleanupPlan>, now: number): Promise<void> {
  const before = probe?.freeGb ?? 0
  const done: string[] = []
  if (plan.stopLiveCoding.length > 0) {
    const fresh = parseProbe((await $.process.run(ramProbe(s2Root(opts).slice(0, 1)), { timeoutMs: 20_000 }).catch(() => null))?.stdout ?? '')
    if (fresh && editorPid(fresh) === null) {
      await $.process.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', `Stop-Process -Id ${plan.stopLiveCoding.join(',')} -ErrorAction SilentlyContinue`], { timeoutMs: 15_000 }).catch(() => null)
      done.push(`stopped LiveCodingConsole (pid ${plan.stopLiveCoding.join(', ')})`)
    }
  }
  if (plan.reap) {
    await $.process.run(['powershell', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', `${s2Root(opts)}/.agents/skills/git-poller-storm/scripts/reap-orphan-git.ps1`], { timeoutMs: 60_000 }).catch(() => null)
    done.push('ran the orphan-git reaper')
  }
  probe = parseProbe((await $.process.run(ramProbe(s2Root(opts).slice(0, 1)), { timeoutMs: 20_000 }).catch(() => null))?.stdout ?? '') ?? probe
  cleanupAt = now
  cleanupNote = [`${clockOf(now)} ${done.join(', ') || 'nothing to clean'}: free ${before} → ${probe?.freeGb ?? '?'} GB`, ...plan.report].join('; ')
}

/** RAM while this session's PIE runs (abort under 3 GB) and the checkout drive under 20 GB. */
function ramStep(opts: Opts, now: number): void {
  if (!probe) return
  if (isPieRunning && holdsLock() && probe.freeGb < PIE_ABORT_GB) {
    if (!isPieLow) pieLowSince = now
    isPieLow = true
    push({ id: noticeIds.pieAbort(pieLowSince), text: NOTICES.pieAbort(probe.freeGb), isActionable: true })
  } else if (probe.freeGb >= PIE_ABORT_GB) isPieLow = false
  if (probe.diskGb !== null && probe.diskGb < DISK_MIN_GB) push({ id: noticeIds.disk(ymd(now)), text: NOTICES.disk(`${s2Root(opts).slice(0, 2)}`, probe.diskGb), isActionable: false })
}

/** What the tiles and the status line show, from what the tick read; a toast when the Editor comes free or RAM
 * falls (A5 on only). */
function showMachine($: Engine, now: number): void {
  const d = new Date(now)
  nowMin = d.getHours() * 60 + d.getMinutes()
  lockView = parseLockView(lockRaw)
  const key = lockView.isMissing ? 'missing' : lockView.isFree ? `free ${lockView.freeSince ?? ''}` : `${lockView.who ?? ''} ${lockView.until ?? ''}`
  // One toast when the Editor comes free (someone waiting can take it); hand-overs between lanes stay quiet.
  if (lastLockKey !== '' && key !== lastLockKey && lockView.isFree) $.ui.toast(lockLine(lockView))
  lastLockKey = key
  vitals = probe ? { freeGb: probe.freeGb, claude: 0, git: probe.procs.filter(p => p.name.toLowerCase() === 'git').length, editorGb: probe.procs.find(p => p.name === 'UnrealEditor')?.gb ?? 0 } : undefined
  if (vitals) {
    const band = ramBand(vitals.freeGb)
    if (band !== lowBand && band !== 'ok')
      $.ui.toast(band === 'below-abort' ? `Free RAM ${vitals.freeGb} GB: under 3 GB, abort PIE` : `Free RAM ${vitals.freeGb} GB: under 5 GB, do not start PIE`)
    lowBand = band
  }
}

/** Records a repo-relative path this session (or one of its workers) edited in the shared checkout. */
async function recordTouch($: Engine, opts: Opts, locs: Located[]): Promise<void> {
  const root = s2Root(opts)
  let isNew = false
  for (const l of locs) {
    if (!l.root || !l.rel || !sameRoot(l.root, root) || !(await isSharedRoot($, l.root))) continue
    if (!touched.has(l.rel)) {
      touched.add(l.rel)
      isNew = true
    }
  }
  if (!isNew || !me) return
  const t: Touch = { session: me.session, id8: me8, lane: me.lane, paths: [...touched].slice(-500), updatedAt: await $.clock.now() }
  await $.fs.write(`${hfDir(opts)}/touch/${me8}.json`, JSON.stringify(t)).catch(() => undefined)
}

/** A5's coordination refusals before a tool runs: the lock is the editor tool's to write; notices are not
 * logged into intent files. */
async function coordProblem($: Engine, opts: Opts, tool: string, input: Input): Promise<string | null> {
  const viaTool = `call ${EDITOR_TOOL} (action request, release or extend)`
  if (EDIT_TOOLS.has(tool)) {
    const parts = await editParts($, tool, input)
    if (parts.some(([path]) => isLockPath(path))) return blocked('Editor lock', 'under A5 the lock is written by the editor tool, never by hand', viaTool)
    if (parts.some(([path, old, neu]) => isIntentFile(path) && addsNotice(newLines(old, neu))))
      return blocked('Notices', 'hai-flow notices are not logged in docs/intent files (D6: they would be noise in the intent\'s record)', 'leave the "hai-flow ·" line out; the files under Saved/HaiFlow are the record')
  }
  if (SHELL_TOOLS.has(tool) && writesLock(str(input.command))) return blocked('Editor lock', 'under A5 the lock is written by the editor tool, never by a command', viaTool)
  return null
}

const placeText = (d: GrantDecision | null): string => {
  if (!d || d.kind === 'none') return 'no request from this session'
  if (d.kind === 'mine') return `this session holds the Editor${me?.holding ? ` until ${clockOf(me.holding.end)}` : ''}`
  if (d.kind === 'wait') return `waiting (${d.place > 1 ? `${d.place}${d.place === 2 ? 'nd' : d.place === 3 ? 'rd' : 'th'} in the queue` : 'next'}): ${d.why} → ${d.next}`
  return d.kind === 'grant' ? `granted until ${clockOf(d.end)}` : 'recovering a stale lease'
}

/** The `editor` tool: request, release, extend, status (the only writer of the lock under A5). */
async function editorTool($: Engine, opts: Opts, e: Input): Promise<string> {
  if (!(await readA5($))) return blocked('Editor', 'A5 is off, so the Editor holder is not running', 'follow AGENTS.md: take Saved/EDITOR_OWNER.txt by hand')
  if (!(await $.fs.exists(s2Root(opts)))) return blocked('Editor', `no S2 checkout at ${s2Root(opts)}`, 'set the editorLock option to the checkout\'s Saved/EDITOR_OWNER.txt')
  await restoreMe($, opts)
  const action = str(e.action)
  const now = await $.clock.now()
  const tail = (text: string): string => [text, ...drain()].join('\n')
  if (action === 'request') {
    if (!me) return 'no session file'
    await runTick($, opts) // a fresh read of the lock and the queue first
    if (holdsLock()) return tail(`this session already holds the Editor until ${me.holding ? clockOf(me.holding.end) : lock.end} → use it; extend if you need more`)
    const build = e.build === true
    const minutes = Math.max(5, Math.min(180, Math.round(Number(e.minutes) || 30)))
    if (build && minutes > 45) return blocked('Editor', `a build window is at most 45 min (S2 standard), ${minutes} asked`, 'batch the code changes into one window of ≤ 45 min and ask again')
    const want: Want = {
      minutes,
      pie: e.pie === true,
      build,
      what: str(e.what).slice(0, 120) || 'Editor work',
      mode: e.mode === 'unattended' ? 'unattended' : 'interactive',
      pausable: e.pausable !== false,
      nextSafe: str(e.next_safe) || 'after save',
      requestedAt: me.want?.requestedAt ?? now, // asking again keeps the place in the queue
    }
    me = { ...me, want, lane: str(e.lane) ? safeWord(str(e.lane)) : me.lane }
    await saveMe($, opts, now)
    await runTick($, opts)
    const asked = me.yieldAsks.find(a => a.at === now)
    return tail(`${placeText(decision)}${asked ? ` · the holder (session ${asked.holder}) was asked to yield at its next safe point${asked.via === 'send' ? ' (UE request line sent: it runs without hai-flow)' : ''}` : ''}`)
  }
  if (action === 'release') {
    lockRaw = await $.fs.read(opts.editorLock).catch(() => null)
    lock = parseLockLine(lockRaw)
    if (!holdsLock()) {
      if (me) me = { ...me, want: null, holding: null }
      await saveMe($, opts, now)
      return tail(blocked('Editor', 'the lock does not name this session', 'nothing to release (any request of this session is withdrawn)'))
    }
    if (isPieRunning && e.pie_stopped !== true) return blocked('Editor', 'this session started PIE and no stop was seen', 'stop PIE first (or call release with pie_stopped: true once it has ended)')
    const fresh = parseProbe((await $.process.run(ramProbe(s2Root(opts).slice(0, 1)), { timeoutMs: 20_000 }).catch(() => null))?.stdout ?? '')
    const pid = editorPid(fresh)
    const dont = Array.isArray(e.dont_save) ? e.dont_save.map(String).filter(Boolean) : []
    const note = [pid ? `Editor open PID ${pid}, reusable` : 'Editor closed', dont.length ? `Don't-Save: ${dont.join(', ')}` : '', str(e.note)].filter(Boolean).join('; ')
    const line = freeLine({ since: now, by: me?.lane ?? me8, note, background: 'none' })
    if (!(await writeLock($, opts, line))) return blocked('Editor', 'the lock changed while releasing', 'read it with action status, then release again')
    if (me) me = { ...me, want: null, holding: null }
    isPieRunning = false
    await saveMe($, opts, now)
    return tail(`released: ${line}`)
  }
  if (action === 'extend') {
    await readWorld($, opts) // the lock and who waits, as they are now
    if (!holdsLock() || !me) return blocked('Editor', 'the lock does not name this session', 'ask for a slot with action request')
    const h = me.holding ?? { since: atNearest(lock.since.slice(0, 5), now) ?? now, end: atNearest(lock.end, now) ?? now, extended: 0 }
    if (now >= h.end) return blocked('Editor', `the lease ended at ${clockOf(h.end)}; an extension is asked before the end`, 'release now and ask again for the rest')
    const add = Math.max(5, Math.min(120, Math.round(Number(e.minutes) || 15)))
    const end = h.end + add * 60_000
    const phase = syncPhase(syncFile, now)
    if (syncFile && phase === 'planned' && end > syncFile.at - 30 * 60_000) return blocked('Editor', `the lease would end at ${clockOf(end)}, past the sync cutoff ${clockOf(syncFile.at - 30 * 60_000)}`, 'finish by the cutoff, or ask after the sync is done')
    if (syncFile && (phase === 'cutoff' || phase === 'frozen') && syncFile.holder.id8 !== me8) return blocked('Editor', `the sync at ${clockOf(syncFile.at)} is in its ${phase === 'cutoff' ? 'cutoff' : 'freeze'}`, `release by ${clockOf(syncFile.at - 10 * 60_000)}`)
    const waiting = queueOf([me, ...peers], lanes, now, syncFile).length
    if (waiting > 0 && h.extended >= 1) return blocked('Editor', `${waiting} session${waiting === 1 ? '' : 's'} wait and this lease was extended once already`, `release by ${clockOf(h.end)} and ask again`)
    const w = me.want
    const line = heldLine({ lane: me.lane, sessionName: me.title || me.lane, id8: me8, since: h.since, pid: lock.pid ?? editorPid(probe), end, mode: w?.mode ?? 'interactive', pausable: w?.pausable ?? true, nextSafe: w?.nextSafe ?? 'after save', note: lock.note || w?.what || 'Editor work' })
    if (!(await writeLock($, opts, line))) return blocked('Editor', 'the lock changed while extending', 'read it with action status, then try again')
    me = { ...me, holding: { ...h, end, extended: h.extended + 1 } }
    await saveMe($, opts, now)
    return tail(`extended until ${clockOf(end)}: ${line}`)
  }
  await runTick($, opts)
  const queue = queueOf(me ? [me, ...peers] : peers, lanes, now, syncFile)
  return tail(
    JSON.stringify(
      {
        lock: (lockRaw ?? '').trim() || 'missing (unknown, not free)',
        me: placeText(decision),
        queue: queue.map((f, n) => `${n + 1}. ${f.lane} (session ${f.id8}): ${f.want?.minutes} min${f.want?.pie ? ', PIE' : ''}${f.want?.build ? ', build' : ''}: ${f.want?.what}`),
        memory: probe ? { freeGb: probe.freeGb, launchGate: { withPie: gates.pieGb, withoutPie: gates.nopieGb, setOn: gates.source }, pie: 'start ≥ 5 GB, abort < 3 GB (fixed)', diskGb: probe.diskGb, cleanup: cleanupNote || 'none yet' } : 'probe did not answer',
        sync: syncFile ? { at: clockOf(syncFile.at), phase: syncPhase(syncFile, now), holder: syncFile.holder.lane } : 'none planned',
      },
      null,
      1,
    ),
  )
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
      void runTick($, opts)
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
      // The minute timer reads files and probes; it wakes the model only for an event addressed to this session.
      await runTick($, opts)
      $.clock.every(EDITOR_PERIOD_MS, () => void runTick($, opts))
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
      if (a5On && isS2) await runTick($, opts)
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
    // The main loop's model made this call (a plugin's own `$.tool.call`, this mod's included, is raised by that
    // plugin, not the engine): it marks the session busy, and its result may carry queued notices to the model.
    const isMain = e.agentId === undefined && next.origin.plugin === 'engine'
    if (isMain) isBusy = true
    if (tool === EDITOR_TOOL) return { result: await editorTool($, opts, input) }
    const a5 = await load($)
    const isOn = await readA5($)

    // The Editor gate is A5's (D1): with A5 off nothing of hai-flow's refuses an Editor call.
    const editor = isOn ? await editorProblem($, opts, tool, input) : null
    if (editor) return { deny: blocked('Editor lock', editor.split(' → ')[0] ?? editor, editor.split(' → ').slice(1).join(' → ') || 'wait for the Editor') }
    const coord = isOn ? await coordProblem($, opts, tool, input) : null
    if (coord) return { deny: coord }

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
      const id8 = (await $.session.id()).slice(0, 8)
      await $.fs.write(`${(places.TEMP ?? '').replace(/\\/g, '/')}/hai-flow/chain-${id8}.json`, JSON.stringify({ beneath: chain })).catch(() => undefined)
    }
    if (ran.deny !== undefined) return ran
    if (isOn && ran.isError !== true) {
      // What the coordination needs from the call: Editor use (the idle lease), PIE running, the paths edited.
      const text = isUnrealMcp(tool) ? JSON.stringify(input).slice(0, 4000) : ''
      if (isUnrealMcp(tool) || (SHELL_TOOLS.has(tool) && EDITOR_WORK.test(what))) lastEditorUseAt = await $.clock.now()
      if (text && mcpKind(text) === 'pie') isPieRunning = true
      if (text && PIE_STOP.test(text)) isPieRunning = false
      if (EDIT_TOOLS.has(tool) && isS2) await recordTouch($, opts, locs)
    }
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
    // Mid-turn, queued notices ride the main loop's next tool result (D6); a worker's results carry none.
    if (isOn && isMain && pending.length > 0) {
      const texts = drain()
      await saveMe($, opts)
      return { ...ran, context: [...(ran.context ?? []), ...texts] }
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
      // The session is idle now: a notice that needs action and arrived after the last tool result is one prompt.
      isBusy = false
      if (a5On) await deliverIdle($, opts)
    }
    return res
  })

  on('prompt.submit', async ($, e, next) => {
    isBusy = true
    // Hai typed: the marker has been seen, so the title goes back.
    if (markedFrom !== null && (e.origin.kind === 'composer' || e.origin.kind === 'bridge')) {
      const was = markedFrom
      markedFrom = null
      if (hasMark(await sessionTitle($))) await retitle($, was).catch(() => '')
    }
    // Notices waiting for the next turn ride this prompt as context the model reads (D6).
    if (pending.length > 0 && (await readA5($))) {
      const texts = drain()
      await saveMe($, opts)
      return next({ ...e, context: [...(e.context ?? []), ...texts] })
    }
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const res = await next(e)
    await load($)
    const isOn = await readA5($)
    const id8 = (await $.session.id()).slice(0, 8)
    const text = [rulesFlow, isOn ? rulesA5 : ''].filter(Boolean).join('\n\n').replaceAll('{SESSION8}', id8)
    if (!text) return res
    return { ...res, sections: [...res.sections, { id: 'hai-flow:rules', text, scope: 'session' as const }] }
  })

  // Ather's pane: drawn by Ather beneath; this wraps what it drew.
  on('ui.render', { component: 'Pane', requestId: ATHER_PANE }, async ($, e, next) => drawPane($, opts, e, await next(e)))
}
