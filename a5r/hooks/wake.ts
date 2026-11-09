// Rev 45 (L-49, L-50): A135-A141. The desktop app ends an idle session's process and a message starts it again, so a request
// outlives its process: it keeps its place (coord.ts queueOf, keepsPlace), its session is started when its turn comes, and
// one live A5R, the conductor, sends those starts one at a time, on facts: a request or a refusal on file. Who else still has
// work is not judged here (A140). Pure: no `$`; wakehost.ts reads, writes and sends.
import { HEARTBEAT_STALE_MS, decide, hhmm, keepsPlace, livenessOf, queueIn, ymd, type GrantInput, type LaneBeat, type SessionFile, type Want } from './coord.ts'
import type { LeaseRecord } from './lease.ts'
import type { Need } from './syncplan.ts'

const MIN = 60_000
const HOUR = 60 * MIN
export const WAKE_FILE = 'wake.json'
export const IDLE_FILE = 'idle-with-work.json'
export const CONDUCTOR_FILE = 'conductor.json'
export const REFUSED_DIR = 'refused'
/** A136: how long a started session has to answer (a heartbeat newer than the start). */
export const WAKE_ANSWER_MS = 5 * MIN
/** A136: a request's start is tried again after this (a process that answered and stopped again can be started again). */
export const START_AGAIN_MS = 10 * MIN
/** A138: after a miss of the route (a refused send) it is tried this seldom, to keep sends low. */
export const ROUTE_AGAIN_MS = HOUR
/** A138: a loop pause lasts until the conductor's person types in it, or this long; one probe per this, no sooner. */
export const PAUSE_MS = HOUR
/** A136: refused sends after the first that a request may spend; then it rests for PARK_MS. */
export const REFUSED_RETRIES = 2
export const PARK_MS = 24 * HOUR
/** A138, the night's budget, over 12 h: refused sends with no answer between them that stop every send (the route looks broken),
 * and attempts after which what is left is kept for Editor turns. MEASURED in the engine (2.1.309, maxSelfHops): 10 forwards per
 * prompt of the sending session, then `loop-paused`. */
export const SEND_WINDOW_MS = 12 * HOUR
export const REFUSED_MAX = 8
export const SPARE_FROM = 6
/** MEASURED in the app (4.4212, wakeWaitsForPerson): at this many wakes since its person typed the app holds a session for its person. */
export const APP_WAKE_CAP = 10
/** The conductor keeps each session's last attempt this long (the longest wait before a retry is ROUTE_AGAIN_MS). */
export const TRIED_KEEP_MS = 2 * HOUR
/** A136: how long it keeps when a session was last started for its turn (Fable 9 reads the lease it then took). */
export const TURN_KEEP_MS = 48 * HOUR
/** A conductor's claim older than this is another's to take. */
export const CONDUCTOR_STALE_MS = 3 * MIN
/** A141: this many minutes in a row raise the alarm. */
export const IDLE_ALARM_MIN = 30
/** A137: a refusal older than this is forgotten. */
export const REFUSAL_KEEP_MS = 48 * HOUR

/** JSON of a shared file, or null when it is not. */
const jsonOf = <T>(text: string | null): Partial<T> | null => {
  try {
    return JSON.parse(text ?? '') as Partial<T> | null
  } catch {
    return null
  }
}

// ---------- A135: the stopped request ----------
/** A135: the session's process is gone and its request still stands: it will be started when its turn comes. */
export const isStopped = (f: SessionFile, files: readonly SessionFile[], lanes: readonly LaneBeat[], now: number): boolean => Boolean(f.want && keepsPlace(f.want, now)) && !f.holding && livenessOf(f.id8, files, lanes, now) !== 'alive'
/** A136: its own A5R, running again: an answer ends what its misses said. */
export const answered = (w: Want | null): Want | null => {
  if (!w || (w.misses === undefined && !w.movedBack && w.routeMisses === undefined && w.parkedUntil === undefined)) return w
  const { misses: _m, movedBack: _b, routeMisses: _r, parkedUntil: _p, ...rest } = w
  return rest
}
/** What one start came to, for its request. `real`: nobody answered a send that went, or the app has no such session. `refused`:
 * the send was refused and nobody answered. `moved`: nothing went (the engine's guard, the budget, a conductor that cannot send, a
 * session the app holds for its person). */
export type MissKind = 'real' | 'refused' | 'moved'
/** A136: a request after a miss goes behind every other request (coord.ts queueOf). A real miss counts, and a second one withdraws it
 * (null); a refused send after a real miss is a real miss. A refused send alone moves it, tried again hourly (retryAfter), and past
 * REFUSED_RETRIES it rests for PARK_MS. A `moved` one spends nothing: nobody was asked. */
export const afterMiss = (w: Want, kind: MissKind, now: number): Want | null => {
  const misses = w.misses ?? 0
  if (kind === 'moved') return w.movedBack ? w : { ...w, movedBack: true }
  if (misses >= 1) return null
  if (kind === 'real') return { ...w, movedBack: true, misses: 1 }
  const routeMisses = (w.routeMisses ?? 0) + 1
  return { ...w, movedBack: true, routeMisses, ...(routeMisses > REFUSED_RETRIES ? { parkedUntil: now + PARK_MS } : {}) }
}

// ---------- A138: how a session is reached ----------
/** One record of the desktop app's own session list (`local_*.json`). */
export type DeskRow = { local: string; cli: string; isArchived: boolean; wakes: number; isHeldForPerson: boolean }
export const parseDeskRow = (text: string | null): DeskRow | null => {
  const v = jsonOf<{ sessionId: unknown; cliSessionId: unknown; isArchived: unknown; sideSessionWakesSinceUserMessage: unknown; stoppedUntilPersonSends: unknown }>(text)
  if (typeof v?.sessionId !== 'string' || typeof v.cliSessionId !== 'string') return null
  const wakes = typeof v.sideSessionWakesSinceUserMessage === 'number' ? v.sideSessionWakesSinceUserMessage : 0
  return { local: v.sessionId, cli: v.cliSessionId.toLowerCase(), isArchived: v.isArchived === true, wakes, isHeldForPerson: wakes >= APP_WAKE_CAP || Boolean(v.stoppedUntilPersonSends) }
}
/** The folder of those records on this machine, from the engine's own environment; null outside the desktop app. */
export const deskDir = (appData: string | undefined, account: string | undefined, org: string | undefined): string | null => (appData && account && org ? `${appData.replace(/\\/g, '/')}/Claude/claude-code-sessions/${account}/${org}` : null)

/** What one send came to. `refused` may still start the session (MEASURED: a send that reported no start did start one), so
 * only the heartbeat decides; `loop-paused` is the engine's guard: nothing was sent and nothing goes around it. */
export type SendResult = { kind: 'sent' } | { kind: 'refused'; reason: string } | { kind: 'loop-paused'; reason: string }
/** A138: THE route, in one place: the SendMessage tool with the desktop's `local_` id (it forwards to the app, whose message
 * starts a stopped process, under the engine's own loop guard). Changing the route is changing this and readSend. */
export const sendInput = (address: string, text: string): Record<string, unknown> => ({ tool: 'SendMessage', to: address, message: text, summary: 'A5R starts this session' })
const LOOP_PAUSED = /already messaged Claude Desktop sessions|Paused until your user/i
export const readSend = (ran: { deny?: string; text?: string } | null): SendResult => {
  const v = jsonOf<{ success: unknown; message: unknown }>(ran?.text ?? null)
  if (v?.success === true && ran?.deny === undefined) return { kind: 'sent' }
  const reason = ran === null ? 'the tool call failed' : (ran.deny ?? (v ? String(v.message ?? 'no reason given') : ran.text || 'no answer from the tool'))
  return LOOP_PAUSED.test(`${ran?.deny ?? ''} ${ran?.text ?? ''}`) ? { kind: 'loop-paused', reason } : { kind: 'refused', reason } // the guard's words on any channel
}
/** A141's cause while the guard holds. Exact words: the person's next message there is what lifts it. */
export const pausedCause = (session: string): string => `paused until you type in ${session}`

// ---------- the messages ----------
export const turnMessage = (w: Want, minutes: number, now: number): string =>
  `A5R · Editor — your turn has come: ${w.what} (${minutes} min). Your lease starts when this session answers and ends about ${hhmm(now + minutes * MIN)} → go on with that work; if you no longer need it, release it with the editor tool and request again when you do.`
/** A146: the start of a sync's holder whose process stopped before its sync (the sync goes on if it answers). */
export const syncMessage = (s: { id: string; at: number }): string =>
  `A5R · Sync main — you hold the sync of main at ${hhmm(s.at)} (${s.id}) and your session had stopped → answer now and stay on: your A5R starts the sync worker at ${hhmm(s.at)}; if you cannot hold it, hand it over or cancel it with the sync tool.`
export const refusalMessage = (r: Refusal): string =>
  `A5R · ${r.kind === 'git' ? 'Git' : 'Sync main'} — what refused you is free now (${r.what}) → run that again and go on; if you no longer need it, do nothing.`

// ---------- A136: whose turn it is ----------
/** The stopped session whose turn it is: the first in the queue that every check decide makes for it (the lock, a sync, a Focus,
 * a merge in progress, the launch gate) would grant now, with no live request ahead of it; waiting only for memory it is not
 * started, and it blocks nobody meanwhile. `skip`: archived, or tried in this window. */
export const turnToStart = (x: GrantInput, skip: (f: SessionFile) => boolean): SessionFile | null => {
  const skipped = new Set<string>()
  for (const f of queueIn(x)) {
    if (!isStopped(f, x.files, x.lanes, x.now)) return null
    if (skip(f)) skipped.add(f.id8)
    else if (decide({ ...x, me8: f.id8, files: x.files.filter(o => !skipped.has(o.id8)) }).kind === 'grant') return f
  }
  return null
}
/** A136 / A138: how long after an attempt a stopped request is tried again: never faster than hourly after a miss of the route. */
export const retryAfter = (w: Want): number => (w.movedBack && !w.misses ? ROUTE_AGAIN_MS : START_AGAIN_MS)
/** A136: whether a stopped request rests now: parked, or tried too lately (`again`: A141's one more try, that aside). */
export const isResting = (w: Want, triedAt: number, now: number, again = false): boolean => (w.parkedUntil ?? 0) > now || (!again && now - triedAt < retryAfter(w))

// ---------- A137: what else a stopped session waits on ----------
/** Saved/A5R/refused/<id8>.json, written by the refused session itself. */
export type Refusal = { v: 1; id8: string; kind: 'git' | 'freeze'; at: number; what: string; needs?: Need[] }
export const parseRefusal = (text: string | null): Refusal | null => {
  const v = jsonOf<Refusal>(text)
  return v && typeof v.id8 === 'string' && typeof v.at === 'number' && (v.kind === 'git' || v.kind === 'freeze') ? { v: 1, id8: v.id8, kind: v.kind, at: v.at, what: String(v.what ?? ''), ...(Array.isArray(v.needs) ? { needs: v.needs as Need[] } : {}) } : null
}
/** The refusals to act on in order: oldest first, not too old, of a session whose process has since stopped. */
export const stoppedRefusals = <R extends Refusal>(rs: readonly R[], files: readonly SessionFile[], lanes: readonly LaneBeat[], now: number): R[] =>
  rs.filter(r => now - r.at < REFUSAL_KEEP_MS && files.some(f => f.id8 === r.id8 && f.heartbeatAt > 0) && livenessOf(r.id8, files, lanes, now) !== 'alive').sort((a, b) => a.at - b.at || a.id8.localeCompare(b.id8))

/** A136: the lease a session started for its turn took since: `idle` when it ended released as idle with no Editor use. */
export const leaseSince = (leases: readonly LeaseRecord[], id8: string, at: number): 'idle' | 'used' | null => {
  const l = leases.filter(r => r.id8 === id8 && r.grantedAt >= at).pop()
  return !l ? null : l.endReason === 'idle' && l.firstEditorSeenAt === null ? 'idle' : 'used'
}

// ---------- A136-A141: what the conductor keeps (Saved/A5R/wake.json, its one writer) ----------
export type WakeWhy = 'turn' | 'git' | 'freeze' | 'sync'
export type WakeOutcome = 'answered' | 'no-answer' | 'no-address' | 'loop-paused'
/** `refused`: what the send reported (the heartbeat still decides). */
export type Start = { id8: string; lane: string; why: WakeWhy; at: number; requestedAt: number | null; refused?: string }
/** A start that went, once settled: answered (a heartbeat newer than it), no answer after WAKE_ANSWER_MS, or null while it is
 * still waited for. */
export const startOutcome = (s: { id8: string; at: number }, files: readonly SessionFile[], now: number): 'answered' | 'no-answer' | null =>
  files.some(f => f.id8 === s.id8 && f.heartbeatAt > s.at) ? 'answered' : now - s.at >= WAKE_ANSWER_MS ? 'no-answer' : null
/** A146: the one start of a sync's holder, in a slot of its own beside the start in flight (`current`): the sync's id, whether a
 * send went (false: nothing could go, the old rule applies) and, once settled, its outcome. */
export type SyncWake = Start & { id: string; sent: boolean; outcome?: WakeOutcome }
export type WakeRow = { at: number; id8: string; lane: string; why: WakeWhy; outcome: WakeOutcome }
/** `triedAt`: when each session was last tried, whatever for: the one record of attempts. `spent`: the night's attempts (A138's
 * budget). `turnAt`, `idleStarts`: when each was last started for its turn, and how many of
 * those leases in a row ended idle (A136). `pausedBy`, `pausedId`: the name to type in, and its session. */
export type WakeFile = { v: 1; current: Start | null; recent: WakeRow[]; triedAt: Record<string, number>; turnAt: Record<string, number>; idleStarts: Record<string, number>; spent: { at: number; refused?: true }[]; pausedUntil: number; pausedSince: number; pausedBy?: string; pausedId?: string; lastFailure?: string; syncWake?: SyncWake }
export const NO_WAKE: WakeFile = { v: 1, current: null, recent: [], triedAt: {}, turnAt: {}, idleStarts: {}, spent: [], pausedUntil: 0, pausedSince: 0 }
/** A138: why the night's budget holds this send (null: it does not). */
export const budgetHold = (w: WakeFile, why: WakeWhy, now: number): string | null => {
  const spent = w.spent.filter(s => now - s.at < SEND_WINDOW_MS)
  const refused = spent.filter(s => s.refused).length
  if (refused >= REFUSED_MAX) return `${refused} sends refused with no answer: the route looks broken, nothing more goes until a session answers`
  return why !== 'turn' && why !== 'sync' && spent.length >= SPARE_FROM ? `${spent.length} sends tonight: what is left is kept for Editor turns` : null
}
/** A139 / A141: what status.json says of them. */
export type WakeStatus = { stopped: number; idleWithWork: { run: number; days: Record<string, number>; nights: Record<string, number> }; starting: { lane: string; id8: string; why: WakeWhy; at: number } | null; pausedUntil: number | null }
export const RECENT_KEEP = 40
export const parseWake = (text: string | null): WakeFile => {
  const v = jsonOf<WakeFile>(text)
  if (!v) return NO_WAKE
  const syncWake = syncWakeOf(v.syncWake)
  const map = (m: unknown): Record<string, number> => (m && typeof m === 'object' ? (m as Record<string, number>) : {})
  const word = (k: 'pausedBy' | 'pausedId' | 'lastFailure') => (typeof v[k] === 'string' ? { [k]: v[k] } : {})
  return {
    v: 1,
    current: v.current && typeof v.current.id8 === 'string' && typeof v.current.at === 'number' ? v.current : null,
    recent: Array.isArray(v.recent) ? v.recent.filter(r => r && typeof r.at === 'number') : [],
    triedAt: map(v.triedAt),
    turnAt: map(v.turnAt),
    idleStarts: map(v.idleStarts),
    spent: Array.isArray(v.spent) ? v.spent.filter(s => s && typeof s.at === 'number') : [],
    pausedUntil: typeof v.pausedUntil === 'number' ? v.pausedUntil : 0,
    pausedSince: typeof v.pausedSince === 'number' ? v.pausedSince : 0,
    ...word('pausedBy'),
    ...word('pausedId'),
    ...word('lastFailure'),
    ...(syncWake ? { syncWake } : {}),
  }
}
const OUTCOMES: readonly string[] = ['answered', 'no-answer', 'no-address', 'loop-paused'] satisfies WakeOutcome[]
/** A stored sync start, checked field by field (null when it is not one: an `id8` is needed to see its answer). */
const syncWakeOf = (v: Partial<SyncWake> | undefined): SyncWake | null =>
  v && typeof v.id === 'string' && typeof v.at === 'number' && typeof v.id8 === 'string' && v.id8 !== '' && typeof v.lane === 'string'
    ? { id8: v.id8, lane: v.lane, why: 'sync', at: v.at, requestedAt: null, id: v.id, sent: v.sent === true, ...(OUTCOMES.includes(String(v.outcome)) ? { outcome: v.outcome as WakeOutcome } : {}) }
    : null
export const withRow = (w: WakeFile, row: WakeRow): WakeFile => ({ ...w, recent: [...w.recent, row].slice(-RECENT_KEEP) })
/** The next conductor: the first live A5R that conducts, those that can start a session (in the desktop app) first, then by id. */
export const conductorOf = (files: readonly SessionFile[], now: number): string | null =>
  files.filter(f => f.conducts === true && now - f.heartbeatAt <= HEARTBEAT_STALE_MS).sort((a, b) => Number(b.sends === true) - Number(a.sends === true) || a.id8.localeCompare(b.id8))[0]?.id8 ?? null
export const parseConductor = (text: string | null): { id8: string; at: number } | null => {
  const v = jsonOf<{ id8: unknown; at: unknown }>(text)
  return v && typeof v.id8 === 'string' && typeof v.at === 'number' ? { id8: v.id8, at: v.at } : null
}
/** The claim is sticky: a fresh one's holder conducts on, so a session waking up never takes over (nor starts a new loop count);
 * with none, one gone stale, or a holder that cannot start a session while the next one can, the next one takes it. */
export const mayConduct = (me8: string, next: string | null, claim: { id8: string; at: number } | null, now: number, yields = false): boolean => (claim && now - claim.at < CONDUCTOR_STALE_MS && !yields ? claim.id8 === me8 : next === me8)

// ---------- A141: the count and the alarm (Saved/A5R/idle-with-work.json) ----------
export type IdleFile = { v: 1; days: Record<string, number>; nights: Record<string, number>; run: number; lastAt: number; freeSince: number; alarmed: boolean }
export const NO_IDLE: IdleFile = { v: 1, days: {}, nights: {}, run: 0, lastAt: 0, freeSince: 0, alarmed: false }
const KEEP_DAYS = 14
export const parseIdle = (text: string | null): IdleFile => {
  const v = jsonOf<IdleFile>(text)
  return !v ? NO_IDLE : { v: 1, days: v.days ?? {}, nights: v.nights ?? {}, run: typeof v.run === 'number' ? v.run : 0, lastAt: typeof v.lastAt === 'number' ? v.lastAt : 0, freeSince: typeof v.freeSince === 'number' ? v.freeSince : 0, alarmed: v.alarmed === true }
}
/** The night a moment belongs to, named by the evening it started: 20:00 to 08:00; null by day. */
export const nightOf = (at: number): string | null => {
  const d = new Date(at)
  if (d.getHours() >= 20) return ymd(at)
  return d.getHours() < 8 ? ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 12).getTime()) : null
}
const trimmed = (m: Record<string, number>): Record<string, number> => Object.fromEntries(Object.entries(m).sort().slice(-KEEP_DAYS))
/** One conductor's minute: free (and nothing claims the Editor), and whether work waits. Minutes count once each; a run counts
 * minutes in a row (with no conductor for over 2 min there is nobody to count: the run starts over). */
export const nextIdle = (i: IdleFile, x: { isFree: boolean; hasWork: boolean; now: number }): IdleFile => {
  if (Math.floor(i.lastAt / MIN) === Math.floor(x.now / MIN)) return i
  const isIdleMin = x.isFree && x.hasWork
  const isRow = x.now - i.lastAt <= 2 * MIN
  const night = nightOf(x.now)
  const day = ymd(x.now)
  const run = isIdleMin ? (isRow ? i.run : 0) + 1 : 0
  return {
    v: 1,
    days: isIdleMin ? trimmed({ ...i.days, [day]: (i.days[day] ?? 0) + 1 }) : i.days,
    nights: isIdleMin && night ? trimmed({ ...i.nights, [night]: (i.nights[night] ?? 0) + 1 }) : i.nights,
    run,
    lastAt: x.now,
    freeSince: x.isFree ? (i.freeSince && isRow ? i.freeSince : x.now) : 0,
    alarmed: run > 0 && i.alarmed,
  }
}
export const isAlarmDue = (i: IdleFile): boolean => i.run >= IDLE_ALARM_MIN && !i.alarmed
export const alarmText = (minutes: number, cause: string): string => `A5R: ${minutes > 0 ? `the Editor has stood free ${minutes} min with work waiting` : 'work is waiting for the Editor'}: ${cause}`

// ---------- A139 / A141: what the panel, status.json and /a5r say ----------
/** The panel's line: the Editor free 30 min or more with nobody queued, and the idle-with-work minutes of today and last night. */
export const idleLine = (i: IdleFile, x: { now: number; queued: number; isFree: boolean }): string => {
  const today = i.days[ymd(x.now)] ?? 0
  const hour = new Date(x.now).getHours()
  const lastNight = nightOf(hour >= 20 ? x.now - 24 * HOUR : hour < 8 ? x.now : x.now - 12 * HOUR)
  const night = lastNight ? (i.nights[lastNight] ?? 0) : 0
  const freeMin = x.isFree && i.freeSince ? Math.floor((x.now - i.freeSince) / MIN) : 0
  return [...(freeMin >= IDLE_ALARM_MIN && x.queued === 0 ? [`free ${freeMin} min, nobody queued`] : []), ...(today + night > 0 ? [`idle with work: ${today} min today, ${night} min last night`] : [])].join(' · ')
}
/** A135 / Fable 5: live sessions on an A5R before 0.28.0: they still withdraw stopped requests at 2 h, and do not conduct. */
export const oldLine = (files: readonly SessionFile[], now: number): string => {
  const old = files.filter(f => f.conducts !== true && now - f.heartbeatAt <= HEARTBEAT_STALE_MS).map(f => f.lane)
  return old.length > 0 ? `older A5R in ${old.join(', ')}: reload them (they withdraw stopped requests at 2 h)` : ''
}
const WHY_WORDS: Record<WakeWhy, string> = { turn: 'its turn', git: 'git free', freeze: 'freeze lifted', sync: 'its sync' }
/** A139: what ran and what was started last night (the night running at `now` before 08:00, else the one that ended that morning); '' when nothing did. */
export const nightLine = (w: WakeFile, leases: readonly LeaseRecord[], now: number): string => {
  const end = new Date(now)
  if (end.getHours() >= 8) end.setHours(8, 0, 0, 0)
  const to = end.getHours() < 8 ? now : end.getTime()
  const from = new Date(to - 12 * HOUR)
  if (end.getHours() < 8) from.setHours(20, 0, 0, 0)
  const at = from.getTime()
  const ran = [...new Set(leases.filter(l => l.grantedAt >= at && l.grantedAt < to).map(l => l.lane))]
  const started = w.recent.filter(r => r.at >= at && r.at < to).map(r => `${r.lane} (${WHY_WORDS[r.why]}, ${r.outcome})`)
  return ran.length + started.length === 0 ? '' : `Last night: ran ${ran.join(', ') || 'nothing'}; started ${started.join(', ') || 'nobody'}.`
}
