// a5r-hosts S-d (L2): the host side of jobs on closures (no `$`). The status writer's minute (decision 1) answers each new
// `Saved/A5R/inbox/<id>.json` under the coordination root with a job (accepted, or declined with its code), starts an
// accepted job once with `asHost.startCommand` when it is set (decision 2; recorded in `<id>.start`), and writes the beat
// `<id>.beat` for each running job whose session is alive (decision 3). The job tool (`take`, `progress`, `done`, `fail`,
// `return`, `list`) is the job's session. Every write of a job file goes through the state machine (`move`), and the
// minute writes only the jobs it creates: its start record and beats are files of their own, so it never rewrites a job
// its session is writing. A hand edit of these files is refused at the edit.
import { noticeText } from './coord.ts'
import { parseHandoff, resultKindOf } from './handoff.ts'
import type { HostCard } from './hostcard.ts'
import type { AsHost } from './hosts.ts'
import type { FileIo } from './hostio.ts'
import { availabilityNow } from './hostcard.ts'
import { INBOX_DIR, JOBS_DIR, JOB_GATE, JOB_USAGE, activeJobs, answerOf, beatOf, beatPath, inboxPath, jobPath, mayJobMove, needsReason, parseJob, preemptNow, preemptOf, preemptPath, startPath, withBeat, withPreempt, type Job, type JobState } from './jobs.ts'
import type { Notice } from './coord.ts'

/** The io a host's jobs need: the files, the rules' secret patterns, a start that returns at once (the engine has no
 * detached process: the startCommand itself must come back, e.g. `hc run --bg`; F-d1), a debug log. */
export type JobIo = FileIo & { secrets: () => Promise<readonly string[]>; start: (argv: readonly string[], cwd: string) => Promise<{ exitCode: number } | null>; log: (note: string) => void }
/** What the host's a5r knows this minute: its asHost, its own sync freeze, its lanes (the card's), session liveness. */
export type HostNow = { asHost: AsHost; now: number; frozen: boolean; lanes: HostCard['lanes']; alive: (id8: string) => boolean; warnMs: number }
/** The job tool's input (one parse for the tool and the command). */
export type JobInput = { op: string; id: string; text: string; ref: string; code: string }
/** A job's start record (`<id>.start`): when startCommand ran and whether it came back with exit 0. */
type Start = { at: number; ok: boolean; said: string }
const startOf = (raw: string | null): Start | null => {
  try {
    const v = JSON.parse(raw ?? '') as Partial<Start>
    return typeof v.at === 'number' && typeof v.ok === 'boolean' ? { at: v.at, ok: v.ok, said: String(v.said ?? '') } : null
  } catch {
    return null
  }
}

export const jobsDesk = (h: { coord: () => string; coordRoot: () => string; me8: () => string }) => {
  let jobs: Job[] = []
  let starts = new Map<string, Start>()

  /** The jobs here, each with its beat folded in, and the start records. */
  const read = async (io: FileIo): Promise<Job[]> => {
    const files = (await io.list(`${h.coord()}/${JOBS_DIR}`)).map(f => f.name)
    const ids = files.filter(n => n.endsWith('.json')).map(n => n.slice(0, -5))
    const side = async (id: string, ext: string) => (files.includes(`${id}.${ext}`) ? io.read(`${h.coord()}/${JOBS_DIR}/${id}.${ext}`) : null)
    const all = await Promise.all(ids.map(async id => ({ id, job: parseJob(await io.read(jobPath(h.coord(), id))), beat: beatOf(await side(id, 'beat')), preempt: preemptOf(await side(id, 'preempt')), start: startOf(await side(id, 'start')) })))
    jobs = all.flatMap(x => (x.job ? [withPreempt(withBeat(x.job, x.beat), x.preempt)] : []))
    starts = new Map(all.flatMap(x => (x.start ? [[x.id, x.start] as const] : [])))
    return jobs
  }
  /** The one way a job file is written (section 5): refused when the machine has no such step or a reason is missing. */
  const move = async (io: FileIo, prev: Job | null, next: Job): Promise<string | null> => {
    if (!mayJobMove(prev?.state ?? null, next.state)) return noticeText(JOB_GATE, `job ${next.id} is ${prev?.state ?? 'new'}; it cannot become ${next.state}`, 'see /a5r job list')
    if (needsReason(next.state) && !next.reason?.trim()) return noticeText(JOB_GATE, `${next.state} needs a reason (a code, then text)`, JOB_USAGE)
    // The preemption is the minute's file, folded in on read: never written into the session's job file.
    const { preempt: _p, ...file } = next
    await io.write(jobPath(h.coord(), next.id), JSON.stringify(file))
    jobs = [...jobs.filter(j => j.id !== next.id), next]
    return null
  }

  /** Decision 10: a WIP branch is on the remote (`git ls-remote origin <ref>` in the coordination root names it). */
  const isPushed = async (io: FileIo, ref: string): Promise<boolean> => {
    if (!/^(?!-)(?!.*\.\.)[\w./-]+$/.test(ref)) return false // a branch name, never an option
    const head = `refs/heads/${ref.replace(/^refs\/heads\//, '')}`
    const r = await io.run(['git', '-C', h.coordRoot(), 'ls-remote', 'origin', head], 30_000)
    return r?.exitCode === 0 && r.stdout.split(/\r?\n/).some(l => l.split(/\s+/)[1] === head)
  }
  /** The first idle lane under laneRoot that no running job holds. */
  const holds = (lane: string, but?: string) => jobs.some(j => j.id !== but && (j.state === 'running' || j.state === 'parked') && j.lane === lane)
  const idleLane = (x: HostNow): string | null => x.lanes.find(l => l.state === 'idle' && !holds(l.id))?.id ?? null
  /** Decision 2: an accepted job a session must take (no startCommand, or its start did not come back with exit 0). */
  const isWaiting = (j: Job): boolean => j.state === 'accepted' && starts.get(j.id)?.ok !== true

  /** A new inbox file answered (decision 1); C12's no-op is accepted, run and done, each step through the machine. */
  const answer = async (io: JobIo, x: HostNow, name: string, secrets: readonly string[]): Promise<void> => {
    const id = name.slice(0, -5)
    const raw = (await io.read(inboxPath(h.coord(), id))) ?? ''
    const ho = parseHandoff(raw)
    if (!ho || ho.id !== id) return io.log(`a5r: inbox ${name} is not a hand-off`)
    const first = answerOf(raw, ho, { asHost: x.asHost, now: x.now, frozen: x.frozen, active: activeJobs(jobs), secrets })
    if ((await move(io, null, first)) || !ho.noop || first.state !== 'accepted') return
    const running: Job = { ...first, state: 'running', startedAt: x.now, progress: 'no-op' }
    if (!(await move(io, first, running))) await move(io, running, { ...running, state: 'done', progress: 'no-op: answered and done', result: { kind: 'report', ref: jobPath(h.coord(), id) } })
  }

  /** Decisions 1 to 3 and 10, by the status writer once a minute. */
  const tick = async (io: JobIo, x: HostNow): Promise<void> => {
    await read(io)
    const secrets = await io.secrets()
    for (const f of await io.list(`${h.coord()}/${INBOX_DIR}`)) if (f.name.endsWith('.json') && !jobs.some(j => `${j.id}.json` === f.name)) await answer(io, x, f.name, secrets)
    for (const j of jobs) {
      if (j.state === 'accepted' && x.asHost.startCommand && !starts.has(j.id)) {
        const argv = x.asHost.startCommand.map(a => a.replaceAll('{packet}', inboxPath(h.coord(), j.id)).replaceAll('{id}', j.id))
        const r = await io.start(argv, h.coordRoot())
        // Once: recorded whatever the start said, so a failing command is not run every minute (the job then waits for take).
        const st: Start = { at: x.now, ok: r?.exitCode === 0, said: r ? `exit ${r.exitCode}` : 'no answer' }
        await io.write(startPath(h.coord(), j.id), JSON.stringify(st))
        starts.set(j.id, st)
      } else if (j.state === 'running') {
        if (j.session && x.alive(j.session)) await io.write(beatPath(h.coord(), j.id), String(x.now))
        const p = preemptNow(x.asHost, x.now, x.warnMs)
        if (p && !j.preempt) await io.write(preemptPath(h.coord(), j.id), JSON.stringify(p))
        if (!p && j.preempt) await io.write(preemptPath(h.coord(), j.id), '{}') // availability came back: lifted
      }
    }
    await read(io)
  }
  /** Decision 10: the notice this session gets for a job it runs that is preempted (once per preemption). */
  const told = (): Notice[] =>
    jobs
      .filter(j => j.state === 'running' && j.session === h.me8() && j.preempt)
      .map(j => ({ id: `job:${j.id}:preempt:${j.preempt?.at}`, text: noticeText(`job ${j.id}`, `preempted: ${j.preempt?.reason}; deadline ${new Date(j.preempt?.deadline ?? 0).toISOString()}`, `reach a safe point, push a WIP branch, then /a5r job park ${j.id} <branch>`), isActionable: true }))

  const find = async (io: FileIo, id: string): Promise<Job | null> => (await read(io)).find(j => j.id === id.trim()) ?? null
  const line = (j: Job) => `${j.id} · ${j.state}${j.lane ? ` · lane ${j.lane}` : ''}${j.session ? ` · session ${j.session}` : ''}${j.reason ? ` · ${j.reason}` : ''}${j.progress ? ` · ${j.progress}` : ''}`

  /** The job tool and `/a5r job …`: the session on the host. */
  const act = async (io: JobIo, x: HostNow, e: JobInput): Promise<string> => {
    if (e.op === 'list') {
      const xs = await read(io)
      return xs.length ? ['Jobs on this host:', ...xs.map(line)].join('\n') : 'No jobs on this host.'
    }
    const j = await find(io, e.id)
    if (!j) return noticeText(JOB_GATE, `no job ${e.id || '(no id)'} on this host`, 'list them: /a5r job list')
    const now = await io.now()
    const set = (to: JobState, more: Partial<Job>, said: string) => move(io, j, { ...j, ...more, state: to, updatedAt: now }).then(bad => bad ?? said)
    if (e.op === 'take') {
      if (j.state !== 'accepted' && j.state !== 'parked') return noticeText(JOB_GATE, `job ${j.id} is ${j.state}`, 'take an accepted or parked job')
      const avail = availabilityNow(x.asHost.availability, now)
      if (j.state === 'parked' && avail.state !== 'yes') return noticeText(JOB_GATE, `job ${j.id} is parked and this host is not available (${avail.reason ?? 'no'})`, `take it when availability is back, or /a5r job return ${j.id} <CODE> [text]`)
      if (j.state === 'parked' && j.lane && holds(j.lane, j.id)) return noticeText(JOB_GATE, `lane ${j.lane} of job ${j.id} is held by another job`, 'wait for it, or return this job')
      const lane = j.state === 'parked' && j.lane ? j.lane : idleLane(x)
      if (!lane) return noticeText(JOB_GATE, 'no lane under laneRoot is idle', 'wait for a lane, or add one (C9)')
      const resumed = j.state === 'parked' ? { resumedAt: now } : {}
      const { preempt: _p, ...rest } = j
      return move(io, j, { ...rest, ...resumed, state: 'running', lane, session: h.me8(), startedAt: j.startedAt ?? now, startedBy: starts.get(j.id)?.ok ? 'startCommand' : 'take', heartbeatAt: now, updatedAt: now }).then(bad => bad ?? `A5R · job ${j.id} taken: lane ${lane}, session ${h.me8()}. Report with /a5r job progress|done|fail ${j.id}.`)
    }
    if (j.session && j.session !== h.me8()) return noticeText(JOB_GATE, `job ${j.id} is run by session ${j.session}`, `only that session reports it; or /a5r job take ${j.id} once it is parked`)
    if (e.op === 'progress') return j.state !== 'running' ? noticeText(JOB_GATE, `job ${j.id} is ${j.state}`, 'take it first') : set('running', { progress: e.text.slice(0, 200), heartbeatAt: now }, `A5R · job ${j.id}: progress noted.`)
    if (e.op === 'done') return e.ref ? set('done', { result: { kind: resultKindOf(e.ref), ref: e.ref } }, `A5R · job ${j.id} done: ${e.ref}. Its origin reads it on its next minute.`) : noticeText(JOB_GATE, 'done needs where the result is (a PR, a branch or a report path)', JOB_USAGE)
    if (e.op === 'park') {
      if (!e.ref) return noticeText(JOB_GATE, 'park needs the pushed WIP branch', `/a5r job park ${j.id} <branch>`)
      if (!(await isPushed(io, e.ref))) return noticeText(JOB_GATE, `${e.ref} is not on the remote`, `push it (git push origin ${e.ref}), then /a5r job park ${j.id} ${e.ref}`)
      return set('parked', { wip: e.ref, progress: `parked at ${e.ref}` }, `A5R · job ${j.id} parked at ${e.ref}. Take it again when the host is available, or return it.`)
    }
    if (e.op === 'fail' || e.op === 'return') return set(e.op === 'fail' ? 'failed' : 'returned', { reason: [e.code, e.text].filter(Boolean).join(' ') }, `A5R · job ${j.id} ${e.op === 'fail' ? 'failed' : 'returned'}: ${e.code}.`)
    return noticeText(JOB_GATE, `"${e.op}" is not a job action`, JOB_USAGE)
  }

  return {
    read,
    tick,
    act,
    told,
    /** The pane's line for each accepted job that waits for a session (decision 2), from the jobs as last read. */
    waiting: (): string[] => jobs.filter(isWaiting).map(j => `job ${j.id} waiting → /a5r job take ${j.id}${starts.get(j.id) ? ` (startCommand: ${starts.get(j.id)?.said})` : ''}`),
  }
}
