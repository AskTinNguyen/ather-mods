import type { EngineInterface as Engine, Register, RenderElement } from 'claude-code'
import { A5, gitTargets, newLines, norm, tokenize, under, type A5Config, type Decision, type Located, type Places, type Proof } from './a5.ts'
import { acceptText, closesIntent, failed, isPrCommand, isPrTool, namedPaths, openedPrs, prNumbersOf, ruleName, score, shipSlugOf, shipText, unreadLine, unreadText, type AcceptInput, type RuleScore } from './accept.ts'
import { bareTitle, hasMark, isDirectorCallLine, isFindingsFile, isPending, markedTitle, pendingLine, readMarker, type Marker } from './decision.ts'
import { FREE_RAM_PROBE, PIE_MIN_FREE_GB, isEditorStartStop, lockProblem, mcpKind, parseEditorLock } from './editor.ts'
import {
  CUTOFF_MS, DIR, HARD_END_WARN_MS, SYNC_BUILD_MIN, SYNC_MERGE_MIN, isSyncHolderGone, withBuild, HEARTBEAT_STALE_MS, LANE_STALE_MS, IDLE_RELEASE_MS, LEASE_WARN_MS, NOTICES, PIE_ABORT_GB, DISK_MIN_GB, RELEASE_BEFORE_MS, YIELD_EVERY_MS, atNearest, atNext, blankSession, clampGate, classify,
  cleanupPlan, decide, ordinal, presetTimes, editorPid, endedSync, freeLine, gatesOf, gitWrites, hash, heldLine, historyBlobs, hhmm as clockOf, isIntentFile, isLockPath, isOpenPhase, livenessOf, mayAskYield,
  movedSync, newSync, noticeIds, noticeText, ownersOf, parseLockLine, parseMergeTree, parseProbe, parseSessionFile, parseSharedProbe, parseSyncFile, parseTouch, queueOf, ramProbe, addsNotice, safeWord,
  PROBE_FRESH_MS,
  syncPhase, isSyncCommandOnly, SYNC_WORKER_PROMPT, syncWorkerTask, parseClients, overviewOf, overviewLine, sessionsView, projectFolder, titleFromRecord, withoutModOf, noModMessage, type ClientRow, type NoMod, ueRequestLine, withConflicts, withUntracked, parseAdded, writesLock, writesNoticeToIntent, ymd, type Conflict, type Decision as GrantDecision, type Gates, type GrantInput, type LaneBeat, type LockLine, type Notice, type Probe,
  type Phase, type SessionFile, type SyncFile, type SyncHolder, type Touch, type Want,
} from './coord.ts'
import { curtainSvg, icon, sealSvg, stampSvg, sweepSvg, type Curtain, type Motion } from './icons.ts'
import { A5_LOOK, ATHER, STATUS, V2, a5Band, applyTheme, currentTheme, themeOf, noHits, recolor, replaceKeyed, ruleCards, rulesChips, RULE_SHORT, scarfAvatars, withSeal, type RuleHits } from './theme.ts'
import { PIE_START_GB, acceptCard, ago, compactLine, sessionsBox, editorTile, type LinePart, lockLine, mainTile, memoryTile, parseLockView, ramBand, tilesRow, toMin, type LockView, type Sync, type SyncData, type Vitals } from './watch.ts'

// Hai's S2 flow beside Ather Automata, which it never changes. With A5 off it draws nothing into Ather's
// pane, status line or toasts and gates nothing; only the 🟥 / ⏯️ title marks stay (D1).
// - A5 (a5.ts, accept.ts, rules/config.json), only while `/a5 on`: the five rules (D9). At the tool call it
//   refuses or asks only before what cannot be undone (D10); nothing per turn. Everything else is scored at
//   acceptance (nghiệm thu A5) over the branch, the intent's files and Ather's proof, when a PR is opened or
//   an intent closes. Rules about the shared checkout skip a worker's own worktree; a worker never asks Hai.
// - A5's coordination (coord.ts) for the sessions sharing one S2 checkout and one machine: the Editor
//   holder (model tool `editor`: a queue computed alike by every session from Saved/A5 files, a lease
//   with a hard end, the lock written in the S2 standard's lines), RAM (safe cleanup before a grant, the
//   launch gate, PIE 5/3 GB fixed) and the Sync main holder (`/a5 sync`, model tool `sync`: cutoff, freeze,
//   conflicts to their owners). One minute timer reads files and probes; it wakes the model only for an
//   event addressed to this session. Notices start "A5 ·" and are never logged in docs/intent.
// - 🟥 / ⏯️ (decision.ts), always: the title is marked and unread set. A 🟥 that relays an intent's director
//   call (a worker added it to findings.md, intent skill) is in Ather's Needs you already; any other 🟥 gets
//   one PENDING.md line, so no decision is lost.
// - Ather's pane (theme.ts, watch.ts, icons.ts), A5 on only: its home view gains Editor holder · Memory ·
//   Sync main tiles with pixel icons; the accent turns gold, a red seal joins the brand, the five rules sit
//   at the foot. Icons move only when a state turns over (a dither reveal) or a sync runs (a dither sweep).
// Every refusal reads the same: "A5 · <gate> — <why> → <what next>".
// Module variables are this session's (one process per session); a reload starts them over, and what must
// survive one (the request, the lease, delivered notice ids) lives in this session's own file.

type Opts = { a5WhenPresent: string; editorLock: string; pendingFile: string; motion: string; launchGatePieGb?: number; launchGateGb?: number; syncMergeMinutes?: number; syncBuildMinutes?: number }
type Input = Record<string, unknown>

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])
const ALLOW_ONCE = 'Allow once'
const ALLOW_SESSION = 'Allow for this session'
const ATHER_PANE = 'ather'
const A5_PANE = 'a5'
const PANE_INK = (): { ink: string; quiet: string } => ({ ink: A5_LOOK.ivory, quiet: A5_LOOK.quiet }) // A33/A40: the A5 pane's text and quiet grey, per theme // A29: the A5 pane's id ($.ui.open) and its render requestId
const EDITOR_PERIOD_MS = 60_000
const SYNC_STALE_MS = 3 * 60_000
const MOTION_MS = 2_500 // a state change animates in renders within this window
const RULE_NAMES: Record<string, string> = RULE_SHORT // D9 / A34, short for refusals
const INK = (): string => A5_LOOK.paneInk // A40: the pane's ink, per theme

let engine: A5 | null = null
let rulesA5 = ''
let rulesFlow = ''
let places: Places = {}
const approved = new Set<string>()
const rootOf = new Map<string, string | null>()
const isLinked = new Map<string, boolean>() // git root -> a linked worktree (one session's own), not the shared checkout
let wroteDirectorCall = false // this turn added an open director call to an intent's findings.md
let markedFrom: string | null = null // the title before this session marked it, put back when Hai answers
let a5On = false
let a5FlipAt = 0
let hits: RuleHits = noHits()
let hitsDay = '' // A32: the day the counts are for ('Hits today')
let openRule: number | null = null // A32: the rule whose card is open in the A5 pane
// A37: when the A5 pane opened (or first drew) and when the compact line first drew: their entrance plays then.
let paneEnterAt = 0
let lineEnterAt = 0
const ENTRANCE_MS = 1_000 // how long after the opening the curtains stay in the tree (they finish within 300 ms)
const ENTRANCE_BUDGET_MS = 300
// A38: one-shot event dithers (≤ 1 s): a rule chip stamps red when its rule is hit; the band sweeps at the sync freeze
// (❄ in) and back at the lift; a new acceptance score resolves the chips one by one to ✓ / ✗.
const FX_MS = 1_000
const freshHits = new Set<string>() // rules hit since the A5 pane last drew
const hitStampAt: Record<string, number> = {}
let lastPhaseSeen: Phase | null = null
let freezeAt = 0
let liftAt = 0
let scoreSeenAt = 0
let scoreFxAt = 0
let isS2 = false
let lockView: LockView | undefined
let vitals: Vitals | undefined
let nowMin = 0
let lastLockKey = ''
let lowBand = 'ok'
let sync: Sync | undefined
let syncAt = 0
let isReadingGit = false
let isStatusShown = false
const seen = new Map<string, { sig: string; color: string; at: number; from: string }>() // each tile's state, and when it last turned over
let chain: string[] | null = null // the plugins beneath this one on a tool call: Ather there means the pane can be wrapped

// A5's coordination: what this session last read from the files and the machine (coord.ts decides).
const EDITOR_TOOL = 'mcp__a5__editor'
const SYNC_TOOL = 'mcp__a5__sync'
const SYNC_AGENT = 'a5:sync' // D7: the sync worker's agent type
const CLEANUP_EVERY_MS = 5 * 60_000 // while a slot waits on RAM, the safe cleanup runs at most this often
const PIE_STOP = /StopPIE|EndPIE|StopPlayInEditor|EndPlayMap|RequestEndPlayMap/i
const EDITOR_WORK = /Build\.(bat|sh|cmd)\b|UnrealEditor|RunUAT/i
let hasTools = false
let me: SessionFile | null = null // this session's own file (Saved/A5/editor/<id8>.json), as last written
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
const dryRuns = new Set<string>() // syncs (id + time) whose conflict dry-run this holder has started
let nowMs = 0 // the time of the last tick
let clearFrom: string | null = null // the session id a /clear left, until its files have moved to the new id (A10)
let lastAccept: { at: number; slug: string | null; scores: RuleScore[]; what: string } | null = null // A18/A19: the last acceptance score
let acceptDirty = false // A19: a file changed since the last score
let isScoring = false
let shipCheckedAt = 0
let shipSlug: string | null = null // A19: the tracked intent is in Ship (or ready to close)
const SHIP_CHECK_MS = 5 * 60_000
// A23: PR numbers this session scored or found already listed, and the intents whose PR lines it has read once.
const prsKnown = new Set<number>()
const prBaseline = new Set<string>()
let prDirty = false // an edit touched an intent's progress.md or prompt.md: look for a new PR number soon
const CLIENTS_EVERY_MS = 5 * 60_000 // A16: the client's session list is read at most this often
let clients: ClientRow[] | null = null // A16: null when the client's list tool is missing or refused
let clientsAt = 0
const s2Cwds = new Map<string, boolean>() // A16: whether a client session's folder is the S2 checkout or one of its worktrees
const MAX_CLASSIFIED = 40 // conflicted paths checked against rule 11; the rest count as foreign
const MAX_ADDED_CHECKED = 5_000 // paths origin/main adds that are checked on disk at the cutoff (A11)

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const parentOf = (p: string): string => {
  const i = p.lastIndexOf('/')
  return i < 0 ? '' : p.slice(0, i)
}
const s2Root = (opts: Opts): string => parentOf(parentOf(norm(opts.editorLock)))
const hhmm = (d: Date): string => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
const stampOf = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${hhmm(d)}`
const count = (rule: string) => {
  for (const id of rule.match(/D[1-5]/g) ?? []) freshHits.add(id) // A38: the chip stamps at the next draw
  for (const id of rule.match(/D[1-5]/g) ?? []) hits[id as keyof RuleHits] += 1
}
const gateOf = (rule: string): string => `${rule} ${rule.split('/').map(r => RULE_NAMES[r]).filter(Boolean).join(' / ')}`
/** The one shape of every refusal: which gate, why, and what to do instead. */
const blocked = (gate: string, why: string, next: string): string => `A5 · ${gate} — ${why} → ${next}`

async function load($: Engine): Promise<A5> {
  if (engine) return engine
  const root = $.plugin.root.replace(/\\/g, '/')
  const cfg = JSON.parse(await $.fs.read(`${root}/rules/config.json`)) as A5Config
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
  rulesA5 = await $.fs.read(`${root}/rules/rules-a5.md`).catch(() => '')
  rulesFlow = await $.fs.read(`${root}/rules/rules-flow.md`).catch(() => '')
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

type AtherStatus = { role?: string; tracked?: { slug?: string; stage?: string; directorCalls?: string[]; prs?: string[] } | null; evidence?: Proof['evidence'] }

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
  const text: string = await $.fs.read(`${$.plugin.root}/rules/scope`).catch(() => '')
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
    const answer = await $.ui.ask(`${gate}: ${d.why} Run \`${what.slice(0, 160)}\`?`, {
      options: [ALLOW_ONCE, ALLOW_SESSION, 'No'],
      header: `A5 ${d.rule}`,
    })
    if (answer === ALLOW_ONCE) return 'allow'
    if (answer === ALLOW_SESSION) {
      approved.add(d.key)
      return 'allow'
    }
    return blocked(gate, d.why, `Hai said no${answer && answer !== 'No' ? ` ("${answer}")` : ''}: do not retry it; ask Hai or do other work`)
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
    isS2 && syncFile && ['cutoff', 'frozen'].includes(phaseOf(syncFile, nowMs)) ? `Sync ${clockOf(syncFile.at)} ${phaseOf(syncFile, nowMs)}` : '',
  ].filter(Boolean)
  $.ui.status(parts.length ? parts.join(' · ') : undefined)
  isStatusShown = parts.length > 0
}

// ---------- A5 coordination: files, the minute tick, notices ----------
const hfDir = (opts: Opts): string => `${s2Root(opts)}/${DIR}`
const sameRoot = (a: string, b: string): boolean => norm(a).toLowerCase().replace(/\/$/, '') === norm(b).toLowerCase().replace(/\/$/, '')

/** This session's own file, read back after a reload (its request, lease and delivered notices survive); after a
 * /clear, moved to the new session id first (A10). */
async function restoreMe($: Engine, opts: Opts): Promise<SessionFile> {
  const id = await $.session.id()
  const id8 = id.slice(0, 8).toLowerCase()
  if (me && me.id8 === id8) return me
  if (clearFrom && clearFrom.slice(0, 8).toLowerCase() !== id8) {
    const from = clearFrom
    clearFrom = null
    return moveAfterClear($, opts, from, id)
  }
  me8 = id8
  const dir = hfDir(opts)
  const file = parseSessionFile(await $.fs.read(`${dir}/editor/${id8}.json`).catch(() => null))
  const title = file?.title || (await sessionTitle($).catch(() => ''))
  me = file ?? blankSession(id, safeWord(bareTitle(title) || `session-${id8}`), bareTitle(title), await $.clock.now())
  for (const d of me.delivered) delivered.add(d)
  for (const n of me.prsKnown ?? []) prsKnown.add(n)
  for (const slug of me.prBaseline ?? []) prBaseline.add(slug)
  for (const p of parseTouch(await $.fs.read(`${dir}/touch/${id8}.json`).catch(() => null))?.paths ?? []) touched.add(p)
  return me
}

/** A10: after /clear the process goes on under a new session id (no session.start fires). This session's file
 * (request, lease, yield asks, delivered notices), its touch file, its HELD/HANDED lock line (`session <new id8>`,
 * read-compare-write) and a sync it holds move to the new id, so it keeps driving the Editor it opened and nobody
 * sees a gone holder. The old file is left with no request, no lease and a zero heartbeat. */
async function moveAfterClear($: Engine, opts: Opts, oldSid: string, newSid: string): Promise<SessionFile> {
  const old8 = oldSid.slice(0, 8).toLowerCase()
  const new8 = newSid.slice(0, 8).toLowerCase()
  const dir = hfDir(opts)
  const now = await $.clock.now()
  const src = me && me.id8 === old8 ? me : parseSessionFile(await readJson($, `${dir}/editor/${old8}.json`))
  me8 = new8
  me = src ? { ...src, session: newSid, id8: new8, heartbeatAt: now } : blankSession(newSid, `session-${new8}`, '', now)
  for (const d of me.delivered) delivered.add(d)
  for (const n of me.prsKnown ?? []) prsKnown.add(n)
  for (const slug of me.prBaseline ?? []) prBaseline.add(slug)
  await saveMe($, opts, now)
  if (src) await $.fs.write(`${dir}/editor/${old8}.json`, JSON.stringify({ ...src, want: null, holding: null, yieldAsks: [], heartbeatAt: 0 })).catch(() => undefined)
  const t = parseTouch(await readJson($, `${dir}/touch/${old8}.json`))
  for (const p of t?.paths ?? []) touched.add(p)
  if (touched.size > 0) await $.fs.write(`${dir}/touch/${new8}.json`, JSON.stringify({ session: newSid, id8: new8, lane: me.lane, paths: [...touched].slice(-500), updatedAt: now })).catch(() => undefined)
  if (t) await $.fs.write(`${dir}/touch/${old8}.json`, JSON.stringify({ ...t, paths: [], updatedAt: now })).catch(() => undefined)
  lockRaw = await $.fs.read(opts.editorLock).catch(() => null)
  lock = parseLockLine(lockRaw)
  if (lockRaw && lock.id8 === old8 && (lock.kind === 'held' || lock.kind === 'handed')) {
    const line = lockRaw.trim().replace(new RegExp(`\\bsession\\s+${old8}\\b`, 'gi'), `session ${new8}`)
    if (!(await writeLock($, opts, line))) $.ui.log('a5: the lock changed while moving it to the cleared session id', { to: 'debug' })
  }
  const s = parseSyncFile(await readJson($, syncPath(opts)))
  if (s && s.holder.id8 === old8 && isOpenPhase(syncPhase(s, now)))
    await writeSync($, opts, { ...s, holder: { ...s.holder, session: newSid, id8: new8 }, plannedBy: s.plannedBy.replace(old8, new8), updatedAt: now }, s)
  return me
}

/** While session.end runs the old id is still current: wait for the new one (as Ather's followClear does), then
 * run a tick, whose restoreMe moves this session's files, lock line and sync to it. */
function followClear($: Engine, opts: Opts, oldSid: string, tries: number): void {
  $.clock.after(200, () => {
    void $.session
      .id()
      .then(sid => {
        if (sid !== oldSid) return runTick($, opts)
        if (tries > 0) followClear($, opts, oldSid, tries - 1)
        return undefined
      })
      .catch(() => undefined)
  })
}

/** Writes this session's file (its heartbeat with it); one writer: this session. */
async function saveMe($: Engine, opts: Opts, at?: number): Promise<void> {
  if (!me) return
  const now = at ?? (await $.clock.now())
  me = { ...me, heartbeatAt: now, delivered: [...delivered].slice(-200), prsKnown: [...prsKnown].slice(-500), prBaseline: [...prBaseline].slice(-100), yieldAsks: me.yieldAsks.filter(a => now - a.at < YIELD_EVERY_MS) }
  await $.fs.write(`${hfDir(opts)}/editor/${me.id8}.json`, JSON.stringify(me)).catch(err => $.ui.log(`a5: session file not written: ${String(err)}`, { to: 'debug' }))
}

async function readJson($: Engine, path: string): Promise<string | null> {
  return $.fs.read(path).catch(() => null)
}

/** A fresh machine reading (a grant, the cleanup, a release), published to the shared probe file for the others. */
async function freshProbe($: Engine, opts: Opts): Promise<Probe | null> {
  const ran = await $.process.run(ramProbe(s2Root(opts).slice(0, 1)), { timeoutMs: 20_000 }).catch(() => null)
  const p = ran ? parseProbe(ran.stdout) : null
  if (p) await $.fs.write(`${hfDir(opts)}/probe.json`, JSON.stringify({ at: await $.clock.now(), by: me8, probe: p })).catch(() => undefined)
  return p
}

/** A9: the machine reading every A5 session shares. A session probes only when Saved/A5/probe.json is older
 * than 50 s, and only after claiming it by read-compare-write and a re-read, so two sessions rarely both probe;
 * everyone else reads the file. */
async function sharedProbe($: Engine, opts: Opts, now: number): Promise<Probe | null> {
  const path = `${hfDir(opts)}/probe.json`
  const raw = await readJson($, path)
  const cur = parseSharedProbe(raw)
  if (cur?.probe && now - cur.at < PROBE_FRESH_MS) return cur.probe
  const claim = JSON.stringify({ at: now, by: me8, probe: cur?.probe ?? null })
  const again = await readJson($, path)
  if (again !== raw) return parseSharedProbe(again)?.probe ?? cur?.probe ?? null // another session claimed it first
  await $.fs.write(path, claim).catch(() => undefined)
  const mine = await readJson($, path)
  if (mine !== claim) return parseSharedProbe(mine)?.probe ?? cur?.probe ?? null
  return (await freshProbe($, opts)) ?? cur?.probe ?? null
}

/** Everything the decisions read: the lock, every session file, Ather's lanes, the sync plan, the touch files
 * and the shared machine reading. */
async function readWorld($: Engine, opts: Opts): Promise<void> {
  const root = s2Root(opts)
  const dir = hfDir(opts)
  const now = await $.clock.now()
  const [raw, list, laneList, syncText, touchList, shared] = await Promise.all([
    $.fs.read(opts.editorLock).catch(() => null),
    $.fs.list(`${dir}/editor`).catch(() => []),
    $.fs.list(`${root}/Saved/AtherAutomata/lanes`).catch(() => []),
    readJson($, `${dir}/sync.json`),
    $.fs.list(`${dir}/touch`).catch(() => []),
    sharedProbe($, opts, now),
  ])
  lockRaw = raw
  lock = parseLockLine(raw)
  const jsons = <T>(entries: { name: string; kind: string }[]) => entries.filter(f => f.kind === 'file' && f.name.endsWith('.json')) as T[]
  const files = await Promise.all(jsons<{ name: string }>(list).map(async f => parseSessionFile(await readJson($, `${dir}/editor/${f.name}`))))
  peers = files.filter((f): f is SessionFile => f !== null && f.id8 !== me8)
  lanes = (
    await Promise.all(
      jsons<{ name: string; mtimeMs: number }>(laneList).map(async (f): Promise<LaneBeat | null> => {
        try {
          const v = JSON.parse((await readJson($, `${root}/Saved/AtherAutomata/lanes/${f.name}`)) ?? '') as { sessionId?: string; hasEnded?: boolean; intent?: unknown; branch?: unknown; lastActiveAt?: unknown }
          const activeAt = Number(v.lastActiveAt)
          return { sessionId: String(v.sessionId ?? f.name.replace(/\.json$/, '')), hasEnded: v.hasEnded === true, mtimeMs: f.mtimeMs, intent: typeof v.intent === 'string' ? v.intent : '', branch: typeof v.branch === 'string' ? v.branch : '', ...(Number.isFinite(activeAt) && activeAt > 0 ? { lastActiveAt: activeAt } : {}) }
        } catch {
          return null // a half-written heartbeat; the next tick reads it
        }
      }),
    )
  ).filter((l): l is LaneBeat => l !== null)
  syncFile = parseSyncFile(syncText)
  touches = (await Promise.all(jsons<{ name: string }>(touchList).map(async f => parseTouch(await readJson($, `${dir}/touch/${f.name}`))))).filter((t): t is Touch => t !== null && t.id8 !== me8)
  probe = shared
}

// A26: session titles from Claude Code's records, looked up off the render, at most every 10 min per session.
const sessionNames = new Map<string, string>()
const namesAt = new Map<string, number>()
const NAME_TTL_MS = 2 * 60_000 // A31: a rename shows within two minutes
let isNaming = false

/** This checkout's records folder under Claude Code's config (`<config>/projects/<root with - for each other
 * character>`; any letter case), or ''. */
async function recordsDir($: Engine, opts: Opts): Promise<string> {
  const slash = (v: string | undefined | null) => (v ?? '').replace(/\\/g, '/')
  const home = slash(await $.env.get('USERPROFILE').catch(() => '')) || slash(await $.env.get('HOME').catch(() => ''))
  const config = slash(await $.env.get('CLAUDE_CONFIG_DIR').catch(() => '')) || (home ? `${home}/.claude` : '')
  if (!config) return ''
  const want = projectFolder(s2Root(opts))
  const all = (await $.fs.list(`${config}/projects`).catch(() => [])).filter(d => d.kind === 'dir')
  const hit = all.find(d => d.name === want) ?? all.find(d => d.name.toLowerCase() === want.toLowerCase())
  return hit ? `${config}/projects/${hit.name}` : ''
}

/** The title lines of one record: grep, or PowerShell where there is none (as Ather's transcripts.mjs does). */
async function titleLines($: Engine, path: string): Promise<string> {
  const pattern = '"(customTitle|aiTitle)":"[^"]*"'
  const grep = await $.process.run(['grep', '-oE', pattern, path], { timeoutMs: 15_000 }).catch(() => null)
  if (grep && (grep.exitCode === 0 || grep.exitCode === 1)) return grep.stdout
  const select = `Select-String -LiteralPath '${path.replace(/'/g, "''")}' -Pattern '${pattern}' -AllMatches | ForEach-Object { $_.Matches.Value }`
  const ps = await $.process.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', select], { timeoutMs: 20_000 }).catch(() => null)
  return ps?.exitCode === 0 ? ps.stdout : ''
}

/** A26: names for the live sessions whose a5 file gives none (Ather-only sessions), from their records. */
async function refreshNames($: Engine, opts: Opts, ids: string[]): Promise<void> {
  if (isNaming) return
  isNaming = true
  try {
    const now = await $.clock.now()
    const todo = ids.filter(id8 => now - (namesAt.get(id8) ?? 0) > NAME_TTL_MS)
    if (todo.length === 0) return
    for (const id8 of todo) namesAt.set(id8, now)
    const dir = await recordsDir($, opts)
    if (!dir) return
    const list = await $.fs.list(dir).catch(() => [])
    for (const id8 of todo) {
      const f = list.find(x => x.kind === 'file' && x.name.toLowerCase().startsWith(id8) && x.name.endsWith('.jsonl'))
      const title = f ? titleFromRecord(await titleLines($, `${dir}/${f.name}`)) : ''
      if (title) sessionNames.set(id8, title)
    }
    $.ui.invalidate('ui.render')
  } finally {
    isNaming = false
  }
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
  await $.prompt.submit({ text: texts.join('\n\n') }).catch(err => $.ui.log(`a5: notice prompt not queued: ${String(err)}`, { to: 'debug' }))
}

/** The model tools, registered the first time A5 is seen on in this session (D1: none while it is off). */
async function ensureTools($: Engine): Promise<void> {
  if (hasTools) return
  hasTools = true
  await $.tool.register({
    name: 'editor',
    description:
      'a5 A5 Editor holder for the shared S2 checkout: the only way to take or give the Unreal Editor while A5 is on. ' +
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
        launch: { type: 'boolean', description: 'request: false when the slot never launches the Editor (it holds the lock to keep the Editor down, as the sync worker does): the RAM launch gate is skipped.' },
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
  }).catch(err => $.ui.log(`a5: editor tool not registered: ${String(err)}`, { to: 'debug' }))
  await $.tool.register({
    name: 'sync',
    description:
      'a5 A5 Sync main holder for the shared S2 checkout: plans a merge of origin/main and its timeline. At the cutoff (sync − 30 min) every session is told to commit its own paths, write its resume note and release the Editor by sync − 10; ' +
      'from the sync time until done or abort, other sessions are refused git writes and Editor use in the shared checkout; the freeze is a lease with a hard end (T + 45 min, T + 90 min with a build), after which the sync expires and Hai is asked. At the sync time the holder\'s a5 starts the sync worker, which runs the merge and ends with done or abort. ' +
      '"plan" (at HH:MM, build, holder: a session id8 or lane, default this session; a sync this session holds is moved), "move", "build" (build: true/false, before the freeze), "cancel" (before the freeze), "conflicts" (paths: the conflicted paths when the automatic dry-run could not run), "done" (note), "abort" (note: why), "status". Only the holder changes a planned sync.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['plan', 'move', 'build', 'cancel', 'conflicts', 'done', 'abort', 'status'] },
        build: { type: 'boolean', description: 'plan, move, build: the sync includes a build (a longer freeze).' },
        at: { type: 'string', description: 'plan, move: the sync time, HH:MM (the next time it comes round).' },
        holder: { type: 'string', description: 'plan: the session that will run the merge (its first 8 hex or its lane); default this session.' },
        paths: { type: 'array', items: { type: 'string' }, description: 'conflicts: repo-relative conflicted paths.' },
        note: { type: 'string', description: 'done, abort: one line (what merged, or why it was aborted).' },
      },
      required: ['action'],
    },
  }).catch(err => $.ui.log(`a5: sync tool not registered: ${String(err)}`, { to: 'debug' }))
  // D7: the sync worker's agent type, spawned by this mod at the sync time and hidden from the model (agent.offer).
  await $.agent.register({ name: 'sync', description: 'a5 sync worker: runs the planned merge of origin/main into the shared S2 checkout at the sync time and ends it with done or abort. Started by a5 only.', prompt: SYNC_WORKER_PROMPT, background: true }).catch(err => $.ui.log(`a5: sync worker type not registered: ${String(err)}`, { to: 'debug' }))
}

/** D7: at T the holder's a5 starts the sync worker, once per sync (sync.json records it before the spawn,
 * so a reload or a second tick never starts another). */
async function spawnWorker($: Engine, opts: Opts, s: SyncFile, now: number): Promise<void> {
  if (!(await writeSync($, opts, { ...s, workerAt: now, updatedAt: now }, s))) return
  const claimed = syncFile ?? s
  const ran = await $.agent.spawn({ subagentType: SYNC_AGENT, description: `Sync main ${clockOf(s.at)}`, prompt: syncWorkerTask(claimed, s2Root(opts), (lockRaw ?? '').trim()) }).catch(err => ({ deny: String(err) }))
  if (ran.deny !== undefined) {
    push({ id: `sync:${s.id}:${s.at}:worker-failed`, text: NOTICES.workerFailed(claimed, ran.deny), isActionable: true })
    return
  }
  // The spawn names its agent; where it does not, the session's agent list does (the newest sync worker this mod started).
  const id = ran.agentId ?? (await $.agent.list().catch(() => [])).filter(a => a.type === SYNC_AGENT && a.spawnedBy === 'a5').pop()?.id
  if (id) await writeSync($, opts, { ...claimed, workerId: id, updatedAt: now }, claimed)
}

/** A12: the worker's turn ended; if the sync is still open it ended without done or abort, so the sync is aborted
 * for it and the holder told (the freeze must never outlive its worker). */
async function workerEnded($: Engine, opts: Opts, agentId: string, answer: string): Promise<void> {
  const s = parseSyncFile(await readJson($, syncPath(opts)))
  if (!s || s.state !== 'planned' || s.workerAt === null || s.holder.id8 !== me8) return
  if (s.workerId !== agentId) {
    // No id was recorded (or another agent ended): it is the worker only if the agent list says it ran as one.
    if (s.workerId !== null) return
    const agent = (await $.agent.list().catch(() => [])).find(a => a.id === agentId)
    if (agent?.type !== SYNC_AGENT) return
  }
  const now = await $.clock.now()
  const ended = endedSync(s, 'aborted', `the sync worker ended without done or abort${answer ? `: ${answer.replace(/\s+/g, ' ').slice(0, 140)}` : ''}`, now)
  await $.fs.write(syncPath(opts), JSON.stringify(ended))
  syncFile = ended
  delivered.add(noticeIds.lifted(ended)) // the holder hears the worker's end instead of the lift
  push({ id: `sync:${s.id}:${s.at}:worker-ended`, text: NOTICES.workerEnded(ended), isActionable: true })
}

/** One minute tick, serialized with the tool's own runs: read, decide, write this session's files, notify. */
function runTick($: Engine, opts: Opts): Promise<void> {
  tickChain = tickChain.then(() => tick($, opts)).catch(err => $.ui.log(`a5 tick: ${String(err)}`, { to: 'debug' }))
  return tickChain
}

async function tick($: Engine, opts: Opts): Promise<void> {
  await readTheme($)
  if ((await readA5($)) && !isScoring && (prDirty || (await $.clock.now()) - shipCheckedAt >= SHIP_CHECK_MS)) await refreshAccept($, opts)
  if (!(await readA5($))) {
    showStatus($)
    return
  }
  if (!(await $.fs.exists(s2Root(opts)))) return // no S2 checkout on this machine
  await ensureTools($)
  await restoreMe($, opts)
  const now = await $.clock.now()
  nowMs = now
  await readWorld($, opts)
  gates = gatesOf(await $.store.get('gates').catch(() => null), opts.launchGatePieGb, opts.launchGateGb)
  await refreshClients($, opts, now)
  await editorStep($, opts, now)
  await syncStep($, opts, now)
  await mergeGuardStep($, opts, now)
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
  if (d.kind === 'grant') {
    // A grant reads the machine itself, not the shared reading (A9).
    probe = (await freshProbe($, opts)) ?? probe
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
 * a5 (a field in this session's file it reads), or the standard `UE request:` line to a holder without it. */
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
    if (!sent.isDelivered) $.ui.log(`a5: UE request to ${y.holder} not delivered: ${sent.reason}`, { to: 'debug' })
  }
  me = { ...me, yieldAsks: [...me.yieldAsks, { holder: y.holder, at: now, via: withMod ? 'file' : 'send', minutes: want.minutes, lane: me.lane }] }
}

/** The safe cleanup before a grant: the S2 orphan-git reaper under 14 GB, LiveCodingConsole stopped only while
 * no Editor runs (checked again by a fresh probe); every other process is named and left alone. */
async function runCleanup($: Engine, opts: Opts, plan: ReturnType<typeof cleanupPlan>, now: number): Promise<void> {
  const before = probe?.freeGb ?? 0
  const done: string[] = []
  if (plan.stopLiveCoding.length > 0) {
    const fresh = await freshProbe($, opts)
    if (fresh && editorPid(fresh) === null) {
      await $.process.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', `Stop-Process -Id ${plan.stopLiveCoding.join(',')} -ErrorAction SilentlyContinue`], { timeoutMs: 15_000 }).catch(() => null)
      done.push(`stopped LiveCodingConsole (pid ${plan.stopLiveCoding.join(', ')})`)
    }
  }
  if (plan.reap) {
    await $.process.run(['powershell', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', `${s2Root(opts)}/.agents/skills/git-poller-storm/scripts/reap-orphan-git.ps1`], { timeoutMs: 60_000 }).catch(() => null)
    done.push('ran the orphan-git reaper')
  }
  probe = (await freshProbe($, opts)) ?? probe
  cleanupAt = now
  cleanupNote = [`${clockOf(now)} ${done.join(', ') || 'nothing to clean'}: free ${before} → ${probe?.freeGb ?? '?'} GB`, ...plan.report].join('; ')
}

// ---------- Sync main holder: Saved/A5/sync.json, written by the holder alone ----------
const syncPath = (opts: Opts): string => `${hfDir(opts)}/sync.json`
const isLive = (id8: string, now: number): boolean => livenessOf(id8, me ? [me, ...peers] : peers, lanes, now) !== 'gone'
/** The sync's phase for every reader alike, the freeze lease included (D8: hard end, holder gone). */
const phaseOf = (s: SyncFile | null, now: number): Phase => syncPhase(s, now, isSyncHolderGone(s, me ? [me, ...peers] : peers, lanes, now))
/** D8: how long a freeze may last past T, from the plugin options. */
const freezeMinutes = (opts: Opts, build: boolean): number => {
  const v = Number(build ? opts.syncBuildMinutes : opts.syncMergeMinutes)
  return Number.isFinite(v) && v >= 10 && v <= 480 ? Math.round(v) : build ? SYNC_BUILD_MIN : SYNC_MERGE_MIN
}

/** One session raises an alert that every session sees (a 🟥 for Hai): the first to create its alert file wins. */
async function claimAlert($: Engine, opts: Opts, key: string): Promise<boolean> {
  const path = `${hfDir(opts)}/alerts/${key.replace(/[^\w.-]+/g, '_')}.json`
  if (await $.fs.exists(path)) return false
  const mine = JSON.stringify({ by: me8, at: await $.clock.now() })
  await $.fs.write(path, mine).catch(() => undefined)
  return (await readJson($, path)) === mine
}

/** A 🟥 for Hai from the coordination layer: the title, unread and one PENDING.md line (decision.ts). */
async function raiseRed($: Engine, opts: Opts, question: string, fallback: string): Promise<void> {
  await applyMarker($, opts, { kind: 'decision', question, fallback }, false).catch(err => $.ui.log(`a5: 🟥 not raised: ${String(err)}`, { to: 'debug' }))
}

/** D8: a freeze past its hard end, or whose holder is gone, is written down as expired (a terminal state any
 * session may write, read-compare-write; writing it twice is harmless), and the session whose alert file wins
 * raises the 🟥. */
async function expireSync($: Engine, opts: Opts, s: SyncFile, now: number): Promise<SyncFile> {
  const why = now >= s.hardEnd ? `its hard end ${clockOf(s.hardEnd)} passed` : `its holder ${s.holder.lane} (session ${s.holder.id8}) is gone`
  const cur = parseSyncFile(await readJson($, syncPath(opts)))
  if (!cur || cur.id !== s.id || cur.state !== 'planned') return cur ?? s
  const ended = endedSync(cur, 'expired', why, now)
  await $.fs.write(syncPath(opts), JSON.stringify(ended))
  syncFile = ended
  if (await claimAlert($, opts, `sync-expired-${s.id}-${s.at}`)) await raiseRed($, opts, NOTICES.expiredRed(ended, why), 'git and the Editor stay open; nobody touches the merge state until Hai decides')
  return ended
}

/** Writes the sync plan, unless another session has become its holder since this one read it (one writer). */
async function writeSync($: Engine, opts: Opts, next: SyncFile, prior: SyncFile | null): Promise<boolean> {
  const now = parseSyncFile(await readJson($, syncPath(opts)))
  if (now && prior && now.id === prior.id && now.updatedAt !== prior.updatedAt && now.holder.id8 !== me8) return false
  await $.fs.write(syncPath(opts), JSON.stringify(next))
  syncFile = next
  return true
}

/** The session a plan names as holder: this one by default, else a live session by its first hex or its lane. */
function holderFor(spec: string, now: number): SyncHolder | null {
  if (!me) return null
  const s = spec.trim().toLowerCase()
  if (!s || s === me8 || s === me.lane.toLowerCase()) return { session: me.session, id8: me8, lane: me.lane }
  const f = peers.find(p => (p.id8.startsWith(s) || p.lane.toLowerCase() === s) && now - p.heartbeatAt <= HEARTBEAT_STALE_MS)
  return f ? { session: f.session, id8: f.id8, lane: f.lane } : null
}

/** Rule 11 for each conflicted path: main's blob against every blob this branch had (one rev-parse and one log). */
async function classifyAll($: Engine, opts: Opts, paths: readonly string[]): Promise<Conflict[]> {
  const repo = s2Root(opts)
  const git = async (args: string[]): Promise<string> => {
    const r = await $.process.run(['git', '-C', repo, ...args], { timeoutMs: 30_000 }).catch(() => null)
    return r && r.exitCode === 0 ? r.stdout : ''
  }
  const out: Conflict[] = []
  for (const p of paths.slice(0, MAX_CLASSIFIED)) {
    const main = (await git(['rev-parse', `origin/main:${p}`])).trim()
    out.push(classify(p, main, historyBlobs(await git(['log', '--format=%H', '--raw', '--no-abbrev', '--max-count=200', 'HEAD', '--', p]))))
  }
  return [...out, ...paths.slice(MAX_CLASSIFIED).map(p => ({ path: p, kind: 'foreign' as const }))]
}

/** At the cutoff the holder's a5 dry-runs the merge against the last fetched origin/main (no fetch, 60 s). */
async function dryRun($: Engine, opts: Opts, s: SyncFile, now: number): Promise<void> {
  const r = await $.process.run(['git', '-C', s2Root(opts), 'merge-tree', '--write-tree', '--name-only', 'HEAD', 'origin/main'], { timeoutMs: 60_000 }).catch(() => null)
  if (!r || (r.exitCode !== 0 && r.exitCode !== 1)) {
    push({ id: `sync:${s.id}:${s.at}:dry-run-failed`, text: noticeText('Sync main', `the conflict dry-run (git merge-tree) did not finish${r ? ` (exit ${r.exitCode})` : ' within 60 s'}`, `run git -C ${s2Root(opts)} merge-tree --write-tree --name-only HEAD origin/main yourself and pass the conflicted paths with the sync tool (action conflicts)`), isActionable: true })
    return
  }
  const conflicts = r.exitCode === 0 ? [] : await classifyAll($, opts, parseMergeTree(r.stdout).paths)
  const untracked = await addedOnDisk($, opts, s)
  const next = withConflicts(s, conflicts, 'merge-tree', now)
  await writeSync($, opts, untracked === null ? next : withUntracked(next, untracked, now), s)
}

/** A11: the files origin/main adds that already exist on disk in the shared checkout ("untracked would be
 * overwritten", which merge-tree does not see): each added path is checked on its own, never a whole-tree
 * untracked scan. Null when git could not list them (the holder is told). */
async function addedOnDisk($: Engine, opts: Opts, s: SyncFile): Promise<string[] | null> {
  const repo = s2Root(opts)
  const r = await $.process.run(['git', '-C', repo, 'diff', '--name-only', '-z', '--diff-filter=A', 'HEAD', 'origin/main'], { timeoutMs: 60_000 }).catch(() => null)
  if (!r || r.exitCode !== 0) {
    push({ id: `sync:${s.id}:${s.at}:added-failed`, text: noticeText('Sync main', 'the list of files origin/main adds (git diff --diff-filter=A) did not finish', `run git -C ${repo} diff --name-only --diff-filter=A HEAD origin/main yourself and check which of those paths already exist in the checkout before the merge`), isActionable: true })
    return null
  }
  const added = parseAdded(r.stdout).slice(0, MAX_ADDED_CHECKED)
  const found: string[] = []
  for (let i = 0; i < added.length; i += 50) {
    const batch = added.slice(i, i + 50)
    const hits = await Promise.all(batch.map(p => $.fs.exists(`${repo}/${p}`).catch(() => false)))
    batch.forEach((p, n) => hits[n] && found.push(p))
  }
  return found
}

/** The sync's timeline for this session: who holds it, the cutoff, release by T − 10, the freeze, the conflicts
 * that touch this session's paths, and the lift; the holder also dry-runs the merge at the cutoff. */
async function syncStep($: Engine, opts: Opts, now: number): Promise<void> {
  let s = syncFile
  if (!s || !me) return
  let phase = phaseOf(s, now)
  if (s.state === 'planned' && phase === 'expired') {
    s = await expireSync($, opts, s, now)
    phase = phaseOf(s, now)
  }
  const isHolder = s.holder.id8 === me8
  if (isHolder && phase === 'frozen' && now >= s.hardEnd - HARD_END_WARN_MS) push({ id: noticeIds.hardEndSoon(s), text: NOTICES.hardEndSoon(s), isActionable: true })
  if (isHolder && isOpenPhase(phase) && !s.plannedBy.includes(me8)) push({ id: noticeIds.holderNamed(s), text: NOTICES.syncHolderNamed(s), isActionable: true })
  if (phase === 'cutoff') push({ id: noticeIds.cutoff(s), text: NOTICES.cutoff(s, isHolder, holdsLock()), isActionable: true })
  if (!isHolder && holdsLock() && ((phase === 'cutoff' && now >= s.at - RELEASE_BEFORE_MS) || phase === 'frozen')) push({ id: noticeIds.releaseBy(s), text: NOTICES.releaseBy(s), isActionable: true })
  if (phase === 'frozen') push({ id: noticeIds.frozen(s), text: isHolder ? NOTICES.frozenHolder(s) : NOTICES.frozen(s), isActionable: false })
  if (isHolder && phase === 'frozen' && s.workerAt === null) {
    await spawnWorker($, opts, s, now)
    s = syncFile ?? s
  }
  if (!isOpenPhase(phase)) {
    // The lift reaches the sessions that were told of this sync, and only for a while after it ended.
    const stale = [noticeIds.cutoff(s), noticeIds.frozen(s), noticeIds.releaseBy(s)]
    const wasTold = stale.some(id => delivered.has(id) || pending.some(n => n.id === id))
    if (wasTold && now - (s.endedAt ?? s.updatedAt) < 6 * 3_600_000) {
      // The lift supersedes what this session was still to be told about the same sync.
      for (const id of stale) if (pending.some(n => n.id === id)) delivered.add(id)
      pending = pending.filter(n => !stale.includes(n.id))
      push({ id: noticeIds.lifted(s), text: s.state === 'expired' ? NOTICES.expired(s) : NOTICES.lifted(s), isActionable: true })
    }
    return
  }
  if (isHolder && (phase === 'cutoff' || phase === 'frozen')) {
    await messageNoMod($, opts, s, now)
    s = syncFile ?? s
  }
  if (isHolder && phase !== 'planned' && s.conflicts === null && !dryRuns.has(`${s.id}:${s.at}`)) {
    dryRuns.add(`${s.id}:${s.at}`)
    await dryRun($, opts, s, now)
  }
  const sync = syncFile?.id === s.id ? syncFile : s
  const lower = new Set([...touched].map(p => p.toLowerCase()))
  const all = [...touches, { session: me.session, id8: me8, lane: me.lane, paths: [...touched], updatedAt: now }]
  const cs = sync.conflicts
  if (cs && cs.length > 0) {
    const minePaths = cs.filter(c => lower.has(c.path.toLowerCase()))
    if (minePaths.length > 0) push({ id: noticeIds.conflicts(sync, minePaths.map(c => c.path)), text: NOTICES.ownerConflicts(sync, minePaths), isActionable: true })
    if (isHolder) {
      const rows = cs.map(c => ({ c, owners: ownersOf(c.path, all).map(t => t.lane) }))
      push({ id: `${noticeIds.conflicts(sync, cs.map(c => c.path))}:holder`, text: NOTICES.holderConflicts(sync, rows), isActionable: true })
    }
  }
  // A11: each untracked file main would overwrite goes to the session whose touch file names it; the holder
  // gets the whole list, with "owner unknown" where nobody's touch file names it.
  const un = sync.untracked
  if (un && un.length > 0) {
    const mineUn = un.filter(p => lower.has(p.toLowerCase()))
    if (mineUn.length > 0) push({ id: noticeIds.untracked(sync, mineUn), text: NOTICES.ownerUntracked(sync, mineUn), isActionable: true })
    if (isHolder) push({ id: `${noticeIds.untracked(sync, un)}:holder`, text: NOTICES.holderUntracked(sync, un.map(path => ({ path, owners: ownersOf(path, all).map(t => t.lane) }))), isActionable: true })
  }
}

/** Plan, move, cancel, take over, record conflicts, end: the one place sync.json changes (panel, /a5 sync, tool). */
async function syncAction($: Engine, opts: Opts, action: string, a: { at?: string; holder?: string; note?: string; paths?: string[]; build?: boolean }): Promise<string> {
  const gate = 'Sync main'
  if (!(await readA5($))) return blocked(gate, 'A5 is off', 'turn A5 on (/a5 on) to plan a sync')
  if (!(await $.fs.exists(s2Root(opts)))) return blocked(gate, `no S2 checkout at ${s2Root(opts)}`, 'set the editorLock option to the checkout\'s Saved/EDITOR_OWNER.txt')
  await restoreMe($, opts)
  if (!me) return 'no session file'
  const now = await $.clock.now()
  await readWorld($, opts)
  const s = syncFile
  const phase = phaseOf(s, now)
  const open = isOpenPhase(phase)
  const isMine = s?.holder.id8 === me8
  const isGone = s ? !isLive(s.holder.id8, now) : false
  const when = (x: SyncFile) => `the sync at ${clockOf(x.at)} (holder ${x.holder.lane}, session ${x.holder.id8})`
  const notHolder = (x: SyncFile) => blocked(gate, `${when(x)} is held by another live session; only its holder changes it`, `ask that session (${x.holder.lane}) to ${action === 'cancel' ? 'cancel' : action === 'move' || action === 'plan' ? 'move' : 'end'} it`)
  const planned = (x: SyncFile) =>
    `${when(x)}${x.build ? ', with a build' : ''}: cutoff ${clockOf(x.at - CUTOFF_MS)} (every session commits its own paths, writes its resume note, releases the Editor by ${clockOf(x.at - RELEASE_BEFORE_MS)}); from ${clockOf(x.at)} git writes and the Editor freeze for everyone but the holder until done or abort, at the latest until ${clockOf(x.hardEnd)} (its hard end: then it expires and Hai is asked).`
  if (action === 'plan' || action === 'move') {
    const at = atNext(a.at ?? '', now)
    if (at === null) return blocked(gate, `"${a.at ?? ''}" is not a time`, 'give HH:MM, for example /a5 sync 16:00')
    if (s && open) {
      if (!isMine && !isGone) return notHolder(s)
      if (phase === 'frozen') return blocked(gate, `${when(s)} is frozen already`, 'finish it with done or abort first')
      const base = movedSync({ ...s, holder: isMine ? s.holder : { session: me.session, id8: me8, lane: me.lane } }, at, now)
      const moved = a.build === undefined ? base : withBuild(base, a.build, freezeMinutes(opts, a.build), now)
      if (!(await writeSync($, opts, moved, s))) return blocked(gate, 'sync.json changed while moving it', 'read it with status and try again')
      return `moved: ${planned(moved)}`
    }
    if (action === 'move') return blocked(gate, 'no sync is planned', 'plan one with /a5 sync HH:MM or the panel')
    const holder = holderFor(a.holder ?? '', now)
    if (!holder) return blocked(gate, `no live session named "${a.holder}"`, 'name a session by its first 8 hex or its lane, or leave it out to hold the sync yourself')
    const build = a.build === true
    const next = newSync(at, holder, `${me.lane} (session ${me8})`, now, build, freezeMinutes(opts, build))
    if (!(await writeSync($, opts, next, s))) return blocked(gate, 'sync.json changed while planning', 'read it with status and try again')
    return `planned: ${planned(next)}${at - now < CUTOFF_MS ? ' The cutoff is already past: every session is told now.' : ''}`
  }
  if (action === 'status') {
    if (!s) return 'No sync planned. Plan one on the A5 panel or with /a5 sync HH:MM.'
    return `${when(s)}: ${phase}${isOpenPhase(phase) ? ` (freeze ${clockOf(s.at)}–${clockOf(s.hardEnd)}${s.build ? ', with a build' : ''})` : ''}${isGone && isOpenPhase(phase) ? ' (its holder is gone: take it over from the panel or with /a5 sync takeover)' : ''}${s.conflicts ? ` · conflicts: ${s.conflicts.length ? s.conflicts.map(c => `${c.path} (${c.kind})`).join(', ') : 'none'}` : ''}${s.untracked ? ` · untracked main would overwrite: ${s.untracked.length ? s.untracked.join(', ') : 'none'}` : ''}${s.note ? ` · ${s.note}` : ''}`
  }
  if (!s || !open) return blocked(gate, 'no sync is planned', 'plan one with /a5 sync HH:MM or the panel')
  if (action === 'takeover') {
    if (isMine) return `this session already holds ${when(s)}`
    if (!isGone) return notHolder(s)
    const taken = { ...s, holder: { session: me.session, id8: me8, lane: me.lane }, updatedAt: now }
    return (await writeSync($, opts, taken, s)) ? `taken over: ${planned(taken)}` : blocked(gate, 'sync.json changed while taking it over', 'read it with status')
  }
  if (!isMine && !isGone) return notHolder(s)
  const mine = isMine ? s : { ...s, holder: { session: me.session, id8: me8, lane: me.lane } }
  if (action === 'conflicts') {
    const paths = (a.paths ?? []).map(p => p.replace(/\\/g, '/').trim()).filter(Boolean)
    const next = withConflicts(mine, await classifyAll($, opts, paths), 'holder', now)
    if (!(await writeSync($, opts, next, s))) return blocked(gate, 'sync.json changed', 'read it with status and try again')
    return `recorded ${paths.length} conflicted path${paths.length === 1 ? '' : 's'}: ${(next.conflicts ?? []).map(c => `${c.path} (${c.kind}${c.match ? `, main holds our ${c.match}` : ''})`).join(', ') || 'none'}; the sessions that edited them are told at their next tick`
  }
  if (action === 'build') {
    if (phase === 'frozen') return blocked(gate, `${when(s)} is frozen already`, 'its hard end stays as it is')
    const build = a.build ?? !s.build
    const next = withBuild(mine, build, freezeMinutes(opts, build), now)
    return (await writeSync($, opts, next, s)) ? `${build ? 'with' : 'without'} a build: ${planned(next)}` : blocked(gate, 'sync.json changed', 'read it with status')
  }
  if (action === 'cancel') {
    if (phase === 'frozen') return blocked(gate, `${when(s)} is frozen already`, 'end it with done or abort')
    return (await writeSync($, opts, endedSync(mine, 'cancelled', a.note ?? '', now), s)) ? `cancelled ${when(s)}; every session told of it hears it is off` : blocked(gate, 'sync.json changed', 'read it with status')
  }
  if (action === 'done' || action === 'abort') {
    if (action === 'done' && phase !== 'frozen') return blocked(gate, `${when(s)} has not started (it starts at ${clockOf(s.at)})`, 'move or cancel it instead')
    const ended = endedSync(mine, action === 'done' ? 'done' : 'aborted', a.note ?? '', now)
    if (!(await writeSync($, opts, ended, s))) return blocked(gate, 'sync.json changed', 'read it with status')
    delivered.add(noticeIds.lifted(ended)) // the holder ended it itself: no lift notice back to it
    return `${action === 'done' ? 'done' : 'aborted'}: git and the Editor are open again for every session; each one is told at its next tick`
  }
  return blocked(gate, `unknown action "${action}"`, 'use plan, move, cancel, takeover, conflicts, done, abort or status')
}

/** /a5 sync …: HH:MM [build] [for <session>] · move HH:MM · build on|off · cancel · done [note] · abort <why> ·
 * takeover · (status). */
async function syncCommand($: Engine, opts: Opts, rest: string): Promise<string> {
  const [verb = '', ...tail] = rest.trim().split(/\s+/)
  const word = verb.toLowerCase()
  if (/^\d{1,2}:\d{2}$/.test(verb)) {
    const build = tail.some(t => t.toLowerCase() === 'build')
    const forAt = tail.findIndex(t => t.toLowerCase() === 'for')
    return syncAction($, opts, 'plan', { at: verb, build, holder: forAt >= 0 ? tail.slice(forAt + 1).filter(t => t.toLowerCase() !== 'build').join(' ') : '' })
  }
  if (word === 'move') return syncAction($, opts, 'move', { at: tail[0] ?? '' })
  if (word === 'build') return syncAction($, opts, 'build', { build: (tail[0] ?? 'on').toLowerCase() !== 'off' })
  if (['cancel', 'done', 'abort', 'takeover'].includes(word)) return syncAction($, opts, word, { note: tail.join(' ') })
  return syncAction($, opts, 'status', {})
}

/** A16: the client's own session list (the desktop app's `list_sessions`, as `get_session` is already called), at
 * most every 5 minutes; without the tool (another client, a refusal) the overview falls back to lanes and files. */
async function refreshClients($: Engine, opts: Opts, now: number): Promise<void> {
  if (clientsAt > 0 && now - clientsAt < CLIENTS_EVERY_MS) return
  clientsAt = now
  const text = await callTool($, { tool: 'mcp__ccd_session_mgmt__list_sessions', limit: 50 }).catch(() => '')
  clients = text ? parseClients(text) : null
  for (const r of clients ?? []) {
    const key = r.cwd.toLowerCase()
    if (!s2Cwds.has(key)) s2Cwds.set(key, under(r.cwd, s2Root(opts)) || (r.cwd !== '' && (await $.fs.exists(`${r.cwd}/S2.uproject`).catch(() => false))))
  }
}

/** A16: at the cutoff the holder sends each live S2 session without a5 0.4 the standard message once (they
 * cannot be frozen), records them in sync.json, and its own notice names them. */
async function messageNoMod($: Engine, opts: Opts, s: SyncFile, now: number): Promise<void> {
  const targets = withoutModOf(me8, me ? [me, ...peers] : peers, lanes, now).filter(n => !s.messaged.includes(n.sessionId))
  if (targets.length === 0) return
  const rows: { n: NoMod; isDelivered: boolean }[] = []
  for (const n of targets) {
    const sent = await $.session.send({ to: { sessionId: n.sessionId }, text: noModMessage(s, s2Root(opts)) }).catch(err => ({ isDelivered: false as const, reason: String(err) }))
    rows.push({ n, isDelivered: sent.isDelivered })
  }
  await writeSync($, opts, { ...s, messaged: [...s.messaged, ...targets.map(t => t.sessionId)], updatedAt: now }, s)
  push({ id: noticeIds.withoutMod(s, targets.map(t => t.id8)), text: NOTICES.holderWithoutMod(s, rows), isActionable: false })
}

// ---------- A5 acceptance (nghiệm thu, A18): the five rules over the branch, before a PR and when an intent closes ----------
const PASS_ONCE = 'Let this PR through'

/** A22: what a PR tool's input names (repository `owner/name`, head and base branches), all optional. */
type PrRefs = { repo?: string; head?: string; base?: string }

/** Binaries left out of the added-lines diff (they carry no lines to score and make it big). */
const BINARY_EXCLUDES = ['uasset', 'umap', 'ubulk', 'uexp', 'png', 'jpg', 'jpeg', 'tga', 'exr', 'hdr', 'psd', 'fbx', 'abc', 'wav', 'ogg', 'mp4', 'dll', 'exe', 'pdb', 'lib', 'zip', '7z'].map(x => `:(exclude,icase)*.${x}`)

/** The added lines per file of `git diff -U0`. */
const addedLines = (diff: string): Map<string, string[]> => {
  const out = new Map<string, string[]>()
  let file = ''
  for (const l of diff.replace(/\r/g, '').split('\n')) {
    if (l.startsWith('+++ ')) file = l.replace(/^\+\+\+ (b\/)?/, '').trim()
    else if (l.startsWith('+') && file && file !== '/dev/null') out.set(file, [...(out.get(file) ?? []), l.slice(1)])
  }
  return out
}

/** The PR body a `gh pr create` / `gh api …/pulls` command carries (inline, or the file it names). */
async function prBody($: Engine, command: string, dir: string): Promise<string> {
  const toks = tokenize(command)
  for (let i = 0; i < toks.length; i += 1) {
    const t = toks[i] ?? ''
    const next = toks[i + 1] ?? ''
    if (t === '--body' || t === '-b') return next.replace(/\\n/g, '\n')
    if (t.startsWith('--body=')) return t.slice(7).replace(/\\n/g, '\n')
    if (t === '--body-file' || (t === '-F' && !next.includes('='))) return $.fs.read(norm(next, dir)).catch(() => '')
    if ((t === '-f' || t === '--raw-field' || t === '--field') && next.startsWith('body=')) return next.slice(5).replace(/\\n/g, '\n')
    if (t === '-F' && next.startsWith('body=@')) return $.fs.read(norm(next.slice(6), dir)).catch(() => '')
  }
  return ''
}

/** A18: everything the score reads, cheap and path-scoped: the branch diff against main (names and added lines),
 * the intent's four files, Ather's proof, the other sessions' touch files and active intents, this session's
 * untracked files in the shared checkout, worktrees on the same branch, running background agents. */
async function gatherAccept($: Engine, opts: Opts, a5: A5, root: string, slugHint: string | null, body: string, agentId: string | undefined, refs: PrRefs = {}): Promise<AcceptInput> {
  const git = async (args: string[]): Promise<string> => {
    const r = await $.process.run(['git', '-C', root, ...args], { timeoutMs: 30_000 }).catch(() => null)
    return r && r.exitCode === 0 ? r.stdout : ''
  }
  // The base is origin/main: a local main in the shared checkout can be far behind it, and main...HEAD would then
  // list everything main merged since as this branch's work. Local main only when origin/main is missing.
  const hasRef = async (ref: string) => (await $.process.run(['git', '-C', root, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { timeoutMs: 15_000 }).catch(() => null))?.exitCode === 0
  // A22: a PR tool names its base, head and repository; each is checked here, and one that cannot be read is no pass.
  const baseName = refs.base?.trim() || 'main'
  const base = (await hasRef(`origin/${baseName}`)) ? `origin/${baseName}` : (await hasRef(baseName)) ? baseName : null
  const headName = refs.head?.trim().replace(/^[^:/]+:/, '') || ''
  const head = !headName ? 'HEAD' : (await hasRef(headName)) ? headName : (await hasRef(`origin/${headName}`)) ? `origin/${headName}` : null
  const branch = headName || (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  const origin = refs.repo ? (await git(['remote', 'get-url', 'origin'])).trim() : ''
  const isOtherRepo = Boolean(refs.repo) && !origin.replace(/\.git$/i, '').toLowerCase().endsWith(`/${(refs.repo ?? '').toLowerCase()}`) && !origin.replace(/\.git$/i, '').toLowerCase().endsWith(`:${(refs.repo ?? '').toLowerCase()}`)
  const refProblem = isOtherRepo
    ? `the PR is for ${refs.repo}, not this session's repository (${origin || 'no origin remote'})`
    : !base
      ? `no origin/${baseName} or ${baseName} to diff against`
      : !head
        ? `head ${headName} is not in this repository (fetch it, or open the PR from its own checkout)`
        : null
  // An unread diff never passes: a failure, a timeout or a cut output is named, and nothing is scored.
  const whole = async (args: string[]): Promise<{ out: string; why: string | null }> => {
    const r = await $.process.run(['git', '-C', root, ...args], { timeoutMs: 30_000 }).catch(() => null)
    if (!r) return { out: '', why: `git ${args[0]} ${args[1]} timed out or did not start` }
    if (r.exitCode !== 0) return { out: '', why: `git ${args[0]} ${args[1]} exited ${r.exitCode}` }
    if (r.isStdoutTruncated) return { out: '', why: `git ${args[0]} ${args[1]} output passed 4 MiB` }
    return { out: r.stdout, why: null }
  }
  const range = `${base}...${head}`
  const names = refProblem ? { out: '', why: refProblem } : await whole(['diff', '--name-only', range])
  const text = !names.why ? await whole(['diff', '-U0', '--no-color', range, '--', '.', ...BINARY_EXCLUDES]) : { out: '', why: null }
  const diffProblem = names.why ?? text.why
  const files = names.out.split(/\r?\n/).map(f => f.trim()).filter(Boolean)
  const added = addedLines(text.out)
  const status = await atherStatus($)
  const fromDiff = [...new Set(files.map(f => /^docs\/intent\/([^/]+)\//.exec(f)?.[1]).filter((s): s is string => Boolean(s)))]
  const slug = slugHint ?? status?.tracked?.slug ?? (fromDiff.length === 1 ? (fromDiff[0] ?? null) : null)
  const read = (rel: string) => $.fs.read(`${root}/${rel}`).catch(() => '')
  const [prompt, progress, findings] = slug ? await Promise.all([read(`docs/intent/${slug}/prompt.md`), read(`docs/intent/${slug}/progress.md`), read(`docs/intent/${slug}/findings.md`)]) : ['', '', '']
  const otherIntents: { slug: string; names: string[] }[] = []
  for (const d of await $.fs.list(`${root}/docs/intent`).catch(() => [])) {
    if (d.name === slug || d.kind === 'file') continue
    const p = await read(`docs/intent/${d.name}/prompt.md`)
    if (/^-\s*Status:\s*active\b/im.test(p)) otherIntents.push({ slug: d.name, names: namedPaths(p, d.name).filter(n => n !== `docs/intent/${d.name}/`) })
  }
  const now = await $.clock.now()
  const isS2Repo = isS2 && (sameRoot(root, s2Root(opts)) || (await $.fs.exists(`${root}/S2.uproject`)))
  const othersTouch = isS2Repo ? touches.filter(t => isLive(t.id8, now)).map(t => ({ lane: t.lane, paths: t.paths })) : []
  const mine = [...touched].slice(0, 100)
  const untrackedLeft = isS2Repo && mine.length
    ? ((await $.process.run(['git', '-C', s2Root(opts), 'status', '--porcelain', '--untracked-files=all', '--', ...mine], { timeoutMs: 30_000 }).catch(() => null))?.stdout ?? '').split(/\r?\n/).filter(l => l.startsWith('?? ')).map(l => l.slice(3).trim())
    : []
  const strayWorktrees: string[] = []
  let wt = ''
  for (const l of (await git(['worktree', 'list', '--porcelain'])).split(/\r?\n/)) {
    if (l.startsWith('worktree ')) wt = l.slice(9).trim()
    else if (l === `branch refs/heads/${branch}` && wt && !sameRoot(wt, root)) strayWorktrees.push(wt)
  }
  const runningAgents = (await $.agent.list().catch(() => [])).filter(a => a.status === 'running' && a.type !== SYNC_AGENT && a.id !== agentId).map(a => `${a.type}: ${a.description}`)
  return {
    slug,
    branch,
    files,
    added,
    prompt,
    progress,
    findings,
    diffProblem,
    promptDiff: slug && !refProblem ? await git(['diff', range, '--', `docs/intent/${slug}/prompt.md`]) : '',
    proof: status?.tracked?.slug === slug ? proofOf(status) : null,
    body,
    othersTouch,
    otherIntents,
    untrackedLeft,
    strayWorktrees,
    runningAgents,
    cfg: a5.cfg,
  }
}

/** A18: the score at the PR-opening call (main loop or worker) or at an intent's close; a failing score refuses it
 * with the list, Hai may let this one through in the dialog, a worker is never asked. */
async function acceptGate($: Engine, opts: Opts, a5: A5, tool: string, input: Input, agentId: string | undefined): Promise<string | null> {
  let root: string | null = null
  let slug: string | null = null
  let body = ''
  let what = 'this PR'
  let refs: PrRefs = {}
  const cwd = await $.session.cwd()
  if (SHELL_TOOLS.has(tool) && isPrCommand(str(input.command))) {
    const command = str(input.command)
    const cdDir = /^\s*cd\s+("[^"]+"|'[^']+'|\S+)\s*&&/.exec(command)?.[1]?.replace(/^["']|["']$/g, '')
    const dir = norm(cdDir ?? cwd, cwd)
    root = (await locate($, a5, `${dir}/_`)).root
    body = await prBody($, command, dir)
  } else if (isPrTool(tool)) {
    // A22: a PR opened through an MCP tool (GitHub's create_pull_request and the like): the session's repository,
    // checked against the repository, head and base the input names; never let through unread.
    root = (await locate($, a5, `${cwd}/_`)).root ?? cwd
    body = str(input.body)
    const owner = str(input.owner)
    const name = str(input.repo) || str(input.repository) || str(input.repo_name)
    refs = { repo: name ? (owner && !name.includes('/') ? `${owner}/${name}` : name) : undefined, head: str(input.head) || str(input.head_branch) || undefined, base: str(input.base) || str(input.base_branch) || undefined }
  } else if (EDIT_TOOLS.has(tool)) {
    for (const [path, old, neu] of await editParts($, tool, input)) {
      const closing = closesIntent(norm(path, cwd), newLines(old, neu))
      if (closing) {
        slug = closing
        root = (await locate($, a5, path)).root
        what = `closing intent ${closing}`
      }
    }
  }
  if (!root) return null
  const x = await gatherAccept($, opts, a5, root, slug, body, agentId, refs)
  const scores = score(x)
  lastAccept = { at: await $.clock.now(), slug: x.slug, scores, what } // the intent the score read (tracked or from the diff)
  $.ui.invalidate('ui.render')
  const bad = failed(scores)
  // An unread branch diff is no pass: refused with why, like a failing score.
  if (bad.length === 0 && !x.diffProblem) return null
  const text = x.diffProblem ? unreadText(x.diffProblem) : acceptText(scores, what)
  if (agentId !== undefined) return `${text}\n(a worker does not ask Hai: leave it undone, stop and report it to the session that briefed you)`
  if (opts.a5WhenPresent === 'deny') return text
  try {
    const question = x.diffProblem
      ? `A5 acceptance: ${unreadLine(x.diffProblem)} before ${what}, so nothing was scored. Let it through this once?`
      : `A5 acceptance: ${bad.length} of 5 rules not met before ${what} (${bad.map(s => `${s.rule} ${ruleName(s.rule)}`).join('; ')}). Let it through this once?`
    const answer = await $.ui.ask(question, { options: [PASS_ONCE, 'No'], header: 'A5 acceptance' })
    return answer === PASS_ONCE ? null : `${text}\n(Hai said no)`
  } catch {
    return `${text}\n(nobody could approve it now)`
  }
}

/** A19: the card's score, off the render: the tracked intent's stage (Ship or Ready to close shows the card), then
 * the score of this session's repository while a card is wanted. */
async function refreshAccept($: Engine, opts: Opts): Promise<void> {
  if (isScoring) return
  isScoring = true
  try {
    const now = await $.clock.now()
    shipCheckedAt = now
    const status = await atherStatus($)
    const stage = status?.tracked?.stage ?? ''
    shipSlug = status?.tracked?.slug && /^(Ship|Ready to close)$/i.test(stage) ? status.tracked.slug : null
    const a5 = await load($)
    const cwd = await $.session.cwd()
    const root = (await locate($, a5, `${cwd}/_`)).root
    prDirty = false
    if (!root) return
    if (await postHoc($, opts, a5, root, status, now)) return
    if (!shipSlug && !lastAccept) return
    acceptDirty = false
    const slug = lastAccept?.slug ?? shipSlug
    lastAccept = { at: now, slug, scores: score(await gatherAccept($, opts, a5, root, slug, '', undefined)), what: lastAccept?.what ?? 'Ship' }
  } finally {
    isScoring = false
    $.ui.invalidate('ui.render')
  }
}

/** A23: a PR number on the tracked intent's `- PR:` line (or in Ather's `tracked.prs`) that this session never scored
 * (opened on GitHub, or by the app's own button) is scored now, shown on the card with its number, and one 🟥 is
 * raised per failing PR (the first session to claim its alert file). The first read of an intent only records the
 * numbers already there. Returns whether it scored. */
async function postHoc($: Engine, opts: Opts, a5: A5, root: string, status: AtherStatus | null, now: number): Promise<boolean> {
  const slug = status?.tracked?.slug
  if (!slug) return false
  const read = (rel: string) => $.fs.read(`${root}/${rel}`).catch(() => '')
  const listed = [...new Set([...prNumbersOf(await read(`docs/intent/${slug}/progress.md`), await read(`docs/intent/${slug}/prompt.md`)), ...(status?.tracked?.prs ?? []).flatMap(p => prNumbersOf(`- PR: ${p}`, ''))])]
  if (!prBaseline.has(slug)) {
    prBaseline.add(slug)
    for (const n of listed) prsKnown.add(n)
    await saveMe($, opts)
    return false
  }
  const fresh = listed.filter(n => !prsKnown.has(n))
  if (fresh.length === 0) return false
  const x = await gatherAccept($, opts, a5, root, slug, '', undefined)
  const scores = score(x)
  for (const n of fresh) prsKnown.add(n)
  lastAccept = { at: now, slug, scores, what: `PR #${fresh.join(', #')} · scored after the fact` }
  await saveMe($, opts)
  const bad = failed(scores)
  if (bad.length > 0 || x.diffProblem)
    for (const n of fresh)
      if (await claimAlert($, opts, `pr-${n}`))
        await raiseRed(
          $,
          opts,
          `PR #${n} (intent ${slug}) was opened without A5 acceptance and ${x.diffProblem ? `could not be scored: ${unreadLine(x.diffProblem)}` : `fails ${bad.length} of 5 (${bad.map(b => `${b.rule} ${ruleName(b.rule)}`).join('; ')})`}: fix it on its branch before it merges, or let it merge as it is?`,
          'hold the merge until the branch scores 5 of 5',
        )
  return true
}

/** /a5 accept: the score on demand for the repository this session works in (no PR body). */
async function acceptCommand($: Engine, opts: Opts): Promise<string> {
  const a5 = await load($)
  const cwd = await $.session.cwd()
  const root = (await locate($, a5, `${cwd}/_`)).root
  if (!root) return 'A5 acceptance: this session is not in a git repository.'
  const x = await gatherAccept($, opts, a5, root, null, '', undefined)
  const scores = score(x)
  lastAccept = { at: await $.clock.now(), slug: null, scores, what: 'on demand' }
  $.ui.invalidate('ui.render')
  return [`A5 acceptance (${x.diffProblem ? 'not scored' : failed(scores).length ? `${failed(scores).length} of 5 not met` : '5 of 5'}):`, ...scores.map(s => `${s.state === 'pass' ? '✓' : s.state === 'fail' ? '✗' : '–'} ${s.rule} ${ruleName(s.rule)}: ${s.line}`)].join('\n')
}

/** A21: the score of the intent Ather hands over at Ship, as the text added to that prompt. */
async function shipScore($: Engine, opts: Opts, slug: string): Promise<string | null> {
  const a5 = await load($)
  const root = (await locate($, a5, `${await $.session.cwd()}/_`)).root
  if (!root) return null
  const x = await gatherAccept($, opts, a5, root, slug, '', undefined)
  const scores = score(x)
  lastAccept = { at: await $.clock.now(), slug, scores, what: 'Ship' }
  $.ui.invalidate('ui.render')
  return shipText(scores, slug, x.branch, x.diffProblem)
}

/** A15: this session holds the sync and the sync is in its freeze (sync.json read fresh). */
async function isFrozenHolder($: Engine, opts: Opts): Promise<boolean> {
  const s = parseSyncFile(await readJson($, syncPath(opts)))
  if (!s || s.holder.id8 !== (await $.session.id()).slice(0, 8).toLowerCase()) return false
  return phaseOf(s, await $.clock.now()) === 'frozen'
}

/** The first git write of a command that lands in the shared S2 checkout (its main working tree), if any. */
async function sharedGitWrite($: Engine, opts: Opts, a5: A5, writes: { verb: string; dir: string }[]): Promise<{ verb: string; dir: string } | null> {
  const cwd = await $.session.cwd()
  for (const w of writes) {
    const dir = norm(w.dir || cwd, cwd)
    const root = (await locate($, a5, `${dir}/_`)).root
    if (root && sameRoot(root, s2Root(opts)) && (await isSharedRoot($, root))) return w
  }
  return null
}

/** A5's freeze, a lease (D8): from the sync time until done, abort or expiry, a session that does not hold the sync
 * makes no git write in the shared checkout and does not use the Editor (sync.json read fresh for each such call).
 * A14, the merge guard: while .git/MERGE_HEAD exists in the shared checkout, git writes there are refused to every
 * session but the sync's holder, whatever sync.json says. */
async function freezeProblem($: Engine, opts: Opts, a5: A5, tool: string, input: Input): Promise<string | null> {
  const command = SHELL_TOOLS.has(tool) ? str(input.command) : ''
  const isEditorUse = isUnrealMcp(tool) || (command !== '' && isEditorStartStop(command))
  const writes = command ? gitWrites(command) : []
  if (!isEditorUse && writes.length === 0) return null
  const s = parseSyncFile(await readJson($, syncPath(opts)))
  const now = await $.clock.now()
  const isHolder = s?.holder.id8 === (await $.session.id()).slice(0, 8).toLowerCase()
  const shared = writes.length > 0 ? await sharedGitWrite($, opts, a5, writes) : null
  if (shared && !isHolder && (await $.fs.exists(`${s2Root(opts)}/.git/MERGE_HEAD`))) {
    const state = s ? `${s.holder.lane} holds the sync at ${clockOf(s.at)} (${phaseOf(s, now)})` : 'no sync is open (a merge left behind)'
    return blocked('Merge guard', `a merge is in progress in the shared checkout (.git/MERGE_HEAD; ${state}): no git ${shared.verb} there until it is finished or aborted`, 'leave the merge state alone (no commit, reset, abort or stash of yours); its holder or Hai ends it; work without git or in your own worktree')
  }
  if (!s || phaseOf(s, now) !== 'frozen' || isHolder) return null
  const why = `${s.holder.lane} merges origin/main since ${clockOf(s.at)}`
  if (isEditorUse) return blocked('Sync main freeze', `${why}: the Editor waits until the sync is done (at the latest ${clockOf(s.hardEnd)})`, 'do work that needs no Editor; you will be told when it lifts')
  if (shared) return blocked('Sync main freeze', `${why}: no git ${shared.verb} in the shared checkout until the sync is done (at the latest ${clockOf(s.hardEnd)})`, 'leave your changes as they are (never stash or reset them); commit after the lift, or work in your own worktree')
  return null
}

/** A14: a merge left in the shared checkout with no sync open (.git/MERGE_HEAD) is one 🟥 for Hai, raised by the
 * first session that sees it (an alert file per MERGE_HEAD). */
async function mergeGuardStep($: Engine, opts: Opts, now: number): Promise<void> {
  const head = await $.fs.stat(`${s2Root(opts)}/.git/MERGE_HEAD`).catch(() => null)
  if (!head || isOpenPhase(phaseOf(syncFile, now))) return
  if (await claimAlert($, opts, `merge-head-${Math.round(head.mtimeMs)}`))
    await raiseRed(
      $,
      opts,
      `A merge is in progress in the shared S2 checkout (.git/MERGE_HEAD since ${clockOf(head.mtimeMs)}) and no sync is open${syncFile ? ` (the last sync, ${clockOf(syncFile.at)} by ${syncFile.holder.lane}, is ${syncFile.state})` : ''}: finish it or abort it (git merge --abort) yourself, or name a session to do it`,
      'every session but the last sync holder stays refused git writes there until MERGE_HEAD is gone',
    )
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
      return blocked('Notices', 'a5 notices are not logged in docs/intent files (D6: they would be noise in the intent\'s record)', 'leave the "A5 ·" line out; the files under Saved/A5 are the record')
  }
  if (SHELL_TOOLS.has(tool) && writesLock(str(input.command))) return blocked('Editor lock', 'under A5 the lock is written by the editor tool, never by a command', viaTool)
  if (SHELL_TOOLS.has(tool) && writesNoticeToIntent(str(input.command)))
    return blocked('Notices', 'a5 notices are not logged in docs/intent files (D6: they would be noise in the intent\'s record)', 'leave the "A5 ·" line out; the files under Saved/A5 are the record')
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
      ...(e.launch === false ? { launch: false } : {}),
    }
    me = { ...me, want, lane: str(e.lane) ? safeWord(str(e.lane)) : me.lane }
    await saveMe($, opts, now)
    await runTick($, opts)
    const asked = me.yieldAsks.find(a => a.at === now)
    return tail(`${placeText(decision)}${asked ? ` · the holder (session ${asked.holder}) was asked to yield at its next safe point${asked.via === 'send' ? ' (UE request line sent: it runs without a5)' : ''}` : ''}`)
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
    const fresh = await freshProbe($, opts)
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
    const phase = phaseOf(syncFile, now)
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
        sync: syncFile ? { at: clockOf(syncFile.at), phase: phaseOf(syncFile, now), holder: syncFile.holder.lane } : 'none planned',
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

/** This session's place, in the few words the Editor holder tile has room for. */
const placeShort = (d: GrantDecision | null): string => {
  if (!d || d.kind === 'none' || d.kind === 'mine') return ''
  if (d.kind !== 'wait') return 'you: being granted'
  const why = d.code === 'ram' ? ' · waiting on RAM' : d.code === 'sync' ? ' · after the sync' : d.code === 'gone-editor' ? ' · holder gone, Editor open' : d.code === 'missing' ? ' · lock missing' : ''
  return `you: ${d.place > 1 ? `${ordinal(d.place)} in the queue` : 'next'}${why}`
}

/** The Sync main tile's words for the planned sync: when, by whom, its phase, its conflicts. */
function syncData(now: number): SyncData {
  const s = syncFile
  const phase = phaseOf(s, now)
  if (!s) return { line: 'no sync planned', conflicts: '', isRunning: false }
  const by = s.holder.id8 === me8 ? 'this session' : s.holder.lane
  const gone = isOpenPhase(phase) && !isLive(s.holder.id8, now) ? ' · holder gone' : ''
  const cs = isOpenPhase(phase) ? s.conflicts : null
  const line =
    phase === 'planned'
      ? `next sync ${clockOf(s.at)}${s.build ? ' with build' : ''} by ${by} · cutoff ${clockOf(s.at - CUTOFF_MS)} · freeze to ${clockOf(s.hardEnd)} at most`
      : phase === 'cutoff'
        ? `sync ${clockOf(s.at)} by ${by} · cutoff: commit, release the Editor by ${clockOf(s.at - RELEASE_BEFORE_MS)}`
        : phase === 'frozen'
          ? `sync ${clockOf(s.at)}: ${by} merging · git and the Editor frozen to ${clockOf(s.hardEnd)} at most`
          : `last sync ${clockOf(s.at)} ${phase}${s.endedAt ? ` at ${clockOf(s.endedAt)}` : ''} · none planned`
  const un = isOpenPhase(phase) ? (s.untracked ?? []) : []
  const parts = [
    cs && cs.length > 0 ? `conflicts: ${cs.length} (${cs.filter(c => c.kind === 'self').length} self, ${cs.filter(c => c.kind === 'foreign').length} foreign)` : '',
    un.length > 0 ? `untracked main would overwrite: ${un.length}` : '',
  ].filter(Boolean)
  return {
    line: `${line}${cs && cs.length === 0 && un.length === 0 ? ' · dry-run clean' : ''}${gone}`,
    color: phase === 'frozen' ? STATUS.bad : phase === 'cutoff' ? STATUS.warn : undefined,
    conflicts: parts.join(' · '),
    isRunning: phase === 'frozen',
  }
}

type ButtonEl = { Button: (p: Record<string, unknown>) => unknown }

/** D5 / A25: `/a5 gate <pie> <nopie>` sets the launch gate for every session (the plugin store, as the panel's
 * ±1 GB did before 0.8); `/a5 gate reset` goes back to the plugin options. */
async function gateCommand($: Engine, opts: Opts, args: string): Promise<string> {
  const words = args.trim().split(/\s+/).filter(Boolean)
  if (words[0]?.toLowerCase() === 'reset') {
    await $.store.delete('gates')
    await runTick($, opts)
    return `A5 · launch gate back to the plugin options: ≥ ${clampGate(Number(opts.launchGatePieGb ?? 31))} GB with PIE, ≥ ${clampGate(Number(opts.launchGateGb ?? 28))} GB without.`
  }
  const [pie, nopie] = words.map(Number)
  if (words.length === 0) return `A5 · launch gate: ≥ ${gates.pieGb} GB with PIE, ≥ ${gates.nopieGb} GB without (${gates.source === 'panel' ? 'set with /a5 gate' : 'plugin options'}). Change it: /a5 gate <with PIE> <without PIE>, or /a5 gate reset.`
  if (!Number.isFinite(pie) || !Number.isFinite(nopie ?? pie)) return 'A5 · /a5 gate <with PIE GB> <without PIE GB>, e.g. /a5 gate 31 28; or /a5 gate reset.'
  const g = { pieGb: clampGate(pie as number), nopieGb: clampGate((nopie ?? pie) as number) }
  await $.store.set('gates', g)
  await runTick($, opts)
  return `A5 · launch gate for every session: ≥ ${g.pieGb} GB with PIE, ≥ ${g.nopieGb} GB without (the PIE gate stays 5 GB start / 3 GB abort). /a5 gate reset goes back to the plugin options.`
}

/** A25: the Editor tile's one action: Release, only while this session holds the Editor. */
function editorAction($: Engine, opts: Opts, el: ButtonEl, isDesktop: boolean): unknown {
  if (!holdsLock()) return undefined
  return el.Button({
    key: 'hai-editor-release',
    label: 'Release',
    plain: isDesktop ? undefined : true,
    onPress: () =>
      void (async () => {
        const text = await editorTool($, opts, { action: 'release', dont_save: [] } as unknown as Input)
        $.ui.toast(text.length > 200 ? `${text.slice(0, 197)}…` : text, { timeoutMs: 8_000 })
        await runTick($, opts)
      })(),
  })
}

/** A25: the Sync main tile's one action (D4): "Plan sync" when none is open (one dialog with the preset times),
 * else "Sync ⋯", one dialog with what this session may do now: the holder moves, switches the build or cancels
 * before the freeze and ends it during it; a gone holder's sync can be taken over; Refresh always. Every choice
 * goes through syncAction. */
function syncActionButton($: Engine, opts: Opts, el: ButtonEl, isDesktop: boolean, now: number): unknown {
  const s = syncFile
  const phase = phaseOf(s, now)
  const run = (action: string, a: { at?: string; note?: string; build?: boolean }) =>
    (async () => {
      const text = await syncAction($, opts, action, a)
      $.ui.toast(text.length > 200 ? `${text.slice(0, 197)}…` : text, { timeoutMs: 8_000 })
      await runTick($, opts)
    })()
  const refresh = async () => {
    syncAt = 0
    await refreshSync($, opts)
    await runTick($, opts)
  }
  const choices: [string, () => Promise<void>][] = []
  if (!s || !isOpenPhase(phase)) for (const t of presetTimes(now)) choices.push([`Plan ${clockOf(t)}`, () => run('plan', { at: clockOf(t) })])
  else if (s.holder.id8 !== me8) {
    if (!isLive(s.holder.id8, now)) choices.push(['Take over', () => run('takeover', {})])
  } else if (phase === 'frozen') choices.push(['Done', () => run('done', { note: 'ended on the panel' })], ['Abort', () => run('abort', { note: 'aborted on the panel' })])
  else {
    choices.push([`Move to ${clockOf(s.at + 30 * 60_000)}`, () => run('move', { at: clockOf(s.at + 30 * 60_000) })])
    choices.push([s.build ? 'Build: off' : 'Build: on', () => run('build', { build: !s.build })])
    choices.push(['Cancel the sync', () => run('cancel', { note: 'cancelled on the panel' })])
  }
  choices.push(['Refresh', refresh])
  if (choices.length < 2) choices.push(['Close', async () => undefined]) // the dialog takes 2-4 choices
  const isPlan = !s || !isOpenPhase(phase)
  // The dialog's free-text "Other" takes a time: plan at it, or (the holder, before the freeze) move to it.
  const isMover = isPlan || (s?.holder.id8 === me8 && phase !== 'frozen')
  const question = isPlan
    ? 'Plan a merge of origin/main at… (another time: type HH:MM)'
    : `Sync ${s ? clockOf(s.at) : ''} by ${s?.holder.id8 === me8 ? 'this session' : (s?.holder.lane ?? '?')} (${phase})${isMover ? ' · type HH:MM to move it' : ''}`
  return el.Button({
    key: 'hai-sync-action',
    label: isPlan ? 'Plan sync' : 'Sync ⋯',
    plain: isDesktop ? undefined : true,
    onPress: () =>
      void (async () => {
        const answer = await $.ui.ask(question, { options: choices.map(c => c[0]).slice(0, 4), header: 'Sync main' }).catch(() => null)
        const pick = choices.find(c => c[0] === answer)
        const typed = /^\s*(\d{1,2}:\d{2})\s*$/.exec(answer ?? '')?.[1]
        if (pick) await pick[1]()
        else if (typed && isMover) await run(isPlan ? 'plan' : 'move', { at: typed })
      })(),
  })
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

/** A40: the app theme from `/config` ("theme"), applied to every colour a5 draws; dark when it cannot be read. */
async function readTheme($: Engine): Promise<void> {
  const rows = await $.config.list().catch(() => [])
  const row = rows.find(x => x.key === 'theme')
  const name = themeOf(row?.value)
  if (name !== currentTheme()) {
    applyTheme(name)
    $.ui.invalidate('ui.render')
  }
}

/** The reads both panes need, off the render: the branch state, the nghiệm thu score (when one is wanted, or the
 * Ship check is due), the PR lines. */
function scheduleReads($: Engine, opts: Opts, now: number): void {
  if (isS2 && now - syncAt > SYNC_STALE_MS) $.clock.after(10, () => void refreshSync($, opts))
  const wantCard = lastAccept !== null || shipSlug !== null
  if (!isScoring && ((wantCard && acceptDirty) || prDirty || now - shipCheckedAt > SHIP_CHECK_MS)) $.clock.after(10, () => void refreshAccept($, opts))
}

/** A29: open (or bring back) the A5 pane; a toast when the surface could not place it. */
async function openA5Pane($: Engine): Promise<string> {
  paneEnterAt = await $.clock.now() // A37: the entrance plays at the next draw
  const r = await $.ui.open({ id: A5_PANE, title: 'A5' }).catch(err => ({ isPlaced: false, reason: String(err) }) as const)
  if (r.isPlaced) return 'A5 pane opened.'
  const why = 'reason' in r ? String(r.reason) : 'not placed'
  $.ui.toast(`A5: the pane could not be placed (${why})`)
  return `A5 pane not placed: ${why}`
}

/** A28: the compact line's three parts and their attention marks. */
function lineParts(el: Parameters<typeof icon>[0], opts: Opts, isDesktop: boolean, now: number): LinePart[] {
  const t = editorTile({ lock: lockView, me8, nowMin, place: placeShort(decision), waiting: 0 })
  const isMine = holdsLock()
  const isOver = t.dot === STATUS.bad
  const justGranted = isMine && me?.holding !== null && me?.holding !== undefined && now - me.holding.since < 5 * 60_000
  const l = lockView
  // A30: values only: the holder (★ for this session) and until; "free"; "?" for a missing lock.
  const editorName = !l || l.isMissing || l.isFree ? undefined : isMine ? '★' : (l.who ?? 'held')
  const editorValue = !l || l.isMissing ? '?' : l.isFree ? 'free' : l.until ? ` →${l.until}` : ''
  const editorWarn = isOver || justGranted || !l || l.isMissing
  const free = vitals?.freeGb
  const under = free !== undefined && (free < gates.nopieGb || ramBand(free) !== 'ok')
  const memText = free === undefined ? '? GB' : `${free} GB${under ? ' ⚠' : ''}`
  const phase = phaseOf(syncFile, now)
  const open = syncFile && isOpenPhase(phase) ? syncFile : null
  // A30: main's behind count as −N (0 when level), or the planned sync's time (❄ in its freeze, ⚠ at its cutoff).
  const syncText = open ? `${clockOf(open.at)}${phase === 'frozen' ? ' ❄' : phase === 'cutoff' ? ' ⚠' : ''}` : sync ? (sync.behind === null ? '?' : sync.behind > 0 ? `−${sync.behind}` : '0') : '…'
  const syncWarn = Boolean(open && (phase === 'cutoff' || phase === 'frozen'))
  const tint = (warn: boolean, base: string) => (warn ? STATUS.warn : base)
  const still: Motion = { kind: 'still' }
  return [
    { key: 'editor', icon: icon(el, 'editor', tint(editorWarn, t.dot ?? INK()), opts.motion === 'off' ? still : motionFor('editor', `${t.value}|${t.dot}`, t.dot ?? INK(), now, false, opts), isDesktop), ...(editorName ? { name: editorName } : {}), value: editorValue, isWarn: editorWarn },
    { key: 'memory', icon: icon(el, 'memory', tint(under, STATUS.ok), still, isDesktop), value: memText, isWarn: under },
    { key: 'main', icon: icon(el, 'branch', tint(syncWarn, INK()), opts.motion === 'off' ? still : motionFor('main', syncText, INK(), now, phase === 'frozen', opts), isDesktop), value: syncText, isWarn: syncWarn },
  ]
}

/** Ather's pane as Ather drew it. With A5 on: one compact A5 line right under Ather's own summary strip (A28), the
 * accent in lacquer gold and the red seal beside the brand. Nothing else of A5 is in it; the rest is the A5 pane. */
async function drawPane($: Engine, opts: Opts, e: { surface: string; props: { bodyColumns?: number } }, tree: RenderElement): Promise<RenderElement> {
  const on = await readA5($)
  if (!on) return tree // A5 off: Ather's pane exactly as Ather drew it (D1)
  const el = $.ui.resolve(e as never) as never as Parameters<typeof icon>[0] & Parameters<typeof tilesRow>[0]
  const isDesktop = e.surface === 'desktop'
  const now = await $.clock.now()
  const root = tree as unknown as { children?: unknown[] }
  if (!Array.isArray(root.children)) return recolor(tree)
  let kids = [...root.children]
  const stripAt = kids.findIndex(k => keyOf(k) === 'strip')
  if (isS2 && stripAt >= 0) {
    scheduleReads($, opts, now)
    // A30: "★ A5 ›" on the seal red (a Button has no colour of its own: the red is its box's background).
    const button = el.Button({ key: 'hai-a5-open', label: '★ A5 ›', plain: true, onPress: () => void openA5Pane($) })
    // A40: the button's label is the surface's ink; seal red behind it reads in the dark theme, a red rim in the light one.
    let line = compactLine(el, lineParts(el, opts, isDesktop, now), button, isDesktop, currentTheme() === 'dark' ? A5_LOOK.sealBg : undefined, currentTheme() === 'light' ? A5_LOOK.hit : undefined)
    // A37: the compact line's entrance when it first draws (desktop, motion on).
    if (lineEnterAt === 0) lineEnterAt = now
    if (isDesktop && opts.motion !== 'off' && now - lineEnterAt < ENTRANCE_MS) {
      line = withCurtain(el as never, line, 'hai-a5-line-in', entrance(1)[0] as Curtain)
      $.clock.after(ENTRANCE_MS + 10, () => $.ui.invalidate('ui.render'))
    }
    kids.splice(stripAt + 1, 0, line)
  }
  // The pixel seal only while it stamps in on the desktop; the crisp text seal the rest of the time.
  const stamp = opts.motion !== 'off' && now - a5FlipAt < MOTION_MS
  const sealEl = stamp && isDesktop && el.Svg ? el.Svg({ source: sealSvg(A5_LOOK.sealBg, A5_LOOK.sealText, true), alt: 'A5 on', width: 27, height: 14, isInteractive: true }) : undefined
  kids = kids.map(k => replaceKeyed(k, 'head-words', words => withSeal(el, words, sealEl)))
  // A39: every worker avatar Ather drew wears the red scarf while A5 is on.
  return recolor(scarfAvatars({ ...(tree as object), children: kids } as unknown as RenderElement))
}

/** A37/A38: a pixel curtain laid over a block: an absolute box spanning it (painted over what it holds, clipped to
 * it) holding one SVG whose cells clear or fill in Bayer order. The block becomes the curtain's positioning parent. */
function withCurtain(el: { Box: (p: Record<string, unknown>) => unknown; Svg?: (p: Record<string, unknown>) => unknown }, block: unknown, key: string, c: Curtain): unknown {
  return withOverlay(el, block, key, curtainSvg(c))
}

/** A37/A38: any one-shot SVG laid over a block the same way (an absolute box spanning it, clipped to it). */
function withOverlay(el: { Box: (p: Record<string, unknown>) => unknown; Svg?: (p: Record<string, unknown>) => unknown }, block: unknown, key: string, source: string): unknown {
  if (!el.Svg) return block
  const b = block as { props?: Record<string, unknown>; children?: unknown[] }
  const over = el.Box({ key, position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden', children: [el.Svg({ source, alt: '', width: 2400, height: 480, isInteractive: true })] })
  return { ...b, props: { ...(b.props ?? {}), position: 'relative' }, children: [...(b.children ?? []), over] }
}

/** A37: the entrance: each block in turn (band, tools, sessions, card, rules) dithers in from seal-red pixels, the
 * whole sequence ending within 300 ms; the cells take 4 ms apiece. */
const entrance = (n: number): Curtain[] => {
  const step = 4
  const last = ENTRANCE_BUDGET_MS - 16 * step
  return Array.from({ length: n }, (_, i) => ({ color: A5_LOOK.sealBg, begin: n > 1 ? Math.floor((i * last) / (n - 1)) : 0, step, clear: true }))
}

/** A35 (mockup v2): the A5 pane's frame: the band at full width, then every block on one gutter, one gap between blocks. */
function paneOf(el: { Box: (p: Record<string, unknown>) => unknown }, kids: unknown[]): RenderElement {
  const [band, ...blocks] = kids as { props?: Record<string, unknown> }[]
  const onGutter = blocks.map(b => ({ ...b, props: { ...(b.props ?? {}), marginX: V2.gutter, marginTop: 0 } }))
  return el.Box({ key: 'hai-a5-pane', flexDirection: 'column', width: '100%', rowGap: 1, children: [band, ...onGutter] }) as unknown as RenderElement
}

/** A29: the A5 pane: the three tool rows (A25), the sessions list (A26), the Nghiệm thu card (A19), and the five
 * rules as its last block (A27). With A5 off it says how to turn it on; outside the S2 checkout it has no tools. */
async function drawA5Pane($: Engine, opts: Opts, e: { surface: string; props: { bodyColumns?: number } }): Promise<RenderElement> {
  const el = $.ui.resolve(e as never) as never as Parameters<typeof icon>[0] & Parameters<typeof tilesRow>[0]
  const isDesktop = e.surface === 'desktop'
  const now = await $.clock.now()
  const isOn = await readA5($)
  // A38: the sync freeze and its lift, seen at the draw after they happen.
  const phaseNow = phaseOf(syncFile, now)
  if (lastPhaseSeen !== null && phaseNow === 'frozen' && lastPhaseSeen !== 'frozen') freezeAt = now
  if (lastPhaseSeen === 'frozen' && phaseNow !== 'frozen') liftAt = now
  lastPhaseSeen = phaseNow
  const isFx = isDesktop && opts.motion !== 'off'
  let fxPlaced = false
  let band = a5Band(el, isOn, isOn && phaseNow === 'frozen')
  if (isFx && now - freezeAt < FX_MS) {
    band = withOverlay(el as never, band, 'hai-a5-fx-freeze', sweepSvg(A5_LOOK.sealText, false))
    fxPlaced = true
  } else if (isFx && now - liftAt < FX_MS) {
    band = withOverlay(el as never, band, 'hai-a5-fx-lift', sweepSvg(A5_LOOK.sealText, true))
    fxPlaced = true
  }
  const kids: unknown[] = [band] // A33/A35: the band first
  if (!isOn) {
    kids.push(el.Box({ key: 'hai-a5-off', children: [el.Text({ color: ATHER.quiet, wrap: 'wrap', children: 'A5 is off: Ather runs as it ships. /a5 on turns on the five rules, the Editor holder, RAM and Sync main for every session.' })] }))
    return paneOf(el, kids)
  }
  scheduleReads($, opts, now)
  if (isS2) {
    const id8 = me8 || (await $.session.id()).slice(0, 8).toLowerCase()
    const waiting = queueOf(me ? [me, ...peers] : peers, lanes, now, syncFile).length
    const plan = syncData(now)
    const tiles = [
      editorTile({ lock: lockView, me8: id8, nowMin, place: placeShort(decision), waiting }),
      memoryTile(el, vitals, { pieGb: gates.pieGb, nopieGb: gates.nopieGb, isFromPanel: gates.source === 'panel', cleanup: cleanupNote, diskGb: probe?.diskGb ?? null, drive: s2Root(opts).slice(0, 2) }, { fill: A5_LOOK.meter, track: A5_LOOK.meterTrack }),
      mainTile(sync, plan, syncActionButton($, opts, el, isDesktop, now)),
    ]
    tiles[0] = { ...tiles[0], action: editorAction($, opts, el, isDesktop) } as (typeof tiles)[number]
    // A35 (mockup v2): Memory reads "<n> GB free · below launch gate" (the note in amber only when below); its gate
    // details are the sub-line; no meter. Sync main's sub-line: when main was fetched, the planned or last sync.
    const free = vitals?.freeGb
    const extra = [...(probe?.diskGb !== null && probe?.diskGb !== undefined && probe.diskGb < DISK_MIN_GB ? [`${s2Root(opts).slice(0, 2)} ${probe.diskGb} GB free`] : []), ...(vitals && vitals.git >= 10 ? [`${vitals.git} git processes`] : [])]
    tiles[1] = {
      ...tiles[1],
      value: free === undefined ? 'probe failed' : `${free} GB free`,
      meter: undefined,
      ...(free !== undefined && free < gates.nopieGb ? { note: { text: 'below launch gate', warn: true } } : free !== undefined && free < gates.pieGb ? { note: { text: 'launch fits without PIE', warn: false } } : {}),
      sub: [`gate ${gates.pieGb} GB with PIE, ${gates.nopieGb} without`, `PIE needs ${PIE_START_GB} GB`, ...extra].join(' · '),
      subWarn: extra.length > 0,
    } as (typeof tiles)[number]
    if (sync) tiles[2] = { ...tiles[2], sub: [`fetched ${ago(sync.fetchedMinAgo)}`, plan.line, plan.conflicts, ...sync.flags].filter(Boolean).join(' · '), subWarn: Boolean(plan.conflicts) || sync.flags.length > 0 } as (typeof tiles)[number]
    const names = { editor: 'editor', memory: 'memory', main: 'branch' } as const
    for (const t of tiles) {
      const name = names[t.key as keyof typeof names]
      // A33: gold icons; a state that is not fine keeps its status colour.
      const color = t.dot && t.dot !== STATUS.ok ? t.dot : A5_LOOK.gold
      t.icon = icon(el, name, color, motionFor(`pane-${t.key}`, `${t.value}|${color}`, color, now, t.key === 'main' && plan.isRunning, opts), isDesktop)
    }
    kids.push(tilesRow(el, tiles, isDesktop, PANE_INK()))
    // A26: the sessions on this machine as a short named list, one line each.
    const view = sessionsView({ me8: id8, meTitle: me?.title ?? '', files: me ? [me, ...peers] : peers, lanes, clients, isS2Cwd: cwd => s2Cwds.get(cwd.toLowerCase()) ?? false, lock, sync: syncFile, now, phase: phaseOf(syncFile, now), names: sessionNames })
    kids.push(sessionsBox(el, view, isDesktop, PANE_INK()))
    // A31: every live session's record title, to match it to the app's open list (and to title it without that list).
    const live = [...new Set([...lanes.filter(l => !l.hasEnded && now - l.mtimeMs <= LANE_STALE_MS).map(l => l.sessionId.slice(0, 8).toLowerCase()), ...peers.filter(p => now - p.heartbeatAt <= HEARTBEAT_STALE_MS).map(p => p.id8)])].filter(id => id && id !== id8)
    if (live.length > 0 && !isNaming && live.some(id => now - (namesAt.get(id) ?? 0) > NAME_TTL_MS)) $.clock.after(10, () => void refreshNames($, opts, live))
  } else kids.push(el.Box({ key: 'hai-a5-nos2', children: [el.Text({ color: ATHER.quiet, wrap: 'wrap', children: 'This session is not in the S2 checkout: the Editor, Memory and Sync main tools and the sessions list live in an S2 session.' })] }))
  // A19: the Nghiệm thu A5 card, once there is a score or the tracked intent is in Ship.
  if (lastAccept) {
    const rows = lastAccept.scores.map(s => ({ rule: s.rule, name: ruleName(s.rule), state: s.state, line: s.line }))
    kids.push(acceptCard(el, 'A5 acceptance', `${lastAccept.slug ?? 'no intent'} · ${lastAccept.what} · ${clockOf(lastAccept.at)}`, rows, isDesktop))
  }
  // A27: the five rules, last; A20: rule 1's word switches country / project in a Client of its own.
  const { Client } = el as unknown as { Client?: (p: Record<string, unknown>) => unknown }
  const rule1 = opts.motion !== 'off' && Client ? Client({ key: 'hai-rule1', module: './rule1.ts', props: { dither: isDesktop, color: ATHER.quiet, dim: true } }) : undefined
  // A36: the five chips; a press shows or hides that rule's card. "Hits today": the counts start over each day.
  const today = ymd(now)
  if (hitsDay !== today) {
    if (hitsDay) hits = noHits()
    hitsDay = today
  }
  await load($) // the rules text the cards read
  const motto = rule1 ?? el.Text({ color: ATHER.quiet, children: 'Love the project' })
  const pressSeal = (n: number) => () => {
    openRule = openRule === n ? null : n
    $.ui.invalidate('ui.render')
  }
  for (const id of freshHits) hitStampAt[id] = now
  freshHits.clear()
  if (lastAccept && lastAccept.at !== scoreSeenAt) {
    scoreSeenAt = lastAccept.at
    scoreFxAt = now
  }
  const marks = (n: number): unknown[] => {
    const s = lastAccept?.scores.find(x => x.rule === n)
    return s ? [el.Text({ key: `hai-a5-chip-${n}-mark`, color: s.state === 'pass' ? STATUS.ok : s.state === 'fail' ? STATUS.bad : A5_LOOK.quiet, children: s.state === 'pass' ? '✓' : s.state === 'fail' ? '✗' : '–' })] : []
  }
  let rules = rulesChips(el as never, ruleCards(rulesA5), hits, openRule, pressSeal, motto, { ink: A5_LOOK.ivory, quiet: A5_LOOK.quiet, hit: A5_LOOK.hit }, marks)
  if (isFx)
    for (const n of [1, 2, 3, 4, 5]) {
      const id = `D${n}`
      if (now - (hitStampAt[id] ?? -FX_MS) < FX_MS) {
        rules = replaceKeyed(rules, `hai-a5-chip-${n}-box`, box => withOverlay(el as never, box, `hai-a5-fx-hit-${n}`, stampSvg(A5_LOOK.sealBg)))
        fxPlaced = true
      }
      if (lastAccept && now - scoreFxAt < FX_MS) {
        rules = replaceKeyed(rules, `hai-a5-chip-${n}-box`, box => withOverlay(el as never, box, `hai-a5-fx-score-${n}`, curtainSvg({ color: A5_LOOK.gold, begin: (n - 1) * 150, step: 4, clear: true })))
        fxPlaced = true
      }
    }
  if (fxPlaced) $.clock.after(FX_MS + 10, () => $.ui.invalidate('ui.render')) // then still
  kids.push(rules)
  // A37: the entrance, on the desktop, with motion on, for a moment after the pane opened (or first drew).
  if (paneEnterAt === 0) paneEnterAt = now
  const isEntering = isDesktop && opts.motion !== 'off' && now - paneEnterAt < ENTRANCE_MS
  if (isEntering) {
    const plan = entrance(kids.length)
    kids.forEach((k, i) => {
      kids[i] = withCurtain(el as never, k, `hai-a5-in-${i}`, plan[i] as Curtain)
    })
    $.clock.after(ENTRANCE_MS + 10, () => $.ui.invalidate('ui.render')) // then still: the curtains leave the tree
  }
  return recolor(paneOf(el, kids))
}

export const register: Register = (on, options) => {
  const opts = options as unknown as Opts

  on('session.start', async ($, e, next) => {
    const res = await next(e)
    await readTheme($) // A40
    await $.command.register({
      name: 'a5',
      description: 'A5: /a5 (opens the A5 pane) · /a5 on · /a5 off · /a5 status · /a5 accept (A5 acceptance now) · /a5 gate <with PIE GB> <without PIE GB> | reset · /a5 sync HH:MM [build] [for <session>] | move HH:MM | build on|off | cancel | done | abort | takeover (on: the five rules, checked at the action and at A5 acceptance before a PR; Editor holder, RAM and Sync main)',
      argumentHint: 'on | off | status | accept | gate <pie> <nopie> | sync HH:MM',
    })
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

  // D7: the sync worker is this mod's to start, never the model's.
  on('agent.offer', { agent: SYNC_AGENT }, async () => ({ isOffered: false }))

  // A /clear goes on under a new session id: this session's lease, request and sync follow it (A10).
  on('session.end', async ($, e, next) => {
    const res = await next(e)
    if (e.reason === 'clear' && isS2) {
      clearFrom = e.sessionId
      followClear($, opts, e.sessionId, 25)
    }
    return res
  })

  on('command.run', { command: 'a5' }, async ($, e) => {
    if (/^sync\b/i.test(e.args.trim())) return { text: await syncCommand($, opts, e.args.trim().slice(4)) }
    if (/^accept\b/i.test(e.args.trim())) return { text: await acceptCommand($, opts) }
    if (/^gate\b/i.test(e.args.trim())) return { text: await gateCommand($, opts, e.args.trim().slice(4)) }
    // A29: `/a5` with no words opens the A5 pane; `/a5 status` keeps the text reply below.
    if (e.args.trim() === '') return { text: await openA5Pane($) }
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
          ? '★ A5 on: the five rules apply in every session from its next tool call (at the action for what cannot be undone; A5 acceptance before a PR or an intent close); Ather\'s pane takes the red seal and the gold accent.'
          : 'A5 off: the rules, A5 acceptance, the Editor holder, RAM and Sync main gates stop; Ather\'s pane, status line and toasts are Ather\'s own again. The 🟥/⏯️ title marks stay.',
      }
    }
    await readA5($)
    const where2 = chain === null ? 'not seen yet (no tool call so far)' : chain.includes('ather-automata') ? 'above ather-automata: its pane gets the tiles' : `beneath ather-automata (${chain.join(' → ') || 'nothing'} below): the pane cannot be wrapped from here; put a5 first in CLAUDE_CODE_PLUGIN_DIRS`
    const coord =
      a5On && isS2
        ? ` Editor: ${placeText(decision)}; lock: ${(lockRaw ?? '').trim() || 'missing'}. Memory: ${probe ? `${probe.freeGb} GB free` : 'no reading'}, launch gate ${gates.pieGb}/${gates.nopieGb} GB (${gates.source}). Sync: ${syncFile ? `${clockOf(syncFile.at)} ${phaseOf(syncFile, nowMs)} (holder ${syncFile.holder.lane}, hard end ${clockOf(syncFile.hardEnd)})` : 'none planned'}. ${overviewLine(overviewOf({ me8, files: me ? [me, ...peers] : peers, lanes, clients, isS2Cwd: cwd => s2Cwds.get(cwd.toLowerCase()) ?? false, lock, sync: syncFile, now: nowMs, phase: phaseOf(syncFile, nowMs) }))}.`
        : ''
    return { text: `A5 is ${a5On ? 'ON' : 'off'}. Hits this session: ${Object.entries(hits).map(([k, v]) => `${k} ${v}`).join(' · ')}. a5 sits ${where2}.${coord}` }
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const input = e as unknown as Input
    // The main loop's model made this call (a plugin's own `$.tool.call`, this mod's included, is raised by that
    // plugin, not the engine): it marks the session busy, and its result may carry queued notices to the model.
    const isMain = e.agentId === undefined && next.origin.plugin === 'engine'
    if (isMain) isBusy = true
    if (tool === EDITOR_TOOL) return { result: await editorTool($, opts, input) }
    if (tool === SYNC_TOOL) {
      const paths = Array.isArray(input.paths) ? input.paths.map(String) : []
      const text = await syncAction($, opts, str(input.action), { at: str(input.at), holder: str(input.holder), note: str(input.note), paths, build: typeof input.build === 'boolean' ? input.build : undefined })
      return { result: [text, ...drain()].join('\n') }
    }
    const a5 = await load($)
    const isOn = await readA5($)

    // The Editor gate is A5's (D1): with A5 off nothing of a5's refuses an Editor call.
    const frozen = isOn ? await freezeProblem($, opts, a5, tool, input) : null
    if (frozen) return { deny: frozen }
    const editor = isOn ? await editorProblem($, opts, tool, input) : null
    if (editor) return { deny: blocked('Editor lock', editor.split(' → ')[0] ?? editor, editor.split(' → ').slice(1).join(' → ') || 'wait for the Editor') }
    const coord = isOn ? await coordProblem($, opts, tool, input) : null
    if (coord) return { deny: coord }
    // A18: nghiệm thu A5 on the PR-opening call and on an intent close (D10: at acceptance, never per turn).
    const accepted = isOn ? await acceptGate($, opts, a5, tool, input, e.agentId) : null
    if (accepted) return { deny: accepted }

    let d: Decision | null = null
    let what = ''
    let parts: [string, string, string][] = []
    const locs: Located[] = []
    if (SHELL_TOOLS.has(tool)) {
      what = str(input.command)
      if (isOn) {
        const cwd = await $.session.cwd()
        d = a5.preShell(what, cwd, places, 0, await sharedTest($, a5, what, cwd))
        // A15: the sync's own git work passes A5's asks for its holder and worker, during their frozen phase only.
        if (d?.kind === 'ask' && isSyncCommandOnly(what) && (await isFrozenHolder($, opts))) d = null
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
      await $.fs.write(`${(places.TEMP ?? '').replace(/\\/g, '/')}/a5/chain-${id8}.json`, JSON.stringify({ beneath: chain })).catch(() => undefined)
    }
    if (ran.deny !== undefined) return ran
    // A19: a file changed (an edit, a git write): the card scores again at its next draw.
    if (ran.isError !== true && (EDIT_TOOLS.has(tool) || (SHELL_TOOLS.has(tool) && gitWrites(str(input.command)).length > 0))) acceptDirty = true
    if (ran.isError !== true && EDIT_TOOLS.has(tool) && parts.some(([path]) => /docs\/intent\/[^/]+\/(progress|prompt)\.md$/i.test(path.replace(/\\/g, '/')))) prDirty = true
    // A23: a PR this session opened through the gate was scored there; its number is not scored again after the fact.
    if (isOn && ran.isError !== true && (isPrTool(tool) || (SHELL_TOOLS.has(tool) && isPrCommand(what)))) {
      for (const n of openedPrs(JSON.stringify(ran).slice(0, 20_000))) prsKnown.add(n)
      await saveMe($, opts)
    }
    if (isOn && ran.isError !== true) {
      // What the coordination needs from the call: Editor use (the idle lease), PIE running, the paths edited.
      const text = isUnrealMcp(tool) ? JSON.stringify(input).slice(0, 4000) : ''
      if (isUnrealMcp(tool) || (SHELL_TOOLS.has(tool) && EDITOR_WORK.test(what))) lastEditorUseAt = await $.clock.now()
      if (text && mcpKind(text) === 'pie') isPieRunning = true
      if (text && PIE_STOP.test(text)) isPieRunning = false
      if (EDIT_TOOLS.has(tool) && isS2) await recordTouch($, opts, locs)
    }
    // A director call added to an intent's findings this turn (🟥 routing); no per-turn report is kept (D10).
    if (EDIT_TOOLS.has(tool) && ran.isError !== true && parts.some(([path, old, neu]) => isFindingsFile(path) && newLines(old, neu).some(isDirectorCallLine))) wroteDirectorCall = true
    // Mid-turn, queued notices ride the main loop's next tool result (D6); a worker's results carry none.
    if (isOn && isMain && pending.length > 0) {
      const texts = drain()
      await saveMe($, opts)
      return { ...ran, context: [...(ran.context ?? []), ...texts] }
    }
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const res = await next(e)
    // A12: the sync worker's run ended; without done or abort the sync is aborted for it.
    if (e.agentId !== undefined && isS2 && (await readA5($))) {
      await workerEnded($, opts, e.agentId, 'answer' in e && typeof e.answer === 'string' ? e.answer : '').catch(err => $.ui.log(`a5: worker end: ${String(err)}`, { to: 'debug' }))
      if (!isBusy) await deliverIdle($, opts)
    }
    if (e.agentId === undefined) {
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
    // A21: Ather's Ship hand-off is scored at once and the score rides the prompt (never refused: the PR call stays
    // the gate). The origin is what the sender says: it only adds context here, it never opens a gate.
    const origin = e.origin as typeof e.origin | undefined
    const shipFor = origin?.kind === 'plugin' && origin.name === 'ather-automata' ? shipSlugOf(e.text) : null
    const added = shipFor && (await readA5($)) ? await shipScore($, opts, shipFor).catch(() => null) : null
    const text = added ? `${e.text}\n\n${added}` : e.text
    // Notices waiting for the next turn ride this prompt as context the model reads (D6).
    if (pending.length > 0 && (await readA5($))) {
      const texts = drain()
      await saveMe($, opts)
      return next({ ...e, text, context: [...(e.context ?? []), ...texts] })
    }
    return added ? next({ ...e, text }) : next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const res = await next(e)
    await load($)
    const isOn = await readA5($)
    const id8 = (await $.session.id()).slice(0, 8)
    const text = [rulesFlow, isOn ? rulesA5 : ''].filter(Boolean).join('\n\n').replaceAll('{SESSION8}', id8)
    if (!text) return res
    return { ...res, sections: [...res.sections, { id: 'a5:rules', text, scope: 'session' as const }] }
  })

  // Ather's pane: drawn by Ather beneath; this wraps what it drew.
  on('ui.render', { component: 'Pane', requestId: ATHER_PANE }, async ($, e, next) => drawPane($, opts, e, await next(e)))
  // A40: the theme changed in /config: every colour follows at once.
  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const res = await next(e)
    if (!('deny' in res && res.deny)) {
      applyTheme(themeOf(e.value))
      $.ui.invalidate('ui.render')
    }
    return res
  })
  // A29: the A5 pane is this plugin's own: drawn here, never by anything beneath.
  on('ui.render', { component: 'Pane', requestId: A5_PANE }, async ($, e) => drawA5Pane($, opts, e))
}
