// Rev 45 (L-49, L-50): A135-A141. The desktop app ends an idle session's process and a message starts it again, so a request
// outlives its process: it keeps its place (coord.ts queueOf, keepsPlace), its session is started when its turn comes, and
// one live A5R, the conductor, answers for a free Editor while work waits. Pure: no `$`; wakehost.ts reads, writes and sends.
import { HEARTBEAT_STALE_MS, decide, hhmm, keepsPlace, livenessOf, queueIn, ymd, type GrantInput, type LaneBeat, type SessionFile, type Want } from './coord.ts'
import { openQuestion, saysFinished, type TranscriptEvent } from './judge.ts'
import type { LeaseRecord } from './lease.ts'
import { NUDGE_IDLE_MS, saysWaitingForEditor } from './nudge.ts'
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
/** A138: while the engine's loop guard holds, the next send goes this much later. */
export const PAUSE_MS = 15 * MIN
/** A140: a session started for work holds the one slot this long after it answers, unless it asks or holds first. */
export const WORK_SETTLE_MS = 10 * MIN
/** A140: what "still has Editor work" measures: asked or held within this long, not started for it within that long. */
export const WORK_RECENT_MS = 24 * HOUR
export const WORK_AGAIN_MS = 2 * HOUR
/** A140: a conductor's claim older than this is another's to take. */
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
  if (!w || (w.misses === undefined && !w.movedBack)) return w
  const { misses: _m, movedBack: _b, ...rest } = w
  return rest
}
/** A136: a request after a miss goes behind every other request (coord.ts queueOf). `isReal` (nobody answered a send that went,
 * or the app has no such session) counts, and a second such miss withdraws it (null); a miss of the route (a refused send, the
 * engine's loop guard) only moves it: nobody was asked. */
export const afterMiss = (w: Want, isReal: boolean): Want | null => {
  const misses = w.misses ?? 0
  if (isReal && misses >= 1) return null
  if (!isReal && w.movedBack) return w
  return { ...w, movedBack: true, ...(isReal ? { misses: misses + 1 } : {}) }
}

// ---------- A138: how a session is reached ----------
/** One record of the desktop app's own session list (`local_*.json`). */
export type DeskRow = { local: string; cli: string; isArchived: boolean }
export const parseDeskRow = (text: string | null): DeskRow | null => {
  const v = jsonOf<{ sessionId: unknown; cliSessionId: unknown; isArchived: unknown }>(text)
  return typeof v?.sessionId === 'string' && typeof v.cliSessionId === 'string' ? { local: v.sessionId, cli: v.cliSessionId.toLowerCase(), isArchived: v.isArchived === true } : null
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
export const refusalMessage = (r: Refusal): string =>
  `A5R · ${r.kind === 'git' ? 'Git' : 'Sync main'} — what refused you is free now (${r.what}) → run that again and go on; if you no longer need it, do nothing.`
export const workMessage = (freeGb: number | null): string =>
  `A5R · Editor — the Editor is free, nobody is queued (free memory ${freeGb === null ? '?' : freeGb} GB) and your last words leave Editor work open → if you still have it, request it with the editor tool; if not, do nothing.`

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
/** A136 / A138: how long after an attempt a stopped request is tried again. */
export const retryAfter = (w: Want): number => (w.movedBack && !w.misses ? ROUTE_AGAIN_MS : START_AGAIN_MS)

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

// ---------- A140: who still has Editor work ----------
/** Last words that close a session's Editor work: done, nothing pending, or it needs the person (and A69's, judge.ts). */
const FINISHED_WORDS = /\b(done|finished|completed?|shipped|merged|nothing (is )?(pending|left|more)|no (more |further )?(editor )?work|needs? (the person|hai|you|your)|waiting (for|on) (hai|you|the person)|over to you)\b|\bxong\b|hoàn thành/i
const lastWords = (events: readonly TranscriptEvent[]): string | undefined => events.filter(e => e.role === 'assistant' && e.text).pop()?.text
/** A140: whether its own last words finish it, by the A65 judge's own readings (a question open to the person, its work said
 * over) and the words above; words that wait for the Editor do not, whatever came before them; no words at all are unknown, and
 * unknown is finished (nothing is started on a guess). */
export const isFinished = (events: readonly TranscriptEvent[]): boolean => {
  const last = lastWords(events)
  if (!last || openQuestion(events)) return true
  return !saysWaitingForEditor(last) && (saysFinished(last) || FINISHED_WORDS.test(last))
}
/** A140: when this session last asked for or held the Editor (0: never on record). */
export const editorSignAt = (f: SessionFile, leases: readonly LeaseRecord[]): number => Math.max(f.askedAt ?? 0, f.editorUseAt ?? 0, f.holding?.since ?? 0, f.want?.requestedAt ?? 0, ...leases.filter(l => l.id8 === f.id8).map(l => l.endAt))
/** A140: the sessions that may still have Editor work, the most recently active first: not asking, not holding, nothing
 * running, idle (or stopped), active within a day, not archived, and no turn since its request was withdrawn (by the person, by
 * age or by two misses). Whether it was tried within 2 h is the conductor's (wakehost.ts workStep: A141 still counts those). */
export const workPool = (x: { files: readonly SessionFile[]; now: number; archived: ReadonlySet<string> }): SessionFile[] =>
  x.files
    .filter(f => {
      const turn = f.lastTurnAt
      if (f.heartbeatAt === 0 || f.want || f.holding || x.archived.has(f.id8) || turn === undefined || (f.agents ?? 0) > 0) return false
      const idleFor = x.now - turn
      return idleFor <= WORK_RECENT_MS && idleFor >= NUDGE_IDLE_MS && (f.withdrawnAt ?? 0) < turn
    })
    .sort((a, b) => (b.lastTurnAt ?? 0) - (a.lastTurnAt ?? 0))
/** A140: what its last words say, read once per turn. */
export type Words = { isFinished: boolean; waits: boolean }
export const wordsOf = (events: readonly TranscriptEvent[]): Words => ({ isFinished: isFinished(events), waits: saysWaitingForEditor(lastWords(events) ?? '') })
/** A140: whether a session in that pool has work: asked or held within a day (or, A91, its last words wait for the Editor), and
 * its last words do not finish it. */
export const hasWork = (f: SessionFile, leases: readonly LeaseRecord[], words: Words, now: number): boolean => !words.isFinished && (now - editorSignAt(f, leases) <= WORK_RECENT_MS || words.waits)
/** A140: what the conductor knows of one session in the pool. `toldAt`: the last nudge in its inbox; `triedAt`, `answeredAt`:
 * its last start, and its last answer to a start for work; `hasRecord`: the desktop app lists it. */
export type WorkFact = { f: SessionFile; words: Words; toldAt: number; triedAt: number; answeredAt: number; isAlive: boolean; hasRecord: boolean; fits: boolean }
/** A140 / A91 / A141, the whole rule of who is told, who is started and what the free minute counts as. A session with work and:
 * the gates against it: held, nobody is started; started for work and it answered with no request since: it said no, and stays out
 * until it asks or holds again, and so does a live one told that took a turn and did not ask; stopped, tried within 2 h: it waits,
 * and counts while nobody answered; stopped otherwise: started, and the plan ends there (one at a time); live and told within 2 h:
 * counts while it has not asked; live otherwise: told. `again`:
 * A141's one more try, the 2 h aside. */
export const workPlan = (facts: readonly WorkFact[], x: { now: number; leases: readonly LeaseRecord[]; again: boolean; nameOf: (f: SessionFile) => string }): { tell: SessionFile[]; start: SessionFile | null; held: string | null } => {
  const tell: SessionFile[] = []
  let held: string | null = null
  for (const w of facts) {
    const said = Math.max(w.answeredAt, (w.f.lastTurnAt ?? 0) > w.toldAt ? w.toldAt : 0)
    if (!hasWork(w.f, x.leases, w.words, x.now) || (said > 0 && editorSignAt(w.f, x.leases) < said)) continue
    const name = x.nameOf(w.f)
    if (!w.fits) return { tell, start: null, held: `${name} has work, but the Editor's gates hold it` }
    const isTried = x.now - w.triedAt < WORK_AGAIN_MS && !x.again
    if (w.isAlive) {
      if (x.now - w.toldAt < WORK_AGAIN_MS && !x.again) held ??= `${name} was told and has not asked yet`
      else tell.push(w.f)
    } else if (w.hasRecord) {
      if (!isTried) return { tell, start: w.f, held }
      if (w.answeredAt < w.triedAt) held ??= `${name} has work and did not answer at ${hhmm(w.triedAt)}`
    }
  }
  return { tell, start: null, held: held ?? (tell[0] ? `${x.nameOf(tell[0])} was told and has not asked yet` : null) }
}
/** A140: the Editor's gates for a session with no request: a stand-in slot of 30 min without PIE meets what decide checks. */
export const workFits = (x: GrantInput, f: SessionFile): boolean => {
  const want: Want = { minutes: 30, pie: false, build: false, what: 'Editor work', mode: 'unattended', pausable: true, nextSafe: '', requestedAt: x.now }
  return decide({ ...x, me8: f.id8, files: x.files.map(o => (o.id8 === f.id8 ? { ...o, want } : o)) }).kind === 'grant'
}

// ---------- A136-A141: what the conductor keeps (Saved/A5R/wake.json, its one writer) ----------
export type WakeWhy = 'turn' | 'git' | 'freeze' | 'work'
export type WakeOutcome = 'answered' | 'no-answer' | 'no-address' | 'loop-paused'
/** `refused`: what the send reported (the heartbeat still decides); `answeredAt`: a session started for work that came up. */
export type Start = { id8: string; lane: string; why: WakeWhy; at: number; requestedAt: number | null; refused?: string; answeredAt?: number }
export type WakeRow = { at: number; id8: string; lane: string; why: WakeWhy; outcome: WakeOutcome }
/** `triedAt`: when each session was last tried, whatever for: the one record of attempts; `answeredAt`: when it last answered a
 * start for work (A140: it said no until it asks). */
export type WakeFile = { v: 1; current: Start | null; recent: WakeRow[]; triedAt: Record<string, number>; answeredAt: Record<string, number>; pausedUntil: number; pausedSince: number; pausedBy?: string; lastFailure?: string }
export const NO_WAKE: WakeFile = { v: 1, current: null, recent: [], triedAt: {}, answeredAt: {}, pausedUntil: 0, pausedSince: 0 }
/** A139 / A141: what status.json says of them. */
export type WakeStatus = { stopped: number; idleWithWork: { run: number; days: Record<string, number>; nights: Record<string, number> }; starting: { lane: string; id8: string; why: WakeWhy; at: number } | null; pausedUntil: number | null }
export const RECENT_KEEP = 40
export const parseWake = (text: string | null): WakeFile => {
  const v = jsonOf<WakeFile>(text)
  return v ? { v: 1, current: v.current && typeof v.current.id8 === 'string' && typeof v.current.at === 'number' ? v.current : null, recent: Array.isArray(v.recent) ? v.recent.filter(r => r && typeof r.at === 'number') : [], triedAt: v.triedAt && typeof v.triedAt === 'object' ? v.triedAt : {}, answeredAt: v.answeredAt && typeof v.answeredAt === 'object' ? v.answeredAt : {}, pausedUntil: typeof v.pausedUntil === 'number' ? v.pausedUntil : 0, pausedSince: typeof v.pausedSince === 'number' ? v.pausedSince : 0, ...(typeof v.pausedBy === 'string' ? { pausedBy: v.pausedBy } : {}), ...(typeof v.lastFailure === 'string' ? { lastFailure: v.lastFailure } : {}) } : NO_WAKE
}
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
const WHY_WORDS: Record<WakeWhy, string> = { turn: 'its turn', git: 'git free', freeze: 'freeze lifted', work: 'Editor work' }
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
