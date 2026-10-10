import type { EngineInterface as Engine, Register, RenderElement } from 'claude-code'
import { A5R, commandVerb, deleteTargets, gitTargets, newLines, norm, tokenize, under, type A5RConfig, type Decision, type Located, type Places, type Proof } from './a5r.ts'
import { acceptText, cappedItems, checklistComplete, checklistFull, closesIntent, failed, passKey, inScope, isPrCommand, isPrTool, namedPaths, prCommandRefs, openedPrs, prLinksOf, prNumbersOf, ruleName, score, shipSlugOf, shipText, unreadLine, unreadText, unscored, worstOf, type AcceptInput, type PrLink, type RuleScore } from './accept.ts'
import { bareTitle, hasMark, isDirectorCallLine, isFindingsFile, isPending, markedTitle, pendingLine, readMarker, type Marker } from './decision.ts'
import { FREE_RAM_PROBE, PIE_MIN_FREE_GB, isEditorStartStop, lockProblem, mcpKind, parseEditorLock } from './editor.ts'
import {
  CUTOFF_MS, DIR, HARD_END_WARN_MS, SYNC_BUILD_MIN, SYNC_MERGE_MIN, isSyncHolderGone, withBuild, HEARTBEAT_STALE_MS, LANE_STALE_MS, IDLE_RELEASE_MS, LEASE_WARN_MS, NOTICES, PIE_ABORT_GB, DISK_MIN_GB, RELEASE_BEFORE_MS, YIELD_EVERY_MS, atNearest, atNext, blankSession, clampGate, classify,
  cleanupPlan, decide, ordinal, presetTimes, editorPid, endedSync, freeLine, gatesOf, gitWrites, hash, heldLine, historyBlobs, hhmm as clockOf, isIntentFile, isLockPath, isOpenPhase, livenessOf, mayAskYield,
  movedSync, newSync, noticeIds, noticeText, ownersOf, parseLockLine, parseMergeTree, parseProbe, parseSessionFile, parseSharedProbe, parseSyncFile, parseTouch, queueOf, ramProbe, addsNotice, safeWord,
  PROBE_FRESH_MS,
  lapseOf, releasedNote, type Released, buildProcs, isBuildLease, lockTimes, unrealPids, orchestrateLine, ORCHESTRATE_MAX_BYTES, type OrchestrateEvent,
  syncPhase, isSyncCommandOnly, SYNC_WORKER_PROMPT, syncWorkerTask, parseClients, overviewOf, overviewLine, sessionsView, projectFolder, titleFromRecord, titleSearchPs, TITLE_PATTERN, withoutModOf, noModMessage, type ClientRow, type NoMod, ueRequestLine, withConflicts, withUntracked, parseAdded, writesLock, writesNoticeToIntent, ymd, type Conflict, type Decision as GrantDecision, type Gates, type GrantInput, type LaneBeat, type LockLine, type Notice, type Probe,
  type Phase, type SessionFile, type SyncFile, type SyncHolder, type Touch, type Want,
} from './coord.ts'
import { classifyGit, exactAlternative, gitPlace, isGit, repoPath, walk } from './gitshared.ts'
import { JUDGE_SYSTEM, defaultRecommendation, digestOf, hintOf, judgePrompt, parseTail, parseVerdict, type JudgeFacts, type VerdictRow } from './judge.ts'
import { curtainSvg, entranceCurtains, entranceLife, fxLife, icon, paceOf, scoreCurtain, sealSvg, stampSvg, sweepSvg, type Curtain, type Motion } from './icons.ts'
import { A5R_LOOK, ATHER, STATUS, V2, a5rBand, applyTheme, currentTheme, themeOf, noHits, recolor, replaceKeyed, ruleCards, rulesChips, RULE_SHORT, scarfAvatars, withSeal, type RuleHits } from './theme.ts'
import { PIE_START_GB, acceptCard, ago, compactLine, sessionsBox, editorTile, type LinePart, lockLine, mainTile, memoryTile, parseLockView, ramBand, tilesRow, toMin, type LockView, type Sync, type SyncData, type Vitals } from './watch.ts'

// Hai's S2 flow beside Ather Automata, which it never changes. With A5R off it draws nothing into Ather's
// pane, status line or toasts and gates nothing; only the 🟥 / ⏯️ title marks stay (D1).
// - A5R (a5r.ts, accept.ts, rules/config.json), only while `/a5r on`: the five rules (D9). At the tool call it
//   refuses or asks only before what cannot be undone (D10); nothing per turn. Everything else is scored at
//   acceptance (nghiệm thu A5R) over the branch, the intent's files and Ather's proof, when a PR is opened or
//   an intent closes. Rules about the shared checkout skip a worker's own worktree. A73: nothing asks or waits at the action.
// - A5R's coordination (coord.ts) for the sessions sharing one S2 checkout and one machine: the Editor
//   holder (model tool `editor`: a queue computed alike by every session from Saved/A5R files, a lease
//   with a hard end, the lock written in the S2 standard's lines), RAM (safe cleanup before a grant, the
//   launch gate, PIE 5/3 GB fixed) and the Sync main holder (`/a5r sync`, model tool `sync`: cutoff, freeze,
//   conflicts to their owners). One minute timer reads files and probes; it wakes the model only for an
//   event addressed to this session. Notices start "A5R ·" and are never logged in docs/intent.
// - 🟥 / ⏯️ (decision.ts), always: the title is marked and unread set. A 🟥 that relays an intent's director
//   call (a worker added it to findings.md, intent skill) is in Ather's Needs you already; any other 🟥 gets
//   one PENDING.md line, so no decision is lost.
// - Ather's pane (theme.ts, watch.ts, icons.ts), A5R on only: its home view gains Editor holder · Memory ·
//   Sync main tiles with pixel icons; the accent turns gold, a red seal joins the brand, the five rules sit
//   at the foot. Icons move only when a state turns over (a dither reveal) or a sync runs (a dither sweep).
// Every refusal reads the same: "A5R · <gate> — <why> → <what next>".
// Module variables are this session's (one process per session); a reload starts them over, and what must
// survive one (the request, the lease, delivered notice ids) lives in this session's own file.

type Opts = { a5rWhenPresent: string; editorLock: string; pendingFile: string; motion: string; launchGatePieGb?: number; launchGateGb?: number; syncMergeMinutes?: number; syncBuildMinutes?: number }
type Input = Record<string, unknown>

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])
const ATHER_PANE = 'ather'
const A5R_PANE = 'a5r'
const PANE_INK = (): { ink: string; quiet: string } => ({ ink: A5R_LOOK.ivory, quiet: A5R_LOOK.quiet }) // A33/A40: the A5R pane's text and quiet grey, per theme // A29: the A5R pane's id ($.ui.open) and its render requestId
const EDITOR_PERIOD_MS = 60_000
const SYNC_STALE_MS = 3 * 60_000
const MOTION_MS = 2_500 // a state change animates in renders within this window
const RULE_NAMES: Record<string, string> = RULE_SHORT // D9 / A34, short for refusals
const INK = (): string => A5R_LOOK.paneInk // A40: the pane's ink, per theme

let engine: A5R | null = null
let rulesA5R = ''
let rulesFlow = ''
let places: Places = {}
const rootOf = new Map<string, string | null>()
const isLinked = new Map<string, boolean>() // git root -> a linked worktree (one session's own), not the shared checkout
let wroteDirectorCall = false // this turn added an open director call to an intent's findings.md
let a5rOn = false
let a5rFlipAt = 0
let hits: RuleHits = noHits()
let hitsDay = '' // A32: the day the counts are for ('Hits today')
let openRule: number | null = null // A32: the rule whose card is open in the A5R pane
// A37: when the A5R pane opened (or first drew) and when the compact line first drew: their entrance plays then.
let paneEnterAt = 0
let lineEnterAt = 0
// A51: their timings (and `motion: slow`, ten times slower) live in icons.ts: ENTRANCE_MS, entranceLife, fxLife.
// A38: one-shot event dithers (≤ 1 s): a rule chip stamps red when its rule is hit; the band sweeps at the sync freeze
// (❄ in) and back at the lift; a new acceptance score resolves the chips one by one to ✓ / ✗.
const freshHits = new Set<string>() // rules hit since the A5R pane last drew
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

// A5R's coordination: what this session last read from the files and the machine (coord.ts decides).
const EDITOR_TOOL = 'mcp__a5r__editor'
const SYNC_TOOL = 'mcp__a5r__sync'
const SYNC_AGENT = 'a5r:sync' // D7: the sync worker's agent type
const JUDGE_AGENT = 'a5r:judge' // A65: the advisory judge's agent type
const CLEANUP_EVERY_MS = 5 * 60_000 // while a slot waits on RAM, the safe cleanup runs at most this often
const PIE_STOP = /StopPIE|EndPIE|StopPlayInEditor|EndPlayMap|RequestEndPlayMap/i
const EDITOR_WORK = /Build\.(bat|sh|cmd)\b|UnrealEditor|RunUAT/i
let hasTools = false
let me: SessionFile | null = null // this session's own file (Saved/A5R/editor/<id8>.json), as last written
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
// A59: the last wake prompt this session queued, and the last sign that a turn ran (a prompt, a main-loop tool call,
// a turn's end): a wake whose turn never starts frees the busy flag after WAKE_WAIT_MS.
let wakeAt = 0
let turnSignalAt = 0
const WAKE_WAIT_MS = 30_000
let mergeHead = false // A61: .git/MERGE_HEAD exists in the shared checkout (read every minute)
let agentsNow: number | null = null // A62: this session's running background agents at the last minute
let agentKindsNow: string[] = [] // A67: their kinds
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
// A18/A19: the last acceptance score; A52: after the fact, one score per PR (`prs`) and `scores` the worst of them.
let lastAccept: { at: number; slug: string | null; scores: RuleScore[]; what: string; prs?: { n: number; label: string; scores: RuleScore[] }[] } | null = null
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
const blocked = (gate: string, why: string, next: string): string => `A5R · ${gate} — ${why} → ${next}`

async function load($: Engine): Promise<A5R> {
  if (engine) return engine
  const root = $.plugin.root.replace(/\\/g, '/')
  const cfg = JSON.parse(await $.fs.read(`${root}/rules/config.json`)) as A5RConfig
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
  rulesA5R = await $.fs.read(`${root}/rules/rules-a5r.md`).catch(() => '')
  rulesFlow = await $.fs.read(`${root}/rules/rules-flow.md`).catch(() => '')
  engine = new A5R(cfg, places)
  return engine
}

/** Whether A5R is on: Hai's switch, kept across sessions in this plugin's store. Notes when it just came on. */
async function readA5R($: Engine): Promise<boolean> {
  const v = (await $.store.get('a5r').catch(() => null)) as { on?: boolean } | null
  const on = v?.on === true
  if (on && !a5rOn) a5rFlipAt = await $.clock.now()
  a5rOn = on
  return a5rOn
}

/** The git project a file lives in (walks up to a `.git`), cached per folder. */
async function locate($: Engine, a5r: A5R, path: string): Promise<Located> {
  const p = norm(path, await $.session.cwd())
  const known = a5r.roots.find(r => under(p, r))
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
async function sharedTest($: Engine, a5r: A5R, command: string, cwd: string): Promise<(dir: string) => boolean> {
  const known = new Map<string, boolean>()
  for (const dir of [cwd, ...gitTargets(command)]) {
    const p = norm(dir, cwd)
    known.set(p.toLowerCase(), await isSharedRoot($, (await locate($, a5r, `${p}/_`)).root))
  }
  return dir => known.get(norm(dir || cwd, cwd).toLowerCase()) ?? true
}

type AtherStatus = { role?: string; pack?: string; gates?: string[]; tracked?: { slug?: string; stage?: string; checklist?: string; directorCalls?: string[]; prs?: string[] } | null; evidence?: Proof['evidence'] }

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
  s?.tracked?.slug ? { intent: s.tracked.slug, role: s.role ?? '', evidence: s.evidence ?? {}, ...(s.pack ? { pack: s.pack, gates: s.gates ?? [] } : {}) } : null

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

/** A73: what a rule-1 match does at the action. Nothing asks and nothing waits: a call is refused only with an alternative
 * the agent can carry out itself (`refuse`), runs after a check of the facts (`check`, A74: git that can discard work in
 * the shared checkout), or runs and is recorded for nghiem thu (`record`, A75: shared config, recursive deletes, removed
 * test assertions, edits outside a scope file, global git config). The permission mode and an away window change nothing. */
type Act = { act: 'refuse' | 'check' | 'record'; alt?: string }
const ACTIONS: Record<string, Act> = {
  'no-verify': { act: 'refuse', alt: 'fix what the hook reports, then commit without --no-verify' },
  'lfs-skip-smudge': { act: 'refuse', alt: 'let LFS fetch the objects (git lfs pull), or work in a worktree of your own' },
  'sparse-checkout': { act: 'refuse', alt: 'make a worktree of your own and set its sparse layout there' },
  kit: { act: 'refuse', alt: 'change the mod in a worktree of its repository (D:/Projects/ather-mods-wt/<name>), never in the live plugin folder' },
  secret: { act: 'refuse', alt: 'keep the secret in an environment variable or a config file outside the repository' },
  'force-push': { act: 'refuse', alt: 'push to a new branch and open a PR; never rewrite shared history' },
  'push-main': { act: 'refuse', alt: 'push your branch and open a PR' },
  'add-all': { act: 'refuse', alt: 'stage exact paths: git add -- <path> ...' },
  // git-discard and git-switch are read by gitSharedProblem (segment by segment, on facts).
  'git-switch': { act: 'check' },
  'git-discard': { act: 'check' },
}
/** A75 (review 6): global git keys whose change breaks every repository on the machine; p4 obliterate cannot be undone. */
const GLOBAL_CONFIG_REFUSED = /\bconfig\s+--global\s+(?:--\S+\s+)*(credential\.|lfs\.|core\.(autocrlf|eol|hookspath|fsmonitor)\b|filter\.)/i
const actOf = (d: Decision, command = ''): Act => {
  if (d.key === 'git-config-global' && GLOBAL_CONFIG_REFUSED.test(command)) return { act: 'refuse', alt: 'set it for this repository (git config --local <key> <value>) or for one command (git -c <key>=<value> <command>)' }
  if (d.key === 'p4-destructive' && /\bp4\s+obliterate\b/i.test(command)) return { act: 'refuse', alt: 'p4 obliterate cannot be undone: use p4 delete (a recoverable revision), or leave the files' }
  return ACTIONS[d.key] ?? (d.kind === 'deny' ? { act: 'refuse', alt: 'do it another way' } : { act: 'record' })
}

/** A74 (rev 27, after the adversary review): git in the shared checkout, segment by segment with the folder each runs
 * in (`cd`, `pushd`, `popd`, `-C`). Moving the tree, reset --hard, clean -x and the other forms that cannot be read on
 * facts are refused with the alternative; a discard runs when the exact paths it names (resolved to the repository)
 * have no uncommitted change, or only changes in this session's touch paths that no other live session claims; a
 * discard that names no paths, `.`, or a whole top folder is refused with the same command on exact paths (a status of
 * the whole S2 tree takes 36-82 s). One path-scoped `git status` per segment, 8 s at most. Null: it may run. */
async function gitSharedProblem($: Engine, opts: Opts, a5r: A5R, command: string, cwd: string): Promise<string | null> {
  const gate = gateOf('D1')
  for (const seg of walk(command, cwd)) {
    if (!isGit(seg)) continue
    const { dir, args } = gitPlace(seg)
    const act = classifyGit(args)
    if (!act) continue
    const root = (await locate($, a5r, `${dir}/_`)).root
    if (!root || !(await isSharedRoot($, root))) continue
    if (act.kind === 'refuse') return blocked(gate, `${act.why} (the shared checkout)`, act.alt)
    if (act.kind === 'stash-drop') {
      const list = await $.process.run(['git', '-C', root, 'stash', 'list'], { timeoutMs: 8_000 }).catch(() => null)
      const n = list?.exitCode === 0 ? list.stdout.split(/\r?\n/).filter(Boolean).length : null
      if (n === 0) continue
      return blocked(gate, n === null ? 'git stash list could not be read' : `the shared checkout holds ${n} stash entr${n === 1 ? 'y' : 'ies'}, any of them maybe another session's`, 'leave the stash as it is; keep your own work in a commit or a worktree of your own')
    }
    if (act.paths.length === 0) return blocked(gate, `git ${act.sub} names no paths, so it would act on the whole shared working tree`, exactAlternative(act.sub))
    const rels: string[] = []
    for (const spec of act.paths) {
      const r = repoPath(spec, dir, root)
      if ('why' in r) return blocked(gate, `git ${act.sub} on ${r.why} cannot be checked on facts in the shared checkout`, exactAlternative(act.sub))
      rels.push(r.rel)
    }
    const ran = await $.process.run(['git', '-C', root, 'status', '--porcelain=v1', '-z', `--untracked-files=${act.untracked ? 'all' : 'no'}`, '--', ...rels], { timeoutMs: 8_000 }).catch(() => null)
    if (!ran || ran.exitCode !== 0) return blocked(gate, `git status could not be read in the shared checkout${ran ? ` (exit ${ran.exitCode})` : ' within 8 s'}, so what git ${act.sub} would discard is unknown`, 'name fewer, deeper paths, or run it in a worktree of your own')
    const changed = ran.stdout.split(/\0|\r?\n/).filter(e => /^.. \S/.test(e)).map(e => e.slice(3).trim()).filter(Boolean)
    const now = await $.clock.now()
    const mine = new Set([...touched].map(p => p.toLowerCase()))
    const others = touches.filter(t => isLive(t.id8, now))
    const foreign: string[] = []
    for (const p of changed) {
      const t = others.find(o => o.paths.some(x => x.toLowerCase() === p.toLowerCase()))
      // A74 (review 5): a path another live session claims is its, even when this session touched it too.
      if (t) foreign.push(`${p} (${t.lane}'s, session ${t.id8}${mine.has(p.toLowerCase()) ? '; this session touched it too' : ''})`)
      else if (!mine.has(p.toLowerCase())) foreign.push(`${p} (no session claims it)`)
    }
    if (foreign.length > 0)
      return blocked(gate, `git ${act.sub} would discard uncommitted changes in the shared checkout: ${foreign.slice(0, 6).join('; ')}${foreign.length > 6 ? `; and ${foreign.length - 6} more` : ''}`, 'commit or move those changes first (their owner does), or run it in a worktree of your own (git worktree add)')
  }
  return null
}

/** A74 (review 5): after this session commits in the shared checkout, its touch set keeps only the paths still changed
 * (a committed path is no longer its uncommitted work). */
async function pruneTouched($: Engine, opts: Opts): Promise<void> {
  if (!me || touched.size === 0) return
  const paths = [...touched].slice(-200)
  const ran = await $.process.run(['git', '-C', s2Root(opts), 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...paths], { timeoutMs: 8_000 }).catch(() => null)
  if (!ran || ran.exitCode !== 0) return
  const still = new Set(ran.stdout.split(/\0|\r?\n/).filter(e => /^.. \S/.test(e)).map(e => e.slice(3).trim().toLowerCase()))
  let changed = false
  for (const p of [...touched]) if (!still.has(p.toLowerCase())) {
    touched.delete(p)
    changed = true
  }
  if (!changed) return
  const t: Touch = { session: me.session, id8: me8, lane: me.lane, paths: [...touched].slice(-500), updatedAt: await $.clock.now() }
  await $.fs.write(`${hfDir(opts)}/touch/${me8}.json`, JSON.stringify(t)).catch(() => undefined)
}

/** A75: one action that ran and is recorded for nghiem thu: Saved/A5R/recorded/<id8>.json, this session's file. */
type Recorded = { at: number; id8: string; lane: string; kind: string; rule: string; path: string; target?: string; root: string | null; why: string }
/** A75 (review 6): what a recorded shell action is about, for nghiem thu to look for in progress.md or findings.md: a
 * delete's targets, a config key, a depot path; else the command. */
const recordTarget = (kind: string, command: string): string => {
  const [, args] = commandVerb(tokenize(command))
  if (kind === 'delete') return deleteTargets(args).join(' ') || command.slice(0, 120)
  if (kind === 'git-config-global') return /--global\s+(?:--\S+\s+)*(\S+)/.exec(command)?.[1] ?? command.slice(0, 120)
  return args.filter(a => !a.startsWith('-')).slice(-1)[0] ?? command.slice(0, 120)
}
async function recordAction($: Engine, opts: Opts, r: Omit<Recorded, 'at' | 'id8' | 'lane'>): Promise<void> {
  if (!(await $.fs.exists(s2Root(opts)))) return
  const id8 = me8 || (await $.session.id()).slice(0, 8).toLowerCase()
  const path = `${hfDir(opts)}/recorded/${id8}.json`
  let entries: Recorded[] = []
  try {
    const v = JSON.parse((await readJson($, path)) ?? '') as { entries?: Recorded[] }
    entries = Array.isArray(v.entries) ? v.entries : []
  } catch {
    entries = []
  }
  entries.push({ ...r, at: await $.clock.now(), id8, lane: me?.lane ?? id8 })
  await $.fs.write(path, JSON.stringify({ v: 1, entries: entries.slice(-300) })).catch(() => undefined)
}
/** A75: every session's recorded actions (for nghiem thu). */
async function readRecorded($: Engine, opts: Opts): Promise<Recorded[]> {
  const dir = `${hfDir(opts)}/recorded`
  const out: Recorded[] = []
  for (const f of await $.fs.list(dir).catch(() => [])) {
    if (f.kind !== 'file' || !f.name.endsWith('.json')) continue
    try {
      const v = JSON.parse((await readJson($, `${dir}/${f.name}`)) ?? '') as { entries?: Recorded[] }
      if (Array.isArray(v.entries)) out.push(...v.entries)
    } catch {
      // a half-written file: the next read has it
    }
  }
  return out
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
    if (a5rOn) $.ui.toast(`🟥 Waiting on Hai${isInFindings ? ' (Ather: Needs you)' : ''}: ${m.question.slice(0, 80)}`, { timeoutMs: 12_000 })
    await callTool($, { tool: 'mcp__ccd_sidebar__set_unread', session_id: 'self', unread: true }).catch(() => '')
  }
  const sign = m.kind === 'decision' ? '🟥' : '⏯️'
  if (now && !now.startsWith(sign)) {
    await retitle($, markedTitle(now, sign)).catch(() => '')
  }
}


/** The line under the prompt says only what the pane would not tell at a glance: ★ A5R while it is on, and
 * an Editor lease run over or RAM under the PIE gate. The normal state is silence (the pane has it). */
function showStatus($: Engine): void {
  // A5R off: the status line is Ather's alone (D1); a line this mod set earlier is taken down once.
  if (!a5rOn) {
    if (isStatusShown) $.ui.status(undefined)
    isStatusShown = false
    return
  }
  const end = toMin(lockView?.until)
  const isOver = Boolean(lockView && !lockView.isFree && !lockView.isMissing && end !== undefined && end < nowMin)
  const parts = [
    a5rOn ? '★ A5R' : '',
    isS2 && isOver ? `Editor: ${lockView?.who ?? 'held'} over its lease` : '',
    isS2 && vitals && ramBand(vitals.freeGb) !== 'ok' ? `RAM ${vitals.freeGb} GB free` : '',
    isS2 && syncFile && ['cutoff', 'frozen'].includes(phaseOf(syncFile, nowMs)) ? `Sync ${clockOf(syncFile.at)} ${phaseOf(syncFile, nowMs)}` : '',
  ].filter(Boolean)
  $.ui.status(parts.length ? parts.join(' · ') : undefined)
  isStatusShown = parts.length > 0
}

// ---------- A5R coordination: files, the minute tick, notices ----------
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
  // A55: no turn time yet (a new session, or a file from before 0.12.4): this start counts as one, so a lease it may
  // already hold (granted before it started) is never judged unseen.
  if (me.lastTurnAt === undefined) me = { ...me, lastTurnAt: await $.clock.now() }
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
    if (!(await writeLock($, opts, line))) $.ui.log('a5r: the lock changed while moving it to the cleared session id', { to: 'debug' })
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
  me = { ...me, heartbeatAt: now, delivered: [...delivered].slice(-200), prsKnown: [...prsKnown].slice(-500), prBaseline: [...prBaseline].slice(-100), prScorer: POSTHOC_SCORER, ...(agentsNow === null ? {} : { agents: agentsNow, agentKinds: agentKindsNow }), yieldAsks: me.yieldAsks.filter(a => now - a.at < YIELD_EVERY_MS) }
  await $.fs.write(`${hfDir(opts)}/editor/${me.id8}.json`, JSON.stringify(me)).catch(err => $.ui.log(`a5r: session file not written: ${String(err)}`, { to: 'debug' }))
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

/** A9: the machine reading every A5R session shares. A session probes only when Saved/A5R/probe.json is older
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
  mergeHead = await $.fs.exists(`${root}/.git/MERGE_HEAD`).catch(() => false) // A61
  verdicts = await readVerdicts($, opts) // A65
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
  const grep = await $.process.run(['grep', '-oE', TITLE_PATTERN, path], { timeoutMs: 15_000 }).catch(() => null)
  if (grep && (grep.exitCode === 0 || grep.exitCode === 1)) return grep.stdout
  // A44: UTF-8 out and in, or emoji and dashes in a title come back as "?".
  const ps = await $.process.run(titleSearchPs(path), { timeoutMs: 20_000 }).catch(() => null)
  return ps?.exitCode === 0 ? ps.stdout : ''
}

/** A26: names for the live sessions whose a5r file gives none (Ather-only sessions), from their records. */
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
  const batch = [...pending]
  const texts = drain()
  isBusy = true
  const at = await $.clock.now()
  wakeAt = at
  await saveMe($, opts)
  try {
    await $.prompt.submit({ text: texts.join('\n\n') })
  } catch (err) {
    // A59: a refused wake frees the busy flag and puts its notices back, so the next minute (or the next notice) tries again.
    $.ui.log(`a5r: notice prompt not queued: ${String(err)}`, { to: 'debug' })
    for (const n of batch) delivered.delete(n.id)
    pending = [...batch, ...pending.filter(p => !batch.some(b => b.id === p.id))]
    isBusy = false
    await saveMe($, opts)
    return
  }
  // A59: a wake whose turn never starts (no prompt, tool call or turn end seen) does not keep the session muted.
  $.clock.after(WAKE_WAIT_MS, () => {
    if (wakeAt === at && isBusy && turnSignalAt < at) {
      isBusy = false
      $.ui.log('a5r: the notice prompt started no turn within 30 s; the next notice will wake the session again', { to: 'debug' })
    }
  })
}

/** The model tools, registered the first time A5R is seen on in this session (D1: none while it is off). */
async function ensureTools($: Engine): Promise<void> {
  if (hasTools) return
  hasTools = true
  await $.tool.register({
    name: 'editor',
    description:
      'a5r A5R Editor holder for the shared S2 checkout: the only way to take or give the Unreal Editor while A5R is on. ' +
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
  }).catch(err => $.ui.log(`a5r: editor tool not registered: ${String(err)}`, { to: 'debug' }))
  await $.tool.register({
    name: 'sync',
    description:
      'a5r A5R Sync main holder for the shared S2 checkout: plans a merge of origin/main and its timeline. At the cutoff (sync − 30 min) every session is told to commit its own paths, write its resume note and release the Editor by sync − 10; ' +
      'from the sync time until done or abort, other sessions are refused git writes and Editor use in the shared checkout; the freeze is a lease with a hard end (T + 45 min, T + 90 min with a build), after which the sync expires and Hai is asked. At the sync time the holder\'s a5r starts the sync worker, which runs the merge and ends with done or abort. ' +
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
  }).catch(err => $.ui.log(`a5r: sync tool not registered: ${String(err)}`, { to: 'debug' }))
  // D7: the sync worker's agent type, spawned by this mod at the sync time and hidden from the model (agent.offer).
  await $.agent.register({ name: 'sync', description: 'a5r sync worker: runs the planned merge of origin/main into the shared S2 checkout at the sync time and ends it with done or abort. Started by a5r only.', prompt: SYNC_WORKER_PROMPT, background: true }).catch(err => $.ui.log(`a5r: sync worker type not registered: ${String(err)}`, { to: 'debug' }))
  // A65: the advisory judge, read-only (Read and Grep only), a small model, a few turns, no CLAUDE.md; started by a5r only.
  await $.agent.register({ name: 'judge', description: 'a5r advisory judge: reads a stalled lease holder\'s facts and transcript tail and gives one verdict. Started by a5r only.', prompt: JUDGE_SYSTEM, tools: ['Read', 'Grep'], model: 'haiku', maxTurns: 6, omitClaudeMd: true, background: true }).catch(err => $.ui.log(`a5r: judge type not registered: ${String(err)}`, { to: 'debug' }))
}

/** D7: at T the holder's a5r starts the sync worker, once per sync (sync.json records it before the spawn,
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
  const id = ran.agentId ?? (await $.agent.list().catch(() => [])).filter(a => a.type === SYNC_AGENT && a.spawnedBy === 'a5r').pop()?.id
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
  tickChain = tickChain.then(() => tick($, opts)).catch(err => $.ui.log(`a5r tick: ${String(err)}`, { to: 'debug' }))
  return tickChain
}

async function tick($: Engine, opts: Opts): Promise<void> {
  await readTheme($)
  if ((await readA5R($)) && !isScoring && (prDirty || (await $.clock.now()) - shipCheckedAt >= SHIP_CHECK_MS)) await refreshAccept($, opts)
  if (!(await readA5R($))) {
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
  await lapseStep($, opts, now)
  await judgeStep($, opts, now).catch(err => $.ui.log(`a5r: judge: ${String(err)}`, { to: 'debug' }))
  await editorStep($, opts, now)
  await syncStep($, opts, now)
  await mergeGuardStep($, opts, now)
  ramStep(opts, now)
  const running = (await $.agent.list().catch(() => [])).filter(a => a.status === 'running') // A62, A67
  agentsNow = running.length
  agentKindsNow = running.map(a => a.type || 'agent')
  await saveMe($, opts, now)
  showMachine($, now)
  await deliverIdle($, opts)
  showStatus($)
  $.ui.invalidate('ui.render')
}

const grantInput = (now: number): GrantInput => ({ me8, lock, files: me ? [me, ...peers] : peers, lanes, now, sync: syncFile, probe, gates, mergeHead })
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
    await notePid($, opts, false)
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

/** A60: Saved/A5R/released/<id8>.json: the releases other sessions made of this holder's lease (A54, A55). Its
 * writers are the releasing sessions only; the holder reads it and acknowledges each release by its notice id (kept
 * in its own file's delivered list), so the holder's own saves can never erase one. */
const releasedPath = (opts: Opts, id8: string): string => `${hfDir(opts)}/released/${id8}.json`
const readReleases = async ($: Engine, opts: Opts, id8: string): Promise<Released[]> => {
  try {
    const v = JSON.parse((await readJson($, releasedPath(opts, id8))) ?? '') as { releases?: unknown }
    return Array.isArray(v.releases) ? (v.releases as Released[]).filter(r => r && typeof r.since === 'number' && (r.kind === 'lapsed' || r.kind === 'unseen')) : []
  } catch {
    return []
  }
}

/** A62: one line in Saved/A5R/orchestrate.log (rotated past about 1 MB into orchestrate.log.1). */
async function orchestrateLog($: Engine, opts: Opts, e: OrchestrateEvent): Promise<void> {
  const path = `${hfDir(opts)}/orchestrate.log`
  const cur = (await $.fs.read(path).catch(() => '')) ?? ''
  const line = `${orchestrateLine(e)}\n`
  if (cur.length + line.length > ORCHESTRATE_MAX_BYTES) {
    await $.fs.write(`${path}.1`, cur).catch(() => undefined)
    await $.fs.write(path, line).catch(() => undefined)
  } else await $.fs.write(path, cur + line).catch(() => undefined)
}

/** A62: the facts a log line carries about the lock's holder. */
function holderFacts(held: LockLine, now: number, p: Probe | null): Omit<OrchestrateEvent, 'at' | 'rule' | 'acted'> {
  const all = me ? [me, ...peers] : peers
  const f = all.find(x => x.id8 === held.id8)
  return { lane: held.lane, id8: held.id8, procs: (p?.procs ?? []).map(x => x.name), liveness: livenessOf(held.id8, all, lanes, now), lastTurnAt: f?.lastTurnAt ?? null, agents: f?.id8 === me8 ? agentsNow : (f?.agents ?? null), build: isBuildLease(held, f) }
}

/** A62: the candidate rules (Tier 1, not acted on yet), each logged once per lease by the first session to claim it:
 * a lease held with no Editor or build running; its holder gone. A64: no rule reads a title mark or PENDING.md;
 * whether a holder waits on Hai is read from its own transcript by the judge (A65). */
async function logCandidates($: Engine, opts: Opts, now: number): Promise<void> {
  const held = lock
  if (held.kind !== 'held' || !held.isStandard || !held.id8 || !probe) return
  const t = lockTimes(held, now)
  if (!t) return
  const facts = holderFacts(held, now, probe)
  const once = async (rule: OrchestrateEvent['rule'], note: string) => {
    if (await claimAlert($, opts, `log-${rule}-${held.id8}-${t.since}`)) await orchestrateLog($, opts, { ...facts, at: now, rule, acted: false, note })
  }
  if (unrealPids(probe).length === 0 && buildProcs(probe).length === 0) await once('no-editor', `lease ${clockOf(t.since)}-${clockOf(t.end)} held with no Unreal Editor or build process running`)
  if (facts.liveness === 'gone') await once('holder-gone', `the holder's session is gone; lease ${clockOf(t.since)}-${clockOf(t.end)}`)
}

/** A54 / A55: this session's own lease released by another session's A5R (A60: its released file says why): one
 * coordination notice each, and the lease and request it held are dropped (it requests again). Then any session
 * releases a lapsed lease (A58: its holder gone, no Editor and no build running, not a build lease) or passes on an
 * unseen grant: a fresh probe confirms, one session claims the release (the alert-file claim), writes the standard
 * FREE line (read-compare-write) and the holder's released file; the head of the queue is granted at its own next
 * minute (this one's, when it is the head). Every release and every candidate rule is logged (A62). Nothing is ever
 * closed or killed. */
async function lapseStep($: Engine, opts: Opts, now: number): Promise<void> {
  if (!me) return
  for (const r of await readReleases($, opts, me8)) {
    const id = noticeIds.released(r)
    if (delivered.has(id) || pending.some(n => n.id === id)) continue
    push({ id, text: r.kind === 'lapsed' ? NOTICES.lapsed(r) : NOTICES.passedOn(r), isActionable: true })
    // The lease (or, once it is dropped, the request it served) is the released one: drop both; a newer request stays.
    const isThat = me.holding ? Math.abs(me.holding.since - r.since) < 60_000 : (me.want?.requestedAt ?? 0) <= r.since
    if (!holdsLock() && isThat) me = { ...me, holding: null, want: null }
  }
  await logCandidates($, opts, now).catch(err => $.ui.log(`a5r: orchestrate log: ${String(err)}`, { to: 'debug' }))
  const all = [me, ...peers]
  const waiting = queueOf(all, lanes, now, syncFile)
  const input = { lock, files: all, lanes, now, waiting }
  if (!lapseOf({ ...input, probe })) return
  const fresh = await freshProbe($, opts)
  const r = lapseOf({ ...input, probe: fresh })
  if (!r || !fresh) return
  probe = fresh
  const held = lock
  if (!(await claimAlert($, opts, `lease-${r.kind}-${held.id8}-${r.since}`))) return
  const line = freeLine({ since: now, by: me.lane, note: releasedNote(r, held), background: 'none' })
  if (!(await writeLock($, opts, line))) return
  const released: Released = { ...r, by: me.lane }
  await orchestrateLog($, opts, { ...holderFacts(held, now, fresh), at: now, rule: r.kind === 'lapsed' ? 'A54-lapsed' : 'A55-unseen', acted: true, note: releasedNote(r, held) }).catch(() => undefined)
  const list = await readReleases($, opts, held.id8)
  await $.fs.write(releasedPath(opts, held.id8), JSON.stringify({ v: 1, releases: [...list, released].slice(-10) })).catch(err => $.ui.log(`a5r: released file not written: ${String(err)}`, { to: 'debug' }))
  if (held.id8 === me8) me = { ...me, holding: null, want: null }
}

// ---------- A65: the advisory judge ----------
let verdicts: VerdictRow[] = [] // Saved/A5R/verdicts.json, the latest first
const judges = new Map<string, { facts: JudgeFacts; hint: { verdict: VerdictRow['verdict']; evidence: string[] } }>() // agentId → incident
const JUDGE_IDLE_MS = 10 * 60_000
const verdictsPath = (opts: Opts): string => `${hfDir(opts)}/verdicts.json`
async function readVerdicts($: Engine, opts: Opts): Promise<VerdictRow[]> {
  try {
    const v = JSON.parse((await readJson($, verdictsPath(opts))) ?? '') as { verdicts?: unknown }
    return Array.isArray(v.verdicts) ? (v.verdicts as VerdictRow[]).filter(r => r && typeof r.at === 'number' && typeof r.verdict === 'string') : []
  } catch {
    return []
  }
}

/** A65: the last `max` lines of the holder's transcript: read whole when it is small enough, else its tail by PowerShell. */
async function transcriptTail($: Engine, path: string, max = 200): Promise<string> {
  if (!path) return ''
  const whole = await $.fs.read(path).catch(() => null)
  if (whole !== null) return whole.split(/\r?\n/).slice(-max).join('\n')
  const ps = await $.process.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', `[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-Content -LiteralPath '${path.replace(/'/g, "''")}' -Tail ${max} -Encoding UTF8`], { timeoutMs: 20_000 }).catch(() => null)
  return ps?.exitCode === 0 ? ps.stdout : ''
}

/** A65: one incident to judge, if any: the Editor lease past its end or its holder silent 10 min while holding; the
 * sync holder silent 10 min in its cutoff or freeze. Never this session's own holding. */
function incidentOf(now: number): { kind: 'editor' | 'sync'; id8: string; lane: string; session: string; since: number; end: number | null; why: string } | null {
  const all = me ? [me, ...peers] : peers
  if (lock.kind === 'held' && lock.isStandard && lock.id8 && lock.id8 !== me8) {
    const t = lockTimes(lock, now)
    const f = all.find(x => x.id8 === lock.id8)
    if (t) {
      // A70: silence counts from the later of the grant and the last turn (a grant just made is not 40 min of silence).
      const quietFrom = typeof f?.lastTurnAt === 'number' ? Math.max(t.since, f.lastTurnAt) : null
      const silent = quietFrom !== null && now - quietFrom >= JUDGE_IDLE_MS && (f?.agents ?? 0) === 0 // A67
      if (now > t.end || silent)
        return { kind: 'editor', id8: lock.id8, lane: lock.lane, session: f?.session ?? '', since: t.since, end: t.end, why: now > t.end ? `the Editor lease ended ${clockOf(t.end)} and is still held` : `the Editor holder has run no turn for ${Math.round((now - (quietFrom ?? now)) / 60_000)} min while holding (granted ${clockOf(t.since)})` }
    }
  }
  const s = syncFile
  const phase = phaseOf(s, now)
  if (s && (phase === 'cutoff' || phase === 'frozen') && s.holder.id8 !== me8) {
    const f = all.find(x => x.id8 === s.holder.id8)
    // A70: silence counts from the later of the sync's cutoff (when it began to hold) and the last turn.
    const quietFrom = typeof f?.lastTurnAt === 'number' ? Math.max(s.at - CUTOFF_MS, f.lastTurnAt) : null
    if (f && quietFrom !== null && now - quietFrom >= JUDGE_IDLE_MS && (f.agents ?? 0) === 0) // A67
      return { kind: 'sync', id8: s.holder.id8, lane: s.holder.lane, session: s.holder.session || f.session, since: s.at, end: s.hardEnd, why: `the sync holder has run no turn for ${Math.round((now - quietFrom) / 60_000)} min in the ${phase}` }
  }
  return null
}

/** A65: on an incident, once (the alert-file claim `judge-<id8>-<since>`), spawn the judge with the facts, a fresh probe
 * and the tail of the holder's transcript. It acts on nothing; its verdict is logged, kept for the Orchestrate card
 * and shown here as a toast. When no judge can start, the rule's own reading stands in (marked as such). */
async function judgeStep($: Engine, opts: Opts, now: number): Promise<void> {
  const inc = incidentOf(now)
  if (!inc || !(await claimAlert($, opts, `judge-${inc.kind}-${inc.id8}-${inc.since}`))) return
  const fresh = (await freshProbe($, opts)) ?? probe
  const all = me ? [me, ...peers] : peers
  const f = all.find(x => x.id8 === inc.id8)
  const dir = await recordsDir($, opts)
  const transcript = dir && inc.session ? `${dir}/${inc.session}.jsonl` : ''
  const events = parseTail(await transcriptTail($, transcript))
  const facts: JudgeFacts = { now, ...inc, liveness: livenessOf(inc.id8, all, lanes, now), lastTurnAt: f?.lastTurnAt ?? null, agents: f?.agents ?? null, procs: (fresh?.procs ?? []).map(p => p.name), hasEditor: unrealPids(fresh).length > 0, hasBuild: buildProcs(fresh).length > 0, transcript, agentKinds: f?.agentKinds ?? [], ...(inc.kind === 'editor' ? { lockPid: lock.pid, lockPidRunning: lock.pid !== null && Boolean(fresh?.procs.some(p => p.pid === lock.pid)) } : {}) }
  const hint = hintOf(facts, events)
  const ran = await $.agent.spawn({ subagentType: JUDGE_AGENT, description: `Judge ${inc.lane || inc.id8}`, prompt: judgePrompt(facts, hint, digestOf(events, 40, now)) }).catch(err => ({ deny: String(err) }))
  // The spawn names its agent; where it does not, the session's agent list does (the newest judge this mod started).
  const id = ran.deny !== undefined ? undefined : (ran.agentId ?? (await $.agent.list().catch(() => [])).filter(a => a.type === JUDGE_AGENT && a.spawnedBy === 'a5r').pop()?.id)
  if (!id) {
    await recordVerdict($, opts, facts, { verdict: hint.verdict, evidence: hint.evidence, recommendation: defaultRecommendation(hint.verdict) }, 'rule')
    return
  }
  judges.set(id, { facts, hint })
}

/** A65: a judge's run ended: its verdict (or, unreadable, the rule's reading) is recorded. */
async function judgeEnded($: Engine, opts: Opts, agentId: string, answer: string): Promise<void> {
  const j = judges.get(agentId)
  if (!j) return
  judges.delete(agentId)
  const v = parseVerdict(answer)
  await recordVerdict($, opts, j.facts, v ? { ...v, recommendation: v.recommendation || defaultRecommendation(v.verdict) } : { verdict: j.hint.verdict, evidence: j.hint.evidence, recommendation: defaultRecommendation(j.hint.verdict) }, v ? 'judge' : 'rule')
}

/** A65: a verdict in orchestrate.log, in Saved/A5R/verdicts.json (the card) and as a toast here. Nothing else. */
async function recordVerdict($: Engine, opts: Opts, f: JudgeFacts, v: { verdict: VerdictRow['verdict']; evidence: string[]; recommendation: string }, source: VerdictRow['source']): Promise<void> {
  const now = await $.clock.now()
  const row: VerdictRow = { at: now, id8: f.id8, lane: f.lane, kind: f.kind, verdict: v.verdict, evidence: v.evidence[0] ?? '', recommendation: v.recommendation, by: me8, source }
  await orchestrateLog($, opts, { at: now, rule: 'A65-judge', lane: f.lane, id8: f.id8, procs: f.procs, liveness: f.liveness, lastTurnAt: f.lastTurnAt, agents: f.agents, build: f.hasBuild, acted: false, note: `verdict ${v.verdict} (${source}): ${v.evidence.join('; ')}; recommend: ${v.recommendation}` }).catch(() => undefined)
  verdicts = [row, ...(await readVerdicts($, opts))].slice(0, 10)
  await $.fs.write(verdictsPath(opts), JSON.stringify({ v: 1, verdicts })).catch(err => $.ui.log(`a5r: verdicts not written: ${String(err)}`, { to: 'debug' }))
  $.ui.toast(`Orchestrate · ${f.lane || f.id8}: ${v.verdict} — ${v.recommendation}`, { timeoutMs: 12_000 })
  $.ui.invalidate('ui.render')
}

/** A65: the Orchestrate card: the latest verdicts, one row each (time, session, verdict), a quiet line of evidence and
 * the recommendation under it. */
function orchestrateCard(el: { Box: (p: Record<string, unknown>) => unknown; Text: (p: Record<string, unknown>) => unknown }, rows: readonly VerdictRow[]): unknown {
  const tone = (v: VerdictRow['verdict']) => (v === 'working' || v === 'done' ? STATUS.ok : v === 'stuck-or-crashed' ? STATUS.bad : STATUS.warn)
  return el.Box({
    key: 'hai-orchestrate',
    flexDirection: 'column',
    children: [
      el.Box({ key: 'hai-orchestrate-head', children: [el.Text({ color: V2.label, children: 'ORCHESTRATE' })] }),
      ...rows.slice(0, 3).map((r, i) =>
        el.Box({
          key: `hai-orchestrate-${i}`,
          flexDirection: 'column',
          children: [
            el.Text({ wrap: 'wrap', children: [`${clockOf(r.at)} · ${r.lane || r.id8} (${r.id8}) · `, el.Text({ color: tone(r.verdict), bold: true, children: r.verdict }), r.source === 'rule' ? ' (rule)' : ''] }),
            el.Text({ color: ATHER.quiet, wrap: 'wrap', children: `${r.evidence ? `${r.evidence} → ` : ''}${r.recommendation}` }),
          ],
        }),
      ),
    ],
  })
}

/** A55: when this session's main loop last ran (written with its file at the next save). */
async function markTurn($: Engine): Promise<void> {
  if (me) me = { ...me, lastTurnAt: await $.clock.now() }
}

/** A66: the holder writes the Editor that actually runs into its HELD line (read-compare-write; the holder only): at
 * its minute when the shared reading shows an UnrealEditor the line does not name, and right after it launches the
 * Editor or makes an Editor MCP call (`fresh`: a reading of its own). A line whose pid still runs is left alone. */
async function notePid($: Engine, opts: Opts, fresh: boolean): Promise<void> {
  if (!me || !holdsLock() || !me.holding) return
  const reading = fresh ? ((await freshProbe($, opts)) ?? probe) : probe
  if (!reading) return
  if (lock.pid !== null && reading.procs.some(p => p.pid === lock.pid)) return
  const pid = editorPid(reading)
  if (pid === null || pid === lock.pid) return
  const w = me.want
  const h = me.holding
  const line = heldLine({ lane: me.lane, sessionName: me.title || me.lane, id8: me8, since: h.since, pid, end: h.end, mode: w?.mode ?? (lock.mode === 'unattended' ? 'unattended' : 'interactive'), pausable: w?.pausable ?? lock.pausable, nextSafe: w?.nextSafe ?? 'after save', note: lock.note || w?.what || 'Editor work' })
  await writeLock($, opts, line)
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
 * a5r (a field in this session's file it reads), or the standard `UE request:` line to a holder without it. */
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
    if (!sent.isDelivered) $.ui.log(`a5r: UE request to ${y.holder} not delivered: ${sent.reason}`, { to: 'debug' })
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

// ---------- Sync main holder: Saved/A5R/sync.json, written by the holder alone ----------
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
async function claimAlert($: Engine, opts: Opts, key: string, extra: Record<string, unknown> = {}): Promise<boolean> {
  const path = alertPath(opts, key)
  if (await $.fs.exists(path)) return false
  const mine = JSON.stringify({ by: me8, at: await $.clock.now(), ...extra })
  await $.fs.write(path, mine).catch(() => undefined)
  return (await readJson($, path)) === mine
}

const alertPath = (opts: Opts, key: string): string => `${hfDir(opts)}/alerts/${key.replace(/[^\w.-]+/g, '_')}.json`

/** A 🟥 for Hai from the coordination layer: the title, unread and one PENDING.md line (decision.ts). */
async function raiseRed($: Engine, opts: Opts, question: string, fallback: string): Promise<void> {
  await applyMarker($, opts, { kind: 'decision', question, fallback }, false).catch(err => $.ui.log(`a5r: 🟥 not raised: ${String(err)}`, { to: 'debug' }))
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

/** At the cutoff the holder's a5r dry-runs the merge against the last fetched origin/main (no fetch, 60 s). */
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

/** Plan, move, cancel, take over, record conflicts, end: the one place sync.json changes (panel, /a5r sync, tool). */
async function syncAction($: Engine, opts: Opts, action: string, a: { at?: string; holder?: string; note?: string; paths?: string[]; build?: boolean }): Promise<string> {
  const gate = 'Sync main'
  if (!(await readA5R($))) return blocked(gate, 'A5R is off', 'turn A5R on (/a5r on) to plan a sync')
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
    if (at === null) return blocked(gate, `"${a.at ?? ''}" is not a time`, 'give HH:MM, for example /a5r sync 16:00')
    if (s && open) {
      if (!isMine && !isGone) return notHolder(s)
      if (phase === 'frozen') return blocked(gate, `${when(s)} is frozen already`, 'finish it with done or abort first')
      const base = movedSync({ ...s, holder: isMine ? s.holder : { session: me.session, id8: me8, lane: me.lane } }, at, now)
      const moved = a.build === undefined ? base : withBuild(base, a.build, freezeMinutes(opts, a.build), now)
      if (!(await writeSync($, opts, moved, s))) return blocked(gate, 'sync.json changed while moving it', 'read it with status and try again')
      return `moved: ${planned(moved)}`
    }
    if (action === 'move') return blocked(gate, 'no sync is planned', 'plan one with /a5r sync HH:MM or the panel')
    const holder = holderFor(a.holder ?? '', now)
    if (!holder) return blocked(gate, `no live session named "${a.holder}"`, 'name a session by its first 8 hex or its lane, or leave it out to hold the sync yourself')
    const build = a.build === true
    const next = newSync(at, holder, `${me.lane} (session ${me8})`, now, build, freezeMinutes(opts, build))
    if (!(await writeSync($, opts, next, s))) return blocked(gate, 'sync.json changed while planning', 'read it with status and try again')
    return `planned: ${planned(next)}${at - now < CUTOFF_MS ? ' The cutoff is already past: every session is told now.' : ''}`
  }
  if (action === 'status') {
    if (!s) return 'No sync planned. Plan one on the A5R panel or with /a5r sync HH:MM.'
    return `${when(s)}: ${phase}${isOpenPhase(phase) ? ` (freeze ${clockOf(s.at)}–${clockOf(s.hardEnd)}${s.build ? ', with a build' : ''})` : ''}${isGone && isOpenPhase(phase) ? ' (its holder is gone: take it over from the panel or with /a5r sync takeover)' : ''}${s.conflicts ? ` · conflicts: ${s.conflicts.length ? s.conflicts.map(c => `${c.path} (${c.kind})`).join(', ') : 'none'}` : ''}${s.untracked ? ` · untracked main would overwrite: ${s.untracked.length ? s.untracked.join(', ') : 'none'}` : ''}${s.note ? ` · ${s.note}` : ''}`
  }
  if (!s || !open) return blocked(gate, 'no sync is planned', 'plan one with /a5r sync HH:MM or the panel')
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

/** /a5r sync …: HH:MM [build] [for <session>] · move HH:MM · build on|off · cancel · done [note] · abort <why> ·
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

/** A16: at the cutoff the holder sends each live S2 session without a5r 0.4 the standard message once (they
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

// ---------- A5R acceptance (nghiệm thu, A18): the five rules over the branch, before a PR and when an intent closes ----------
/** A56: the tracked intent when its checklist is complete (every acceptance row met or waived in its progress.md, read
 * in `root` and else in the session's own checkout, or Ather's checklist full), else null: before that, and with no
 * tracked intent, A5R acceptance stays out of a PR (no score, no refusal, no dialog, no 🟥, no card). */
async function checklistEnd($: Engine, a5r: A5R, root: string, status: AtherStatus | null): Promise<string | null> {
  const slug = status?.tracked?.slug
  if (!slug) return null
  if (checklistFull(status?.tracked?.checklist)) return slug
  const sessionRoot = (await locate($, a5r, `${await $.session.cwd()}/_`)).root
  for (const r of [root, ...(sessionRoot && !sameRoot(sessionRoot, root) ? [sessionRoot] : [])]) {
    const [prompt, progress] = await Promise.all([$.fs.read(`${r}/docs/intent/${slug}/prompt.md`).catch(() => ''), $.fs.read(`${r}/docs/intent/${slug}/progress.md`).catch(() => '')])
    if (prompt) return checklistComplete(prompt, progress) ? slug : null
  }
  return null
}

/** A57: uses one of Hai's passes (`/a5r pass`) that names one of `keys`, if any: removed from the saved state. */
async function takePass($: Engine, opts: Opts, keys: readonly (string | null | undefined)[]): Promise<string | null> {
  const wanted = keys.filter((k): k is string => Boolean(k)).map(k => k.toLowerCase())
  const hit = me?.passes?.find(p => wanted.includes(p)) ?? null
  if (hit && me) {
    me = { ...me, passes: (me.passes ?? []).filter(p => p !== hit) }
    await saveMe($, opts)
  }
  return hit
}

/** A57: `/a5r pass <PR or slug>`: Hai lets the next gated call of that intent (or PR's after-the-fact score) through once. */
async function passCommand($: Engine, opts: Opts, arg: string): Promise<string> {
  const key = passKey(arg)
  if (!key) return 'A5R pass: /a5r pass <intent slug | PR number> lets the next PR call (or intent close) of that intent, or the after-the-fact score of that PR, through once even if A5R acceptance fails.'
  await restoreMe($, opts)
  if (!me) return 'A5R pass: this session has no A5R state yet.'
  me = { ...me, passes: [...(me.passes ?? []).filter(p => p !== key), key] }
  await saveMe($, opts)
  return `A5R pass: the next ${key.startsWith('#') ? `after-the-fact score of PR ${key}` : `PR call or close of intent ${key}`} goes through once, even with rules not met (it is still scored and shown on the card).`
}

/** A22: what a PR tool's input names (repository `owner/name`, head and base branches), all optional. */
type PrRefs = { repo?: string; head?: string; base?: string; problem?: string } // A46: problem: the call's refs cannot be read

/** A47 (b): a repository's remotes from `git remote -v`. */
const remotesOf = (text: string): { name: string; url: string }[] =>
  [...new Map(text.split(/\r?\n/).map(l => /^(\S+)\s+(\S+)/.exec(l)).filter((m): m is RegExpExecArray => Boolean(m)).map(m => [m[1] ?? '', { name: m[1] ?? '', url: m[2] ?? '' }])).values()]
/** A47 (b): whether a remote URL is `owner/name` (https, ssh or scp form, with or without .git). */
const urlIsRepo = (url: string, repo: string): boolean => {
  const u = url.replace(/\.git$/i, '').toLowerCase()
  const r = repo.replace(/\.git$/i, '').toLowerCase()
  return u.endsWith(`/${r}`) || u.endsWith(`:${r}`)
}

/** A42: the a5r kit's rules/ and tests/ folders as paths in the repository at `root`: where the kit sits inside it, else
 * under the kit's own folder name (the same mod checked out in another worktree of that repository). */
const kitDirsIn = (root: string): string[] => {
  const kit = String(places.KIT ?? '').replace(/\\/g, '/').replace(/\/$/, '')
  if (!kit) return []
  const r = root.replace(/\\/g, '/').replace(/\/$/, '')
  const rel = kit.toLowerCase().startsWith(`${r.toLowerCase()}/`) ? kit.slice(r.length + 1) : (kit.split('/').pop() ?? '')
  return rel ? [`${rel}/rules/`, `${rel}/tests/`] : []
}

/** A41: where a PR's head is: the worktree (of the repository at `start`) that has it checked out, scored at its HEAD;
 * else `origin/<head>` (or a local branch of that name) scored from `start` without a checkout; with no head named,
 * `start`'s own current branch (gh opens that one). A folder with no repository, or a head found nowhere, is a problem:
 * the score is "not scored" with it. */
async function prTarget($: Engine, start: string, refs: PrRefs): Promise<{ root: string; head: string | null; branch: string; problem: string | null }> {
  const run = (args: string[]) => $.process.run(['git', '-C', start, ...args], { timeoutMs: 15_000 }).catch(() => null)
  if (refs.problem) return { root: start, head: null, branch: '', problem: refs.problem }
  const top = await run(['rev-parse', '--show-toplevel'])
  if (!top || top.exitCode !== 0) return { root: start, head: null, branch: '', problem: `no git repository at ${start}` }
  const headName = refs.head?.trim().replace(/^[^:]+:/, '') || ''
  if (!headName) return { root: start, head: 'HEAD', branch: '', problem: null }
  let wt = ''
  for (const line of ((await run(['worktree', 'list', '--porcelain']))?.stdout ?? '').split(/\r?\n/)) {
    if (line.startsWith('worktree ')) wt = line.slice(9).trim()
    else if (line.trim() === `branch refs/heads/${headName}` && wt) return { root: wt, head: 'HEAD', branch: headName, problem: null }
  }
  for (const ref of [`origin/${headName}`, headName]) if ((await run(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]))?.exitCode === 0) return { root: start, head: ref, branch: headName, problem: null }
  return { root: start, head: null, branch: headName, problem: `head ${headName} is neither checked out in a worktree of this repository nor at origin/${headName}: fetch it, or open the PR from its own checkout` }
}

/** A52: a PR's diff read from GitHub (`gh pr diff`): its file names, its patch, why it could not be read whole, its head. */
type GivenDiff = { files: string; patch: string; why: string | null; branch: string }

/** A52: one file's part of a whole patch (`diff --git a/<path> b/<path>` to the next file), or ''. */
const fileDiff = (patch: string, path: string): string => {
  const parts = patch.replace(/\r/g, '').split(/^(?=diff --git )/m)
  return parts.find(p => p.startsWith('diff --git ') && (p.split('\n')[0] ?? '').endsWith(` b/${path}`)) ?? ''
}

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
async function gatherAccept($: Engine, opts: Opts, a5r: A5R, start: string, slugHint: string | null, body: string, agentId: string | undefined, refs: PrRefs = {}, given?: GivenDiff): Promise<AcceptInput> {
  // A41: the branch the PR is opened from: the worktree that has its head checked out, else origin/<head>; never the
  // session's own checkout unless that is where the head is. A52: a PR read from GitHub brings its own diff.
  const target = given ? { root: start, head: null, branch: given.branch, problem: null } : await prTarget($, start, refs)
  const root = target.root
  const git = async (args: string[]): Promise<string> => {
    const r = await $.process.run(['git', '-C', root, ...args], { timeoutMs: 30_000 }).catch(() => null)
    return r && r.exitCode === 0 ? r.stdout : ''
  }
  // The base is origin/main: a local main in the shared checkout can be far behind it, and main...HEAD would then
  // list everything main merged since as this branch's work. Local main only when origin/main is missing.
  const hasRef = async (ref: string) => (await $.process.run(['git', '-C', root, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { timeoutMs: 15_000 }).catch(() => null))?.exitCode === 0
  // A22: a PR tool names its base, head and repository; each is checked here, and one that cannot be read is no pass.
  const baseName = refs.base?.trim() || 'main'
  // A47 (b): the PR's repository may be any remote of this repository (a fork PR: `-R upstream/x --head me:branch` from a
  // clone whose origin is the fork); its base is then that remote's branch.
  const remotes = refs.repo && !given ? remotesOf(await git(['remote', '-v'])) : []
  const repoRemote = refs.repo ? (remotes.find(x => urlIsRepo(x.url, refs.repo ?? '')) ?? null) : null
  const isOtherRepo = Boolean(refs.repo) && !repoRemote && !given
  const baseRefs = [...(repoRemote && repoRemote.name !== 'origin' ? [`${repoRemote.name}/${baseName}`] : []), `origin/${baseName}`, baseName]
  let base: string | null = null
  if (!given) for (const ref of baseRefs) if (!base && (await hasRef(ref))) base = ref
  const head = target.head
  const branch = target.branch || (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  const refProblem = given
    ? null
    : target.problem
    ? target.problem
    : isOtherRepo
      ? `the PR is for ${refs.repo}, which is not a remote of the repository at ${root} (${remotes.map(x => x.url).join(', ') || 'no remote'})`
      : !base
        ? `no ${baseRefs.join(' or ')} to diff against`
        : !head
          ? `head ${target.branch} is not in this repository (fetch it, or open the PR from its own checkout)`
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
  const names = given ? { out: given.files, why: given.why } : refProblem ? { out: '', why: refProblem } : await whole(['diff', '--name-only', range])
  const text = given ? { out: given.patch, why: null } : !names.why ? await whole(['diff', '-U0', '--no-color', range, '--', '.', ...BINARY_EXCLUDES]) : { out: '', why: null }
  const files = names.out.split(/\r?\n/).map(f => f.trim()).filter(Boolean)
  const added = addedLines(text.out)
  const status = await atherStatus($)
  const fromDiff = [...new Set(files.map(f => /^docs\/intent\/([^/]+)\//.exec(f)?.[1]).filter((s): s is string => Boolean(s)))]
  // A41: the intent is the one this branch's diff touches (docs/intent/<slug>/); the session's tracked intent only when the
  // diff touches none (or is among those it touches).
  const tracked = status?.tracked?.slug ?? null
  const read = (rel: string) => $.fs.read(`${root}/${rel}`).catch(() => '')
  // A47 (a): several intents touched, none of them the tracked one: the one whose prompt names most of the diff's
  // paths; a tie is "not scored", naming the candidates (never the alphabetically first).
  let slug: string | null = slugHint ?? (fromDiff.length === 0 ? tracked : tracked && fromDiff.includes(tracked) ? tracked : fromDiff.length === 1 ? (fromDiff[0] ?? null) : null)
  let slugProblem: string | null = null
  if (!slugHint && slug === null && fromDiff.length > 1) {
    const counts = await Promise.all(
      fromDiff.map(async s => {
        const named = namedPaths(await read(`docs/intent/${s}/prompt.md`), s).filter(p => p !== `docs/intent/${s}/`)
        return { s, n: files.filter(f => inScope(f, named)).length }
      }),
    )
    counts.sort((x, y) => y.n - x.n || x.s.localeCompare(y.s))
    const top = counts.filter(c => c.n === counts[0]?.n)
    if (top.length === 1) slug = top[0]?.s ?? null
    else slugProblem = `the diff touches the intents ${top.map(c => c.s).join(', ')} equally (${top[0]?.n ?? 0} of its paths named by each): open one PR per intent`
  }
  const diffProblem = names.why ?? text.why ?? slugProblem
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
  // A41: this session's background agents count against a PR from its own worktree; a PR from another worktree is not
  // held up by work elsewhere.
  const sessionRoot = (await locate($, a5r, `${await $.session.cwd()}/_`)).root
  const runningAgents = sessionRoot && sameRoot(sessionRoot, root) ? (await $.agent.list().catch(() => [])).filter(a => a.status === 'running' && a.type !== SYNC_AGENT && a.id !== agentId).map(a => `${a.type}: ${a.description}`) : []
  return {
    slug,
    branch,
    files,
    added,
    prompt,
    progress,
    findings,
    diffProblem,
    refProblem,
    promptDiff: slug && given ? fileDiff(given.patch, `docs/intent/${slug}/prompt.md`) : slug && !refProblem ? await git(['diff', range, '--', `docs/intent/${slug}/prompt.md`]) : '',
    proof: status?.tracked?.slug === slug ? proofOf(status) : null,
    body,
    othersTouch,
    otherIntents,
    untrackedLeft,
    strayWorktrees,
    runningAgents,
    cfg: a5r.cfg,
    kitDirs: kitDirsIn(root),
    // A75: the actions recorded at the tool call in this repository (shared config, removed assertions, ...).
    recorded: (await readRecorded($, opts)).filter(r => !r.root || sameRoot(r.root, root)).map(r => ({ kind: r.kind, path: r.path, target: r.target ?? r.path, at: r.at, lane: r.lane, mine: r.id8 === me8 })),
  }
}

/** A18: the score at the PR-opening call (main loop or worker) or at an intent's close; a failing score refuses it
 * with the list (A57: no dialog; /a5r pass lets one through); a worker gets the same answer. */
async function acceptGate($: Engine, opts: Opts, a5r: A5R, tool: string, input: Input, agentId: string | undefined): Promise<string | null> {
  let root: string | null = null
  let slug: string | null = null
  let body = ''
  let what = 'this PR'
  let refs: PrRefs = {}
  const cwd = await $.session.cwd()
  if (SHELL_TOOLS.has(tool) && isPrCommand(str(input.command))) {
    const command = str(input.command)
    // A41: the PR's own repository, head, base and folder, from the command; a folder with no repository is scored as
    // unread (never passed, never another branch's score).
    const cmdRefs = prCommandRefs(command)
    const dir = norm(cmdRefs.dir ?? cwd, cwd)
    root = (await locate($, a5r, `${dir}/_`)).root ?? dir
    body = await prBody($, command, dir)
    refs = { repo: cmdRefs.repo, head: cmdRefs.head, base: cmdRefs.base, ...(cmdRefs.problem ? { problem: cmdRefs.problem } : {}) }
  } else if (isPrTool(tool)) {
    // A22: a PR opened through an MCP tool (GitHub's create_pull_request and the like): the session's repository,
    // checked against the repository, head and base the input names; never let through unread.
    root = (await locate($, a5r, `${cwd}/_`)).root ?? cwd
    body = str(input.body)
    const owner = str(input.owner)
    const name = str(input.repo) || str(input.repository) || str(input.repo_name)
    refs = { repo: name ? (owner && !name.includes('/') ? `${owner}/${name}` : name) : undefined, head: str(input.head) || str(input.head_branch) || undefined, base: str(input.base) || str(input.base_branch) || undefined }
  } else if (EDIT_TOOLS.has(tool)) {
    for (const [path, old, neu] of await editParts($, tool, input)) {
      const closing = closesIntent(norm(path, cwd), newLines(old, neu))
      if (closing) {
        slug = closing
        root = (await locate($, a5r, path)).root
        what = `closing intent ${closing}`
      }
    }
  }
  if (!root) return null
  // A56: a PR enters A5R acceptance only at the end of a checklist (before Ship): the session tracks an intent, and the
  // intent the PR's diff is for (the tracked one unless the diff names another) has every acceptance row met or waived
  // (or Ather counts it full). Before that, or with no tracked intent, the PR runs: no score shown, no refusal, no card.
  // An intent's close always enters.
  const status = slug === null ? await atherStatus($) : null
  const tracked = status?.tracked?.slug ?? null
  if (slug === null && !tracked) return null
  const x = await gatherAccept($, opts, a5r, root, slug, body, agentId, refs)
  if (slug === null && !(x.slug !== null && (checklistComplete(x.prompt, x.progress) || (x.slug === tracked && checklistFull(status?.tracked?.checklist))))) return null
  const endSlug = x.slug ?? slug
  const scores = score(x)
  lastAccept = { at: await $.clock.now(), slug: x.slug, scores, what } // the intent the score read (tracked or from the diff)
  $.ui.invalidate('ui.render')
  const bad = failed(scores)
  // An unread branch diff is no pass: refused with why, like a failing score.
  if (bad.length === 0 && !x.diffProblem) return null
  // A57: never a dialog: Hai's pass (given beforehand with /a5r pass) lets this one through, else it is refused.
  if (await takePass($, opts, [x.slug, endSlug])) return null
  const text = x.diffProblem ? unreadText(x.diffProblem) : acceptText(scores, what)
  if (agentId !== undefined) return `${text}\n(a worker does not ask Hai: leave it undone, stop and report it to the session that briefed you)`
  return text
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
    const a5r = await load($)
    const cwd = await $.session.cwd()
    const root = (await locate($, a5r, `${cwd}/_`)).root
    prDirty = false
    if (!root) return
    if (await postHoc($, opts, a5r, root, status, now)) return
    if (!shipSlug && !lastAccept) return
    // A52: an after-the-fact card holds each PR's own score; a file changing in this checkout never re-scores the
    // checkout under the PRs' names.
    if (lastAccept?.prs) return
    acceptDirty = false
    const slug = lastAccept?.slug ?? shipSlug
    lastAccept = { at: now, slug, scores: score(await gatherAccept($, opts, a5r, root, slug, '', undefined)), what: lastAccept?.what ?? 'Ship' }
  } finally {
    isScoring = false
    $.ui.invalidate('ui.render')
  }
}

/** A52: the after-the-fact scorer's version, written in this session's file and in every PR alert it claims. Before it
 * (0.12.2 and older) a PR was scored as the session's own checkout; an alert of that scorer is withdrawn and its PR
 * scored once more. */
const POSTHOC_SCORER = 2

/** A52: a PR's head, base and state from GitHub (`gh pr view`, never prompting, 30 s), or why it could not be read. */
async function prView($: Engine, root: string, link: PrLink): Promise<{ head: string; base: string; state: string } | string> {
  const argv = ['gh', 'pr', 'view', String(link.n), ...(link.repo ? ['-R', link.repo] : []), '--json', 'headRefName,baseRefName,state']
  const r = await $.process.run(argv, { cwd: root, env: GH_ENV, timeoutMs: 30_000 }).catch(() => null)
  if (!r) return 'gh pr view timed out or did not start'
  if (r.exitCode !== 0) return `gh pr view exited ${r.exitCode}${r.stderr.trim() ? `: ${r.stderr.trim().split(/\r?\n/)[0]?.slice(0, 120)}` : ''}`
  try {
    const v = JSON.parse(r.stdout) as { headRefName?: unknown; baseRefName?: unknown; state?: unknown }
    if (typeof v.headRefName === 'string' && v.headRefName && typeof v.baseRefName === 'string' && v.baseRefName) return { head: v.headRefName, base: v.baseRefName, state: String(v.state ?? '').toUpperCase() }
  } catch {
    // falls through
  }
  return 'gh pr view gave no head and base'
}
const GH_ENV = { GH_PROMPT_DISABLED: '1', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', NO_COLOR: '1' }

/** A52: a PR's diff from GitHub (`gh pr diff`: its file names, then its patch), whole or with why not. */
async function prDiffFromGitHub($: Engine, root: string, link: PrLink, head: string): Promise<GivenDiff> {
  const run = async (extra: string[]): Promise<{ out: string; why: string | null }> => {
    const r = await $.process.run(['gh', 'pr', 'diff', String(link.n), ...(link.repo ? ['-R', link.repo] : []), ...extra], { cwd: root, env: GH_ENV, timeoutMs: 60_000 }).catch(() => null)
    if (!r) return { out: '', why: 'gh pr diff timed out or did not start' }
    if (r.exitCode !== 0) return { out: '', why: `gh pr diff exited ${r.exitCode}` }
    if (r.isStdoutTruncated) return { out: '', why: 'gh pr diff output passed 4 MiB' }
    return { out: r.stdout, why: null }
  }
  const names = await run(['--name-only'])
  const patch = names.why ? { out: '', why: null } : await run(['--color', 'never'])
  return { files: names.out, patch: patch.out, why: names.why ?? patch.why, branch: head }
}

/** A52: one PR scored on its own diff: head, base and state from GitHub; an open PR from the worktree holding its head,
 * else origin/<head> against origin/<base>; a merged or closed one (its branch merged in or gone), or one whose head
 * is not here, from `gh pr diff`. `transient`: GitHub could not be asked, so it is tried again later. */
async function scorePr($: Engine, opts: Opts, a5r: A5R, root: string, slug: string, link: PrLink): Promise<{ n: number; label: string; scores: RuleScore[]; problem: string | null; transient: boolean; state: string }> {
  const v = await prView($, root, link)
  if (typeof v === 'string') return { n: link.n, label: `not scored: ${v}`, scores: unscored(v), problem: v, transient: true, state: '' }
  const refs: PrRefs = { ...(link.repo ? { repo: link.repo } : {}), head: v.head, base: v.base }
  let x = v.state === 'OPEN' ? await gatherAccept($, opts, a5r, root, slug, '', undefined, refs) : null
  let via = 'local branches'
  if (!x || x.refProblem) {
    x = await gatherAccept($, opts, a5r, root, slug, '', undefined, refs, await prDiffFromGitHub($, root, link, v.head))
    via = 'its diff on GitHub'
  }
  const state = v.state.toLowerCase() || 'unknown'
  return { n: link.n, label: `${v.head} → ${v.base} · ${state} · ${x.files.length} files, read from ${via}`, scores: score(x), problem: x.diffProblem ?? null, transient: false, state: v.state }
}

/** A52: an alert of the old scorer (no `scorer` in it, not withdrawn) for PR `n`: it scored the checkout, not the PR. */
async function oldAlert($: Engine, opts: Opts, n: number): Promise<boolean> {
  const text = await readJson($, alertPath(opts, `pr-${n}`))
  if (text === null) return false
  try {
    const v = JSON.parse(text) as { scorer?: unknown; withdrawn?: unknown }
    return v.scorer === undefined && v.withdrawn !== true
  } catch {
    return true
  }
}

/** A52: withdraws an old scorer's alert for PR `n`: its alert file says so (so no session withdraws it twice) and its open
 * PENDING.md line is ticked with why. */
async function withdrawOldAlert($: Engine, opts: Opts, n: number): Promise<void> {
  const now = await $.clock.now()
  await $.fs.write(alertPath(opts, `pr-${n}`), JSON.stringify({ by: me8, at: now, scorer: POSTHOC_SCORER, withdrawn: true, why: 'scored the session checkout, not the PR (before a5r 0.12.3)' })).catch(() => undefined)
  const file = opts.pendingFile || `${(places.USERPROFILE ?? '').replace(/\\/g, '/')}/.claude/PENDING.md`
  const pending = await $.fs.read(file).catch(() => null)
  if (pending === null) return
  const mark = `PR #${n} (intent `
  const lines = pending.split('\n')
  let changed = false
  const next = lines.map(l => {
    if (!l.startsWith('- [ ]') || !l.includes(mark) || !l.includes('without A5R acceptance')) return l
    changed = true
    return `- [x]${l.slice(5).replace(/\r$/, '')} · withdrawn ${stampOf(new Date(now))}: that score read the session's checkout, not the PR; a5r 0.12.3 scored the PR on its own diff${l.endsWith('\r') ? '\r' : ''}`
  })
  if (changed) await $.fs.write(file, next.join('\n')).catch(() => undefined)
}

/** A23: a PR number on the tracked intent's `- PR:` line (or in Ather's `tracked.prs`) that this session never scored
 * (opened on GitHub, or by the app's own button) is scored now, shown on the card with its number, and one 🟥 is
 * raised per failing PR (the first session to claim its alert file). The first read of an intent only records the
 * numbers already there. A52: each PR is scored on its own diff (scorePr), one section per PR on the card, a 🟥 only
 * for a PR whose own score fails; a PR an old scorer raised an alert for is scored again once and that alert is
 * withdrawn. Returns whether it scored. */
async function postHoc($: Engine, opts: Opts, a5r: A5R, root: string, status: AtherStatus | null, now: number): Promise<boolean> {
  const slug = status?.tracked?.slug
  if (!slug) return false
  const read = (rel: string) => $.fs.read(`${root}/${rel}`).catch(() => '')
  const links = new Map<number, PrLink>()
  for (const l of [...prLinksOf(await read(`docs/intent/${slug}/progress.md`), await read(`docs/intent/${slug}/prompt.md`)), ...(status?.tracked?.prs ?? []).flatMap(p => prLinksOf(`- PR: ${p}`, ''))])
    if (!links.has(l.n) || (l.repo && !links.get(l.n)?.repo)) links.set(l.n, l)
  const listed = [...links.keys()]
  if (!prBaseline.has(slug)) {
    prBaseline.add(slug)
    for (const n of listed) prsKnown.add(n)
    await saveMe($, opts)
    return false
  }
  // A56: after the fact too, only at the end of the checklist: a PR listed before that is recorded and never scored.
  if (!(await checklistEnd($, a5r, root, status))) {
    const before = prsKnown.size
    for (const n of listed) prsKnown.add(n)
    if (prsKnown.size !== before) await saveMe($, opts)
    return false
  }
  const again = new Set<number>()
  for (const n of listed) if (prsKnown.has(n) && (await oldAlert($, opts, n))) again.add(n)
  const fresh = listed.filter(n => !prsKnown.has(n) || again.has(n))
  if (fresh.length === 0) return false
  const results = []
  for (const n of fresh) results.push(await scorePr($, opts, a5r, root, slug, links.get(n) ?? { n, repo: null }))
  for (const r of results) {
    if (r.transient) continue
    prsKnown.add(r.n)
    if (again.has(r.n)) await withdrawOldAlert($, opts, r.n)
  }
  lastAccept = { at: now, slug, scores: worstOf(results.map(r => r.scores)), what: `PR #${fresh.join(', #')} · scored after the fact`, prs: results.map(r => ({ n: r.n, label: r.label, scores: r.scores })) }
  await saveMe($, opts)
  for (const r of results) {
    if (r.transient) continue
    const bad = failed(r.scores)
    if (bad.length === 0 && !r.problem) continue
    if (await takePass($, opts, [`#${r.n}`])) continue // A57: Hai passed this PR
    if (!(await claimAlert($, opts, `pr2-${r.n}`, { scorer: POSTHOC_SCORER }))) continue
    const isMerged = r.state === 'MERGED'
    const verdict = r.problem ? `could not be scored: ${unreadLine(r.problem)}` : `fails ${bad.length} of 5 (${bad.map(b => `${b.rule} ${ruleName(b.rule)}`).join('; ')})`
    await raiseRed(
      $,
      opts,
      isMerged
        ? `PR #${r.n} (intent ${slug}) was merged without A5R acceptance and ${verdict}: fix it in a follow-up PR, or leave it as it is?`
        : `PR #${r.n} (intent ${slug}) was opened without A5R acceptance and ${verdict}: fix it on its branch before it merges, or let it merge as it is?`,
      isMerged ? 'a follow-up PR fixes it' : 'hold the merge until the branch scores 5 of 5',
    )
  }
  return true
}

/** /a5r accept: the score on demand for the repository this session works in (no PR body). */
async function acceptCommand($: Engine, opts: Opts): Promise<string> {
  const a5r = await load($)
  const cwd = await $.session.cwd()
  const root = (await locate($, a5r, `${cwd}/_`)).root
  if (!root) return 'A5R acceptance: this session is not in a git repository.'
  const x = await gatherAccept($, opts, a5r, root, null, '', undefined)
  const scores = score(x)
  lastAccept = { at: await $.clock.now(), slug: x.slug, scores, what: 'on demand' } // A47: the intent the score read
  $.ui.invalidate('ui.render')
  return [`A5R acceptance (${x.diffProblem ? 'not scored' : failed(scores).length ? `${failed(scores).length} of 5 not met` : '5 of 5'}):`, ...scores.map(s => `${s.state === 'pass' ? '✓' : s.state === 'fail' ? '✗' : '–'} ${s.rule} ${ruleName(s.rule)}: ${s.line}`)].join('\n')
}

/** A21: the score of the intent Ather hands over at Ship, as the text added to that prompt. */
async function shipScore($: Engine, opts: Opts, slug: string): Promise<string | null> {
  const a5r = await load($)
  const root = (await locate($, a5r, `${await $.session.cwd()}/_`)).root
  if (!root) return null
  const x = await gatherAccept($, opts, a5r, root, slug, '', undefined)
  const scores = score(x)
  lastAccept = { at: await $.clock.now(), slug, scores, what: 'Ship' }
  $.ui.invalidate('ui.render')
  return shipText(scores, slug, x.branch, x.diffProblem)
}

/** A57: `/a5r help`. */
const A5R_HELP = [
  'A5R commands:',
  '/a5r · opens the A5R pane',
  '/a5r on | off · the five rules and the Editor, RAM and Sync main coordination, for every session',
  '/a5r status · the state as text',
  '/a5r accept · A5R acceptance now, for this session\'s repository (the full list)',
  '/a5r pass <intent slug | PR number> · lets the next PR call or close of that intent (or that PR\'s after-the-fact score) through once, even if acceptance fails; acceptance never asks',
  'At the tool call A5R never asks and never waits: git that can discard work in the shared checkout runs on exact paths when no other session\'s uncommitted change is in its way (else it names the path and owner); with no paths, `.` or a top folder it is refused with the same command on exact paths; shared config, recursive deletes and removed test assertions run and are recorded for acceptance; force push, push to main, git add ., --no-verify, GIT_LFS_SKIP_SMUDGE, reset --hard, clean -x and moving the shared tree are refused with what to do instead.',
  '/a5r gate <with PIE GB> <without PIE GB> | reset · the launch gate',
  '/a5r sync HH:MM [build] [for <session>] | move HH:MM | build on|off | cancel | done | abort | takeover · Sync main',
  'A5R acceptance steps in only at the end of the tracked intent\'s checklist (every row met or waived), at Ather\'s Ship prompt and when an intent closes; a PR before that runs unscored.',
].join('\n')

/** A15: this session holds the sync and the sync is in its freeze (sync.json read fresh). */
async function isFrozenHolder($: Engine, opts: Opts): Promise<boolean> {
  const s = parseSyncFile(await readJson($, syncPath(opts)))
  if (!s || s.holder.id8 !== (await $.session.id()).slice(0, 8).toLowerCase()) return false
  return phaseOf(s, await $.clock.now()) === 'frozen'
}

/** The first git write of a command that lands in the shared S2 checkout (its main working tree), if any. */
async function sharedGitWrite($: Engine, opts: Opts, a5r: A5R, writes: { verb: string; dir: string }[]): Promise<{ verb: string; dir: string } | null> {
  const cwd = await $.session.cwd()
  for (const w of writes) {
    const dir = norm(w.dir || cwd, cwd)
    const root = (await locate($, a5r, `${dir}/_`)).root
    if (root && sameRoot(root, s2Root(opts)) && (await isSharedRoot($, root))) return w
  }
  return null
}

/** A5R's freeze, a lease (D8): from the sync time until done, abort or expiry, a session that does not hold the sync
 * makes no git write in the shared checkout and does not use the Editor (sync.json read fresh for each such call).
 * A14, the merge guard: while .git/MERGE_HEAD exists in the shared checkout, git writes there are refused to every
 * session but the sync's holder, whatever sync.json says. */
async function freezeProblem($: Engine, opts: Opts, a5r: A5R, tool: string, input: Input): Promise<string | null> {
  const command = SHELL_TOOLS.has(tool) ? str(input.command) : ''
  const isEditorUse = isUnrealMcp(tool) || (command !== '' && isEditorStartStop(command))
  const writes = command ? gitWrites(command) : []
  if (!isEditorUse && writes.length === 0) return null
  const s = parseSyncFile(await readJson($, syncPath(opts)))
  const now = await $.clock.now()
  const isHolder = s?.holder.id8 === (await $.session.id()).slice(0, 8).toLowerCase()
  const shared = writes.length > 0 ? await sharedGitWrite($, opts, a5r, writes) : null
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
 * falls (A5R on only). */
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

/** A5R's coordination refusals before a tool runs: the lock is the editor tool's to write; notices are not
 * logged into intent files. */
async function coordProblem($: Engine, opts: Opts, tool: string, input: Input): Promise<string | null> {
  const viaTool = `call ${EDITOR_TOOL} (action request, release or extend)`
  if (EDIT_TOOLS.has(tool)) {
    const parts = await editParts($, tool, input)
    if (parts.some(([path]) => isLockPath(path))) return blocked('Editor lock', 'under A5R the lock is written by the editor tool, never by hand', viaTool)
    if (parts.some(([path, old, neu]) => isIntentFile(path) && addsNotice(newLines(old, neu))))
      return blocked('Notices', 'a5r notices are not logged in docs/intent files (D6: they would be noise in the intent\'s record)', 'leave the "A5R ·" line out; the files under Saved/A5R are the record')
  }
  if (SHELL_TOOLS.has(tool) && writesLock(str(input.command))) return blocked('Editor lock', 'under A5R the lock is written by the editor tool, never by a command', viaTool)
  if (SHELL_TOOLS.has(tool) && writesNoticeToIntent(str(input.command)))
    return blocked('Notices', 'a5r notices are not logged in docs/intent files (D6: they would be noise in the intent\'s record)', 'leave the "A5R ·" line out; the files under Saved/A5R are the record')
  return null
}

const placeText = (d: GrantDecision | null): string => {
  if (!d || d.kind === 'none') return 'no request from this session'
  if (d.kind === 'mine') return `this session holds the Editor${me?.holding ? ` until ${clockOf(me.holding.end)}` : ''}`
  if (d.kind === 'wait') return `waiting (${d.place > 1 ? `${d.place}${d.place === 2 ? 'nd' : d.place === 3 ? 'rd' : 'th'} in the queue` : 'next'}): ${d.why} → ${d.next}`
  return d.kind === 'grant' ? `granted until ${clockOf(d.end)}` : 'recovering a stale lease'
}

/** The `editor` tool: request, release, extend, status (the only writer of the lock under A5R). */
async function editorTool($: Engine, opts: Opts, e: Input): Promise<string> {
  if (!(await readA5R($))) return blocked('Editor', 'A5R is off, so the Editor holder is not running', 'follow AGENTS.md: take Saved/EDITOR_OWNER.txt by hand')
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
    return tail(`${placeText(decision)}${asked ? ` · the holder (session ${asked.holder}) was asked to yield at its next safe point${asked.via === 'send' ? ' (UE request line sent: it runs without a5r)' : ''}` : ''}`)
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
    // A68: past its end a lease may still be extended while nobody waits; with someone waiting it may not.
    const queued = queueOf([me, ...peers], lanes, now, syncFile).length
    if (now >= h.end && queued > 0) return blocked('Editor', `the lease ended at ${clockOf(h.end)} and ${queued} session${queued === 1 ? '' : 's'} wait${queued === 1 ? 's' : ''}`, 'release now and ask again for the rest')
    const add = Math.max(5, Math.min(120, Math.round(Number(e.minutes) || 15)))
    const end = Math.max(h.end, now) + add * 60_000
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
  const why = d.code === 'ram' ? ' · waiting on RAM' : d.code === 'sync' ? ' · after the sync' : d.code === 'gone-editor' ? ' · holder gone, Editor open' : d.code === 'missing' ? ' · lock missing' : d.code === 'merge' ? ' · merge in progress' : ''
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

/** D5 / A25: `/a5r gate <pie> <nopie>` sets the launch gate for every session (the plugin store, as the panel's
 * ±1 GB did before 0.8); `/a5r gate reset` goes back to the plugin options. */
async function gateCommand($: Engine, opts: Opts, args: string): Promise<string> {
  const words = args.trim().split(/\s+/).filter(Boolean)
  if (words[0]?.toLowerCase() === 'reset') {
    await $.store.delete('gates')
    await runTick($, opts)
    return `A5R · launch gate back to the plugin options: ≥ ${clampGate(Number(opts.launchGatePieGb ?? 31))} GB with PIE, ≥ ${clampGate(Number(opts.launchGateGb ?? 28))} GB without.`
  }
  const [pie, nopie] = words.map(Number)
  if (words.length === 0) return `A5R · launch gate: ≥ ${gates.pieGb} GB with PIE, ≥ ${gates.nopieGb} GB without (${gates.source === 'panel' ? 'set with /a5r gate' : 'plugin options'}). Change it: /a5r gate <with PIE> <without PIE>, or /a5r gate reset.`
  if (!Number.isFinite(pie) || !Number.isFinite(nopie ?? pie)) return 'A5R · /a5r gate <with PIE GB> <without PIE GB>, e.g. /a5r gate 31 28; or /a5r gate reset.'
  const g = { pieGb: clampGate(pie as number), nopieGb: clampGate((nopie ?? pie) as number) }
  await $.store.set('gates', g)
  await runTick($, opts)
  return `A5R · launch gate for every session: ≥ ${g.pieGb} GB with PIE, ≥ ${g.nopieGb} GB without (the PIE gate stays 5 GB start / 3 GB abort). /a5r gate reset goes back to the plugin options.`
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

/** A40: the app theme from `/config` ("theme"), applied to every colour a5r draws; dark when it cannot be read. */
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

/** A29: open (or bring back) the A5R pane; a toast when the surface could not place it. */
async function openA5Pane($: Engine): Promise<string> {
  paneEnterAt = await $.clock.now() // A37: the entrance plays at the next draw
  const r = await $.ui.open({ id: A5R_PANE, title: 'A5R' }).catch(err => ({ isPlaced: false, reason: String(err) }) as const)
  if (r.isPlaced) return 'A5R pane opened.'
  const why = 'reason' in r ? String(r.reason) : 'not placed'
  $.ui.toast(`A5R: the pane could not be placed (${why})`)
  return `A5R pane not placed: ${why}`
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

/** Ather's pane as Ather drew it. With A5R on: one compact A5R line right under Ather's own summary strip (A28), the
 * accent in lacquer gold and the red seal beside the brand. Nothing else of A5R is in it; the rest is the A5R pane. */
async function drawPane($: Engine, opts: Opts, e: { surface: string; props: { bodyColumns?: number } }, tree: RenderElement): Promise<RenderElement> {
  const on = await readA5R($)
  if (!on) return tree // A5R off: Ather's pane exactly as Ather drew it (D1)
  const el = $.ui.resolve(e as never) as never as Parameters<typeof icon>[0] & Parameters<typeof tilesRow>[0]
  const isDesktop = e.surface === 'desktop'
  const now = await $.clock.now()
  const root = tree as unknown as { children?: unknown[] }
  if (!Array.isArray(root.children)) return recolor(tree)
  let kids = [...root.children]
  const stripAt = kids.findIndex(k => keyOf(k) === 'strip')
  if (isS2 && stripAt >= 0) {
    scheduleReads($, opts, now)
    // A30: "★ A5R ›" on the seal red (a Button has no colour of its own: the red is its box's background).
    const button = el.Button({ key: 'hai-a5r-open', label: '★ A5R ›', plain: true, onPress: () => void openA5Pane($) })
    // A40: the button's label is the surface's ink; seal red behind it reads in the dark theme, a red rim in the light one.
    let line = compactLine(el, lineParts(el, opts, isDesktop, now), button, isDesktop, currentTheme() === 'dark' ? A5R_LOOK.sealBg : undefined, currentTheme() === 'light' ? A5R_LOOK.hit : undefined)
    // A37: the compact line's entrance when it first draws (desktop, motion on).
    if (lineEnterAt === 0) lineEnterAt = now
    const life = entranceLife(paceOf(opts.motion))
    if (isDesktop && opts.motion !== 'off' && now - lineEnterAt < life) {
      line = withCurtain(el as never, line, 'hai-a5r-line-in', entrance(1, paceOf(opts.motion))[0] as Curtain)
      $.clock.after(life + 10, () => $.ui.invalidate('ui.render'))
    }
    kids.splice(stripAt + 1, 0, line)
  }
  // The pixel seal only while it stamps in on the desktop; the crisp text seal the rest of the time.
  const stamp = opts.motion !== 'off' && now - a5rFlipAt < MOTION_MS
  const sealEl = stamp && isDesktop && el.Svg ? el.Svg({ source: sealSvg(A5R_LOOK.sealBg, A5R_LOOK.sealText, true), alt: 'A5R on', width: 34, height: 14, isInteractive: true }) : undefined
  kids = kids.map(k => replaceKeyed(k, 'head-words', words => withSeal(el, words, sealEl)))
  // A39: every worker avatar Ather drew wears the red scarf while A5R is on.
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
 * whole sequence ending within 300 ms × pace (A51: ten times slower with motion slow); the cells take 4 ms × pace. */
const entrance = (n: number, pace = 1): Curtain[] => entranceCurtains(n, A5R_LOOK.sealBg, pace)

/** A35 (mockup v2): the A5R pane's frame: the band at full width, then every block on one gutter, one gap between blocks.
 * A49: a block on the gutter drops its own `width: '100%'` and stretches instead: a width of 100% is the pane's whole
 * width, and the gutter margins sit outside it, so the block ran 2 columns past the pane's right edge and the edge cut
 * the ends of its lines (a session row's "· 2m" read "· 2"). Stretched, its width is the pane's minus both margins. */
function paneOf(el: { Box: (p: Record<string, unknown>) => unknown }, kids: unknown[]): RenderElement {
  const [band, ...blocks] = kids as { props?: Record<string, unknown> }[]
  const onGutter = blocks.map(b => {
    const { width: _full, ...props } = b.props ?? {}
    return { ...b, props: { ...props, marginX: V2.gutter, marginTop: 0 } }
  })
  return el.Box({ key: 'hai-a5r-pane', flexDirection: 'column', alignItems: 'stretch', width: '100%', rowGap: 1, children: [band, ...onGutter] }) as unknown as RenderElement
}

/** A29: the A5R pane: the three tool rows (A25), the sessions list (A26), the Nghiệm thu card (A19), and the five
 * rules as its last block (A27). With A5R off it says how to turn it on; outside the S2 checkout it has no tools. */
async function drawA5Pane($: Engine, opts: Opts, e: { surface: string; props: { bodyColumns?: number } }): Promise<RenderElement> {
  const el = $.ui.resolve(e as never) as never as Parameters<typeof icon>[0] & Parameters<typeof tilesRow>[0]
  const isDesktop = e.surface === 'desktop'
  const now = await $.clock.now()
  const isOn = await readA5R($)
  // A38: the sync freeze and its lift, seen at the draw after they happen.
  const phaseNow = phaseOf(syncFile, now)
  if (lastPhaseSeen !== null && phaseNow === 'frozen' && lastPhaseSeen !== 'frozen') freezeAt = now
  if (lastPhaseSeen === 'frozen' && phaseNow !== 'frozen') liftAt = now
  lastPhaseSeen = phaseNow
  const isFx = isDesktop && opts.motion !== 'off'
  const pace = paceOf(opts.motion) // A51: slow plays the entrance and the event dithers ten times slower
  const fxMs = fxLife(pace)
  let fxPlaced = false
  let band = a5rBand(el, isOn, isOn && phaseNow === 'frozen')
  if (isFx && now - freezeAt < fxMs) {
    band = withOverlay(el as never, band, 'hai-a5r-fx-freeze', sweepSvg(A5R_LOOK.sealText, false, 900, 120, 2, pace))
    fxPlaced = true
  } else if (isFx && now - liftAt < fxMs) {
    band = withOverlay(el as never, band, 'hai-a5r-fx-lift', sweepSvg(A5R_LOOK.sealText, true, 900, 120, 2, pace))
    fxPlaced = true
  }
  const kids: unknown[] = [band] // A33/A35: the band first
  if (!isOn) {
    kids.push(el.Box({ key: 'hai-a5r-off', children: [el.Text({ color: ATHER.quiet, wrap: 'wrap', children: 'A5R is off: Ather runs as it ships. /a5r on turns on the five rules, the Editor holder, RAM and Sync main for every session.' })] }))
    return paneOf(el, kids)
  }
  scheduleReads($, opts, now)
  if (isS2) {
    const id8 = me8 || (await $.session.id()).slice(0, 8).toLowerCase()
    const waiting = queueOf(me ? [me, ...peers] : peers, lanes, now, syncFile).length
    const plan = syncData(now)
    const tiles = [
      editorTile({ lock: lockView, me8: id8, nowMin, place: placeShort(decision), waiting }),
      memoryTile(el, vitals, { pieGb: gates.pieGb, nopieGb: gates.nopieGb, isFromPanel: gates.source === 'panel', cleanup: cleanupNote, diskGb: probe?.diskGb ?? null, drive: s2Root(opts).slice(0, 2) }, { fill: A5R_LOOK.meter, track: A5R_LOOK.meterTrack }),
      mainTile(sync, plan, syncActionButton($, opts, el, isDesktop, now)),
    ]
    tiles[0] = { ...tiles[0], action: editorAction($, opts, el, isDesktop) } as (typeof tiles)[number]
    // A35 (mockup v2): Memory reads "<n> GB free · below launch gate" (the note in amber only when below); its gate
    // details are the sub-line; no meter. Sync main's sub-line: when main was fetched, the planned or last sync.
    // A50: only the parts that warn (a low disk, N git processes) are amber; the gate details stay quiet.
    const free = vitals?.freeGb
    const extra = [...(probe?.diskGb !== null && probe?.diskGb !== undefined && probe.diskGb < DISK_MIN_GB ? [`${s2Root(opts).slice(0, 2)} ${probe.diskGb} GB free`] : []), ...(vitals && vitals.git >= 10 ? [`${vitals.git} git processes`] : [])].map(text => ({ text, warn: true }))
    tiles[1] = {
      ...tiles[1],
      value: free === undefined ? 'probe failed' : `${free} GB free`,
      meter: undefined,
      ...(free !== undefined && free < gates.nopieGb ? { note: { text: 'below launch gate', warn: true } } : free !== undefined && free < gates.pieGb ? { note: { text: 'launch fits without PIE', warn: false } } : {}),
      sub: [{ text: `gate ${gates.pieGb} GB with PIE, ${gates.nopieGb} without` }, { text: `PIE needs ${PIE_START_GB} GB` }, ...extra],
    } as (typeof tiles)[number]
    if (sync) tiles[2] = { ...tiles[2], sub: [`fetched ${ago(sync.fetchedMinAgo)}`, plan.line, plan.conflicts, ...sync.flags].filter(Boolean).join(' · '), subWarn: Boolean(plan.conflicts) || sync.flags.length > 0 } as (typeof tiles)[number]
    const names = { editor: 'editor', memory: 'memory', main: 'branch' } as const
    for (const t of tiles) {
      const name = names[t.key as keyof typeof names]
      // A33: gold icons; a state that is not fine keeps its status colour.
      const color = t.dot && t.dot !== STATUS.ok ? t.dot : A5R_LOOK.gold
      t.icon = icon(el, name, color, motionFor(`pane-${t.key}`, `${t.value}|${color}`, color, now, t.key === 'main' && plan.isRunning, opts), isDesktop)
    }
    kids.push(tilesRow(el, tiles, isDesktop, PANE_INK()))
    // A26: the sessions on this machine as a short named list, one line each.
    const view = sessionsView({ me8: id8, meTitle: me?.title ?? '', files: me ? [me, ...peers] : peers, lanes, clients, isS2Cwd: cwd => s2Cwds.get(cwd.toLowerCase()) ?? false, lock, sync: syncFile, now, phase: phaseOf(syncFile, now), names: sessionNames })
    kids.push(sessionsBox(el, view, isDesktop, PANE_INK()))
    // A31: every live session's record title, to match it to the app's open list (and to title it without that list).
    const live = [...new Set([...lanes.filter(l => !l.hasEnded && now - l.mtimeMs <= LANE_STALE_MS).map(l => l.sessionId.slice(0, 8).toLowerCase()), ...peers.filter(p => now - p.heartbeatAt <= HEARTBEAT_STALE_MS).map(p => p.id8)])].filter(id => id && id !== id8)
    if (live.length > 0 && !isNaming && live.some(id => now - (namesAt.get(id) ?? 0) > NAME_TTL_MS)) $.clock.after(10, () => void refreshNames($, opts, live))
  } else kids.push(el.Box({ key: 'hai-a5r-nos2', children: [el.Text({ color: ATHER.quiet, wrap: 'wrap', children: 'This session is not in the S2 checkout: the Editor, Memory and Sync main tools and the sessions list live in an S2 session.' })] }))
  // A19: the Nghiệm thu A5R card, once there is a score or the tracked intent is in Ship.
  if (lastAccept) {
    // A53: each rule's items capped at three lines (grouped by folder, "and N more"); A52: one section per PR.
    const rowsOf = (scores: RuleScore[]) => scores.map(s => ({ rule: s.rule, name: ruleName(s.rule), state: s.state, line: s.line, ...(s.state === 'fail' ? { items: cappedItems(s.issues).map(i => i.text) } : {}) }))
    const prs = lastAccept.prs?.map(p => ({ n: p.n, label: p.label, rows: rowsOf(p.scores) }))
    kids.push(acceptCard(el, 'A5R acceptance', `${lastAccept.slug ?? 'no intent'} · ${lastAccept.what} · ${clockOf(lastAccept.at)}`, rowsOf(lastAccept.scores), isDesktop, prs))
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
    return s ? [el.Text({ key: `hai-a5r-chip-${n}-mark`, color: s.state === 'pass' ? STATUS.ok : s.state === 'fail' ? STATUS.bad : A5R_LOOK.quiet, children: s.state === 'pass' ? '✓' : s.state === 'fail' ? '✗' : '–' })] : []
  }
  let rules = rulesChips(el as never, ruleCards(rulesA5R), hits, openRule, pressSeal, motto, { ink: A5R_LOOK.ivory, quiet: A5R_LOOK.quiet, hit: A5R_LOOK.hit }, marks)
  if (isFx)
    for (const n of [1, 2, 3, 4, 5]) {
      const id = `D${n}`
      if (now - (hitStampAt[id] ?? -fxMs) < fxMs) {
        rules = replaceKeyed(rules, `hai-a5r-chip-${n}-box`, box => withOverlay(el as never, box, `hai-a5r-fx-hit-${n}`, stampSvg(A5R_LOOK.sealBg, 0, 8 * pace, 600 * pace)))
        fxPlaced = true
      }
      if (lastAccept && now - scoreFxAt < fxMs) {
        rules = replaceKeyed(rules, `hai-a5r-chip-${n}-box`, box => withOverlay(el as never, box, `hai-a5r-fx-score-${n}`, curtainSvg(scoreCurtain(n, A5R_LOOK.gold, pace))))
        fxPlaced = true
      }
    }
  if (fxPlaced) $.clock.after(fxMs + 10, () => $.ui.invalidate('ui.render')) // then still
  // A65: the Orchestrate card, the judges' latest verdicts, last before the rules (the rules stay the foot, A27).
  if (isS2 && verdicts.length > 0) kids.push(orchestrateCard(el as never, verdicts))
  kids.push(rules)
  // A37: the entrance, on the desktop, with motion on, for a moment after the pane opened (or first drew).
  if (paneEnterAt === 0) paneEnterAt = now
  const life = entranceLife(pace)
  const isEntering = isDesktop && opts.motion !== 'off' && now - paneEnterAt < life
  if (isEntering) {
    const plan = entrance(kids.length, pace)
    kids.forEach((k, i) => {
      kids[i] = withCurtain(el as never, k, `hai-a5r-in-${i}`, plan[i] as Curtain)
    })
    $.clock.after(life + 10, () => $.ui.invalidate('ui.render')) // then still: the curtains leave the tree
  }
  return recolor(paneOf(el, kids))
}

export const register: Register = (on, options) => {
  const opts = options as unknown as Opts

  on('session.start', async ($, e, next) => {
    const res = await next(e)
    await readTheme($) // A40
    await $.command.register({
      name: 'a5r',
      description: 'A5R: /a5r (opens the A5R pane) · /a5r on · /a5r off · /a5r status · /a5r accept (A5R acceptance now) · /a5r pass <PR or slug> (let one through once) · /a5r help · /a5r gate <with PIE GB> <without PIE GB> | reset · /a5r sync HH:MM [build] [for <session>] | move HH:MM | build on|off | cancel | done | abort | takeover (on: the five rules, checked at the action and at A5R acceptance at the end of the checklist; Editor holder, RAM and Sync main)',
      argumentHint: 'on | off | status | accept | pass <PR or slug> | gate <pie> <nopie> | sync HH:MM | help',
    })
    await readA5R($)
    a5rFlipAt = 0 // a session that starts with A5R already on does not stamp the seal
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
  on('agent.offer', { agent: JUDGE_AGENT }, async () => ({ isOffered: false })) // A65: a5r's alone

  // A /clear goes on under a new session id: this session's lease, request and sync follow it (A10).
  on('session.end', async ($, e, next) => {
    const res = await next(e)
    if (e.reason === 'clear' && isS2) {
      clearFrom = e.sessionId
      followClear($, opts, e.sessionId, 25)
    }
    return res
  })

  on('command.run', { command: 'a5r' }, async ($, e) => {
    if (/^sync\b/i.test(e.args.trim())) return { text: await syncCommand($, opts, e.args.trim().slice(4)) }
    if (/^accept\b/i.test(e.args.trim())) return { text: await acceptCommand($, opts) }
    if (/^gate\b/i.test(e.args.trim())) return { text: await gateCommand($, opts, e.args.trim().slice(4)) }
    if (/^pass\b/i.test(e.args.trim())) return { text: await passCommand($, opts, e.args.trim().slice(4)) }
    if (/^help\b/i.test(e.args.trim())) return { text: A5R_HELP }
    // A29: `/a5r` with no words opens the A5R pane; `/a5r status` keeps the text reply below.
    if (e.args.trim() === '') return { text: await openA5Pane($) }
    const arg = e.args.trim().toLowerCase()
    if (arg === 'on' || arg === 'off') {
      await $.store.set('a5r', { on: arg === 'on' })
      if (arg === 'on' && !a5rOn) a5rFlipAt = await $.clock.now()
      a5rOn = arg === 'on'
      if (a5rOn) hits = noHits()
      if (a5rOn && isS2) await runTick($, opts)
      showStatus($)
      $.ui.invalidate('ui.render')
      return {
        text: a5rOn
          ? '★ A5R on: the five rules apply in every session from its next tool call (at the action for what cannot be undone; A5R acceptance at the end of an intent checklist, at Ship and at its close); Ather\'s pane takes the red seal and the gold accent.'
          : 'A5R off: the rules, A5R acceptance, the Editor holder, RAM and Sync main gates stop; Ather\'s pane, status line and toasts are Ather\'s own again. The 🟥/⏯️ title marks stay.',
      }
    }
    await readA5R($)
    const where2 = chain === null ? 'not seen yet (no tool call so far)' : chain.includes('ather-automata') ? 'above ather-automata: its pane gets the tiles' : `beneath ather-automata (${chain.join(' → ') || 'nothing'} below): the pane cannot be wrapped from here; put a5r first in CLAUDE_CODE_PLUGIN_DIRS`
    const coord =
      a5rOn && isS2
        ? ` Editor: ${placeText(decision)}; lock: ${(lockRaw ?? '').trim() || 'missing'}. Memory: ${probe ? `${probe.freeGb} GB free` : 'no reading'}, launch gate ${gates.pieGb}/${gates.nopieGb} GB (${gates.source}). Sync: ${syncFile ? `${clockOf(syncFile.at)} ${phaseOf(syncFile, nowMs)} (holder ${syncFile.holder.lane}, hard end ${clockOf(syncFile.hardEnd)})` : 'none planned'}. ${overviewLine(overviewOf({ me8, files: me ? [me, ...peers] : peers, lanes, clients, isS2Cwd: cwd => s2Cwds.get(cwd.toLowerCase()) ?? false, lock, sync: syncFile, now: nowMs, phase: phaseOf(syncFile, nowMs) }))}.`
        : ''
    return { text: `A5R is ${a5rOn ? 'ON' : 'off'}. Hits this session: ${Object.entries(hits).map(([k, v]) => `${k} ${v}`).join(' · ')}. a5r sits ${where2}.${coord}` }
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const input = e as unknown as Input
    // The main loop's model made this call (a plugin's own `$.tool.call`, this mod's included, is raised by that
    // plugin, not the engine): it marks the session busy, and its result may carry queued notices to the model.
    const isMain = e.agentId === undefined && next.origin.plugin === 'engine'
    if (isMain) isBusy = true
    if (isMain) await markTurn($) // A55: the main loop runs
    if (isMain) turnSignalAt = await $.clock.now() // A59
    if (tool === EDITOR_TOOL) return { result: await editorTool($, opts, input) }
    if (tool === SYNC_TOOL) {
      const paths = Array.isArray(input.paths) ? input.paths.map(String) : []
      const text = await syncAction($, opts, str(input.action), { at: str(input.at), holder: str(input.holder), note: str(input.note), paths, build: typeof input.build === 'boolean' ? input.build : undefined })
      return { result: [text, ...drain()].join('\n') }
    }
    const a5r = await load($)
    const isOn = await readA5R($)

    // The Editor gate is A5R's (D1): with A5R off nothing of a5r's refuses an Editor call.
    const frozen = isOn ? await freezeProblem($, opts, a5r, tool, input) : null
    if (frozen) return { deny: frozen }
    const editor = isOn ? await editorProblem($, opts, tool, input) : null
    if (editor) return { deny: blocked('Editor lock', editor.split(' → ')[0] ?? editor, editor.split(' → ').slice(1).join(' → ') || 'wait for the Editor') }
    const coord = isOn ? await coordProblem($, opts, tool, input) : null
    if (coord) return { deny: coord }
    // A18: nghiệm thu A5R on the PR-opening call and on an intent close (D10: at acceptance, never per turn).
    const accepted = isOn ? await acceptGate($, opts, a5r, tool, input, e.agentId) : null
    if (accepted) return { deny: accepted }

    let d: Decision | null = null
    let what = ''
    let parts: [string, string, string][] = []
    const locs: Located[] = []
    let dLoc: Located | null = null // A75: the edit the decision is about
    if (SHELL_TOOLS.has(tool)) {
      what = str(input.command)
      if (isOn) {
        const cwd = await $.session.cwd()
        d = a5r.preShell(what, cwd, places, 0, await sharedTest($, a5r, what, cwd))
        // A15: the sync's own git work passes A5R's asks for its holder and worker, during their frozen phase only.
        if (d?.kind === 'ask' && isSyncCommandOnly(what) && (await isFrozenHolder($, opts))) d = null
      }
    } else if (EDIT_TOOLS.has(tool)) {
      parts = await editParts($, tool, input)
      const scope = isOn ? await scopeGlobs($) : []
      for (const [path, old, neu] of parts) {
        const loc = await locate($, a5r, path)
        locs.push(loc)
        if (isOn && !d) {
          d = a5r.preEdit(path, old, neu, loc, scope, await isSharedRoot($, loc.root))
          if (d) dLoc = loc
        }
        what = path
      }
    }
    // A74: git in the shared checkout, read on facts segment by segment (every form, whatever rule 1's patterns match);
    // the sync's own commands in its frozen phase pass (A15).
    if (isOn && SHELL_TOOLS.has(tool) && /\bgit\b/.test(what) && !(isSyncCommandOnly(what) && (await isFrozenHolder($, opts)))) {
      const problem = await gitSharedProblem($, opts, a5r, what, await $.session.cwd())
      if (problem) {
        count('D1')
        return { deny: problem }
      }
    }
    // A73: no gate asks or waits; the same answer for the main loop, a worker, bypass mode and an away window.
    if (d) {
      const a = actOf(d, what)
      if (a.act === 'refuse') {
        count(d.rule)
        return { deny: blocked(gateOf(d.rule), d.why, a.alt ?? 'do it another way') }
      }
      if (a.act === 'record') {
        const target = SHELL_TOOLS.has(tool) ? recordTarget(d.key, what) : (dLoc?.rel ?? what)
        await recordAction($, opts, { kind: d.key, rule: d.rule, path: SHELL_TOOLS.has(tool) ? what.slice(0, 300) : (dLoc?.rel ?? what), target, root: dLoc?.root ?? null, why: d.why }).catch(() => undefined)
      }
    }

    const ran = await next(e)
    if (chain === null) {
      // Where this plugin sits: Ather beneath means its pane can be wrapped. Kept outside the plugin
      // folder (a write inside it would reload the mod), for /a5r status and for checking by hand.
      chain = next.trace.map(t => t.plugin).filter(p => p !== 'engine')
      const id8 = (await $.session.id()).slice(0, 8)
      await $.fs.write(`${(places.TEMP ?? '').replace(/\\/g, '/')}/a5r/chain-${id8}.json`, JSON.stringify({ beneath: chain })).catch(() => undefined)
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
      // A66: the holder launched the Editor or reached it over MCP: name its pid in the lock line if it does not yet.
      if (isS2 && (isUnrealMcp(tool) || (SHELL_TOOLS.has(tool) && isEditorStartStop(what))) && holdsLock() && lock.pid === null) await notePid($, opts, true).catch(() => undefined)
      if (text && mcpKind(text) === 'pie') isPieRunning = true
      if (text && PIE_STOP.test(text)) isPieRunning = false
      if (EDIT_TOOLS.has(tool) && isS2) await recordTouch($, opts, locs)
      // A74 (review 5): a commit in the shared checkout takes its committed paths out of this session's touch set.
      if (isS2 && SHELL_TOOLS.has(tool) && /\bgit\b[^\n]*\bcommit\b/.test(what)) await pruneTouched($, opts).catch(() => undefined)
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
    if (e.agentId !== undefined && isS2 && (await readA5R($))) {
      await workerEnded($, opts, e.agentId, 'answer' in e && typeof e.answer === 'string' ? e.answer : '').catch(err => $.ui.log(`a5r: worker end: ${String(err)}`, { to: 'debug' }))
      await judgeEnded($, opts, e.agentId, 'answer' in e && typeof e.answer === 'string' ? e.answer : '').catch(err => $.ui.log(`a5r: judge end: ${String(err)}`, { to: 'debug' }))
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
      await markTurn($) // A55: the turn saw everything its tool results carried, a grant made in it included
      turnSignalAt = await $.clock.now() // A59
      isBusy = false
      if (a5rOn) await deliverIdle($, opts)
    }
    return res
  })

  on('prompt.submit', async ($, e, next) => {
    isBusy = true
    // A59: a prompt Hai sends starts a turn; a plugin's queued prompt (this mod's wake included) only counts once its turn
    // runs a tool or ends, so a wake that never runs cannot pass for a turn.
    if ((e.origin as { kind?: string } | undefined)?.kind !== 'plugin') turnSignalAt = await $.clock.now()
    // A55: a turn starts (a prompt a plugin queued, this mod's notice prompt included, counts once the turn runs a tool or ends)
    if ((e.origin as { kind?: string } | undefined)?.kind !== 'plugin') await markTurn($)
    // Hai typed: the marker has been seen, so the title goes back. A63: the title without its mark, read now (never a
    // value kept in memory, which a reload or a restart loses).
    const typed = (e.origin as { kind?: string } | undefined)?.kind
    if (typed === 'composer' || typed === 'bridge') {
      const title = await sessionTitle($)
      if (hasMark(title) && bareTitle(title)) await retitle($, bareTitle(title)).catch(() => '')
    }
    // A21: Ather's Ship hand-off is scored at once and the score rides the prompt (never refused: the PR call stays
    // the gate). The origin is what the sender says: it only adds context here, it never opens a gate.
    const origin = e.origin as typeof e.origin | undefined
    const shipFor = origin?.kind === 'plugin' && origin.name === 'ather-automata' ? shipSlugOf(e.text) : null
    const added = shipFor && (await readA5R($)) ? await shipScore($, opts, shipFor).catch(() => null) : null
    const text = added ? `${e.text}\n\n${added}` : e.text
    // Notices waiting for the next turn ride this prompt as context the model reads (D6).
    if (pending.length > 0 && (await readA5R($))) {
      const texts = drain()
      await saveMe($, opts)
      return next({ ...e, text, context: [...(e.context ?? []), ...texts] })
    }
    return added ? next({ ...e, text }) : next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const res = await next(e)
    await load($)
    const isOn = await readA5R($)
    const id8 = (await $.session.id()).slice(0, 8)
    const text = [rulesFlow, isOn ? rulesA5R : ''].filter(Boolean).join('\n\n').replaceAll('{SESSION8}', id8)
    if (!text) return res
    return { ...res, sections: [...res.sections, { id: 'a5r:rules', text, scope: 'session' as const }] }
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
  // A29: the A5R pane is this plugin's own: drawn here, never by anything beneath.
  on('ui.render', { component: 'Pane', requestId: A5R_PANE }, async ($, e) => drawA5Pane($, opts, e))
}
