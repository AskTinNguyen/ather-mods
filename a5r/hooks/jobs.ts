// a5r-hosts S-d (L2): the job file (prompt.md "Data structures" 4), the host's answer to a hand-off, and the state
// machine of section 5 on both sides. The host writes `Saved/A5R/jobs/<id>.json` (its status writer answers the inbox;
// the job tool's take, progress, done, fail and return), the origin keeps a copy under `Saved/A5R/hosts/<host>/jobs/`
// and computes the effective state (`effectiveOf`) with `unanswered`, `silent` and `lost` from time. A manual host's
// answer is pasted into `<id>.manual-in.json` beside the hand-off, in the same form (`source: "manual"`). Pure: no `$`.
import { availabilityNow, type HostCard } from './hostcard.ts'
import type { AsHost } from './hosts.ts'
import { DIR } from './coord.ts'
import { hasSecret, kindOf, type Handoff, type ResultKind } from './handoff.ts'
import { isObj, textOf } from './shape.ts'

export const JOB_GATE = 'job'
export const JOB_USAGE = '/a5r job list · take <id> · progress <id> "<one line>" · done <id> <ref> · park <id> <pushed branch> · fail <id> <CODE> [text] · return <id> <CODE> [text]'
export const INBOX_DIR = 'inbox'
export const JOBS_DIR = 'jobs'
export const MANUAL_IN = '.manual-in.json'
/** A host's Saved/A5R under its root (an origin's `reach.options.a5rRoot`, a host's coordination root). */
export const a5rDirOf = (root: string): string => `${root.replace(/[\\/]+$/, '')}/${DIR}`
/** The three files of one job under a host's Saved/A5R: the inbox copy (the origin's), the job (the host's, one writer
 * per write through the state machine) and its beat (the host's minute: the heartbeat, a file of its own so the minute
 * never rewrites a job its session is writing). */
export const inboxPath = (a5rDir: string, id: string): string => `${a5rDir}/${INBOX_DIR}/${id}.json`
export const jobPath = (a5rDir: string, id: string): string => `${a5rDir}/${JOBS_DIR}/${id}.json`
export const beatPath = (a5rDir: string, id: string): string => `${a5rDir}/${JOBS_DIR}/${id}.beat`
/** The preemption the host's minute writes for a running job (decision 10; a file of its own, like the beat). */
export const preemptPath = (a5rDir: string, id: string): string => `${a5rDir}/${JOBS_DIR}/${id}.preempt`
/** The start record of a job started by asHost.startCommand (the host's minute; once). */
export const startPath = (a5rDir: string, id: string): string => `${a5rDir}/${JOBS_DIR}/${id}.start`
export const JOB_STATES = ['accepted', 'declined', 'running', 'parked', 'done', 'failed', 'returned'] as const
export type JobState = (typeof JOB_STATES)[number]
/** Decision 1's decline codes, in the order the host checks them. */
export const DECLINE_CODES = ['SECRET', 'NO_TRUST', 'NO_ROLE', 'UNAVAILABLE', 'FROZEN', 'BUSY'] as const
export type DeclineCode = (typeof DECLINE_CODES)[number]

export type Job = {
  v: 1
  id: string
  receivedAt: number
  state: JobState
  /** Required for declined, failed and returned: a code, then free text. */
  reason?: string
  lane?: string
  /** The session that took it (its id8). */
  session?: string
  startedAt?: number
  startedBy?: 'startCommand' | 'take'
  /** Written by the host's tick once a minute while the job's session is alive (rev 5). */
  heartbeatAt?: number
  progress?: string
  result?: { kind: ResultKind; ref: string; sha?: string }
  preempt?: { at: number; reason: string; deadline: number }
  /** When a parked job was taken again: a preemption written before it no longer holds. */
  resumedAt?: number
  /** The pushed WIP branch a parked job waits on (decision 10). */
  wip?: string
  proofRead?: { cmd: string; line: string; ok: boolean }
  /** A manual host's answer, pasted on the origin (`/a5r handoff result`). */
  source?: 'manual'
  updatedAt: number
}

const text = textOf
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

export const parseJob = (raw: string | null): Job | null => {
  let v: unknown
  try {
    v = JSON.parse(raw ?? '')
  } catch {
    return null
  }
  if (!isObj(v) || v.v !== 1 || !text(v.id) || !(JOB_STATES as readonly string[]).includes(text(v.state)) || num(v.receivedAt) === undefined) return null
  const r = isObj(v.result) && text(v.result.ref) ? v.result : null
  const p = isObj(v.preempt) && num(v.preempt.deadline) !== undefined ? v.preempt : null
  return {
    v: 1,
    id: text(v.id),
    receivedAt: num(v.receivedAt) ?? 0,
    state: text(v.state) as JobState,
    ...(text(v.reason) ? { reason: text(v.reason) } : {}),
    ...(text(v.lane) ? { lane: text(v.lane) } : {}),
    ...(text(v.session) ? { session: text(v.session) } : {}),
    ...(num(v.startedAt) !== undefined ? { startedAt: num(v.startedAt) } : {}),
    ...(v.startedBy === 'startCommand' || v.startedBy === 'take' ? { startedBy: v.startedBy } : {}),
    ...(num(v.heartbeatAt) !== undefined ? { heartbeatAt: num(v.heartbeatAt) } : {}),
    ...(text(v.progress) ? { progress: text(v.progress) } : {}),
    ...(r ? { result: { kind: kindOf(r.kind), ref: text(r.ref), ...(text(r.sha) ? { sha: text(r.sha) } : {}) } } : {}),
    ...(p ? { preempt: { at: num(p.at) ?? 0, reason: text(p.reason), deadline: num(p.deadline) ?? 0 } } : {}),
    ...(num(v.resumedAt) !== undefined ? { resumedAt: num(v.resumedAt) } : {}),
    ...(text(v.wip) ? { wip: text(v.wip) } : {}),
    ...(v.source === 'manual' ? { source: 'manual' as const } : {}),
    updatedAt: num(v.updatedAt) ?? num(v.receivedAt) ?? 0,
  }
}

/** Section 5, the host's part: (absent) -> accepted | declined; accepted -> running; running -> done | failed | parked |
 * returned; parked -> running | returned. Nothing leaves declined, done, failed or returned. */
const MOVES: Record<JobState | 'absent', readonly JobState[]> = {
  absent: ['accepted', 'declined'],
  accepted: ['running'], // C12's no-op job too: accepted, running, done, each step through the machine
  running: ['running', 'done', 'failed', 'parked', 'returned'],
  parked: ['running', 'returned'],
  declined: [],
  done: [],
  failed: [],
  returned: [],
}
export const mayJobMove = (from: JobState | null, to: JobState): boolean => MOVES[from ?? 'absent'].includes(to)
/** States that need a reason (a code, then free text). */
export const needsReason = (s: JobState): boolean => s === 'declined' || s === 'failed' || s === 'returned'

/** What the host knows when it answers an inbox file (decision 1). */
export type AnswerCtx = { asHost: AsHost; now: number; frozen: boolean; active: number; secrets: readonly string[] }
/** Decision 1, in order: secret, trust, roles, availability now, the host's own sync freeze, capacity (maxJobs, default
 * 1, over running and accepted jobs; C12's no-op job takes no capacity). The job: accepted, or declined with its code. */
export const answerOf = (raw: string, h: Handoff, x: AnswerCtx): Job => {
  const as = x.asHost
  const avail = availabilityNow(as.availability, x.now)
  const missing = h.wants.filter(w => !as.roles.includes(w))
  const why: [DeclineCode, string] | null = hasSecret(raw, x.secrets)
    ? ['SECRET', 'the hand-off holds a secret (D13)']
    : !as.trust.includes('*') && !as.trust.includes(h.from)
      ? ['NO_TRUST', `origin ${h.from} is not in this host's trust list`]
      : missing.length
        ? ['NO_ROLE', `this host has no role ${missing.join(', ')}`]
        : avail.state !== 'yes'
          ? ['UNAVAILABLE', avail.reason ?? 'not available now']
          : x.frozen
            ? ['FROZEN', "this host's own sync freeze is on"]
            : !h.noop && x.active >= (as.capacity?.maxJobs ?? 1)
              ? ['BUSY', `${x.active} of ${as.capacity?.maxJobs ?? 1} jobs already accepted or running`]
              : null
  return { v: 1, id: h.id, receivedAt: x.now, state: why ? 'declined' : 'accepted', ...(why ? { reason: `${why[0]} ${why[1]}` } : {}), updatedAt: x.now }
}

/** A job's decline (or fail, return) code: the reason's first word. */
export const codeOf = (j: { reason?: string }): string => (j.reason ?? '').split(/\s+/)[0] ?? ''

/** Section 5's computed flags. */
export const SILENT_MS = 3 * 60_000
export const LOST_MS = 15 * 60_000
export type Flag = 'unanswered' | 'silent' | 'lost' | 'undelivered'
export type Effective = { state: Handoff['state'] | JobState; flag?: Flag }
/** The effective state (section 5): the origin's merged or cancelled; else the job's state when there is one; else
 * proposed. Flags from time: undelivered (no inbox copy yet), unanswered (no job `staleHandoffMin` after delivery), silent
 * (a running job's heartbeat older than 3 min), lost (15 min, or a preempted job past its deadline). */
export const effectiveOf = (h: Handoff, job: Job | null, now: number, staleHandoffMin = 30): Effective => {
  if (h.state !== 'proposed') return { state: h.state }
  if (!job) {
    if (h.deliveredAt === undefined) return { state: 'proposed', ...(h.via === 'adapter' ? { flag: 'undelivered' as const } : {}) }
    return now - h.deliveredAt > staleHandoffMin * 60_000 ? { state: 'proposed', flag: 'unanswered' } : { state: 'proposed' }
  }
  if (job.state === 'running' && job.preempt && now > job.preempt.deadline) return { state: 'running', flag: 'lost' }
  if (job.state !== 'running') return { state: job.state }
  const age = now - (job.heartbeatAt ?? job.startedAt ?? job.receivedAt)
  return { state: 'running', ...(age > LOST_MS ? { flag: 'lost' as const } : age > SILENT_MS ? { flag: 'silent' as const } : {}) }
}
/** What the effective state is called on a row and in a notice. */
export const effectiveText = (e: Effective): string => (e.flag ? `${e.state} (${e.flag})` : e.state)

/** Decision 4: what the session that created the hand-off is told (once each), and which of them need a person. */
export type NoticeKey = 'declined' | 'failed' | 'returned' | 'lost' | 'preempt' | 'done'
const TOLD_STATES: readonly NoticeKey[] = ['declined', 'failed', 'returned', 'done']
export const noticeKey = (e: Effective, job: Job | null): NoticeKey | null => {
  if (e.flag === 'lost') return 'lost'
  if (job?.preempt && e.state === 'running') return 'preempt'
  return TOLD_STATES.find(k => k === e.state) ?? null
}
export const needsPerson = (key: NoticeKey): boolean => key !== 'done'
/** A beat file's time (the host's minute writes the time as text), or undefined. */
export const beatOf = (raw: string | null): number | undefined => {
  const n = Number((raw ?? '').trim())
  return raw !== null && Number.isFinite(n) && n > 0 ? n : undefined
}
export type Preempt = NonNullable<Job['preempt']>
/** A preempt file's content, or null. */
export const preemptOf = (raw: string | null): Preempt | null => {
  try {
    const v = JSON.parse(raw ?? '') as unknown
    return isObj(v) && typeof v.at === 'number' && typeof v.deadline === 'number' ? { at: v.at, reason: textOf(v.reason), deadline: v.deadline } : null
  } catch {
    return null
  }
}
/** A job with the minute's preemption folded in: only while it runs or is parked, and only one written since it last
 * started or resumed. */
export const withPreempt = (j: Job, p: Preempt | null): Job => (p && (j.state === 'running' || j.state === 'parked') && p.at >= (j.resumedAt ?? j.startedAt ?? 0) ? { ...j, preempt: p } : j)
/** Decision 10: the preemption a running job gets now, or null: availability gone `no` (deadline now + warn), or within
 * `warn` of its `until` (deadline until). */
export const preemptNow = (as: AsHost, now: number, warnMs: number): Preempt | null => {
  const a = availabilityNow(as.availability, now)
  const until = as.availability.until
  if (until !== undefined && now >= until - warnMs) return { at: now, reason: `the host is available until ${new Date(until).toISOString()}`, deadline: until }
  return a.state === 'no' ? { at: now, reason: a.reason ?? 'the host is not available now', deadline: now + warnMs } : null
}
/** A job with its beat folded in (the later of the two). */
export const withBeat = (j: Job, beat: number | undefined): Job => (beat !== undefined && beat > (j.heartbeatAt ?? 0) ? { ...j, heartbeatAt: beat } : j)

/** The capacity count (decision 1): running and accepted jobs on this host. */
export const activeJobs = (jobs: readonly Job[]): number => jobs.filter(j => j.state === 'running' || j.state === 'accepted').length

/** The card's `jobs` (rev 5): running, and queued = accepted and waiting for a session (or parked). */
export const jobCounts = (jobs: readonly Job[]): HostCard['jobs'] => ({ running: jobs.filter(j => j.state === 'running').length, queued: jobs.filter(j => j.state === 'accepted' || j.state === 'parked').length })
