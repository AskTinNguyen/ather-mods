// Rev 45 (L-49, L-50): A135-A141. The desktop app ends an idle session's process and a message starts it again, so a request
// outlives its process: it keeps its place (coord.ts queueOf, keepsPlace), its session is started when its turn comes, and
// one live A5R, the conductor, answers for a free Editor while work waits. Pure: no `$`; wakehost.ts reads, writes and sends.
import { decide, hhmm, keepsPlace, livenessOf, queueIn, ymd, type GrantInput, type LaneBeat, type SessionFile, type Want } from './coord.ts'
import { hintOf, type TranscriptEvent } from './judge.ts'
import type { LeaseRecord } from './lease.ts'
import { isIdle, idleMsOf, saysWaitingForEditor } from './nudge.ts'
import type { Need } from './syncplan.ts'

const MIN = 60_000
const HOUR = 60 * MIN
export const WAKE_FILE = 'wake.json'
export const IDLE_FILE = 'idle-with-work.json'
export const CONDUCTOR_FILE = 'conductor.json'
export const REFUSED_DIR = 'refused'
/** A136: how long a started session has to answer (a heartbeat newer than the start). */
export const WAKE_ANSWER_MS = 5 * MIN
/** A140: what "still has Editor work" measures: asked or held within this long, not started for it within that long. */
export const WORK_RECENT_MS = 24 * HOUR
export const WORK_AGAIN_MS = 2 * HOUR
/** A140: a conductor's claim older than this is another's to take. */
export const CONDUCTOR_STALE_MS = 3 * MIN
/** A141: this many minutes in a row raise the alarm. */
export const IDLE_ALARM_MIN = 30
/** A137: a refusal older than this is forgotten. */
export const REFUSAL_KEEP_MS = 48 * HOUR

// ---------- A135: the stopped request ----------
/** A135: the session's process is gone and its request still stands: it will be started when its turn comes. */
export const isStopped = (f: SessionFile, files: readonly SessionFile[], lanes: readonly LaneBeat[], now: number): boolean => Boolean(f.want && keepsPlace(f.want, now)) && !f.holding && livenessOf(f.id8, files, lanes, now) !== 'alive'
export const STOPPED_WORDS = 'stopped: will be started when its turn comes'
/** A136: a request after its first miss: back behind the next one, at most once. A second miss withdraws it (null). */
export const afterMiss = (w: Want, nextAskedAt: number | null, canWithdraw: boolean): Want | null => {
  const misses = w.misses ?? 0
  if (misses >= 1) return canWithdraw ? null : w
  return { ...w, misses: 1, ...(nextAskedAt === null ? {} : { requestedAt: Math.max(w.requestedAt, nextAskedAt + 1) }) }
}

// ---------- A138: how a session is reached ----------
/** One record of the desktop app's own session list (`local_*.json`). */
export type DeskRow = { local: string; cli: string; title: string; isArchived: boolean }
export const parseDeskRow = (text: string | null): DeskRow | null => {
  try {
    const v = JSON.parse(text ?? '') as { sessionId?: unknown; cliSessionId?: unknown; title?: unknown; isArchived?: unknown }
    return typeof v.sessionId === 'string' && typeof v.cliSessionId === 'string' ? { local: v.sessionId, cli: v.cliSessionId.toLowerCase(), title: String(v.title ?? ''), isArchived: v.isArchived === true } : null
  } catch {
    return null
  }
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
  if (!ran) return { kind: 'refused', reason: 'the tool call failed' }
  if (ran.deny !== undefined) return { kind: 'refused', reason: ran.deny }
  try {
    const v = JSON.parse(ran.text ?? '') as { success?: unknown; message?: unknown }
    if (v.success === true) return { kind: 'sent' }
    const reason = String(v.message ?? 'no reason given')
    return LOOP_PAUSED.test(reason) ? { kind: 'loop-paused', reason } : { kind: 'refused', reason }
  } catch {
    return { kind: 'refused', reason: ran.text || 'no answer from the tool' }
  }
}
/** A141's cause while the guard holds. Exact words: the person's next message there is what lifts it. */
export const pausedCause = (session: string): string => `paused until you type in ${session}`

// ---------- the messages ----------
export const turnMessage = (w: Want, minutes: number, now: number): string =>
  `A5R · Editor — your turn has come: ${w.what} (${minutes} min). Your lease starts when this session answers and ends about ${hhmm(now + minutes * MIN)} → go on with that work; request again if you no longer need it now (the editor tool's release gives your place up).`
export const refusalMessage = (r: Refusal): string =>
  `A5R · ${r.kind === 'git' ? 'Git' : 'Sync main'} — what refused you is free now (${r.what}) → run that again and go on; if you no longer need it, do nothing.`
export const workMessage = (freeGb: number | null): string =>
  `A5R · Editor — the Editor is free, nobody is queued (free memory ${freeGb === null ? '?' : freeGb} GB) and your last words leave Editor work open → if you still have it, request it with the editor tool; if not, do nothing.`

// ---------- A136: whose turn it is ----------
/** The stopped session at the head of the queue whose turn it is: every check decide makes for it (the lock, a sync, a Focus,
 * a merge in progress, the launch gate) says it would be granted now. Only memory holding it back means it is not started. */
export const turnToStart = (x: GrantInput): SessionFile | null => {
  const head = queueIn(x)[0]
  return head && isStopped(head, x.files, x.lanes, x.now) && decide({ ...x, me8: head.id8 }).kind === 'grant' ? head : null
}
/** The request behind `id8` in the queue (A136: a miss goes back behind it). */
export const nextAskedAt = (x: GrantInput, id8: string): number | null => {
  const q = queueIn(x)
  return q[q.findIndex(f => f.id8 === id8) + 1]?.want?.requestedAt ?? null
}

// ---------- A137: what else a stopped session waits on ----------
/** Saved/A5R/refused/<id8>.json, written by the refused session itself. */
export type Refusal = { v: 1; id8: string; kind: 'git' | 'freeze'; at: number; what: string; needs?: Need[] }
export const parseRefusal = (text: string | null): Refusal | null => {
  try {
    const v = JSON.parse(text ?? '') as Partial<Refusal> | null
    return v && typeof v.id8 === 'string' && typeof v.at === 'number' && (v.kind === 'git' || v.kind === 'freeze') ? { v: 1, id8: v.id8, kind: v.kind, at: v.at, what: String(v.what ?? ''), ...(Array.isArray(v.needs) ? { needs: v.needs as Need[] } : {}) } : null
  } catch {
    return null
  }
}
/** The refusals to act on in order: oldest first, not too old, of a session whose process has since stopped. */
export const stoppedRefusals = (rs: readonly Refusal[], files: readonly SessionFile[], lanes: readonly LaneBeat[], now: number): Refusal[] =>
  rs.filter(r => now - r.at < REFUSAL_KEEP_MS && files.some(f => f.id8 === r.id8) && livenessOf(r.id8, files, lanes, now) !== 'alive').sort((a, b) => a.at - b.at || a.id8.localeCompare(b.id8))

// ---------- A140: who still has Editor work ----------
/** Last words that close a session's Editor work: done, nothing pending, or it needs the person. */
const FINISHED_WORDS = /\b(done|finished|completed?|shipped|merged|nothing (is )?(pending|left|more)|no (more |further )?(editor )?work|needs? (the person|hai|you|your)|waiting (for|on) (hai|you|the person)|over to you)\b|\bxong\b|hoàn thành/i
/** A140: whether its own last words finish it. The A65 judge's first reading of a transcript (hintOf: an open question to the
 * person), then the words above; no words at all are unknown, and unknown is finished (nothing is started on a guess). */
export const isFinished = (events: readonly TranscriptEvent[], now: number): boolean => {
  const last = events.filter(e => e.role === 'assistant' && e.text).pop()
  if (!last) return true
  const reading = hintOf({ now, kind: 'editor', lane: '', id8: '', session: '', since: now, end: null, why: '', liveness: 'alive', lastTurnAt: null, agents: 0, procs: [], hasEditor: false, hasBuild: false, transcript: '' }, events).verdict
  return reading === 'waiting-on-Hai' || reading === 'done' || (FINISHED_WORDS.test(last.text) && !saysWaitingForEditor(last.text))
}
/** A140: when this session last asked for or held the Editor (0: never on record). */
export const editorSignAt = (f: SessionFile, leases: readonly LeaseRecord[]): number => Math.max(f.askedAt ?? 0, f.editorUseAt ?? 0, f.holding?.since ?? 0, f.want?.requestedAt ?? 0, ...leases.filter(l => l.id8 === f.id8).map(l => l.endAt))
/** A140: the sessions that may still have Editor work, the most recently active first: not asking, not holding, nothing
 * running, idle (or stopped), active within a day, and not started for this within 2 h unless `again`. */
export const workPool = (x: { files: readonly SessionFile[]; lanes: readonly LaneBeat[]; now: number; workAt: Readonly<Record<string, number>>; again?: boolean }): SessionFile[] =>
  x.files
    .filter(f => !f.want && !f.holding && (f.agents ?? 0) === 0 && typeof f.lastTurnAt === 'number' && x.now - f.lastTurnAt <= WORK_RECENT_MS && isIdle(idleMsOf({ now: x.now, lastTurnAt: f.lastTurnAt, turnSignalAt: 0, mainCalls: 0, agents: f.agents ?? 0 })) && (x.again || x.now - (x.workAt[f.id8] ?? 0) >= WORK_AGAIN_MS))
    .sort((a, b) => (b.lastTurnAt ?? 0) - (a.lastTurnAt ?? 0))
/** A140: whether a session in that pool has work: asked or held within a day (or, A91, its last words wait for the Editor), and
 * its last words do not finish it. */
export const hasWork = (f: SessionFile, leases: readonly LeaseRecord[], events: readonly TranscriptEvent[], now: number): boolean => {
  const last = events.filter(e => e.role === 'assistant' && e.text).pop()
  return !isFinished(events, now) && (now - editorSignAt(f, leases) <= WORK_RECENT_MS || saysWaitingForEditor(last?.text ?? ''))
}
/** A140: the Editor's gates for a session with no request: a stand-in slot of 30 min without PIE meets what decide checks. */
export const workFits = (x: GrantInput, f: SessionFile): boolean => {
  const want: Want = { minutes: 30, pie: false, build: false, what: 'Editor work', mode: 'unattended', pausable: true, nextSafe: '', requestedAt: x.now }
  return decide({ ...x, me8: f.id8, files: x.files.map(o => (o.id8 === f.id8 ? { ...o, want } : o)) }).kind === 'grant'
}

// ---------- A136-A141: what the conductor keeps (Saved/A5R/wake.json, its one writer) ----------
export type WakeWhy = 'turn' | 'git' | 'freeze' | 'work'
export type WakeOutcome = 'answered' | 'no-answer' | 'no-address' | 'loop-paused'
export type Start = { id8: string; lane: string; why: WakeWhy; at: number; by: string; requestedAt: number | null }
export type WakeRow = { at: number; id8: string; lane: string; why: WakeWhy; outcome: WakeOutcome }
export type WakeFile = { v: 1; current: Start | null; recent: WakeRow[]; workAt: Record<string, number>; pausedUntil: number; pausedSince: number }
export const NO_WAKE: WakeFile = { v: 1, current: null, recent: [], workAt: {}, pausedUntil: 0, pausedSince: 0 }
export const RECENT_KEEP = 40
export const parseWake = (text: string | null): WakeFile => {
  try {
    const v = JSON.parse(text ?? '') as Partial<WakeFile>
    return { v: 1, current: v.current && typeof v.current.id8 === 'string' && typeof v.current.at === 'number' ? v.current : null, recent: Array.isArray(v.recent) ? v.recent.filter(r => r && typeof r.at === 'number') : [], workAt: v.workAt && typeof v.workAt === 'object' ? v.workAt : {}, pausedUntil: typeof v.pausedUntil === 'number' ? v.pausedUntil : 0, pausedSince: typeof v.pausedSince === 'number' ? v.pausedSince : 0 }
  } catch {
    return NO_WAKE
  }
}
export const withRow = (w: WakeFile, row: WakeRow): WakeFile => ({ ...w, recent: [...w.recent, row].slice(-RECENT_KEEP) })
/** The conductor: the first live A5R that conducts, by id; a fresh claim of another stands (one at a time as sessions come and go). */
export const conductorOf = (files: readonly SessionFile[], lanes: readonly LaneBeat[], now: number): string | null =>
  files.filter(f => f.conducts === true && livenessOf(f.id8, files, lanes, now) === 'alive').map(f => f.id8).sort()[0] ?? null
export const parseConductor = (text: string | null): { id8: string; at: number } | null => {
  try {
    const v = JSON.parse(text ?? '') as { id8?: unknown; at?: unknown } | null
    return v && typeof v.id8 === 'string' && typeof v.at === 'number' ? { id8: v.id8, at: v.at } : null
  } catch {
    return null
  }
}
export const mayConduct = (me8: string, first: string | null, claim: { id8: string; at: number } | null, now: number): boolean => first === me8 && (!claim || claim.id8 === me8 || now - claim.at >= CONDUCTOR_STALE_MS)

// ---------- A141: the count and the alarm (Saved/A5R/idle-with-work.json) ----------
export type IdleFile = { v: 1; days: Record<string, number>; nights: Record<string, number>; run: number; lastAt: number; freeSince: number; alarmed: boolean }
export const NO_IDLE: IdleFile = { v: 1, days: {}, nights: {}, run: 0, lastAt: 0, freeSince: 0, alarmed: false }
const KEEP_DAYS = 14
export const parseIdle = (text: string | null): IdleFile => {
  try {
    const v = JSON.parse(text ?? '') as Partial<IdleFile>
    return { v: 1, days: v.days ?? {}, nights: v.nights ?? {}, run: typeof v.run === 'number' ? v.run : 0, lastAt: typeof v.lastAt === 'number' ? v.lastAt : 0, freeSince: typeof v.freeSince === 'number' ? v.freeSince : 0, alarmed: v.alarmed === true }
  } catch {
    return NO_IDLE
  }
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
export const nextIdle = (i: IdleFile, x: { isFree: boolean; hasWork: boolean; now: number }): { idle: IdleFile; isCounted: boolean } => {
  if (Math.floor(i.lastAt / MIN) === Math.floor(x.now / MIN)) return { idle: i, isCounted: false }
  const isIdleMin = x.isFree && x.hasWork
  const isRow = x.now - i.lastAt <= 2 * MIN
  const night = nightOf(x.now)
  const day = ymd(x.now)
  const run = isIdleMin ? (isRow ? i.run : 0) + 1 : 0
  return {
    idle: {
      v: 1,
      days: isIdleMin ? trimmed({ ...i.days, [day]: (i.days[day] ?? 0) + 1 }) : i.days,
      nights: isIdleMin && night ? trimmed({ ...i.nights, [night]: (i.nights[night] ?? 0) + 1 }) : i.nights,
      run,
      lastAt: x.now,
      freeSince: x.isFree ? (i.freeSince && isRow ? i.freeSince : x.now) : 0,
      alarmed: run > 0 && i.alarmed,
    },
    isCounted: isIdleMin,
  }
}
export const isAlarmDue = (i: IdleFile): boolean => i.run >= IDLE_ALARM_MIN && !i.alarmed
export const alarmText = (minutes: number, cause: string): string => `A5R: ${minutes > 0 ? `the Editor has stood free ${minutes} min with work waiting` : 'work is waiting for the Editor'}: ${cause}`

// ---------- A139 / A141: what the panel, status.json and /a5r say ----------
/** The panel's line: the Editor free 30 min or more with nobody queued, and the idle-with-work minutes of today and last night. */
export const idleLine = (i: IdleFile, x: { now: number; queued: number; isFree: boolean }): string => {
  const today = i.days[ymd(x.now)] ?? 0
  const lastNight = nightOf(x.now - 12 * HOUR) ?? nightOf(x.now)
  const night = lastNight ? (i.nights[lastNight] ?? 0) : 0
  const freeMin = x.isFree && i.freeSince ? Math.floor((x.now - i.freeSince) / MIN) : 0
  return [...(freeMin >= IDLE_ALARM_MIN && x.queued === 0 ? [`free ${freeMin} min, nobody queued`] : []), ...(today + night > 0 ? [`idle with work: ${today} min today, ${night} min last night`] : [])].join(' · ')
}
const WHY_WORDS: Record<WakeWhy, string> = { turn: 'its turn', git: 'git free', freeze: 'freeze lifted', work: 'Editor work' }
/** A139: what ran and what was started last night (the night that ended, or is running, at `now`); '' when nothing did. */
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
