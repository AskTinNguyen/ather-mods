// A5R's coordination core for the sessions that share one S2 checkout and one machine: the Editor holder,
// RAM and the Sync main holder. Pure: no `$`; register.ts reads the files, probes the machine, writes and
// delivers. Every session computes the same answers from the same files, so there is no arbiter to keep
// alive: each session writes only its own files (Saved/A5R/editor/<id8>.json, touch/<id8>.json), the
// sync holder alone writes Saved/A5R/sync.json, and the head of the queue alone takes a free lock.
// Files are the truth; a notice is only a doorbell.
import { commandVerb, gitTarget, isDotNetWrite, norm, programs, psQuote, segments, stripHeredocs, tokenize, under, writesFiles } from './a5r.ts'
import { conflictLabel, ruleNote, rulesLabel, storedRules, type SyncRule } from './syncrules.ts'
import type { LeaseNotes } from './lease.ts'
import type { DryRound } from './dryrun.ts'
import { buildStep, runLabel, SCRIPT_SUFFIX } from './buildscript.ts'
import { endOf, opOf, type ConflictHead, type HeadFile } from './gitshared.ts'
import { engineLabel, type EngineFind } from './machine.ts'
import { POST_MERGE_TESTS, isMergedStage, mergeLabel, syncBuildLog, testsLabel, type EntryTell, type StageTell, type SyncStage } from './syncstage.ts'

export const DIR = 'Saved/A5R'
export const HEARTBEAT_STALE_MS = 3 * 60_000 // a session file not refreshed for 3 min: that session is gone
export const LANE_STALE_MS = 10 * 60_000 // Ather's lane heartbeat (30 s) not written for 10 min: gone
export const YIELD_MAX_MIN = 20 // a request this short, without a build, may ask the holder to yield
export const YIELD_EVERY_MS = 60 * 60_000 // at most one interruption per holder per hour
export const CUTOFF_MS = 30 * 60_000 // cutoff = sync − 30 min
export const RELEASE_BEFORE_MS = 10 * 60_000 // the Editor is released by sync − 10 min
export const LEASE_WARN_MS = 5 * 60_000 // the holder is told 5 min before its lease ends
export const IDLE_RELEASE_MS = 15 * 60_000 // an Editor unused this long is released (S2 standard)
export const REAP_BELOW_GB = 14
export const DISK_MIN_GB = 20
export const PIE_START_GB = 5 // fixed, never raised (Hai, 25/09)
export const PIE_ABORT_GB = 3
// D5: Editor ≈ 25.7 GB idle, ≈ 31.4 GB at PIE peak (L_TALab, 28/09). A106 (Hai, 2026-10-20): a MainChar PIE on any map
// needs ≥ 37–38 GB free before launch (machine profile, 2026-10-15), so the PIE launch gate defaults to 38.
export const DEFAULT_GATES = { pieGb: 38, nopieGb: 28 } as const
export const GATE_MIN_GB = 10
export const GATE_MAX_GB = 60
export const MARK = 'A5R ·'

// ---------- time ----------
const pad = (n: number): string => String(n).padStart(2, '0')
export const hhmm = (ms: number): string => {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
export const ymd = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
/** `HH:MM YYYY-MM-DD`, the lock's `since=` stamp. */
export const stampOf = (ms: number): string => `${hhmm(ms)} ${ymd(ms)}`

/** The moment a clock time names, nearest to `now` (an end written as HH:MM can fall either side of midnight). */
export const atNearest = (text: string, now: number): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim())
  if (!m) return null
  const d = new Date(now)
  d.setHours(Number(m[1]), Number(m[2]), 0, 0)
  let t = d.getTime()
  if (t - now > 12 * 3_600_000) t -= 24 * 3_600_000
  else if (now - t > 12 * 3_600_000) t += 24 * 3_600_000
  return t
}

/** The next time a clock time comes round: today when still ahead, else tomorrow. Null for a bad HH:MM. */
export const atNext = (text: string, now: number): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim())
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null
  const d = new Date(now)
  d.setHours(Number(m[1]), Number(m[2]), 0, 0)
  return d.getTime() > now ? d.getTime() : d.getTime() + 24 * 3_600_000
}

/** Three sync times the panel offers: the first half hour at least 45 min ahead (a cutoff notice still lands
 * before its cutoff), then one and two hours later. */
export const presetTimes = (now: number): number[] => {
  const d = new Date(now + 45 * 60_000)
  const extra = d.getMinutes() === 0 || d.getMinutes() === 30 ? 0 : d.getMinutes() < 30 ? 30 - d.getMinutes() : 60 - d.getMinutes()
  d.setMinutes(d.getMinutes() + extra, 0, 0)
  const first = d.getTime()
  return [first, first + 3_600_000, first + 7_200_000]
}

// ---------- session files (Saved/A5R/editor/<id8>.json, one writer each) ----------
export type Mode = 'interactive' | 'unattended'
/** What a session asked the Editor for. */
export type Want = { minutes: number; pie: boolean; build: boolean; what: string; mode: Mode; pausable: boolean; nextSafe: string; requestedAt: number; launch?: boolean; sync?: SyncSlot; isKept?: boolean; focus?: number; waited?: number; waitAt?: number } // focus: A118, made for the Focus that started then; waited / waitAt: A125, the ms its own live session waited (truth.ts liveWait) and when it last counted
/** A79 / A94: a slot that belongs to the sync at `at`: its worker's (silent, released when the worker's sync ends) or its
 * holder's own request for that sync (granted with a notice); both are released with the sync. */
export type SyncSlot = { at: number; role: 'worker' | 'holder' }
/** A79: the Editor slot the sync takes for its worker (its `what` names it, so the grant, lease and idle notices that are
 * meant for a person's own slot skip it). */
export const SYNC_SLOT = 'Sync main '
// A session file from before rev 32 marks the worker's slot only by its `what` (`Sync main HH:MM`).
export const isSyncSlot = (w: Want | null | undefined): boolean => Boolean(w?.sync) || Boolean(w?.what.startsWith(SYNC_SLOT))
/** The worker's own slot, which wakes nobody (A94: the holder's own request for its sync is granted with a notice). */
export const isWorkerSlot = (w: Want | null | undefined): boolean => (w?.sync ? w.sync.role === 'worker' : Boolean(w?.what.startsWith(SYNC_SLOT)))
/** A116 / A117: the holder's lease is the sync's own slot: its file says so, or (no file, or one from before rev 32) its
 * lock note does. */
export const holdsSyncSlot = (lock: LockLine, holder: SessionFile | null | undefined): boolean => isSyncSlot(holder?.want) || lock.note.startsWith(SYNC_SLOT)
/** The lease a session holds, as it took it; A100: with what it notes for its record while it runs (lease.ts); A113: the
 * id8 of the head it went before (a pass slot). */
export type Holding = { since: number; end: number; extended: number; notes?: LeaseNotes; pass?: string }
/** A request to a holder to yield (or a standard `UE request:` line sent to a holder without a5r). */
export type YieldAsk = { holder: string; at: number; via: 'file' | 'send'; minutes: number; lane: string }
export type SessionFile = {
  v: 1
  session: string
  id8: string
  lane: string
  title: string
  heartbeatAt: number
  want: Want | null
  holding: Holding | null
  yieldAsks: YieldAsk[]
  /** Notice ids this session has delivered, so a reload never repeats one. */
  delivered: string[]
  /** A23: PR numbers this session has scored (at the PR call or after the fact), or found already listed when it
   * first read an intent's PR lines; the slugs whose PR lines it has read once (that first read only records). */
  prsKnown?: number[]
  prBaseline?: string[]
  /** A52: the after-the-fact scorer that wrote `prsKnown` (absent: before 0.12.3, which scored the checkout). */
  prScorer?: number
  /** A55: when this session's main loop last ran (a prompt, a tool call, a turn's end); absent before 0.12.4. */
  lastTurnAt?: number
  /** A57: passes Hai gave with `/a5r pass` (an intent slug, or `#<PR>`), each used once by the next gated call. */
  passes?: string[]
  /** A62: how many background agents this session ran at its last save (for orchestrate.log). A67: written every
   * minute; a holder with a running agent is not idle. */
  agents?: number
  /** A67: the kinds of those running agents (their agent types). */
  agentKinds?: string[]
  /** A82: when this session last ran a shell command that may write inside the shared checkout, since its last commit
   * there (absent: none); kept across a reload. */
  sharedShellAt?: number
  /** A103: when this session last used the Editor (an Unreal MCP call, a build, an Editor driver), so an asker can tell
   * whether its holder is in the middle of Editor work. */
  editorUseAt?: number
  /** A104: the place a forced release keeps (the requestedAt of the request it held) until `until`. */
  return?: { requestedAt: number; until: number }
  /** A113 (Fable review D3): written by A5R 0.23.0 and later, which take a pass when they are its passer; a file without it
   * (0.22.0) is never chosen as a passer (it would never take the lock and everyone behind it would wait). */
  canPass?: true
  /** A118: written by A5R 0.25.0 and later, which take and keep a Focus; a file without it is never given one (it would
   * never take the lock, and the queue would wait behind it for the whole box). */
  knowsFocus?: true
}

/** A54/A55: a lease another session's A5R released: lapsed (10 min past its end, its session gone, no Editor or build
 * running, A58) or an unseen grant passed on (no turn since it, 10 min); A60: kept in Saved/A5R/released/<id8>.json. */
export type Released = { kind: 'lapsed' | 'unseen' | 'released'; at: number; by: string; since: number; end: number; requestedAt?: number } // released: Fable review S3, freed by the person past its end

export const blankSession = (session: string, lane: string, title: string, now: number): SessionFile => ({
  v: 1,
  session,
  id8: session.slice(0, 8).toLowerCase(),
  lane,
  title,
  heartbeatAt: now,
  want: null,
  holding: null,
  yieldAsks: [],
  delivered: [],
  canPass: true,
  knowsFocus: true,
})

export const parseSessionFile = (text: string | null): SessionFile | null => {
  try {
    const v = JSON.parse(text ?? '') as Partial<SessionFile>
    if (typeof v?.id8 !== 'string' || typeof v.heartbeatAt !== 'number') return null
    return { v: 1, session: String(v.session ?? v.id8), id8: v.id8.toLowerCase(), lane: String(v.lane ?? v.id8), title: String(v.title ?? ''), heartbeatAt: v.heartbeatAt, want: v.want ?? null, holding: v.holding ?? null, yieldAsks: Array.isArray(v.yieldAsks) ? v.yieldAsks : [], delivered: Array.isArray(v.delivered) ? v.delivered : [], prsKnown: Array.isArray(v.prsKnown) ? v.prsKnown.filter(n => Number.isInteger(n)) : [], prBaseline: Array.isArray(v.prBaseline) ? v.prBaseline.map(String) : [], ...(typeof v.prScorer === 'number' ? { prScorer: v.prScorer } : {}), ...(typeof v.lastTurnAt === 'number' ? { lastTurnAt: v.lastTurnAt } : {}), ...(Array.isArray(v.passes) ? { passes: v.passes.map(String) } : {}), ...(typeof v.agents === 'number' ? { agents: v.agents } : {}), ...(Array.isArray(v.agentKinds) ? { agentKinds: v.agentKinds.map(String) } : {}), ...(typeof v.sharedShellAt === 'number' ? { sharedShellAt: v.sharedShellAt } : {}), ...(typeof v.editorUseAt === 'number' ? { editorUseAt: v.editorUseAt } : {}), ...(typeof v.return?.requestedAt === 'number' && typeof v.return.until === 'number' ? { return: { requestedAt: v.return.requestedAt, until: v.return.until } } : {}), ...(v.canPass === true ? { canPass: true as const } : {}), ...(v.knowsFocus === true ? { knowsFocus: true as const } : {}) }
  } catch {
    return null
  }
}

/** Ather's lane heartbeat (Saved/AtherAutomata/lanes/<sessionId>.json): liveness, and the intent and branch it
 * names (A16). */
export type LaneBeat = { sessionId: string; hasEnded: boolean; mtimeMs: number; intent?: string; branch?: string; lastActiveAt?: number }
export type Liveness = 'alive' | 'gone' | 'unknown'

/** Whether the session named by its first 8 hex is alive, from files only. A58: its own a5r's fresh heartbeat (its
 * session file written within 3 min) means alive, whatever Ather's lane says (a lane can end or go stale while the
 * session runs on); else Ather's lane ended or older than 10 min, or a session file older than 3 min with no fresh
 * lane, means gone. With neither file it is unknown, which is never treated as gone. */
export const livenessOf = (id8: string, files: readonly SessionFile[], lanes: readonly LaneBeat[], now: number): Liveness => {
  if (!id8) return 'unknown'
  const mine = files.find(f => f.id8 === id8)
  if (mine && now - mine.heartbeatAt <= HEARTBEAT_STALE_MS) return 'alive'
  const lane = lanes.find(l => l.sessionId.toLowerCase().startsWith(id8))
  if (lane && (lane.hasEnded || now - lane.mtimeMs > LANE_STALE_MS)) return 'gone'
  const file = files.find(f => f.id8 === id8)
  if ((file && now - file.heartbeatAt <= HEARTBEAT_STALE_MS) || lane) return 'alive'
  return file ? 'gone' : 'unknown'
}

// ---------- the Editor owner lock: S2 standard lines (D2) ----------
export type LockKind = 'missing' | 'free' | 'held' | 'handed'
export type LockLine = {
  kind: LockKind
  /** Written in the S2 standard's form (HELD / HANDED / FREE), not a legacy free-text line. */
  isStandard: boolean
  /** A84: a held line names its holder (a standard line, or a free-form one naming an id, `held by`/`holder:` or a
   * `<lane> (…)` start); a free-form line naming nobody is unreadable (held until its end or 2 h, then free when nothing
   * runs). Free and missing lines count as readable. */
  isReadable: boolean
  /** A84 (re-review): the lane named right after `held by` in a free-form line ('' when it names an id or nothing); the
   * only lane a hand-written holder is matched by. */
  heldLane: string
  raw: string
  lane: string
  sessionName: string
  id8: string
  since: string
  pid: number | null
  end: string
  mode: string
  pausable: boolean
  nextSafe: string
  note: string
  by: string
  background: string
}

const field = (text: string, re: RegExp): string => re.exec(text)?.[1]?.trim() ?? ''
const blank = (raw: string, kind: LockKind): LockLine => ({ kind, isStandard: false, isReadable: kind !== 'held' && kind !== 'handed', heldLane: '', raw, lane: '', sessionName: '', id8: '', since: '', pid: null, end: '', mode: '', pausable: true, nextSafe: '', note: '', by: '', background: '' })

/** The lock's first line, read the S2 standard's way (HELD / HANDED / FREE) or as an older free-text line: a
 * line without a prefix is FREE when it says "free since", else HELD (the standard, section 1). */
export const parseLockLine = (raw: string | null): LockLine => {
  if (raw === null) return blank('', 'missing')
  const first = (raw.replace(/^﻿/, '').split(/\r?\n/).find(l => l.trim() !== '') ?? '').trim()
  if (first === '') return blank('', 'missing')
  const id8 = /\bsession\s+([0-9a-f]{8})/i.exec(first)?.[1]?.toLowerCase() ?? ''
  const pidText = field(first, /\bpid=(\d+|none)\b/)
  const pid = /^\d+$/.test(pidText) ? Number(pidText) : null
  if (/^FREE\b/.test(first))
    return { ...blank(first, 'free'), isStandard: true, isReadable: true, since: field(first, /\bsince=(\d{1,2}:\d{2}(?: \d{4}-\d{2}-\d{2})?)/), by: field(first, /\bby=(\S+)/), note: field(first, /\bnote=(.*?)(?=\s+background=|\s+·\s|$)/), background: field(first, /\bbackground=(\S+)/), pid: /open PID (\d+)/i.test(first) ? Number(/open PID (\d+)/i.exec(first)?.[1]) : null }
  if (/^HELD\b/.test(first))
    return {
      ...blank(first, 'held'),
      isStandard: true,
      isReadable: true,
      // Hotfix 0.18.2: a standard line naming no `session <id8>` (its session= is a title, not an id) is resolved by its
      // lane, like a hand-written line.
      heldLane: id8 ? '' : field(first, /\blane=(\S+)/),
      lane: field(first, /\blane=(\S+)/),
      sessionName: field(first, /\bsession=(\S+)/),
      id8,
      since: field(first, /\bsince=(\d{1,2}:\d{2}(?: \d{4}-\d{2}-\d{2})?)/),
      pid,
      end: field(first, /\bend=(\d{1,2}:\d{2})/),
      mode: field(first, /\bmode=(\w+)/),
      pausable: field(first, /\bpausable=(yes|no)\b/) !== 'no',
      nextSafe: field(first, /\bnext_safe=(.*?)(?=\s+note=|\s+·\s|$)/),
      note: field(first, /\bnote=(.*?)(?=\s+·\s|$)/),
    }
  if (/^HANDED\b/.test(first))
    return { ...blank(first, 'handed'), isStandard: true, isReadable: true, lane: field(first, /\blane=(\S+)/), by: field(first, /\bfrom=(\S+)/), id8, since: field(first, /\bat=(\d{1,2}:\d{2})/), pid, end: field(first, /\breturn_by=(\d{1,2}:\d{2})/), note: field(first, /\bnote=(.*)$/) }
  if (/\bfree since\b/i.test(first) || /^free\b/i.test(first)) return { ...blank(first, 'free'), since: field(first, /free since\s+(\d{1,2}:\d{2})/i) }
  // A84 (MEASURED 2026-10-16: `held by 9b53d3 (avian wing-kit: …) since 10:36 until 13:06 2026-10-16. … Editor PID
  // 21832.`, written by hand while A5R was off): a free-form line is read for what it says: its holder ONLY from an
  // explicit `session <8 hex>` or the token right after `held by` (a 6-8 hex id with a digit, else a lane: the first word
  // up to a space, "(", "since" or "until"); never an id found elsewhere in the note (a yield request's id, a commit sha).
  // Its end (dated when the line carries a date) and its Editor PID.
  const after = /\bheld by\s+(.+)$/i.exec(first)?.[1] ?? ''
  const token = (/^([^\s(]+?)(?=\s|\(|since\b|until\b|$)/i.exec(after)?.[1] ?? '').replace(/[,.;:]+$/, '')
  const hex = /^(?=[0-9a-f]*\d)[0-9a-f]{6,8}$/i.test(token) ? token.toLowerCase() : ''
  const anyId = id8 || hex
  const legacyLane = /^(\S+)\s+\(/.exec(first)?.[1] ?? ''
  // Round-2 review: the legacy hand form `<lane> (…) since HH:MM … expected end HH:MM` names its holder lane first.
  const legacyHolder = !after && !anyId ? (/^(\S+)\s+\([^)]*\)\s*,?\s*since\s+\d{1,2}:\d{2}/i.exec(first)?.[1] ?? '') : ''
  const heldLane = token && !hex ? token : legacyHolder
  const lane = (hex ? (/^\s*\(([^):]+)/.exec(after.slice(token.length))?.[1] ?? '') : heldLane) || legacyLane || (first.split(/\s+/)[0] ?? '')
  const span = /(\d{1,2}:\d{2})\s*(?:->|→)\s*~?(\d{1,2}:\d{2})/.exec(first)
  const end = span?.[2] ?? field(first, /(?:until|expected end|ends?)\s+~?(\d{1,2}:\d{2})/i)
  let since = span?.[1] ?? field(first, /\bsince\s+(\d{1,2}:\d{2})/i)
  const date = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(first)
  if (since && date) {
    // The date names the line's day (its end's, when it follows the end); a start later than the end is the day before.
    const d = new Date(Number(date[1]), Number(date[2]) - 1, Number(date[3]))
    const minutes = (t: string): number => Number(t.split(':')[0]) * 60 + Number(t.split(':')[1])
    if (end && minutes(since) > minutes(end)) d.setDate(d.getDate() - 1)
    since = `${since.padStart(5, '0')} ${ymd(d.getTime())}`
  }
  const handPid = /\bPID\s*[=:]?\s*(\d{2,})\b/i.exec(first)?.[1]
  return {
    ...blank(first, 'held'),
    isReadable: anyId !== '' || heldLane !== '',
    lane: lane.replace(/\buntil\b.*$/i, '').trim().slice(0, 60),
    heldLane: heldLane.slice(0, 60),
    id8: anyId,
    since,
    end,
    pid: pid ?? (handPid ? Number(handPid) : null),
    note: first.slice(0, 120),
  }
}

/** A84: whether a lock line names this session as its holder: by its id (a hand-written line may name only its first
 * 6-8 hex), or, for a free-form line that names no id, by its lane. */
export const namesHolder = (lock: LockLine, id8: string, lane = ''): boolean => {
  if ((lock.kind !== 'held' && lock.kind !== 'handed') || !id8) return false
  if (lock.id8) return lock.id8.length >= 6 && id8.toLowerCase().startsWith(lock.id8)
  if (!lock.heldLane) return false
  const a = safeWord(lock.heldLane).toLowerCase()
  return a !== 'unnamed' && a.length >= 3 && a === safeWord(lane).toLowerCase()
}

/** A84 (re-review): a hand-written held line whose holder is no single known session (a lane matching two live sessions
 * or none, an id prefix nobody has): nobody drives the Editor through the gate on the name alone. */
export const isUnresolvedHand = (lock: LockLine): boolean => (lock.kind === 'held' || lock.kind === 'handed') && lock.id8.length !== 8

/** A84: a free-form line's holder as a session: the one session file it names (by its id prefix; by its lane only while
 * that session lives), else the one Ather lane whose id starts with the named prefix. The lock then carries that
 * session's id8, so its holder uses, releases and re-takes it through the editor tool and everyone else queues. */
export const resolveLock = (lock: LockLine, files: readonly SessionFile[], lanes: readonly LaneBeat[], now: number): LockLine => {
  if ((lock.kind !== 'held' && lock.kind !== 'handed') || !lock.isReadable || lock.id8.length === 8) return lock
  const hits = files.filter(f => namesHolder(lock, f.id8, f.lane) && (lock.id8 !== '' || now - f.heartbeatAt <= HEARTBEAT_STALE_MS))
  if (hits.length === 1) return { ...lock, id8: hits[0]?.id8 ?? lock.id8 }
  if (lock.id8 && hits.length === 0) {
    const ls = lanes.filter(l => l.sessionId.toLowerCase().startsWith(lock.id8))
    if (ls.length === 1) return { ...lock, id8: (ls[0]?.sessionId ?? '').slice(0, 8).toLowerCase() }
  }
  return lock
}

/** A word for a key=value field: no spaces, commas, semicolons or the separator. */
export const safeWord = (s: string, max = 40): string =>
  s.replace(/[\s,;·=]+/g, '-').replace(/[\u0000-\u001f"'`]+/g, '').replace(/^-+|-+$/g, '').slice(0, max) || 'unnamed'

/** A note that no lock reader can mistake for a lock field: Ather's and the older parsers look for "free since",
 * "until HH:MM", "held by", "holder:", "session <hex>" and "expected end" anywhere on the line. */
export const safeNote = (s: string, max = 140): string =>
  s
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s*·\s*/g, '; ')
    .replace(/=/g, ':')
    .replace(/\bfree\b/gi, 'clear')
    .replace(/\buntil\b/gi, 'till')
    .replace(/\bheld by\b/gi, 'held-by')
    .replace(/\bholder\b/gi, 'holding lane')
    .replace(/\bowner\b/gi, 'owning lane')
    .replace(/\bexpected end\b/gi, 'expected finish')
    .replace(/\bsession\s+(?=[0-9a-f]{4})/gi, 'session-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max) || 'none'

const safeNextSafe = (s: string): string => (/^\d{1,2}:\d{2}$/.test(s.trim()) ? s.trim() : 'after save')

export type Held = { lane: string; sessionName: string; id8: string; since: number; pid: number | null; end: number; mode: Mode; pausable: boolean; nextSafe: string; note: string }

/** D2: the standard's HELD line, then the words Ather's parser reads (held by, session <id8>, until). */
export const heldLine = (h: Held): string => {
  const lane = safeWord(h.lane)
  return `HELD lane=${lane} session=${safeWord(h.sessionName)} since=${stampOf(h.since)} pid=${h.pid ?? 'none'} end=${hhmm(h.end)} mode=${h.mode} pausable=${h.pausable ? 'yes' : 'no'} next_safe=${safeNextSafe(h.nextSafe)} note=${safeNote(h.note)} · held by ${lane}, session ${h.id8}, until ${hhmm(h.end)}`
}

/** A117: a standard HELD line naming one session (A5R wrote it, so A5R may rewrite its end). */
export const isStandardHeld = (lock: LockLine): boolean => lock.kind === 'held' && lock.isStandard && lock.id8.length === 8
/** A117: such a line with another end (its `end=` and the `until` older readers take), the rest as it was: the person's
 * resize, written by whichever session's A5R he pressed in. */
export const heldLineAt = (lock: LockLine, end: number): string => lock.raw.replace(/\bend=\d{1,2}:\d{2}/, `end=${hhmm(end)}`).replace(/(· held by .*\buntil )\d{1,2}:\d{2}$/, `$1${hhmm(end)}`)

/** D2: the standard's FREE line, then the words every older reader takes for free. */
export const freeLine = (f: { since: number; by: string; note: string; background: 'none' | 'unknown' }): string =>
  `FREE since=${stampOf(f.since)} by=${safeWord(f.by)} note=${safeNote(f.note)} background=${f.background} · free since ${hhmm(f.since)}`

// ---------- A54 / A55: a lapsed lease and an unseen grant, released by any session's A5R ----------
/** A54: how long past its end a lease with no Editor running is kept before it is released. */
export const LAPSE_MS = 10 * 60_000
/** A55: how long a grant its session never saw (no turn since) is kept while another session waits. */
export const UNSEEN_MS = 10 * 60_000

/** The grant and end moments of a standard HELD line: `since=HH:MM YYYY-MM-DD` dates it, `end=HH:MM` is the first such
 * time after it (a lease past midnight ends the next day). A line without a dated since reads its end nearest now. */
export const lockTimes = (lock: LockLine, now: number): { since: number; end: number } | null => {
  const m = /^(\d{1,2}):(\d{2}) (\d{4})-(\d{2})-(\d{2})$/.exec(lock.since)
  const e = /^(\d{1,2}):(\d{2})$/.exec(lock.end)
  if (!e) return null
  if (!m) {
    const end = atNearest(lock.end, now)
    return end === null ? null : { since: end, end }
  }
  const since = new Date(Number(m[3]), Number(m[4]) - 1, Number(m[5]), Number(m[1]), Number(m[2])).getTime()
  const d = new Date(since)
  d.setHours(Number(e[1]), Number(e[2]), 0, 0)
  const end = d.getTime() < since ? d.getTime() + 24 * 3_600_000 : d.getTime()
  return { since, end }
}

/** Every Unreal Editor process the probe saw (UnrealEditor and UnrealEditor-Cmd). */
export const unrealPids = (probe: Probe | null): number[] => (probe?.procs ?? []).filter(isUnrealProc).map(p => p.pid)

/** A58: the processes of a build or a game run (the probe lists them): while any runs, no lease is lapsed or passed on. */
export const BUILD_NAMES = ['dotnet', 'UnrealBuildTool', 'cl', 'link', 'MSBuild', 'UnrealGame', 'S2'] as const
export const buildProcs = (probe: Probe | null): Proc[] => (probe?.procs ?? []).filter(p => BUILD_NAMES.some(n => isName(p, n)))

/** A108: git in the shared checkout when the worker hands the sync back: the git processes whose command line names the
 * checkout (null: no reading) and the age of its .git/index.lock (null: none). */
export type GitBusy = { gitPids: number[] | null; lockAgeMs: number | null }
export const NO_GIT_BUSY: GitBusy = { gitPids: [], lockAgeMs: null }
/** An index.lock this old with no git of the checkout running was left behind by git (the worker's rule 4 too). */
export const INDEX_LOCK_STALE_MS = 10 * 60_000
/** A108 (review of rev 35): the git processes that work in the checkout: a command line whose `-C <path>` is in it (as the
 * worker runs every git command), never git's own fsmonitor daemon, which runs as long as the checkout has core.fsmonitor
 * on. A git started inside the checkout without -C is not seen (the index.lock still is). */
export const checkoutGitPids = (probe: Probe | null, checkout: string): number[] | null => {
  if (!probe) return null
  const isCheckout = (cmd: string): boolean => {
    const dir = gitTarget(cmd, '')
    return dir !== '' && under(dir, checkout)
  }
  return probe.procs.filter(p => isName(p, 'git') && p.cmd && !/fsmonitor--daemon/i.test(p.cmd) && isCheckout(p.cmd)).map(p => p.pid)
}
/** A108: what the hand-back says of git in the checkout: the facts ('' when none), and the one step they ask for ('' when
 * none). Only .git/index.lock makes the holder wait; the checkout's git processes are named as information; a lock 10 min
 * old with no git of the checkout running, or none known (the process list unread), is stale and may be removed. */
export const gitBusyNote = (b: GitBusy): { fact: string; step: string } => {
  const n = b.gitPids?.length ?? 0
  const pids = b.gitPids === null ? 'the process list could not be read' : n ? `${n} git process${n === 1 ? '' : 'es'} of the checkout still run${n === 1 ? 's' : ''} (PID ${b.gitPids.slice(0, 5).join(', ')}${n > 5 ? ', …' : ''})` : ''
  if (b.lockAgeMs === null) return { fact: pids ? `; ${pids}` : '', step: '' }
  const lock = `.git/index.lock exists (${Math.floor(b.lockAgeMs / 60_000)} min old)`
  if (b.lockAgeMs >= INDEX_LOCK_STALE_MS && n === 0) return { fact: `; ${lock} and ${pids || 'no git of the checkout runs'}: git left it behind`, step: 'remove that stale lock first (rm <checkout>/.git/index.lock)' }
  return { fact: `; ${[pids, lock].filter(Boolean).join(' and ')}`, step: 'wait until .git/index.lock is gone before you touch the index (git still works there; a lock 10 min old with no git of the checkout running is stale: remove it then)' }
}

/** A58: whether the lease is a build: the holder asked with build, or its lock line's note says so. */
export const isBuildLease = (lock: LockLine, holder: SessionFile | undefined): boolean => Boolean(holder?.want?.build) || /\(build\)/i.test(lock.note)
/** The lock note's build mark (takeLock writes it, isBuildLease reads it) and the note without it. */
export const BUILD_MARK = ' (build)'
export const withoutBuildMark = (note: string): string => (note.endsWith(BUILD_MARK) ? note.slice(0, -BUILD_MARK.length) : note)
/** A118: a Focus lease's mark: its holder's request was made for a Focus, or its lock note starts with the Focus's own words. */
export const FOCUS_NOTE = 'Focus: '
export const isFocusLeaseMark = (lock: LockLine, holder: SessionFile | undefined): boolean => holder?.want?.focus !== undefined || lock.note.startsWith(FOCUS_NOTE.trim())

/** A54 / A55: whether the lock's lease may be released by any session now, and why. Never while any Unreal Editor
 * process runs (the overrun notice stays) or while the lock's own pid still runs; never without a probe reading.
 * Lapsed: 10 min past its end. Unseen: 10 min after the grant its session ran no turn (its a5r writes `lastTurnAt`;
 * an older a5r that writes none is never judged), Ather's lane shows no activity since, and another session waits. */
export const lapseOf = (x: { lock: LockLine; files: readonly SessionFile[]; lanes: readonly LaneBeat[]; now: number; probe: Probe | null; waiting: readonly SessionFile[]; sync: SyncFile | null; focus: FocusLease | null; writtenAt?: number | null }): Released | null => {
  const { lock, now } = x
  // A96 / A118: the claim's lease (a sync's holder in its cutoff and freeze, through every stage; a running Focus's session) is
  // never lapsed, never passed on.
  if (claimIn(x)?.id8 === lock.id8) return null
  // A118: a Focus ended early lapses from its cut end, and a lease the person gave is never passed on as unseen.
  const focus = x.focus?.id8 === lock.id8 ? x.focus : null
  if (lock.kind === 'held' && (!lock.isStandard || lock.id8.length !== 8) && x.probe) return handLapseOf({ ...x, probe: x.probe })
  if (lock.kind !== 'held' || !lock.isStandard || !lock.id8 || !x.probe) return null
  const read = lockTimes(lock, now)
  if (!read) return null
  const t = focus ? { ...read, end: Math.min(read.end, focus.end) } : read
  if (unrealPids(x.probe).length > 0) return null
  if (lock.pid !== null && x.probe.procs.some(p => p.pid === lock.pid)) return null
  // A58: never while a build or a game runs, nor for a build lease. Fable review S3: a Focus lease is marked a build lease only
  // for an A5R before 0.25.0; once its Focus is over (a running one returned above) it lapses as any lease.
  const holder = x.files.find(f => f.id8 === lock.id8)
  if (buildProcs(x.probe).length > 0 || (isBuildLease(lock, holder) && !isFocusLeaseMark(lock, holder))) return null
  // A58: lapsed only as the S2 standard (section 2) allows: the holder is gone (and no Editor runs, above); a live
  // holder past its end keeps its lease and the overrun notice.
  if (now >= t.end + LAPSE_MS) return livenessOf(lock.id8, x.files, x.lanes, now) === 'gone' ? { kind: 'lapsed', at: now, by: '', since: t.since, end: t.end } : null
  const lane = x.lanes.find(l => l.sessionId.toLowerCase().startsWith(lock.id8))
  // A67: a holder working through a background agent is not idle.
  const isUnseen = typeof holder?.lastTurnAt === 'number' && holder.lastTurnAt < t.since && (lane?.lastActiveAt ?? 0) < t.since && (holder.agents ?? 0) === 0
  if (!focus && isUnseen && now - t.since >= UNSEEN_MS && x.waiting.some(f => f.id8 !== lock.id8)) return { kind: 'unseen', at: now, by: '', since: t.since, end: t.end }
  return null
}

/** A84: how long a lock line A5R cannot read (no holder named) and with no end is held, from when it was written. */
export const UNREADABLE_MS = 2 * 3_600_000
/** A84 (orchestrator, re-review): how long past its end a hand-written line whose holder resolves to no session is kept. */
export const HAND_LAPSE_MS = 30 * 60_000

/** A84: a lock line written by hand (not the S2 standard's) lapses like a standard one: never while any Unreal Editor or
 * build process runs or while the PID it names runs; a readable line 10 min past its end, unless its holder's session is
 * known to be alive (a live holder keeps it and hears the overrun); a line naming no holder at its end, or 2 h after it
 * was written when it names no end, whoever wrote it. */
const handLapseOf = (x: { lock: LockLine; files: readonly SessionFile[]; lanes: readonly LaneBeat[]; now: number; probe: Probe; writtenAt?: number | null }): Released | null => {
  const { lock, now, probe } = x
  if (unrealPids(probe).length > 0 || buildProcs(probe).length > 0) return null
  if (lock.pid !== null && probe.procs.some(p => p.pid === lock.pid)) return null
  const t = lockTimes(lock, now)
  // A84 (orchestrator's decision, rev 30 re-review): S2 section 2 asks for 'holder gone', which an unknown holder cannot be
  // shown to be; a hand line whose holder resolves to no session lapses 30 min past its end with nothing running instead.
  const grace = !lock.isReadable ? 0 : lock.id8.length === 8 ? LAPSE_MS : HAND_LAPSE_MS
  const until = t ? t.end + grace : typeof x.writtenAt === 'number' ? x.writtenAt + UNREADABLE_MS : null
  if (until === null || now < until) return null
  if (lock.isReadable && lock.id8.length === 8 && livenessOf(lock.id8, x.files, x.lanes, now) === 'alive') return null
  const end = t?.end ?? until
  return { kind: 'lapsed', at: now, by: '', since: t?.since ?? x.writtenAt ?? end, end }
}

/** A54 / A55: the FREE line's note: whose lease, why it was released. */
export const releasedNote = (r: Released, lock: LockLine): string =>
  !lock.isStandard || lock.id8.length !== 8
    ? lock.isReadable && lock.id8.length !== 8
      ? `hand-written lock by ${lock.heldLane || lock.lane || lock.id8 || 'a lane'}${lock.id8 ? ` (id ${lock.id8})` : ''} lapsed: past ${hhmm(r.end)} + 30 min, nothing running (pid ${lock.pid ?? 'none'} not running, no Editor or build)`
      : `${lock.isReadable ? `lapsed hand-written lock of ${lock.lane || 'a lane'}${lock.id8 ? ` (session-${lock.id8})` : ''}` : 'unreadable hand-written lock (it names nobody)'}: ended ${hhmm(r.end)}, ${Math.round((r.at - r.end) / 60_000)} min ago; pid ${lock.pid ?? 'none'} not running, no Editor or build running`
    : r.kind === 'lapsed'
    ? `lapsed lease of ${lock.lane || 'a lane'} (session-${lock.id8}): ended ${hhmm(r.end)}, ${Math.round((r.at - r.end) / 60_000)} min ago; session gone, pid ${lock.pid ?? 'none'}, no Editor or build running`
    : `unseen grant of ${lock.lane || 'a lane'} (session-${lock.id8}): granted ${hhmm(r.since)}, no turn of that session since and no Editor launched; passed to the next in the queue`

// ---------- A62: Saved/A5R/orchestrate.log, one line per event a rule would act on ----------
/** A62: the log rotates past this size (the old one kept as orchestrate.log.1). */
export const ORCHESTRATE_MAX_BYTES = 1_000_000
export type OrchestrateEvent = {
  at: number
  /** A54 / A55 (they act), a candidate rule that only logs: no-editor (a lease held with no Editor or build
   * running), holder-gone; or A65-judge (a verdict, advisory); A112: wait (a session's own wait decision, logged only).
   * A64: no rule reads a session's title or a list file. */
  rule: 'A54-lapsed' | 'A55-unseen' | 'no-editor' | 'holder-gone' | 'A65-judge' | 'ram-supplied' | 'A91-nudge' | 'wait' | 'manual' | 'focus' | 'orphan-close' | 'auto-sync' | 'withdrawn' // manual: A117, the person's change of the queue; focus: A118; A123 orphan-close, A124 auto-sync, A125 withdrawn
  lane: string
  id8: string
  procs: readonly string[]
  liveness: Liveness
  lastTurnAt: number | null
  agents: number | null
  build: boolean
  acted: boolean
  note?: string
}
/** A62: one log line: time, rule, lane, every process the probe saw, the holder's liveness, its last turn, its running
 * agents, whether the lease is a build, and whether a5r acted or only logged. */
export const orchestrateLine = (e: OrchestrateEvent): string =>
  [
    stampOf(e.at),
    `rule=${e.rule}`,
    `lane=${safeWord(e.lane || 'unknown')}`,
    `session=${e.id8 || 'unknown'}`,
    `procs=${e.procs.length ? [...e.procs].sort().join(',') : 'none'}`,
    `holder=${e.liveness}`,
    `lastTurn=${e.lastTurnAt ? stampOf(e.lastTurnAt) : 'unknown'}`,
    `agents=${e.agents ?? 'unknown'}`,
    `build=${e.build ? 'yes' : 'no'}`,
    e.acted ? 'acted' : 'logged-only',
    ...(e.note ? [`note=${safeNote(e.note, 160)}`] : []),
  ].join(' | ')

// ---------- the queue and the grant ----------
export type Gates = { pieGb: number; nopieGb: number }
export const clampGate = (n: number): number => Math.max(GATE_MIN_GB, Math.min(GATE_MAX_GB, Math.round(n)))
/** The launch gate in force: the panel's setting (shared through the plugin's store) over the plugin options. */
export const gatesOf = (stored: unknown, pieOpt: unknown, nopieOpt: unknown): Gates & { source: 'panel' | 'options' } => {
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? clampGate(v) : typeof v === 'string' && Number.isFinite(Number(v)) && v.trim() !== '' ? clampGate(Number(v)) : d)
  const s = stored as Partial<Gates> | null | undefined
  const fromOpts = { pieGb: num(pieOpt, DEFAULT_GATES.pieGb), nopieGb: num(nopieOpt, DEFAULT_GATES.nopieGb) }
  if (s && typeof s.pieGb === 'number' && typeof s.nopieGb === 'number') return { pieGb: clampGate(s.pieGb), nopieGb: clampGate(s.nopieGb), source: 'panel' }
  return { ...fromOpts, source: 'options' }
}

/** `cmd`: a git process's command line (A108: whose checkout it works in), or a cmd.exe's that runs a sync's build script
 * (A109, review: only those cmd.exe are listed). */
export type Proc = { name: string; pid: number; gb: number; parentAlive: boolean; cmd?: string; startedAt?: number; title?: string } // A123 / A125: an Unreal Editor's start time and window title
/** A112 / A114: what holds the machine's memory: every process grouped by name (claude and Chrome included), heaviest first. */
export type Heavy = { name: string; n: number; gb: number }
export type Probe = { freeGb: number; diskGb: number | null; procs: Proc[]; top?: Heavy[] }

const isName = (p: Proc, name: string) => p.name.toLowerCase().replace(/\.exe$/, '') === name.toLowerCase()
/** Rev 30 re-review: every `UnrealEditor*.exe` counts (UnrealEditor-Win64-DebugGame and the like), headless -Cmd included. */
export const isUnrealProc = (p: Proc): boolean => /^unrealeditor/i.test(p.name)
/** An Editor with a window: any `UnrealEditor*` but the headless UnrealEditor-Cmd. */
export const isEditorProc = (p: Proc): boolean => isUnrealProc(p) && !/^unrealeditor-cmd(\.exe)?$/i.test(p.name)
export const editorPid = (probe: Probe | null): number | null => probe?.procs.find(isEditorProc)?.pid ?? null

/** The machine probe's JSON (`ramProbe`), or null when it did not answer. */
export const parseProbe = (stdout: string): Probe | null => {
  try {
    const v = JSON.parse(stdout.trim()) as { freeGb?: unknown; diskGb?: unknown; procs?: unknown; top?: unknown }
    const free = Number(v.freeGb)
    if (!Number.isFinite(free) || free <= 0) return null
    const disk = Number(v.diskGb)
    const raw = Array.isArray(v.procs) ? v.procs : v.procs && typeof v.procs === 'object' ? [v.procs] : []
    const procs = raw
      .map(p => p as Record<string, unknown>)
      .map(p => ({ name: String(p.name ?? '').replace(/\.exe$/i, ''), pid: Number(p.pid), gb: Number(p.gb ?? 0), parentAlive: p.parentAlive !== false, ...(typeof p.cmd === 'string' && p.cmd ? { cmd: p.cmd.slice(0, 1000) } : {}), ...(Number(p.startedAt) > 0 ? { startedAt: Number(p.startedAt) } : {}), ...(typeof p.title === 'string' && p.title ? { title: p.title.slice(0, 200) } : {}) }))
      .filter(p => p.name && Number.isFinite(p.pid))
    const top = (Array.isArray(v.top) ? v.top : v.top && typeof v.top === 'object' ? [v.top] : [])
      .map(t => t as Record<string, unknown>)
      .map(t => ({ name: String(t.name ?? ''), n: Number(t.n ?? 1), gb: Number(t.gb ?? 0) }))
      .filter(t => t.name && Number.isFinite(t.gb))
    return { freeGb: free, diskGb: Number.isFinite(disk) && disk >= 0 ? disk : null, procs, ...(top.length ? { top } : {}) }
  } catch {
    return null
  }
}

/** Saved/A5R/probe.json: the last machine reading, shared by every A5R session (A9). A session probes only when
 * it is older than this; the session probing writes it (a claim first, then the reading). */
export const PROBE_FRESH_MS = 50_000
export type SharedProbe = { at: number; by: string; probe: Probe | null }
export const parseSharedProbe = (text: string | null): SharedProbe | null => {
  try {
    const v = JSON.parse(text ?? '') as { at?: unknown; by?: unknown; probe?: unknown }
    if (typeof v?.at !== 'number') return null
    return { at: v.at, by: String(v.by ?? ''), probe: v.probe ? parseProbe(JSON.stringify(v.probe)) : null }
  } catch {
    return null
  }
}

/** One PowerShell probe: free RAM, the checkout drive's free space, and the heavy processes (pid, working set,
 * whether the parent is alive; the command line of git and of a cmd.exe running a `-build.cmd`), as one JSON line. */
export const ramProbe = (drive: string): string[] => [
  'powershell',
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  [
    '$os = Get-CimInstance Win32_OperatingSystem',
    '$free = [math]::Round($os.FreePhysicalMemory / 1MB, 1)',
    // A111: the checkout's own drive, never a default one (no letter: no disk reading, -1)
    `$d = ${/^[A-Za-z]/.test(drive) ? `Get-PSDrive -Name '${drive.slice(0, 1)}' -ErrorAction SilentlyContinue` : '$null'}`,
    '$disk = if ($d) { [math]::Round($d.Free / 1GB, 1) } else { -1 }',
    '$all = @(Get-Process); $alive = @{}; $titles = @{}; $all | ForEach-Object { $alive[[int]$_.Id] = 1; $titles[[int]$_.Id] = [string]$_.MainWindowTitle }',
    // A112 / A114: the heaviest names among all processes (claude, Chrome, …), which the named list below never shows
    '$top = @($all | Group-Object ProcessName | ForEach-Object { [pscustomobject]@{ name = $_.Name; n = $_.Count; gb = [math]::Round((($_.Group | Measure-Object WorkingSet64 -Sum).Sum) / 1GB, 2) } } | Sort-Object gb -Descending | Select-Object -First 6)',
    "$names = @('git.exe','LiveCodingConsole.exe','UnrealEditor.exe','UnrealEditor-Cmd.exe','ShaderCompileWorker.exe','python.exe','dotnet.exe','UnrealBuildTool.exe','cl.exe','link.exe','MSBuild.exe','UnrealGame.exe','S2.exe')",
    `$procs = @(Get-CimInstance Win32_Process | Where-Object { ($names -contains $_.Name) -or ($_.Name -like 'UnrealEditor*.exe') -or ($_.Name -eq 'cmd.exe' -and ([string]$_.CommandLine) -like '*${SCRIPT_SUFFIX}*') } | ForEach-Object { [pscustomobject]@{ name = $_.Name -replace '\\.exe$',''; pid = [int]$_.ProcessId; gb = [math]::Round($_.WorkingSetSize / 1GB, 2); parentAlive = $alive.ContainsKey([int]$_.ParentProcessId); cmd = $(if ($_.Name -eq 'git.exe' -or $_.Name -eq 'cmd.exe' -or $_.Name -eq 'python.exe' -or $_.Name -like 'UnrealEditor*') { [string]$_.CommandLine } else { '' }); startedAt = $(if ($_.Name -like 'UnrealEditor*' -and $_.CreationDate) { [long]([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } else { 0 }); title = $(if ($_.Name -like 'UnrealEditor*') { $titles[[int]$_.ProcessId] } else { '' }) } })`,
    '[pscustomobject]@{ freeGb = $free; diskGb = $disk; procs = $procs; top = $top } | ConvertTo-Json -Compress -Depth 3',
  ].join('; '),
]

/** The safe cleanup before a grant: the S2 orphan-git reaper below 14 GB free, LiveCodingConsole stopped only
 * while no Editor runs; everything else is named, never killed. */
export const cleanupPlan = (probe: Probe): { reap: boolean; stopLiveCoding: number[]; report: string[] } => {
  const hasEditor = probe.procs.some(isEditorProc)
  const live = probe.procs.filter(p => isName(p, 'LiveCodingConsole'))
  const orphans = probe.procs.filter(p => isName(p, 'git') && !p.parentAlive).length
  const report: string[] = []
  if (hasEditor && live.length) report.push(`LiveCodingConsole kept (an Editor runs): ${live.map(p => `pid ${p.pid}`).join(', ')}`)
  for (const name of ['UnrealEditor-Cmd', 'ShaderCompileWorker', 'python']) {
    const ps = probe.procs.filter(p => isName(p, name))
    if (ps.length) report.push(`${name} ×${ps.length} ${round(ps.reduce((a, p) => a + p.gb, 0))} GB (not killed)`)
  }
  if (orphans && probe.freeGb >= REAP_BELOW_GB) report.push(`${orphans} orphan git (reaped only under ${REAP_BELOW_GB} GB free)`)
  return { reap: probe.freeGb < REAP_BELOW_GB, stopLiveCoding: hasEditor ? [] : live.map(p => p.pid), report }
}

const round = (n: number): number => Math.round(n * 10) / 10

/** What holds memory, heaviest first: the line the Memory tile and a waiting slot show; A112: every process by name when
 * the probe read them (`top`), else the named processes it lists. */
export const heavyList = (probe: Probe, max = 4): string => {
  if (probe.top?.length) return probe.top.slice(0, max).map(t => `${t.name}${t.n > 1 ? ` ×${t.n}` : ''} ${round(t.gb)} GB`).join(', ')
  const by = new Map<string, { n: number; gb: number }>()
  for (const p of probe.procs) {
    const k = p.name
    const was = by.get(k) ?? { n: 0, gb: 0 }
    by.set(k, { n: was.n + 1, gb: was.gb + p.gb })
  }
  const rows = [...by.entries()].sort((a, b) => b[1].gb - a[1].gb).slice(0, max)
  return rows.length ? rows.map(([k, v]) => `${k}${v.n > 1 ? ` ×${v.n}` : ''} ${round(v.gb)} GB`).join(', ') : 'no heavy process'
}

/** D8: whether the session holding a sync is gone (files only; unknown is not gone). */
export const isSyncHolderGone = (s: SyncFile | null, files: readonly SessionFile[], lanes: readonly LaneBeat[], now: number): boolean =>
  Boolean(s) && livenessOf(s?.holder.id8 ?? '', files, lanes, now) === 'gone'

/** A118: the lease a Focus gives its session (focus.ts reads it from Saved/A5R/editor-focus.json): while it runs, the Editor
 * until the box end; ended early (done, or the person's end), the lease cut to `end`. */
export type FocusLease = { id8: string; lane: string; milestone: string; startedAt: number; end: number; isRunning: boolean }
/** A117: the person's order as the queue reads it (order.ts resolves it from Saved/A5R/queue-order.json for the requests
 * that still last): the sessions he placed, in his order, and the minutes he set for a queued request. */
export type ManualOrder = { pins: readonly string[]; minutes: Readonly<Record<string, number>> }
export const NO_MANUAL: ManualOrder = { pins: [], minutes: {} }
/** A117: the person placed this session in the queue (a placed head is never passed, A113). */
export const isPlaced = (m: ManualOrder, id8: string): boolean => m.pins.includes(id8)

/** The sync's phase as every decision reads it from the shared files (a gone holder's freeze expires, D8). */
export const phaseIn = (x: Pick<GrantInput, 'sync' | 'files' | 'lanes' | 'now'>): Phase => syncPhase(x.sync, x.now, isSyncHolderGone(x.sync, x.files, x.lanes, x.now))

/** The one lease every session's decisions protect at a time: the holder's of a sync in its cutoff or freeze (it goes first,
 * its slot ends with the sync, and in the freeze it keeps the lock through every stage: D8, A94, A96), or the session's of a
 * running Focus (A118). They never overlap: a Focus may not cross a sync's cutoff, and a sync's cutoff may not fall inside a
 * Focus. */
export type Claim = { kind: 'sync' | 'focus'; id8: string; lane: string; end: number }
export const claimIn = (x: Pick<GrantInput, 'sync' | 'files' | 'lanes' | 'now' | 'focus'>): Claim | null => {
  if (x.focus?.isRunning) return { kind: 'focus', id8: x.focus.id8, lane: x.focus.lane, end: x.focus.end }
  const phase = phaseIn(x)
  return x.sync && (phase === 'cutoff' || phase === 'frozen') ? { kind: 'sync', id8: x.sync.holder.id8, lane: x.sync.holder.lane, end: x.sync.hardEnd } : null
}

/** The order every session computes alike: live waiting requests, the claim's session first (a sync's holder in its cutoff or
 * freeze, A118 a running Focus's session), then (A117) the sessions the person placed, in his order, then first requested
 * first served. */
export const queueOf = (files: readonly SessionFile[], lanes: readonly LaneBeat[], now: number, claim: Claim | null, manual: ManualOrder): SessionFile[] => {
  const pinned = (f: SessionFile) => manual.pins.indexOf(f.id8)
  const rank = (f: SessionFile) => (f.id8 === claim?.id8 ? -1 : pinned(f) >= 0 ? pinned(f) : manual.pins.length)
  return files
    .filter(f => f.want && !f.holding && livenessOf(f.id8, files, lanes, now) === 'alive')
    .sort((a, b) => rank(a) - rank(b) || (a.want?.requestedAt ?? 0) - (b.want?.requestedAt ?? 0) || a.id8.localeCompare(b.id8))
}
/** The queue of a decision's input. */
export const queueIn = (x: Pick<GrantInput, 'files' | 'lanes' | 'now' | 'sync' | 'focus' | 'manual'>): SessionFile[] => queueOf(x.files, x.lanes, x.now, claimIn(x), x.manual)

/** Why a request waits; `ram`: its own launch gate is not met by free RAM (the head's, or, A112, a later request's behind a
 * head that waits for memory: its place says which). */
export type WaitCode = 'missing' | 'held' | 'gone-editor' | 'queue' | 'sync' | 'ram' | 'probe' | 'merge' | 'focus' // merge: A115, a revert or cherry-pick too; focus: A118
/** A grant; A113: `pass` names the head of the queue this slot goes before (that head waits only for memory). */
export type Grant = { kind: 'grant'; end: number; reuse: number | null; pass?: string }
export type Decision =
  | { kind: 'none' }
  | { kind: 'mine' }
  | Grant
  | { kind: 'recover'; holder: string }
  | { kind: 'wait'; code: WaitCode; why: string; next: string; place: number; reason: string } // reason: A116, in plain words ('' behind the rows above)

export type GrantInput = {
  me8: string
  lock: LockLine
  files: readonly SessionFile[]
  lanes: readonly LaneBeat[]
  now: number
  sync: SyncFile | null
  probe: Probe | null
  gates: Gates
  /** A61 / A115: the head file of a merge, revert or cherry-pick in progress (or left behind) in the shared checkout. */
  conflictHead?: ConflictHead
  /** A88 (c): the RAM probe failed again on a fresh retry (no reading at all). */
  probeFailed?: boolean
  /** A117: the person's order and the minutes he set (NO_MANUAL: first asked, first served). */
  manual: ManualOrder
  /** A118: the lease the person's Focus gives (running, or cut after an early end); null: none. */
  focus: FocusLease | null
}

/** Whether this session may take the Editor now, and if not why and what next. Only the head of the queue takes
 * a free lock (A113: or the one later request that passes a head held back only by memory); the slot's own checks are
 * slotOf's. */
export const decide = (x: GrantInput): Decision => {
  const { me8, lock, now, sync } = x
  const queue = queueIn(x)
  const mine = x.files.find(f => f.id8 === me8)
  if (lock.id8 === me8 && (lock.kind === 'held' || lock.kind === 'handed')) return { kind: 'mine' }
  if (!mine?.want) return { kind: 'none' }
  const place = Math.max(1, queue.findIndex(f => f.id8 === me8) + 1)
  const wait = (code: WaitCode, reason: string, why: string, next: string): Decision => ({ kind: 'wait', code, why, next, place, reason })
  // A118 / A119: while a Focus runs the queue pauses behind it, in its order (the focus session is ranked first).
  const claim = claimIn(x)
  if (claim?.kind === 'focus' && claim.id8 !== me8) return wait('focus', 'after the Focus', `the person gave ${claim.lane} the Editor for a Focus until ${hhmm(claim.end)}`, `the queue pauses until then and runs on in its order (you are ${ordinal(place)}); batch your Editor needs into your turn; meanwhile do what needs no Editor: edits on disk outside its files, builds and tests in your own worktree`)
  const pid = editorPid(x.probe)
  if (lock.kind === 'missing') return wait('missing', 'the lock file is missing', 'Saved/EDITOR_OWNER.txt is missing or empty: unknown, not free', unrealPids(x.probe).length > 0 ? `an Unreal Editor runs with no lock (PID ${unrealPids(x.probe).join(', ')}): held by unknown until it ends, then A5R writes the FREE line; never kill or drive it, never write the lock by hand; do work that needs no Editor meanwhile` : 'A5R writes the FREE line once a fresh probe shows no Unreal Editor running (never write it by hand); do work that needs no Editor meanwhile')
  if (lock.kind === 'held' || lock.kind === 'handed') {
    const who = lock.lane || 'another lane'
    const until = lock.end ? ` until ${lock.end}` : ''
    const live = livenessOf(lock.id8, x.files, x.lanes, now)
    // Round-2 review: never a FREE line without a process reading: a gone holder's lease waits for one (the next minute).
    if (live === 'gone' && !x.probe && queue[0]?.id8 === me8) return wait('probe', 'no process reading yet', `${who} (session ${lock.id8}) is gone, but there is no process reading to show no Editor or build runs`, 'it is read again at the next minute; do work that needs no Editor meanwhile')
    if (live === 'gone' && x.probe && unrealPids(x.probe).length === 0 && buildProcs(x.probe).length === 0 && queue[0]?.id8 === me8) return { kind: 'recover', holder: lock.id8 }
    if (live === 'gone' && pid !== null) return wait('gone-editor', 'its holder is gone, its Editor still open', `${who} (session ${lock.id8}) is gone but UnrealEditor PID ${pid} still runs`, 'never kill it or drive it; do work that needs no Editor meanwhile (its lease is freed once no UnrealEditor runs); an Editor left hung is a finding for Ather\'s Needs you')
    return wait('held', place === 1 ? `behind ${who}` : '', `${who}${lock.id8 ? ` (session ${lock.id8})` : ''} holds the Editor${until}${isUnresolvedHand(lock) && lock.isReadable ? ' (a hand-written line naming no single live session)' : ''}`, `${place > 1 ? `you are ${ordinal(place)} in the queue` : 'you are next'}; do work that needs no Editor meanwhile${isUnresolvedHand(lock) && lock.isReadable ? '; a request turns it into a standard line for you once no other A5R session holds a lease and no Editor of another lane (the PID it names) runs, and it lapses 30 min past its end with nothing running' : ''}`)
  }
  if (queue[0]?.id8 !== me8) {
    const head = queue[0]?.lane ?? 'another session'
    const behind = `you are ${ordinal(place)} in the queue; do work that needs no Editor meanwhile`
    // A113: a head held back only by memory does not block a later request that fits now (one, the first in queue order).
    const h = headStateOf(x, queue)
    if (!h.isMemory) return wait('queue', '', `the Editor is free but ${head} ${isPlaced(x.manual, queue[0]?.id8 ?? '') ? 'was placed first by the person' : 'asked first'}`, behind)
    if (h.passer?.id8 === me8) return h.passer.grant
    // A112: this request's own reason when its slot would not fit either (`ram`: its own launch gate is not met, as for
    // the head; its place says it is not first); capped at 30 min only while a pass is possible.
    const own = slotOf(x, mine, place, h.isAged ? Infinity : PASS_MAX_MIN)
    if (own.kind === 'wait') return { ...own, next: `${head} (first in the queue) waits for memory too; ${own.next}` }
    if (h.passer) return wait('queue', '', `the Editor is free; ${head} waits for memory and ${h.passer.lane} goes before it for ≤ ${PASS_MAX_MIN} min (its slot fits now)`, behind)
    // Its slot fits and nobody passes: only because the head has waited 2 h (headStateOf tried this slot otherwise).
    return wait('queue', '', `the Editor is free but ${head} asked first (it has waited ${PASS_AGING_MIN / 60} h or more for memory: nobody goes before it now)`, behind)
  }
  // A117: a head the person placed is never passed (headStateOf); waiting for memory, it says so.
  const own = slotOf(x, mine, place)
  return own.kind === 'wait' && own.code === 'ram' && isPlaced(x.manual, me8) ? { ...own, reason: `${own.reason}; placed by hand: nobody passes it` } : own
}

/** A113: a slot that goes before a head waiting for memory lasts at most this long; a head that has waited this long is
 * never passed (it keeps its place and gets the next grant that fits). */
export const PASS_MAX_MIN = 30
export const PASS_AGING_MIN = 120

/** The checks after the queue, for one session's request (its own, or a later one as if it were next, A113): no grant
 * over a merge in progress; the slot ends by a planned sync's cutoff and waits out a cutoff and freeze (the sync holder
 * excepted); launching needs the launch gate (an Editor already open is reused, its memory counted). `capMin`: the slot's
 * minutes at most (A113's pass); A117: the minutes the person set for this request, else its own. */
const slotOf = (x: GrantInput, f: SessionFile, place: number, capMin = Infinity): Decision => {
  const { now, sync } = x
  const want = f.want
  if (!want) return { kind: 'none' }
  const wait = (code: WaitCode, reason: string, why: string, next: string): Decision => ({ kind: 'wait', code, why, next, place, reason })
  // A61 / A115: no grant over a merge, revert or cherry-pick in progress (or left behind), whatever the sync's state says.
  if (x.conflictHead) return wait('merge', `waits for the ${opOf(x.conflictHead)} to finish`, `a ${opOf(x.conflictHead)} is in progress in the shared checkout (.git/${x.conflictHead})`, 'Editor grants wait until it is finished or aborted; do work that needs no Editor meanwhile')
  const phase = phaseIn(x)
  const minutes = Math.min(x.manual.minutes[f.id8] ?? want.minutes, capMin)
  // A94 / A118: the claim's slot ends with the claim (the sync's hard end, the Focus's box end).
  const claim = claimIn(x)
  const end = claim?.id8 === f.id8 ? claim.end : now + minutes * 60_000
  const limit = syncLimit(sync, phase, f.id8, end)
  if (sync && limit?.kind === 'cutoff') {
    const room = Math.floor((sync.at - CUTOFF_MS - now) / 60_000)
    return wait('sync', `would cross the sync cutoff ${hhmm(sync.at - CUTOFF_MS)}`, `a ${minutes}-min slot would end at ${hhmm(end)}, past the cutoff ${hhmm(sync.at - CUTOFF_MS)} of the sync at ${hhmm(sync.at)}`, room >= 5 ? `ask again for ≤ ${room} min, or wait until the sync is done` : 'wait until the sync is done')
  }
  if (sync && limit?.kind === 'claim')
    return wait('sync', `sync ${phase === 'cutoff' ? 'cutoff, then freeze' : 'freeze'} until ${hhmm(sync.hardEnd)}`, `the sync at ${hhmm(sync.at)} is in its ${phase === 'cutoff' ? 'cutoff' : 'freeze'}`, 'Editor grants wait until it is done')
  const pid = editorPid(x.probe)
  // The launch gate guards a launch: a slot that never launches the Editor (the sync worker's, a build) skips it.
  // A118: a Focus takes the lock with no launch gate (the lock is no launch; its grant names free RAM against the gate).
  if (pid === null && want.launch !== false && !(claim?.kind === 'focus' && claim.id8 === f.id8)) {
    // A88 (c, re-review): a failed probe is read once more at once; failing twice, the launch is not allowed blind: the
    // agent reads free RAM itself and asks again with that number (`freeGb`), which the normal gate then reads.
    if (!x.probe) return wait('probe', 'no memory reading yet', 'the RAM probe did not answer', x.probeFailed ? `read free RAM with ${FREE_RAM_READ} and call the editor tool request again with freeGb: <number>` : 'it is read again at once')
    const gate = want.pie ? x.gates.pieGb : x.gates.nopieGb
    if (x.probe.freeGb < gate)
      return wait('ram', `needs ${gate} GB, ${x.probe.freeGb} free`, `free RAM is ${x.probe.freeGb} GB after cleanup, under the launch gate of ${gate} GB for a slot ${want.pie ? 'with' : 'without'} PIE`, `the slot waits; memory is held by ${heavyList(x.probe)}`)
  }
  return { kind: 'grant', end, reuse: pid }
}

/** A113: the head of the queue as a later request sees it (the lock free: decide returned before otherwise): whether its
 * only reason to wait is memory, whether it has waited 2 h or more, and the one later request granted before it: the
 * first in queue order whose own slot, capped at 30 min, is granted now (a request that never launches the Editor, or a
 * lower launch gate that free RAM meets; a sync's block, a merge in progress or a planned cutoff keep it waiting as they
 * would the head). Every session computes it from the same files and the shared machine reading, so they agree on who
 * passes; the lock's read-compare-write settles the rare split between two readings of free RAM. A117: a head the person
 * placed is never passed (his order is the order). */
type HeadState = { isMemory: false } | { isMemory: true; isAged: boolean; passer: { id8: string; lane: string; grant: Grant } | null }
const headStateOf = (x: GrantInput, queue: readonly SessionFile[]): HeadState => {
  const [head, ...later] = queue
  const d = head && !isPlaced(x.manual, head.id8) ? slotOf(x, head, 1) : null
  if (!head?.want || d?.kind !== 'wait' || d.code !== 'ram') return { isMemory: false }
  const isAged = x.now - head.want.requestedAt >= PASS_AGING_MIN * 60_000
  for (const [i, f] of (isAged ? [] : later).entries()) {
    if (f.canPass !== true) continue // D3: a 0.22.0 session never takes a pass
    const g = slotOf(x, f, i + 2, PASS_MAX_MIN)
    if (g.kind === 'grant') return { isMemory: true, isAged, passer: { id8: f.id8, lane: f.lane, grant: { ...g, pass: head.id8 } } }
  }
  return { isMemory: true, isAged, passer: null }
}

/** A113: the head this session's lease went before when it was asked with launch: false (such a slot launches no Editor), else
 * null. */
export const noLaunchPass = (f: SessionFile | null): string | null => (f?.holding?.pass && f.want?.launch === false ? f.holding.pass : null)

/** A113: a pass slot's lease may not run past 30 min while the head it passed still asks (its file carries a request,
 * whatever its liveness reads: Fable review D5), an extension included. */
export const passEndOk = (pass: string, since: number, end: number, files: readonly SessionFile[]): boolean =>
  !files.some(f => f.id8 === pass && f.want) || end - since <= PASS_MAX_MIN * 60_000

export const ordinal = (n: number): string => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`

/** A103: a holder is asked to yield only between Editor work: no Editor use for 5 min (from its grant at most) and at
 * least 20 min of its lease left; past its end the room is waived (the lease no longer protects its last minutes). */
export const YIELD_QUIET_MS = 5 * 60_000
export const YIELD_ROOM_MS = 20 * 60_000
export const isYieldMoment = (x: { now: number; since: number; end: number; editorUseAt: number | undefined }): boolean =>
  x.now - Math.max(x.editorUseAt ?? 0, x.since) >= YIELD_QUIET_MS && (x.now >= x.end || x.end - x.now >= YIELD_ROOM_MS)

/** Whether a request may ask the holder to yield now: ≤ 20 min without a build, at the head of the queue, the
 * holder alive and pausable, nobody asked that holder in the last hour, and (A103) the holder between Editor work by its
 * file's lease and the Editor use it publishes (a file from before 0.21.0 publishes none: its grant counts; a holder
 * without a file is asked as before, and the holder's own A5R holds the notice until the moment comes). */
export const mayAskYield = (x: GrantInput): { holder: string } | null => {
  const mine = x.files.find(f => f.id8 === x.me8)
  const want = mine?.want
  if (!want || want.build || want.minutes > YIELD_MAX_MIN) return null
  const claim = claimIn(x)
  if (claim && claim.id8 !== x.me8) return null // A118: while a claim stands only its session may ask a yield (nobody else could be granted)
  if (x.lock.kind !== 'held' || !x.lock.id8 || x.lock.id8 === x.me8 || !x.lock.pausable) return null
  if (livenessOf(x.lock.id8, x.files, x.lanes, x.now) !== 'alive') return null
  const lease = x.files.find(f => f.id8 === x.lock.id8)
  if (lease?.holding?.pass === x.me8) return null // A113: a slot that passed this head (waiting for memory) is not asked to yield
  if (lease?.holding && !isYieldMoment({ now: x.now, since: lease.holding.since, end: lease.holding.end, editorUseAt: lease.editorUseAt })) return null
  if (queueIn(x)[0]?.id8 !== x.me8) return null
  const asked = x.files.some(f => f.yieldAsks.some(a => a.holder === x.lock.id8 && x.now - a.at < YIELD_EVERY_MS))
  return asked ? null : { holder: x.lock.id8 }
}

/** The standard's request line (section 6) for a holder that runs without a5r. */
export const ueRequestLine = (lane: string, minutes: number, what: string, waitUntil: number): string =>
  `UE request: ${lane} cần Editor ~${minutes} phút để ${what.replace(/\s+/g, ' ').slice(0, 120)}, build=no, chờ được tới ${hhmm(waitUntil)}.`

// ---------- the sync timeline (Saved/A5R/sync.json, written by the holder alone) ----------
export type SyncState = 'planned' | 'done' | 'aborted' | 'cancelled' | 'expired'
/** D8: how long a freeze may last past T (its hard end), by default: a merge, or a merge with a build. */
export const SYNC_MERGE_MIN = 45
export const SYNC_BUILD_MIN = 90
export const HARD_END_WARN_MS = 10 * 60_000 // the holder is told this long before the hard end
export type Conflict = { path: string; kind: 'self' | 'foreign'; match?: string }
export type SyncHolder = { session: string; id8: string; lane: string }
export type SyncFile = {
  v: 1
  id: string
  at: number
  holder: SyncHolder
  plannedBy: string
  state: SyncState
  conflicts: Conflict[] | null
  conflictsAt: number | null
  conflictsSource: 'merge-tree' | 'holder' | null
  /** Paths origin/main adds that already exist on disk in the shared checkout (A11): the merge would refuse or
   * overwrite them, and merge-tree does not see them. Null until the holder's dry-run lists them. */
  untracked: string[] | null
  /** A107: what the dry-run behind the lists read (null: no dry-run list on file). */
  dry: DryRead | null
  /** D8: the sync includes a build; its freeze may last longer. */
  build: boolean
  /** D8: the freeze's hard end (T + 45 min, T + 90 min with a build): past it the sync expires. */
  hardEnd: number
  /** D7: the sync worker the holder's a5r spawned at T (once per sync), and when. */
  workerId: string | null
  workerAt: number | null
  /** A16: sessions without a5r 0.4 the holder has sent the standard message to (by session id). */
  messaged: string[]
  endedAt: number | null
  note: string
  updatedAt: number
  /** A93 / A96: the stage the sync is in once its worker ended (null before): building or testing after the merge, manual
   * when the worker handed it back; the freeze holds through every stage. */
  stage: SyncStage | null
  /** A93: the HEAD the holder's a5r recorded before starting the worker, the merge commit, the build's log ('' unknown). */
  preHead: string
  mergeSha: string
  buildLog: string
  /** A109: the one command that starts the sync's build script, as the worker's task gave it ('' none: the sync does not
   * build, its worker has not started, or the script could not be written). */
  buildRun: string
  /** A93: the hard end was put back once while the build ran. */
  extended: boolean
  /** A93: when the current stage began (a build log older than this is an earlier run's). */
  stageAt: number
  /** A99: the holder's conflict rules for the worker, first match wins ([] none). */
  rules: SyncRule[]
}
/** A107: the origin/main a dry-run read ('' unread) and why its list is stale ('' when the fetch just before it succeeded). */
export type DryRead = { main: string; stale: string }
export type Phase = 'none' | 'planned' | 'cutoff' | 'frozen' | 'done' | 'aborted' | 'cancelled' | 'expired'

export const parseSyncFile = (text: string | null): SyncFile | null => {
  try {
    const v = JSON.parse(text ?? '') as Partial<SyncFile>
    if (typeof v?.at !== 'number' || !v.holder || typeof v.holder.id8 !== 'string') return null
    const build = v.build === true
    return {
      v: 1,
      id: String(v.id ?? `sync-${v.at}`),
      at: v.at,
      holder: v.holder,
      plannedBy: String(v.plannedBy ?? ''),
      state: (v.state as SyncState) ?? 'planned',
      conflicts: v.conflicts ?? null,
      conflictsAt: v.conflictsAt ?? null,
      conflictsSource: v.conflictsSource ?? null,
      untracked: Array.isArray(v.untracked) ? v.untracked.map(String) : null,
      dry: v.dry && typeof v.dry === 'object' ? { main: String(v.dry.main ?? ''), stale: String(v.dry.stale ?? '') } : null,
      build,
      hardEnd: typeof v.hardEnd === 'number' ? v.hardEnd : v.at + (build ? SYNC_BUILD_MIN : SYNC_MERGE_MIN) * 60_000, // a 0.4 file: the default end
      workerId: typeof v.workerId === 'string' ? v.workerId : null,
      workerAt: typeof v.workerAt === 'number' ? v.workerAt : null,
      messaged: Array.isArray(v.messaged) ? v.messaged.map(String) : [],
      endedAt: v.endedAt ?? null,
      note: String(v.note ?? ''),
      updatedAt: Number(v.updatedAt ?? 0),
      stage: v.stage === 'building' || v.stage === 'testing' || v.stage === 'manual' ? v.stage : null,
      preHead: String(v.preHead ?? ''),
      mergeSha: String(v.mergeSha ?? ''),
      buildLog: String(v.buildLog ?? ''),
      buildRun: String(v.buildRun ?? ''),
      extended: v.extended === true,
      stageAt: typeof v.stageAt === 'number' ? v.stageAt : 0,
      rules: storedRules(v.rules),
    }
  } catch {
    return null
  }
}

/** planned → cutoff at T − 30 → frozen at T → done / aborted (or cancelled before T). D8: the freeze is a lease:
 * past its hard end, or once the holder session is gone while frozen, it is `expired` for every reader at once,
 * whoever writes that down first. */
export const syncPhase = (s: SyncFile | null, now: number, isHolderGone = false): Phase => {
  if (!s) return 'none'
  if (s.state !== 'planned') return s.state
  if (now < s.at - CUTOFF_MS) return 'planned'
  if (now < s.at) return 'cutoff'
  // A93 (review): after the merge, a gone holder is replaced (the sync is handed to a live session), never expired; before
  // it, and in the manual stage (A96: the sync is the holder's own to finish), a gone holder expires it.
  return now >= s.hardEnd || (isHolderGone && !isMergedStage(s.stage)) ? 'expired' : 'frozen'
}
/** A107: the conflict list on file was made by a dry-run at T or later (not by the holder's hand). */
export const isListAtT = (s: SyncFile): boolean => s.conflictsSource === 'merge-tree' && s.conflictsAt !== null && s.conflictsAt >= s.at
export const isOpenPhase = (p: Phase): boolean => p === 'planned' || p === 'cutoff' || p === 'frozen'
/** A94: this session holds the sync and it is in its cutoff or freeze: its own Editor slot goes first, uncapped, and ends
 * with the sync. */
export const isHolderInSync = (s: SyncFile | null, me8: string, phase: Phase): boolean => Boolean(s && s.holder.id8 === me8 && (phase === 'cutoff' || phase === 'frozen'))
/** A sync's limit on a lease of `id8` that would end at `end` (the editor tool's extend and the person's resize, A117): a
 * planned sync's cutoff it would cross, or a sync in its cutoff or freeze that is not this session's (the Editor is the
 * sync's: released by sync − 10 min); null when none. */
export const syncLimit = (s: SyncFile | null, phase: Phase, id8: string, end: number): { kind: 'cutoff'; why: string } | { kind: 'claim'; why: string; releaseBy: number } | null => {
  if (s && phase === 'planned' && end > s.at - CUTOFF_MS) return { kind: 'cutoff', why: `the lease would end at ${hhmm(end)}, past the sync cutoff ${hhmm(s.at - CUTOFF_MS)}` }
  if (isSyncClaim(s, id8, phase)) return { kind: 'claim', why: `the sync at ${hhmm(s.at)} is in its ${phase === 'cutoff' ? 'cutoff' : 'freeze'}`, releaseBy: s.at - RELEASE_BEFORE_MS }
  return null
}
/** Another session's sync is in its cutoff or freeze: it needs the Editor (and the shared checkout) from this one. */
export const isSyncClaim = (s: SyncFile | null, me8: string, phase: Phase): s is SyncFile => Boolean(s && s.holder.id8 !== me8 && (phase === 'cutoff' || phase === 'frozen'))

export const newSync = (at: number, holder: SyncHolder, plannedBy: string, now: number, build = false, freezeMin = build ? SYNC_BUILD_MIN : SYNC_MERGE_MIN): SyncFile => ({
  v: 1,
  id: `sync-${ymd(at).replace(/-/g, '')}-${hhmm(at).replace(':', '')}-${holder.id8}`,
  at,
  holder,
  plannedBy,
  state: 'planned',
  conflicts: null,
  conflictsAt: null,
  conflictsSource: null,
  untracked: null,
  dry: null,
  build,
  hardEnd: at + freezeMin * 60_000,
  workerId: null,
  workerAt: null,
  messaged: [],
  endedAt: null,
  note: '',
  updatedAt: now,
  stage: null,
  preHead: '',
  mergeSha: '',
  buildLog: '',
  buildRun: '',
  extended: false,
  stageAt: 0,
  rules: [],
})
/** A move keeps the sync's id and the length of its freeze; its notices are keyed by its time too, so a moved
 * sync gets them again. */
export const movedSync = (s: SyncFile, at: number, now: number): SyncFile => ({ ...s, at, hardEnd: at + (s.hardEnd - s.at), conflicts: null, conflictsAt: null, conflictsSource: null, untracked: null, dry: null, messaged: [], updatedAt: now })
/** The build flag of a planned sync, with its freeze length to match (D8). */
export const withBuild = (s: SyncFile, build: boolean, freezeMin: number, now: number): SyncFile => ({ ...s, build, hardEnd: s.at + freezeMin * 60_000, updatedAt: now })

/** `git diff --name-only -z --diff-filter=A HEAD origin/main`: the paths main adds, NUL-separated (no quoting). */
export const parseAdded = (stdout: string): string[] => [...new Set(stdout.split('\0').map(p => p.replace(/[\r\n]+/g, '').trim()).filter(Boolean))]
export const endedSync = (s: SyncFile, state: 'done' | 'aborted' | 'cancelled' | 'expired', note: string, now: number): SyncFile => ({ ...s, state, note: note.slice(0, 200), endedAt: now, updatedAt: now })
/** The holder's own conflict list (the sync tool's conflicts action; the dry-run's goes through withDryRun). */
export const withConflicts = (s: SyncFile, conflicts: Conflict[], now: number): SyncFile => ({ ...s, conflicts, conflictsAt: now, conflictsSource: 'holder', dry: null, updatedAt: now })

/** `git merge-tree --write-tree --name-only HEAD origin/main`: the tree, then the conflicted paths up to the
 * first blank line (informational messages follow it). Exit 1 means conflicts, 0 a clean merge. */
export const parseMergeTree = (stdout: string): { tree: string; paths: string[] } => {
  const lines = stdout.replace(/\r/g, '').split('\n')
  const paths: string[] = []
  for (const l of lines.slice(1)) {
    if (l.trim() === '') break
    if (!paths.includes(l.trim())) paths.push(l.trim())
  }
  return { tree: (lines[0] ?? '').trim(), paths }
}

/** Every blob a path has had in this branch's history (`git log --format=%H --raw --no-abbrev HEAD -- <path>`),
 * mapped to the commit that wrote it. */
export const historyBlobs = (rawLog: string): Map<string, string> => {
  const out = new Map<string, string>()
  let commit = ''
  for (const l of rawLog.replace(/\r/g, '').split('\n')) {
    if (/^[0-9a-f]{40}$/.test(l.trim())) commit = l.trim()
    const m = /^:\d+ \d+ ([0-9a-f]{40}) ([0-9a-f]{40}) /.exec(l)
    if (m?.[2] && !/^0+$/.test(m[2]) && !out.has(m[2])) out.set(m[2], commit)
  }
  return out
}

/** Runbook-sync-lane rule 11: main's blob for the path equals one this branch had, so main only holds an older
 * version of ours (a self-conflict, resolved to ours); otherwise main carries a foreign change. */
export const classify = (path: string, mainBlob: string, blobs: Map<string, string>): Conflict => {
  const match = mainBlob ? blobs.get(mainBlob) : undefined
  return match ? { path, kind: 'self', match: match.slice(0, 12) } : { path, kind: 'foreign' }
}

/** Saved/A5R/touch/<id8>.json: the repo-relative paths a session and its workers edited in the shared
 * checkout, so a conflict reaches the session that owns it. */
export type Touch = { session: string; id8: string; lane: string; paths: string[]; updatedAt: number }
export const parseTouch = (text: string | null): Touch | null => {
  try {
    const v = JSON.parse(text ?? '') as Partial<Touch>
    return typeof v?.id8 === 'string' && Array.isArray(v.paths) ? { session: String(v.session ?? v.id8), id8: v.id8, lane: String(v.lane ?? v.id8), paths: v.paths.map(String), updatedAt: Number(v.updatedAt ?? 0) } : null
  } catch {
    return null
  }
}
export const samePath = (a: string, b: string) => a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()
export const ownersOf = (path: string, touches: readonly Touch[]): Touch[] => touches.filter(t => t.paths.some(p => samePath(p, path)))
export const isBinaryAsset = (path: string): boolean => /\.(uasset|umap)$/i.test(path)

// ---------- freeze: git writes and Editor use in the shared checkout ----------
// A98 (rev 33): update-index writes the index (the sync's own `update-index -q --refresh` is its exact form, A15).
export const FREEZE_VERBS = new Set(['commit', 'add', 'rm', 'mv', 'checkout', 'switch', 'restore', 'reset', 'stash', 'merge', 'rebase', 'pull', 'push', 'cherry-pick', 'revert', 'clean', 'am', 'update-index'])

/** The git writes a command makes (`git [-C dir] [-c k=v] <verb>`), each with the folder it runs in ('' = the
 * working directory). `git stash list|show` only reads. */
export const gitWrites = (command: string): { verb: string; dir: string }[] => {
  const out: { verb: string; dir: string }[] = []
  for (const { verb, args } of programs(command)) {
    if (verb !== 'git') continue
    let dir = ''
    for (let i = 0; i < args.length; i += 1) {
      const a = args[i] ?? ''
      if (a === '-C') {
        dir = args[i + 1] ?? ''
        i += 1
      } else if (a === '-c' || ((a === '--git-dir' || a === '--work-tree' || a === '--namespace') && !a.includes('='))) i += 1
      else if (a.startsWith('-')) continue
      else {
        const next = (args[i + 1] ?? '').toLowerCase()
        if (FREEZE_VERBS.has(a.toLowerCase()) && !(a.toLowerCase() === 'stash' && (next === 'list' || next === 'show'))) out.push({ verb: a.toLowerCase(), dir })
        break
      }
    }
  }
  return out
}

/** A15: whether a command is only the sync's own git work, which the holder and its worker may run during their
 * frozen phase without A5R's asks: `git merge [--no-edit|--no-ff|--no-commit] origin/main`, `git merge --abort`,
 * `git checkout --ours|--theirs -- <paths>`, `git revert -m 1 <sha> [--no-edit]`, `git revert|cherry-pick --abort|--continue
 * [--no-edit]` (A115), `git add -- <paths>`,
 * `git commit [-m <msg>|--no-edit|-F <file>|-q]`, `git update-index -q --refresh` (A98: stat-only changes are no dirt;
 * only `-q`, `--refresh`, `--really-refresh`, no paths), beside git reads; every segment must be git (env assignments such
 * as GIT_TERMINAL_PROMPT=0 allowed), no nested shell, no `.` or `-A` path, no `--amend` or `-a`. */
export const isSyncCommandOnly = (command: string): boolean => {
  const segs = segments(stripHeredocs(command ?? ''))
  if (segs.length === 0) return false
  return segs.every(seg => {
    const [verb, args] = commandVerb(tokenize(seg))
    if (verb !== 'git') return false
    if (gitWrites(seg).length === 0) return true // a read
    let i = 0
    while (i < args.length) {
      const a = args[i] ?? ''
      if (a === '-C' || a === '-c') i += 2
      else if (a === '--no-pager' || /^--(git-dir|work-tree)=/.test(a)) i += 1
      else break
    }
    const sub = (args[i] ?? '').toLowerCase()
    const rest = args.slice(i + 1)
    const isPath = (p: string) => p !== '' && p !== '.' && p !== '*' && !p.startsWith('-')
    const pathsAfterDashes = (xs: string[]) => xs.length >= 2 && xs[0] === '--' && xs.slice(1).every(isPath)
    if (sub === 'merge') {
      if (rest.length === 1 && rest[0] === '--abort') return true
      const opts = rest.filter(r => r.startsWith('-'))
      const targets = rest.filter(r => !r.startsWith('-'))
      return targets.length === 1 && targets[0] === 'origin/main' && opts.every(o => ['--no-edit', '--no-ff', '--no-commit'].includes(o))
    }
    if (sub === 'checkout') return (rest[0] === '--ours' || rest[0] === '--theirs') && pathsAfterDashes(rest.slice(1))
    if (sub === 'revert' || sub === 'cherry-pick') {
      const r = rest.filter(x => x !== '--no-edit')
      if (r.length === 1 && (r[0] === '--abort' || r[0] === '--continue')) return true
      return sub === 'revert' && r.length === 3 && r[0] === '-m' && r[1] === '1' && /^([0-9a-f]{7,40}|HEAD)$/i.test(r[2] ?? '')
    }
    if (sub === 'add') return pathsAfterDashes(rest)
    if (sub === 'update-index') return rest.some(r => r === '--refresh' || r === '--really-refresh') && rest.every(r => ['-q', '--refresh', '--really-refresh'].includes(r))
    if (sub === 'commit') {
      for (let n = 0; n < rest.length; n += 1) {
        const r = rest[n] ?? ''
        if (r === '-m' || r === '--message' || r === '-F' || r === '--file') n += 1
        else if (!(r === '--no-edit' || r === '-q' || r === '--quiet' || /^--(message|file)=/.test(r))) return false
      }
      return true
    }
    return false
  })
}

/** An Edit/Write path that is the Editor owner lock (`.` and `..` resolved). */
export const isLockPath = (path: string): boolean => /(^|\/)Saved\/EDITOR_OWNER\.txt$/i.test(norm(path ?? ''))

const LOCK_NAME = /EDITOR_OWNER\.txt/i
/** A shell command that writes the lock: a segment naming it that writes files (a5r.ts writesFiles: a redirect or tee into it,
 * a writing or deleting verb, an in-place edit, a git write), or a .NET file write. Reading it is fine: agents read the lock
 * with many tools, so this guard lists writers (the order file's, order.ts, lists readers instead). */
export const writesLock = (command: string): boolean =>
  programs(command).some(({ raw, verb, args }) => LOCK_NAME.test(raw) && (writesFiles(raw, verb, args, t => LOCK_NAME.test(t)) || isDotNetWrite(raw)))

// ---------- notices (D6): one shape, one delivery per id per session ----------
export type Notice = { id: string; text: string; isActionable: boolean }
/** A116 / A118: a NEEDS A LOOK row on the A5R panel: what needs the person's look, in one line, and his next step. */
export type LookRow = { what: string; next: string; press?: { kind: 'focus' | 'release'; id8: string; label: string } } // A121 / A122: the person's one press on the row (looks.ts)
export const noticeText = (gate: string, what: string, todo: string): string => `${MARK} ${gate} — ${what} → ${todo}`
export const isIntentFile = (path: string): boolean => /(^|\/)docs\/intent\//i.test((path ?? '').replace(/\\/g, '/'))
/** A76: a line that IS a coordination notice: the prefix and a gate name at its start (after list or quote marks), then
 * " — "; prose that mentions or quotes the prefix is not one. */
export const isNoticeLine = (line: string): boolean => new RegExp(`^\\s*(?:[-*>]\\s+)*${MARK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} [^—\\n]{1,60} — `).test(line)
export const addsNotice = (added: readonly string[]): boolean => added.some(isNoticeLine)
/** A shell command that writes a a5r line into an intent file (a redirect, tee or a PowerShell writer, a
 * heredoc body included). Best effort, like every shell check here. */
export const writesNoticeToIntent = (command: string): boolean =>
  // A76: only text that is a notice counts (it starts a line, or the text an echo/printf/-Value writes), not prose quoting it.
  new RegExp(`(?:^|\\n|(?:echo|printf|Write-Output|Write-Host|-Value)\\s+['"]?)\\s*(?:[-*>]\\s+)*${MARK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} [^—\\n]{1,60} — `).test(command ?? '') &&
  /(>>?|\btee\b|Out-File|Set-Content|Add-Content)\s*(-\w+\s+)*['"]?[^|;&\n]*docs[\\/]+intent[\\/]/i.test(command ?? '')

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** A88 (c): the command an agent can run itself when the probe failed. */
export const FREE_RAM_READ = 'powershell -NoProfile -Command "(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB"'

export const NOTICES = {
  /** A113: `pass`: the slot goes before the head of the queue (`lane`), which waits for memory; `launch` false: no launch. */
  granted: (end: number, pie: boolean, reuse: number | null, cleanup: string, pass?: { lane: string; launch: boolean }): Notice['text'] =>
    noticeText('Editor', `granted to this session until ${hhmm(end)}${pass ? ` (a slot of at most ${PASS_MAX_MIN} min before ${pass.lane}, first in the queue, which waits for memory)` : ''}${reuse ? ` (UnrealEditor PID ${reuse} is open: reuse it)` : ''}${cleanup ? `; cleanup: ${cleanup}` : ''}`, `${pass && !pass.launch ? 'do the work that launches no Editor (asked with launch: false; an Editor launch is refused in this slot)' : reuse ? 'use that Editor' : 'launch the Editor'}${pie ? ' (PIE needs 5 GB free to start)' : ''}; release with the editor tool (action release) when done, and before ${hhmm(end)}`),
  /** A113: an Unreal Editor runs in a pass slot that was asked with launch: false. */
  passLaunched: (pid: number, head: string): string => noticeText('Editor', `an Unreal Editor (PID ${pid}) runs in this session's slot, which went before ${head} (waiting for memory) because it was asked with launch: false`, 'close it now if it is yours (it takes the memory that head waits for), then do the work that launches no Editor; to launch one, release and request again without launch: false'),
  /** A117: the person gave this session's lease another end (its HELD line, rewritten from any session's A5R). */
  resized: (end: number, was: number): string => noticeText('Editor lease', `the person gave your lease another end: it now ends at ${hhmm(end)} (it ended at ${hhmm(was)})`, 'nothing to do: use the time; release with the editor tool when done'),
  /** Fable review D4: two grants met in the same minute (or the line was rewritten): this session lost the lock it took. */
  lockLost: (who: string): string => noticeText('Editor', `the lock names ${who}, not this session (two grants met in the same minute, or the line was rewritten)`, 'your request stays queued in its place; do work that needs no Editor meanwhile'),
  /** A114: a queued session idle an hour while the Editor is free and only memory holds its request back. */
  memory: (why: string, heavy: string, idleMin: number): string => noticeText('Editor', `the Editor is free and you are queued, idle for ${idleMin} min, held back only by memory: ${why}; memory is held by ${heavy}`, 'nothing to do unless some of that memory is yours to free (an Editor, a game or a tool you left running): your request stays queued and the grant wakes you; if your task launches no Editor (a build), ask again with launch: false, which may go before a head waiting for memory'),
  /** A88 (c, re-review): the probe failed while this session's PIE runs, so the 3 GB abort cannot be checked: no silent pass. */
  pieProbeFailed: (): string => noticeText('RAM', 'the RAM probe did not answer while your PIE runs, so the 3 GB PIE abort cannot be checked', `read free RAM with ${FREE_RAM_READ} now and stop PIE if it is under 3 GB`),
  leaseEnding: (end: number): string => noticeText('Editor lease', `your lease ends at ${hhmm(end)}`, 'finish to a checkpoint (PIE stopped, your own assets saved), then release with the editor tool, or extend it if it still fits'),
  overrun: (end: number): string => noticeText('Editor lease', `your lease ended at ${hhmm(end)}`, 'stop at the nearest checkpoint and release now with the editor tool; ask again for the rest (almost done is no reason to overrun)'),
  idle: (min: number): string => noticeText('Editor lease', `this session holds the Editor but has not used it for ${min} min`, 'release it with the editor tool (the Editor may stay open: say so in the note)'),
  yield: (lane: string, minutes: number): string => noticeText('Editor yield', `${lane} asks for the Editor for ~${minutes} min, no build`, 'at your next safe point (≤ 10 min): stop PIE, save only your own assets, release with the editor tool; if you cannot pause, keep it and finish by your end time'),
  recovered: (holder: string): string => noticeText('Editor', `the lease of session ${holder} was stale (its lane is gone, no UnrealEditor runs) and was freed`, 'nothing to do: the queue goes on'),
  lapsed: (r: Released): string => noticeText('Editor lease', `your lease (${hhmm(r.since)}–${hhmm(r.end)}) lapsed: ${Math.round((r.at - r.end) / 60_000)} min past its end with no Editor running, so ${r.by || 'another session'} released it at ${hhmm(r.at)} and the queue went on`, 'nothing of yours was closed; request the Editor again with the editor tool if you still need it'),
  /** A91: the Editor came free with nobody queued, and this session's last message said it was waiting for it. */
  nudge: (freeGb: number | null): string => noticeText('Editor', `the Editor is free now (free memory ${freeGb === null ? '?' : freeGb} GB)`, 'if your task was waiting for it, request it with the editor tool; otherwise ignore this'),
  /** Fable review S3: the person freed this session's lock past its lease's end. */
  releasedByPerson: (r: Released): string => noticeText('Editor lease', `your lease (${hhmm(r.since)}–${hhmm(r.end)}) was past its end, so ${r.by} freed the lock at ${hhmm(r.at)} and the queue went on`, 'stop using the Editor (nothing of yours was closed); request it again with the editor tool if you still need it'),
  passedOn: (r: Released): string => noticeText('Editor', `the Editor was granted to this session at ${hhmm(r.since)}, but this session ran no turn in the next ${Math.round((r.at - r.since) / 60_000)} min and launched no Editor, so ${r.by || 'another session'} passed it to the next in the queue at ${hhmm(r.at)}`, 'request it again with the editor tool when you are ready to use it'),
  goneEditor: (who: string, pid: number): string => noticeText('Editor', `${who} is gone but UnrealEditor PID ${pid} still runs`, 'never kill it or drive it; do work that needs no Editor meanwhile (the lease is freed once no UnrealEditor runs); if it is hung, add a finding for Ather\'s Needs you (AGENTS.md: force-kill only a hung Editor whose holder is confirmed gone)'),
  pieAbort: (free: number): string => noticeText('RAM', `free RAM is ${free} GB, under the ${PIE_ABORT_GB} GB abort line, while this session's PIE runs`, 'stop PIE now, then free memory before starting it again'),
  disk: (drive: string, free: number): string => noticeText('Disk', `${drive} has ${free} GB free, under ${DISK_MIN_GB} GB (the DDC refuses writes under 10 GB)`, 'free space yourself: delete your own temp builds and scratch copies, move old Saved/_restore_backup*, Saved/_train_residue* and whole Saved/Autosaves copies to another drive (keep PackageRestoreData.json and the files it lists); never delete another session\'s files (said once a day)'),
  cutoff: (s: SyncFile, isHolder: boolean, lockMine: boolean): string =>
    isHolder
      ? noticeText('Sync main', `cutoff: you hold the sync at ${hhmm(s.at)}`, `checkpoint your own work now and release the Editor by ${hhmm(s.at - RELEASE_BEFORE_MS)}${lockMine ? ' (if this session still holds it at the sync time, the sync takes that lease: its worker uses or closes that Editor after a dirty-package check, and a5r releases it when the sync ends)' : ''};the conflict dry-run runs now and lands in sync.json; at ${hhmm(s.at)} a5r starts the sync worker, which runs the merge and ends it with done or abort (at the latest ${hhmm(s.hardEnd)})`)
      : noticeText('Sync main', `cutoff: ${s.holder.lane} merges origin/main at ${hhmm(s.at)}`, `commit your own paths now (exact paths, wip: is fine), write your resume note in Saved/LANE_NOTES/<session id>.md, stop PIE and ${lockMine ? 'release the Editor' : 'leave the Editor alone'} by ${hhmm(s.at - RELEASE_BEFORE_MS)}; keep Source/ and Plugins/ edits out of the shared tree from now; from ${hhmm(s.at)} git writes and the Editor wait until the sync is done`),
  releaseBy: (s: SyncFile): string => noticeText('Sync main', `the sync at ${hhmm(s.at)} needs the Editor free by ${hhmm(s.at - RELEASE_BEFORE_MS)} and this session still holds it`, 'stop PIE, save your own assets, release with the editor tool now'),
  frozen: (s: SyncFile): string => noticeText('Sync main', `frozen: ${s.holder.lane} merges origin/main since ${hhmm(s.at)}`, 'no git writes in the shared checkout and no Editor use until it is done; keep working without them (or in your own worktree); you will be told when it lifts'),
  frozenHolder: (s: SyncFile): string => noticeText('Sync main', `it is ${hhmm(s.at)}: every other session's git writes and Editor use are held for your sync, and the sync worker runs the merge in the background`, `leave git and the Editor in the shared checkout to it; it ends with done or abort (at the latest ${hhmm(s.hardEnd)}); you are told when it ends`),
  // A79: the worker's own last word, recorded by the holder's a5r (the Editor lock released with it).
  workerDone: (s: SyncFile): string => noticeText('Sync main', `the sync worker finished the sync at ${hhmm(s.at)}: done (${s.note}); the Editor lock is released`, 'git and the Editor are open again for every session; check the merge commit before trusting old measurements'),
  /** A96: the worker gave up (its abort, no merge commit, or it could not start): the sync is back in the holder's hands,
   * still frozen. */
  syncManual: (s: SyncFile, busy = NO_GIT_BUSY): string => {
    const git = gitBusyNote(busy) // A108: the checkout's git and its index.lock when the worker handed the sync back
    return noticeText('Sync main', `the sync at ${hhmm(s.at)} is back in your hands (${s.note}); every other session stays frozen and the sync's Editor lock stays this session's until done, abort or ${hhmm(s.hardEnd)}${git.fact}`, `keep the lock (the sync tool's done or abort gives it back; the editor tool's release does not); ${git.step ? `${git.step}; then ` : ''}either finish it by hand: close the Editor process first (an open Editor holds files git must replace: "unable to unlink"), check git status and .git/MERGE_HEAD, merge with git non-interactive (git -C <checkout> merge --no-edit origin/main), resolve (rule 11 and your conflict rules)${s.build ? `, build (${buildStep(s.buildRun)})` : ''}, run the post-merge headless tests (${POST_MERGE_TESTS}) and call the sync tool done with their result line; or call the sync tool abort with why, which lifts the freeze and frees the Editor at once`)
  },
  /** A93: the merge is in and its build runs (A109: its log of this run is written and, past the grace, its script still
   * runs): the freeze holds; the holder hears when the build's Result line comes. */
  syncBuilding: (s: SyncFile): string => noticeText('Sync main', `the merge ${mergeLabel(s.mergeSha)} is in and the build runs${s.buildLog ? ` (log ${s.buildLog})` : ''}; every other session stays frozen`, 'leave git and the Editor in the shared checkout alone; A5R wakes you at the build\'s own Result: line'),
  /** A109: the worker ended with its build reported started, and no log of this run is seen yet. */
  syncBuildReported: (s: SyncFile): string => noticeText('Sync main', `the merge ${mergeLabel(s.mergeSha)} is in; the worker reports it started the build; A5R confirms when its log appears${s.buildLog ? ` (${s.buildLog})` : ''}; every other session stays frozen`, 'leave git and the Editor in the shared checkout alone; A5R wakes you at the build\'s own Result: line, or at once if the build did not start'),
  /** A109 (review): Build.bat waits for another Build.bat on the same engine to end (its lock line is the log's last). */
  syncBuildQueued: (s: SyncFile): string => noticeText('Sync main', `the build of the merge ${mergeLabel(s.mergeSha)} started and waits for another Build.bat on this engine to end (Build.bat's lock${s.buildLog ? `; log ${s.buildLog}` : ''}); every other session stays frozen`, 'nothing to do: it goes on by itself when the other build ends; A5R wakes you at its own Result: line'),
  /** A93 / A95: the build succeeded (or the sync does not build): the holder runs the post-merge tests, then done. */
  syncTest: (s: SyncFile): string => noticeText('Sync main', `the merge ${mergeLabel(s.mergeSha)} is in${s.build ? ' and its build succeeded' : ''}; the post-merge headless tests are part of the sync`, `run them now with the S2 standard command: ${POST_MERGE_TESTS}; then call the sync tool done with the test result line in the note (or "tests skipped: <why>"); every other session stays frozen until then`),
  /** A93: the build failed: the holder reverts the merge and aborts. */
  syncBuildFailed: (s: SyncFile): string => noticeText('Sync main', `the build of the merge ${mergeLabel(s.mergeSha)} failed (its own Result: line)`, `revert it: git -C <checkout> revert -m 1 ${s.mergeSha || '<merge sha>'} --no-edit, then call the sync tool abort with the first error lines`),
  /** A93 / A109: the build did not start: no log of this run, told at once when the worker said `build-log=none`, else
   * past the grace; the holder starts the script itself, with the one command the worker was given. */
  syncBuildUnknown: (s: SyncFile): string => noticeText('Sync main', `the merge ${mergeLabel(s.mergeSha)} is in but its build did not start: no log of this run${s.buildLog ? ` (${s.buildLog})` : ''}`, `start the build yourself now with ${buildStep(s.buildRun)} (A5R watches the log and wakes you at its Result: line)`),
  /** A109 (review): the build script ended (its exit or refusal line) with no Result: line: read why before running it again. */
  syncBuildEnded: (s: SyncFile, tail = ''): string => noticeText('Sync main', `the build script of the merge ${mergeLabel(s.mergeSha)} ended without a Result: line${s.buildLog ? ` (log ${s.buildLog})` : ''}${tail ? `; its last lines: ${tail}` : ''}`, `read the log first (a refusal names its cause: no Build.bat under the engine root, a path call would change; else Build.bat's own error), fix that, then start the build again with ${buildStep(s.buildRun)}; A5R watches the log`),
  /** A109 (review): the log stopped with no Result: and no exit line while the script no longer runs (killed, crashed). */
  syncBuildStopped: (s: SyncFile, tail = ''): string => noticeText('Sync main', `the build log of the merge ${mergeLabel(s.mergeSha)}${s.buildLog ? ` (${s.buildLog})` : ''} stopped with no Result: line and no exit line, and its script no longer runs${tail ? `; its last lines: ${tail}` : ''}`, `read it: the build was stopped or crashed; start it again with ${buildStep(s.buildRun)}, and A5R watches the log; if it did finish elsewhere: Succeeded → run the post-merge tests and call done; Failed → git revert -m 1 <merge sha> --no-edit, then abort`),
  /** A93 (review): the holder went away after the merge: this live session now holds the sync, still frozen. */
  syncHandedOver: (s: SyncFile, from: string): string => noticeText('Sync main', `the sync at ${hhmm(s.at)} was held by ${from}, which is gone; the merge ${mergeLabel(s.mergeSha)} is in, so this session now holds it, in its ${s.stage ?? 'merge'} stage${s.buildLog ? ` (build log ${s.buildLog})` : ''}, frozen until ${hhmm(s.hardEnd)} at the latest`, s.stage === 'testing' ? `run the post-merge headless tests (${POST_MERGE_TESTS}), then call the sync tool done with their result line (or "tests skipped: <why>"); abort if they fail` : 'A5R watches the build log for its own Result: line and wakes you; then run the post-merge tests and call done, or revert (git revert -m 1 <merge sha> --no-edit) and abort'),
  /** A93: the hard end was put back once while a build, test or Editor process ran near it. */
  syncExtended: (s: SyncFile): string => noticeText('Sync main', `a build, test or Editor process still runs, so the sync's hard end moved once to ${hhmm(s.hardEnd)}`, s.stage === 'building' ? 'nothing to do: A5R wakes you at the build\'s Result: line' : `finish the sync with done or abort before ${hhmm(s.hardEnd)}`),
  lifted: (s: SyncFile): string =>
    s.state === 'done'
      ? noticeText('Sync main', `done at ${hhmm(s.endedAt ?? s.updatedAt)}${testsLabel(s.note) ? ` · ${testsLabel(s.note)}` : ''}${s.note ? ` (${s.note})` : ''}`, 'git and the Editor are open again: resume from your resume note and re-check the files main changed before trusting old measurements')
      : noticeText('Sync main', `${s.state} at ${hhmm(s.endedAt ?? s.updatedAt)}${s.note ? ` (${s.note})` : ''}`, 'git and the Editor are open again; your work stays as it is; the next sync is planned on the A5R panel'),
  // A107: the dry-run's notices name each path once per session; `isFrozen`: told in the freeze (no git write left to ask
  // for), "found by the dry-run at T" when the list on file was made at T or later.
  fetchFailed: (s: SyncFile, round: DryRound, why: string): string =>
    noticeText('Sync main', `git fetch origin main failed ${round === 'start' ? `at T (${hhmm(s.at)})` : 'at the cutoff'} (${why}), so the conflict dry-run reads origin/main as last fetched`, round === 'start' ? 'nothing to do: the worker\'s task marks its list stale, the worker fetches itself and its merge\'s own unmerged paths decide' : `fetch it yourself (GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never git -C <checkout> fetch origin main) if the network or credential needs you; A5R fetches and dry-runs again at ${hhmm(s.at)}`),
  holderConflicts: (s: SyncFile, rows: { c: Conflict; owners: string[] }[], isFrozen = false): string => {
    const self = rows.filter(r => r.c.kind === 'self')
    const foreign = rows.filter(r => r.c.kind === 'foreign')
    // A99: a path one of the holder's rules matches goes to the worker's rule 5, not to an owner.
    const whose = (r: { c: Conflict; owners: string[] }) => ruleNote(r.c.path, s.rules) ?? (r.owners.length ? r.owners.join(', ') : 'owner unknown')
    const list = foreign.map(r => `${r.c.path}${isBinaryAsset(r.c.path) ? ' (binary)' : ''} → ${whose(r)}`).join('; ')
    return noticeText('Sync main', `${isListAtT(s) ? 'the dry-run at T' : `dry-run for ${hhmm(s.at)}`}: ${plural(rows.length, 'conflict')} (${self.length} self, ${foreign.length} foreign)${list ? `: ${list}` : ''}`, `${self.length ? 'self-conflicts resolve to ours at the merge (rule 11, log each with its commit); ' : ''}${foreign.length ? 'a mechanical text conflict (both sides additive) you resolve and check with git diff --check; a logic or .uasset/.umap conflict → git merge --abort and the path goes to its owner; owner unknown → abort the merge and name the path in the abort note' : 'nothing else to do'}`)
  },
  ownerConflicts: (s: SyncFile, mine: Conflict[], isFrozen = false): string => {
    const self = mine.filter(c => c.kind === 'self')
    const foreign = mine.filter(c => c.kind === 'foreign')
    const parts = [
      foreign.length ? `foreign change on main in ${foreign.map(c => c.path).join(', ')}` : '',
      self.length ? `self-conflict in ${self.map(c => `${c.path} (main holds our ${c.match})`).join(', ')}` : '',
    ].filter(Boolean)
    return noticeText('Sync main', `${parts.join('; ')} for the sync at ${hhmm(s.at)}${isListAtT(s) ? ', found by the dry-run at T' : ''}; this session edited ${mine.length === 1 ? 'that path' : 'those paths'}`, `${foreign.length ? (isFrozen ? `the sync is frozen, so make no git write; the worker reads no messages and aborts on a conflict that is not mechanical and no rule settles, then ${s.holder.lane} finishes the merge by hand: tell ${s.holder.lane} how the two sides combine (never discard either side)` : `before ${hhmm(s.at)}: commit your own version (exact paths) and tell ${s.holder.lane} how the two sides combine; a logic or .uasset/.umap conflict means the merge is aborted and you resolve it after the sync (the owner decides, never discard either side)`) : ''}${foreign.length && self.length ? '; ' : ''}${self.length ? 'a self-conflict needs nothing from you: the holder resolves it to ours (rule 11)' : ''}`)
  },
  ownerUntracked: (s: SyncFile, paths: readonly string[], isFrozen = false): string =>
    noticeText('Sync main', `origin/main adds ${paths.join(', ')}, which already ${paths.length === 1 ? 'exists' : 'exist'} untracked in the shared checkout and ${paths.length === 1 ? 'was' : 'were'} written by this session; the merge at ${hhmm(s.at)} would refuse to overwrite ${paths.length === 1 ? 'it' : 'them'} (merge-tree does not see this)${isListAtT(s) ? '; found by the dry-run at T' : ''}`, isFrozen ? `the sync is frozen, so make no git write; the worker aborts on such a file and ${s.holder.lane} finishes the merge by hand: tell ${s.holder.lane} whether ${paths.length === 1 ? 'it' : 'they'} may be moved out of the tree; never delete a file that may be someone else's` : `before ${hhmm(s.at)}: commit ${paths.length === 1 ? 'it' : 'them'} with exact paths (then it is an ordinary conflict, yours to settle) or move ${paths.length === 1 ? 'it' : 'them'} out of the tree; never delete a file that may be someone else's`),
  holderUntracked: (s: SyncFile, rows: { path: string; owners: string[] }[], isFrozen = false): string =>
    noticeText('Sync main', `${isListAtT(s) ? 'the dry-run at T found that ' : ''}origin/main adds ${plural(rows.length, 'file')} that already ${rows.length === 1 ? 'exists' : 'exist'} untracked in the shared checkout ("untracked would be overwritten"): ${rows.map(r => `${r.path} → ${r.owners.length ? r.owners.join(', ') : 'owner unknown'}`).join('; ')}`, `${isFrozen ? 'the worker aborts on such a file (its rule 4) and hands the sync back to you' : `the owners are told to commit or move theirs before ${hhmm(s.at)}`}; owner unknown → name it in the sync's note and leave it; never delete or overwrite one to get the merge through`),
  holderWithoutMod: (s: SyncFile, rows: { n: NoMod; isDelivered: boolean }[]): string =>
    noticeText('Sync main', `${plural(rows.length, 'live S2 session')} without a5r 0.4 cannot be frozen for the sync at ${hhmm(s.at)}: ${rows.map(r => `${r.n.intent} (session ${r.n.id8}${r.n.branch ? `, ${r.n.branch}` : ''})${r.isDelivered ? '' : ' — the message did not reach it'}`).join('; ')}`, `each got the standard message once; before the merge check that their paths are committed and that they are off git and the Editor; one that is not → move the sync (/a5r sync move HH:MM) or cancel it before ${hhmm(s.at)}`),
  hardEndSoon: (s: SyncFile): string =>
    noticeText('Sync main', `the freeze of the sync at ${hhmm(s.at)} ends at ${hhmm(s.hardEnd)} (its hard end) and the sync is not done`, 'finish it with done or abort before then; at the hard end it expires, git and the Editor open again for every session, and each session is told'),
  expired: (s: SyncFile): string =>
    noticeText('Sync main', `the sync at ${hhmm(s.at)} expired at ${hhmm(s.endedAt ?? s.updatedAt)} without done or abort (${s.note || 'its lease ran out'})`, 'git and the Editor are open again (a merge, revert or cherry-pick left half done in the checkout still blocks git writes: the Merge guard notice names the session that ends it); your work stays as it is; the next sync is planned on the A5R panel'),
  // A83: what A5R raised as a decision mark before 0.17.0 is a plain notice now.
  prAfter: (n: number, slug: string, verdict: string, isMerged: boolean): string => noticeText('Acceptance', `PR #${n} (intent ${slug}) was ${isMerged ? 'merged' : 'opened'} without A5R acceptance and ${verdict}`, isMerged ? 'fix it in a follow-up PR (the A5R card lists what fails), or record in progress.md why it stays' : 'fix it on its branch before it merges (the A5R card lists what fails), or record in progress.md why it merges as it is'),
  // 0.17.1: with its owner alive (A115: opguard.ts ownerOf; before, the last sync's holder) it ends the merge, revert or
  // cherry-pick; else the first live session (queue order) takes it over.
  // Fable review D2 (rev 39): told during a planned sync or its cutoff too (Editor grants wait on it in every phase).
  mergeLeft: ({ head, mtimeMs }: HeadFile, owner: { lane: string } | null, sync: SyncFile | null, phase: Phase, taker: { lane: string; isMe: boolean } | null, checkout: string): string =>
    noticeText('Merge guard', `a ${opOf(head)} is in progress in the shared S2 checkout (.git/${head} since ${hhmm(mtimeMs)})${syncWhere(sync, phase)}`,
      taker === null
        ? `${owner ? owner.lane : 'the session that started it'} ends it (git ${opOf(head)} --abort, or finish it); every other session makes no git write there until .git/${head} is gone`
        : taker.isMe
          ? `${owner ? 'its holder is gone, so ' : ''}this session takes it over: /a5r sync takeover (or the sync tool, action takeover), then ${endOf(head, checkout)}${isOpenPhase(phase) ? '' : '; then plan a new sync'}`
          : `${taker.lane} is asked to take it over and end it; make no git write there until .git/${head} is gone`),
  syncHolderNamed: (s: SyncFile): string => noticeText('Sync main', `you were named holder of the sync at ${hhmm(s.at)} (planned by ${s.plannedBy})`, `at ${hhmm(s.at - CUTOFF_MS)} the cutoff notice reaches every session; at ${hhmm(s.at)} this session's a5r starts the sync worker, which ends the sync with done or abort (at the latest ${hhmm(s.hardEnd)}); keep this session open until then`),
} as const

/** The Merge guard notice's place in the sync's timeline: during an open sync, else after the last one (if any). */
const syncWhere = (sync: SyncFile | null, phase: Phase): string => {
  if (!sync) return ' and no sync is open'
  return isOpenPhase(phase) ? ` during the sync at ${hhmm(sync.at)} by ${sync.holder.lane} (${phase})` : ` and no sync is open (the last sync, ${hhmm(sync.at)} by ${sync.holder.lane}, is ${sync.state})`
}

/** A93 / A96 / A109: what the holder is told as its sync enters a stage (the worker's end) or moves within one (the
 * watch), from the sync and the facts read with it: the build log's last lines, the checkout's git at a hand-back. */
export type TellFacts = { tail: string; busy: GitBusy }
export const SYNC_TELL: Record<StageTell | EntryTell, (s: SyncFile, f: TellFacts) => string> = {
  building: NOTICES.syncBuilding,
  testing: NOTICES.syncTest,
  manual: (s, f) => NOTICES.syncManual(s, f.busy),
  'build-failed': NOTICES.syncBuildFailed,
  'build-unknown': NOTICES.syncBuildUnknown,
  'build-reported': NOTICES.syncBuildReported,
  'build-queued': NOTICES.syncBuildQueued,
  'build-ended': (s, f) => NOTICES.syncBuildEnded(s, f.tail),
  'build-stopped': (s, f) => NOTICES.syncBuildStopped(s, f.tail),
}

/** A113 (Fable review D1): an Editor running in a launch:false pass slot is told again, at most once per 10-min window. */
export const PASS_TELL_MS = 10 * 60_000
/** A113: why a launch:false pass slot may not launch or drive an Editor (a refusal's why), and what to do instead. */
export const passNoLaunch = (head: string, what: string): string => `this slot went before ${head} (first in the queue, waiting for memory) because it was asked with launch: false, and ${what}`
export const PASS_NO_LAUNCH_NEXT = 'do the work that needs no Editor (the build) in this slot; to use an Editor, release and request again without launch: false (the launch gate applies)'
/** A114: the memory note's id prefix; its time follows, so a reload reads when it was last told from `delivered`. */
export const MEMORY_NOTE_ID = 'editor:memory:'
export const noticeIds = {
  granted: (since: number) => `editor:granted:${since}`,
  leaseEnding: (since: number, end: number) => `editor:ending:${since}:${end}`,
  overrun: (since: number, end: number) => `editor:overrun:${since}:${end}`,
  idle: (since: number) => `editor:idle:${since}`,
  yield: (asker: string, at: number) => `editor:yield:${asker}:${at}`,
  recovered: (holder: string, at: number) => `editor:recovered:${holder}:${Math.floor(at / 60_000)}`,
  released: (r: Released) => `editor:released:${r.kind}:${r.since}`,
  nudge: (window: string) => `editor:nudge:${window}`,
  passLaunched: (since: number, now: number) => `editor:pass-launch:${since}:${Math.floor(now / PASS_TELL_MS)}`,
  lockLost: (since: number) => `editor:lock-lost:${since}`,
  resized: (since: number, end: number) => `editor:resized:${since}:${end}`,
  memory: (at: number) => `${MEMORY_NOTE_ID}${at}`,
  goneEditor: (holder: string, pid: number) => `editor:gone:${holder}:${pid}`,
  pieAbort: (n: number) => `ram:pie-abort:${n}`,
  disk: (day: string) => `disk:${day}`,
  cutoff: (s: SyncFile) => `sync:${s.id}:${s.at}:cutoff`,
  releaseBy: (s: SyncFile) => `sync:${s.id}:${s.at}:release`,
  frozen: (s: SyncFile) => `sync:${s.id}:${s.at}:frozen`,
  lifted: (s: SyncFile) => `sync:${s.id}:${s.at}:${s.state}`,
  conflicts: (s: SyncFile, paths: readonly string[]) => `sync:${s.id}:${s.at}:conflicts:${paths.slice().sort().join('|').length}:${hash(paths.slice().sort().join('|'))}`,
  holderNamed: (s: SyncFile) => `sync:${s.id}:named`,
  hardEndSoon: (s: SyncFile) => `sync:${s.id}:${s.at}:hard-end-soon:${s.hardEnd}`,
  withoutMod: (s: SyncFile, ids: readonly string[]) => `sync:${s.id}:${s.at}:without-mod:${hash(ids.slice().sort().join('|'))}`,
  untracked: (s: SyncFile, paths: readonly string[]) => `sync:${s.id}:${s.at}:untracked:${hash(paths.slice().sort().join('|'))}`,
} as const

// ---------- A16: the session overview ----------
/** One row of the client's own session list (`mcp__ccd_session_mgmt__list_sessions`); its id is the client's, not
 * the CLI session id the files use. */
export type ClientRow = { id: string; title: string; cwd: string; isRunning: boolean; lastActivityAt: number; isArchived: boolean }
export const CLIENT_ACTIVE_MS = 30 * 60_000 // a client session active within this counts as running

/** The client's session list, or null when the tool is missing, refused or answered something else. */
export const parseClients = (text: string): ClientRow[] | null => {
  try {
    const v = JSON.parse(text) as unknown
    const rows = Array.isArray(v) ? v : Array.isArray((v as { sessions?: unknown })?.sessions) ? (v as { sessions: unknown[] }).sessions : null
    if (!rows) return null
    return rows
      .map(r => r as Record<string, unknown>)
      .filter(r => typeof r.sessionId === 'string')
      .map(r => ({ id: String(r.sessionId), title: String(r.title ?? ''), cwd: String(r.cwd ?? '').replace(/\\/g, '/'), isRunning: r.isRunning === true, lastActivityAt: Date.parse(String(r.lastActivityAt ?? '')) || 0, isArchived: r.isArchived === true }))
  } catch {
    return null
  }
}

export type NoMod = { sessionId: string; id8: string; intent: string; branch: string }
export type Overview = { active: number | null; s2: number; elsewhere: number | null; intents: [string, number][]; editor: string; waiting: string[]; sync: string; withoutMod: NoMod[] }

/** Live S2 sessions that run without a5r 0.4: a fresh Ather lane with no fresh a5r session file. */
export const withoutModOf = (me8: string, files: readonly SessionFile[], lanes: readonly LaneBeat[], now: number): NoMod[] => {
  const fresh = new Set(files.filter(f => now - f.heartbeatAt <= HEARTBEAT_STALE_MS).map(f => f.id8))
  return lanes
    .filter(l => !l.hasEnded && now - l.mtimeMs <= LANE_STALE_MS)
    .map(l => ({ sessionId: l.sessionId, id8: l.sessionId.slice(0, 8).toLowerCase(), intent: l.intent || 'no intent', branch: l.branch ?? '' }))
    .filter(l => l.id8 !== me8 && !fresh.has(l.id8))
}

/** What the panel says about the sessions on this machine: how many run (the client's list), how many in S2 (Ather's
 * lanes and a5r's files), by intent, who holds or waits for the Editor, who holds the sync, and the live S2
 * sessions without a5r 0.4. */
export const overviewOf = (x: { me8: string; files: readonly SessionFile[]; lanes: readonly LaneBeat[]; clients: readonly ClientRow[] | null; isS2Cwd: (cwd: string) => boolean; lock: LockLine; sync: SyncFile | null; now: number; phase: Phase; manual: ManualOrder; focus: FocusLease | null }): Overview => {
  const { now } = x
  const liveLanes = x.lanes.filter(l => !l.hasEnded && now - l.mtimeMs <= LANE_STALE_MS)
  const ids = new Set<string>([x.me8, ...liveLanes.map(l => l.sessionId.slice(0, 8).toLowerCase()), ...x.files.filter(f => now - f.heartbeatAt <= HEARTBEAT_STALE_MS).map(f => f.id8)].filter(Boolean))
  const intentOf = (id8: string) => liveLanes.find(l => l.sessionId.toLowerCase().startsWith(id8))?.intent || 'no intent'
  const counts = new Map<string, number>()
  for (const id8 of ids) counts.set(intentOf(id8), (counts.get(intentOf(id8)) ?? 0) + 1)
  const active = x.clients?.filter(r => !r.isArchived && (r.isRunning || now - r.lastActivityAt <= CLIENT_ACTIVE_MS)) ?? null
  const laneOf = (id8: string) => x.files.find(f => f.id8 === id8)?.lane ?? id8
  const editor = x.lock.kind === 'free' ? 'free' : x.lock.kind === 'missing' ? 'lock missing' : `${x.lock.lane || 'held'}${x.lock.id8 === x.me8 ? ' (this session)' : ''}`
  return {
    active: active ? active.length + 1 : null, // the list leaves out the session reading it
    s2: ids.size,
    elsewhere: active ? active.filter(r => !x.isS2Cwd(r.cwd)).length : null,
    intents: [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    editor,
    waiting: queueIn(x).map(f => laneOf(f.id8)),
    sync: x.sync && isOpenPhase(x.phase) ? `${x.sync.holder.id8 === x.me8 ? 'this session' : x.sync.holder.lane} ${hhmm(x.sync.at)} ${x.phase}` : 'none',
    withoutMod: withoutModOf(x.me8, x.files, x.lanes, now),
  }
}

/** The overview in one line (the terminal) or the same words wrapped (the desktop). */
export const overviewLine = (o: Overview): string =>
  [
    o.active === null ? `Sessions: S2 ${o.s2} live (client list unavailable)` : `Sessions: ${o.active} active · S2 ${o.s2} · elsewhere ${o.elsewhere ?? 0}`,
    o.intents.length ? `by intent: ${o.intents.map(([i, n]) => `${i} ${n}`).join(', ')}` : '',
    `Editor: ${o.editor}${o.waiting.length ? ` (waiting: ${o.waiting.join(', ')})` : ''}`,
    `Sync: ${o.sync}`,
    o.withoutMod.length ? `without a5r 0.4: ${o.withoutMod.map(n => `${n.intent} (session ${n.id8})`).join(', ')}` : '',
  ]
    .filter(Boolean)
    .join(' · ')

/** A16: the one standard message a live S2 session without a5r 0.4 gets at the cutoff (it cannot be frozen). */
export const noModMessage = (s: SyncFile, checkout: string): string =>
  `Sync main (a5r): ${s.holder.lane} merges origin/main into ${checkout} at ${hhmm(s.at)}. This session runs without a5r 0.4, so nothing freezes it: before ${hhmm(s.at)} commit your own paths (exact paths), write your resume note, stop PIE and release the Editor by ${hhmm(s.at - RELEASE_BEFORE_MS)}; from ${hhmm(s.at)} until the holder is done (at the latest ${hhmm(s.hardEnd)}) make no git writes in that checkout and do not use the Editor.`

/** D7: the sync worker's system prompt, the procedure of runbook-sync-lane and s2-sync-main as A12 fixes it. */
export const SYNC_WORKER_PROMPT = [
  'You are the a5r sync worker for the shared S2 checkout. The sync holder\'s a5r started you at the planned sync time T, in the holder\'s session. Every other session is frozen (no git writes, no Editor) until you end, or until the hard end, when the sync expires and every session is told. You call no a5r tool: the holder\'s a5r took the Editor lock for this sync before it started you, releases it when you end, and reads your final answer to record the sync as done or aborted.',
  'Rules (the checkout\'s AGENTS.md and the user\'s machine profile win over this list):',
  '1. Git never prompts. Run every git command with GIT_TERMINAL_PROMPT=0 and GCM_INTERACTIVE=never in its environment (Bash: `GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never git -C <checkout> …`; PowerShell: set $env:GIT_TERMINAL_PROMPT=\'0\' and $env:GCM_INTERACTIVE=\'never\' first) and a timeout on the tool call: fetch and merge 10 min at most, everything else 2 min. A credential, network or LFS failure is an abort, never a retry loop. Never set GIT_LFS_SKIP_SMUDGE. Run every git command in the foreground, to its end, in one tool call: never with `&`, never as a background tool run, never by Start-Process without -Wait, never from a script you leave running; the build of rule 6 is the only command you start to outlive your turn.',
  '2. Always `git -C <checkout>`. Never rebase, reset --hard, stash, clean, push or switch branches. Your git writes are exactly: `git update-index -q --refresh`, `git merge --no-edit origin/main`, `git merge --abort`, `git checkout --ours|--theirs -- <paths>`, `git add -- <paths>`, `git commit --no-edit`, `git revert -m 1 <merge sha> --no-edit`. If any command is refused, abort the sync with the refusal as the reason.',
  '3. The Editor. Never write Saved/EDITOR_OWNER.txt. Read it before any merge: it must name the holder session given in your task (the sync\'s lock). If it names another lane: never close, kill or drive that Editor; never sleep or poll in a loop (a foreground sleep is refused here); read it once more after the fetch of rule 4 (the sync is first in the queue and is granted the moment it comes free), and if it still names another lane, end with SYNC ABORT naming that lane. If an Editor is open while the lock is the sync\'s (or a FREE line says it was left open): list its dirty packages first with an Unreal MCP read; any dirty package → abort (never save it, never discard it); none → close it gracefully as AGENTS.md says and confirm UnrealEditor.exe is gone.',
  '4. Before the merge: record the pre-merge HEAD (`git -C <checkout> rev-parse HEAD`). Abort if .git/MERGE_HEAD, .git/REVERT_HEAD, .git/CHERRY_PICK_HEAD, .git/REBASE_HEAD or an .git/index.lock older than 10 minutes exists. Fetch: `GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never git -C <checkout> fetch origin main`. Before you judge any path dirty or untracked in the way, run `git -C <checkout> update-index -q --refresh` and read `git status` again: a path git no longer lists after it is clean (a stat-only change), never a reason to abort. If a file origin/main adds still exists untracked in the checkout, abort and name it (its owner was told).',
  '5. Merge: `git merge --no-edit origin/main` (never rebase). The dry-run list in your task may be older than your merge (main can move after it): the merge\'s own unmerged paths (`git diff --name-only --diff-filter=U`) decide, listed or not. For each conflicted path: first the holder\'s conflict rules in your task (the first rule whose pattern matches the path wins): a path a rule matches is resolved with that rule\'s side whatever its kind, .uasset and .umap included: `git checkout --<side> -- <path>` then `git add -- <path>`, and your report names each such path with its rule. A path no rule matches: rule 11 — when origin/main\'s blob for the path (`git rev-parse origin/main:<path>`) equals a blob in this branch\'s history (`git log --format=%H --raw --no-abbrev HEAD -- <path>`), it is a self-conflict: `git checkout --ours -- <path>` then `git add -- <path>`. A text conflict where both sides only add lines: resolve it, check `git diff --check`, `git add -- <path>`. Any other conflict (logic, or any .uasset/.umap): `git merge --abort`, then abort the sync naming each path and its owner from the conflict notice. Then `git commit --no-edit`.',
  '6. Build, only when the sync builds: the holder\'s a5r wrote a build script (it runs Build.bat with the right arguments and writes the build log your task names, fresh, before anything else). Start the build only with the one PowerShell command your task gives, exactly as given (the script carries the engine root your task names: use no engine root of your own), in a tool call of its own with nothing after it (a tool call stopped while it still runs kills what it started); never your own cmd, Build.bat or redirection line (cmd /c strips the quotes of such a line and exits at once, with no log and no build). Then check in later tool calls, within 60 seconds: the build log\'s existence decides whether the build started. A log whose last line says `waiting for existing script to terminate` means it started and waits behind Build.bat\'s lock for another build on this engine: started too. The log exists → end at once with the SYNC MERGED line naming that log: never wait for the build (a build outlives your tool calls). No log after 60 seconds → start it no other way: end with `SYNC MERGED <merge sha> build-log=none` and say in your report that the build did not start, with what you saw (the processes). The holder\'s a5r watches that log for the build\'s own `Result:` line (Build.bat exits 0 on failure), keeps every other session frozen meanwhile, and has the holder run the post-merge tests or revert, or start the script itself.',
  '7. End: never end your turn while a command you started (other than the build of rule 6) still runs, and never end with "waiting" or "until … finishes": wait for each such command in the foreground first. Your final answer is a short report whose last line is exactly one of these lines (nothing after it, no other line starting with SYNC):',
  '   SYNC MERGED <merge sha> build-log=<path of the build log, or none when the sync does not build>',
  '   SYNC ABORT <why, one line> state=<the state the checkout is in: clean at <sha>, merge aborted, reverted <sha>, …>',
  '   The holder\'s a5r takes the first as merged (the freeze holds through the build and the post-merge tests, until the holder calls done); the second hands the sync back to the holder, still frozen, to finish by hand or abort. An ending with no SYNC line while a merge commit sits on top of the pre-merge HEAD is taken as merged too; with no merge commit it is handed back like an abort.',
].join('\n')

/** A79 (rev 28, review 2; 0.16.1): the sync worker's last word, read from the last three non-empty lines of its final
 * answer: a line whose keywords are SYNC DONE or SYNC ABORT in capitals (Markdown marks, backticks, `#` and colons around
 * them dropped), the prompt's own template lines (`<merge sha>`, `<why, one line>`) skipped. A DONE that carries a sha
 * wins over any ABORT there ("SYNC ABORT was not needed" after it is prose); otherwise the last such line. A DONE whose
 * sha cannot be read is still done ("sha unread"); an ABORT without a reason is still an abort. Null: no such line, or
 * prose such as "Sync done: the merge finished". */
export type SyncEnd = { kind: 'done'; sha: string; note: string } | { kind: 'abort'; why: string; note: string } | { kind: 'merged'; sha: string; buildLog: string; note: string }
const SYNC_LINE = /^SYNC[\s*`_:]+(DONE|ABORT|MERGED)\b[\s*`_:]*(.*)$/
const SHA_START = /^([0-9a-f]{7,40})\b/i
export const parseSyncEnd = (answer: string): SyncEnd | null => {
  const tail = (answer ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(-3)
  const lines = tail
    .map(l => l.replace(/^[\s`*#>_:-]+/, '').replace(/[\s`*_]+$/, '').replace(/\s+/g, ' '))
    .filter(l => SYNC_LINE.test(l) && !/<merge sha>|<why, one line>|<pre-merge HEAD>/i.test(l))
    .map(l => {
      const m = SYNC_LINE.exec(l)
      return { kind: m?.[1] ?? '', rest: (m?.[2] ?? '').replace(/[`*]/g, '').trim() }
    })
  const withSha = lines.filter(l => (l.kind === 'DONE' || l.kind === 'MERGED') && SHA_START.test(l.rest)).pop()
  const line = withSha ?? lines[lines.length - 1]
  if (line === undefined) return null
  if (line.kind === 'MERGED') {
    // A93: the merge is in and its build runs in the background, writing the log named by build-log= (none: no build).
    const sha = SHA_START.exec(line.rest)?.[1]?.toLowerCase() ?? ''
    const log = /\bbuild-log=("[^"]+"|'[^']+'|\S+)/i.exec(line.rest)?.[1]?.replace(/^["']|["']$/g, '') ?? ''
    return { kind: 'merged', sha, buildLog: /^(none|-)$/i.test(log) ? '' : log, note: `merged ${sha || '(sha unread)'}${log ? `; build log ${log}` : ''}`.slice(0, 300) }
  }
  if (line.kind === 'DONE') {
    const sha = SHA_START.exec(line.rest)?.[1]?.toLowerCase() ?? ''
    return sha
      ? { kind: 'done', sha, note: `merged ${sha}${line.rest.slice(sha.length).trimEnd()}`.slice(0, 300) }
      : { kind: 'done', sha: '', note: `merged (sha unread)${line.rest ? ` ${line.rest}` : ''}`.slice(0, 300) }
  }
  const why = line.rest.replace(/\s*state=.*$/i, '').trim() || 'no reason given'
  return { kind: 'abort', why, note: (line.rest || why).slice(0, 300) }
}

/** A107: when and against which main the conflict list was made, whether it is stale, and that it may be older than the
 * merge, whose own unmerged paths decide. */
const listLabel = (s: SyncFile): string => {
  const made = s.conflictsAt === null ? 'none made' : `made at ${hhmm(s.conflictsAt)}${s.conflictsSource === 'holder' ? ' by the holder' : ` against origin/main ${s.dry?.main.slice(0, 12) || '(sha unread)'}`}`
  return `That list: ${made}${s.dry?.stale ? `, STALE: ${s.dry.stale}` : ''}. It may be older than your merge: the merge's own unmerged paths (git diff --name-only --diff-filter=U) decide.`
}

/** A109: the task's build line: the log, and the one command that starts the script A5R wrote (rule 6); A110: the engine
 * root the script carries and where A5R found it, or that it found none (then no script). */
const buildLine = (s: SyncFile, checkout: string, engine: EngineFind | null): string =>
  !s.build ? 'no'
    : s.buildRun ? `yes; build log: ${syncBuildLog(checkout, s.id)}; start the build (after the merge commit) only with ${runLabel(s.buildRun)}${engine?.root ? ` (the script builds with the engine root ${engineLabel(engine)}: pass no engine root of your own)` : ''}`
      : `yes, but A5R wrote no build script (${engine?.root === null ? engineLabel(engine) : 'the write failed'}): start no build, and end with SYNC MERGED <merge sha> build-log=none`

/** The task the holder's a5r hands the sync worker: this sync's facts; `engine`: what A5R found for a build sync (A110),
 * null for a sync without a build. */
export const syncWorkerTask = (s: SyncFile, checkout: string, lock: string, engine: EngineFind | null): string =>
  [
    `Run the sync of origin/main planned for ${hhmm(s.at)} in ${checkout} (holder ${s.holder.lane}, session ${s.holder.id8}). Hard end ${hhmm(s.hardEnd)}: end before it with the SYNC MERGED or SYNC ABORT line. Build: ${buildLine(s, checkout, engine)}.`,
    `Holder's conflict rules (rule 5, the first match wins): ${rulesLabel(s.rules)}.`,
    `Dry-run at ${isListAtT(s) ? 'T' : 'the cutoff'}: ${s.conflicts === null ? 'not run' : s.conflicts.length === 0 ? 'no conflicts' : s.conflicts.map(c => conflictLabel(c, s.rules)).join('; ')}.`,
    `Untracked files origin/main adds: ${s.untracked === null ? 'not listed' : s.untracked.length === 0 ? 'none' : s.untracked.join('; ')}.`,
    listLabel(s),
    `Editor lock now: ${lock || 'missing'} (the sync's lock names session ${s.holder.id8}).`,
  ].join('\n')

/** A short stable hash (FNV-1a) for notice ids built from long lists. */
export const hash = (text: string): string => {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

// ---------- A26: the sessions list ----------
/** A session's name from Claude Code's record of it (the `"customTitle"` / `"aiTitle"` lines a search found): the
 * last title the person or the session set, else the last one Claude Code generated. Mirrors Ather's
 * `model.mjs sessionTitle` (read-only; Ather is never changed). */
export const titleFromRecord = (lines: string): string => {
  const rows = lines.split(/\r?\n/)
  const last = (kind: string): string => {
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const m = new RegExp(`"${kind}":"([^"]*)"`).exec(rows[i] ?? '')
      if (m) return m[1] ?? ''
    }
    return ''
  }
  const raw = last('customTitle') || last('aiTitle')
  let title = raw
  try {
    title = JSON.parse(`"${raw}"`) as string
  } catch {
    // an escape the search cut in half: the raw text is close enough
  }
  return title.replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, 60)
}

/** Claude Code's records folder name for a checkout root (e.g. `E:/s2` → `E--s2`). */
export const projectFolder = (root: string): string => root.replace(/[^a-zA-Z0-9]/g, '-')

export type SessionRow = { id8: string; title: string; intent: string; holds: string[]; hasA5R: boolean; isMe: boolean; activeMin: number | null; activeKind: 'active' | 'seen' }
export type SessionsView = { header: string; rows: SessionRow[]; more: number; source: 'app' | 'lanes' }
export const SESSION_ROWS = 6
/** The record title Claude Code keeps is cut to 60 characters (`titleFromRecord`); the app's is whole. */
const titleKey = (s: string | undefined | null): string => oneLine(s).slice(0, 60).trim().toLowerCase()

/** A31: what matches a session to the app's own session list: this session and its title, the session files, the app's
 * list (`clients`, null when it could not be read), which of its folders are the S2 checkout, the record titles. */
export type AppFacts = { me8: string; meTitle: string; files: readonly SessionFile[]; clients: readonly ClientRow[] | null; isS2Cwd: (cwd: string) => boolean; names: ReadonlyMap<string, string>; now: number }

/** A31: a session's row in the app's own list. The app's ids are its own (`local_<uuid>`, MEASURED: not the CLI session ids
 * that Ather's lanes and a5r's files use), so a session is matched by title: its Claude Code record title (`names`) or its
 * a5r file title against the app's current title (first 60 characters). Undefined: no app list (the lanes decide); null:
 * the app does not list it (closed, archived, or not matched). */
export const appRowOf = (x: AppFacts): ((id8: string) => ClientRow | null | undefined) => {
  const appRows = x.clients?.filter(r => !r.isArchived && x.isS2Cwd(r.cwd)) ?? null
  const fresh = x.files.filter(f => x.now - f.heartbeatAt <= HEARTBEAT_STALE_MS)
  return id8 => {
    if (!appRows) return undefined
    const keys = [x.names.get(id8), fresh.find(f => f.id8 === id8)?.title].map(titleKey).filter(Boolean)
    return appRows.find(r => keys.includes(titleKey(r.title))) ?? null
  }
}
/** A116: the app's title of a session ('' when the app does not list it), this one's own title for this session: what names
 * the Editor list's rows and what the person types to name one. */
export const appTitleOf = (x: AppFacts): ((id8: string) => string) => {
  const rowOf = appRowOf(x)
  return id8 => oneLine(id8 === x.me8 ? x.meTitle : rowOf(id8)?.title)
}

/** The sessions list's input: the app match, Ather's lanes, the sync and its phase, and (A116) the Editor list's sessions. */
export type SessionsFacts = AppFacts & { lanes: readonly LaneBeat[]; sync: SyncFile | null; phase: Phase; inEditor: ReadonlySet<string> }

/** A26/A31: the S2 sessions that are open now, as a short named list: this session first (★), then the sync's holder,
 * then the most recently active; at most six rows and how many more. A116: the sessions in the Editor list (`inEditor`:
 * its holder and its queue) are left out, so no session is listed twice.
 *
 * Open means in the app's own session list (`clients`: not archived, in the S2 checkout), matched by appRowOf; a matched
 * session shows the app's current title (a rename shows at once); a session the app does not list is dropped. Without
 * the app's list: live lanes only (fresh, not ended), titled from the record. This session is always listed, titled from
 * the app. */
export const sessionsView = (x: SessionsFacts): SessionsView => {
  const { now } = x
  const liveLanes = x.lanes.filter(l => !l.hasEnded && now - l.mtimeMs <= LANE_STALE_MS)
  const freshFiles = x.files.filter(f => now - f.heartbeatAt <= HEARTBEAT_STALE_MS)
  const appOf = appRowOf(x)
  const candidates = [...new Set<string>([...liveLanes.map(l => l.sessionId.slice(0, 8).toLowerCase()), ...(x.clients ? freshFiles.map(f => f.id8) : [])].filter(id8 => id8 && id8 !== x.me8))]
  const syncOpen = x.sync && isOpenPhase(x.phase) ? x.sync : null
  const rowOf = (id8: string, app: ClientRow | null | undefined): SessionRow => {
    const lane = liveLanes.find(l => l.sessionId.toLowerCase().startsWith(id8))
    const file = freshFiles.find(f => f.id8 === id8)
    const isMe = id8 === x.me8
    const holds = syncOpen && syncOpen.holder.id8 === id8 ? [`sync ${hhmm(syncOpen.at)}`] : []
    const activeAt = lane?.lastActiveAt ?? (app && app.lastActivityAt > 0 ? app.lastActivityAt : null)
    const seenAt = activeAt ?? (isMe ? now : (file?.heartbeatAt ?? lane?.mtimeMs ?? null))
    return {
      id8,
      title: oneLine(isMe ? x.meTitle : app?.title) || oneLine(file?.title) || oneLine(x.names.get(id8)) || id8,
      intent: lane?.intent || 'no intent',
      holds,
      hasA5R: isMe || Boolean(file),
      isMe,
      activeMin: seenAt === null ? null : Math.max(0, Math.round((now - seenAt) / 60_000)),
      activeKind: activeAt !== null || isMe ? 'active' : 'seen',
    }
  }
  const rows = [rowOf(x.me8, null)]
  for (const id8 of candidates) {
    const app = appOf(id8)
    if (app === null) continue // the app does not list it: closed, archived, or not matched
    if (app === undefined && !liveLanes.some(l => l.sessionId.toLowerCase().startsWith(id8))) continue
    rows.push(rowOf(id8, app))
  }
  const listed = rows.filter(r => !x.inEditor.has(r.id8))
  const rank = (r: SessionRow) => (r.isMe ? 0 : r.holds.length > 0 ? 1 : 2)
  listed.sort((a, b) => rank(a) - rank(b) || (a.activeMin ?? 1e9) - (b.activeMin ?? 1e9) || a.id8.localeCompare(b.id8))
  return { header: `Other sessions · ${listed.length}`, rows: listed.slice(0, SESSION_ROWS), more: Math.max(0, listed.length - SESSION_ROWS), source: x.clients ? 'app' : 'lanes' }
}

/** A29: a title on one line: newlines, tabs and runs of spaces become one space; blank stays blank (the row then
 * shows the first 8 hex, never a lone dot). */
export const oneLine = (s: string | undefined | null): string => (s ?? '').replace(/[\u0000-\u001f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim()

/** A31: a row's status, at its end and never cut: what it holds or waits for (else "no a5r", else its intent), then
 * how long ago it was active (`now`, `4m`, `2h`). */
export const sessionStatus = (r: SessionRow): string => {
  const what = r.holds.length ? r.holds : [!r.hasA5R ? 'no a5r' : r.intent]
  if (r.holds.length && !r.hasA5R) what.push('no a5r')
  const age = r.activeMin === null ? '' : r.activeMin < 1 ? 'now' : r.activeMin < 60 ? `${r.activeMin}m` : `${Math.round(r.activeMin / 60)}h`
  return [...what, age].filter(Boolean).join(' · ')
}

// ---------- A44: record titles read through PowerShell keep their characters ----------
/** The pattern of a record's title lines (`"customTitle":"…"`, `"aiTitle":"…"`), as Ather's transcripts.mjs reads them. */
export const TITLE_PATTERN = '"(customTitle|aiTitle)":"[^"]*"'

/** A44: the PowerShell fallback for the title search (the engine finds no `grep` on this machine). PowerShell 5 writes
 * its stdout in the console's OEM code page, so emoji and dashes came back as "?" (MEASURED 2026-10-07:
 * `5️⃣📤+6️⃣🤔📤 S2 sync main — watch …` read back as `5????+6?????? S2 sync main - watch …`); UTF-8 output and a UTF-8
 * read of the file keep them. */
export const titleSearchPs = (path: string): string[] => [
  'powershell',
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  `[Console]::OutputEncoding = [Text.Encoding]::UTF8; Select-String -LiteralPath ${psQuote(path)} -Pattern '${TITLE_PATTERN}' -Encoding UTF8 -AllMatches | ForEach-Object { $_.Matches.Value }`,
]
