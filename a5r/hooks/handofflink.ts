// a5r-hosts S-d (L2): the origin side of a hand-off to a declared host, on closures (no `$`). Create checks what an L2
// hand-off needs (an adapter that can write the inbox or a manual host, D21; an Editor protocol it can read when the job
// needs PIE or a build, D22) and delivers the inbox copy at once (the minute retries a failed write). The status writer's
// minute follows each open one (decision 4): it reads the host's job (and its beat) through the adapter and keeps the one
// copy under `Saved/A5R/hosts/<host>/jobs/`, takes a done job's result into the hand-off (its PR number, decision 6) and
// sets `merged` once the PR is merged and its score passed (or `/a5r pass <id>`). Every session computes the effective
// state of the hand-offs it created and is told once per transition. Manual hosts: the packet, and the pasted result.
import { noticeText, type Notice } from './coord.ts'
import type { Adapter } from './adapters/types.ts'
import { HANDOFF_GATE, isOpen, prNumberOf, resultKindOf, type Handoff } from './handoff.ts'
import type { DeskIo } from './handoffhost.ts'
import type { HostCard } from './hostcard.ts'
import type { FileIo } from './hostio.ts'
import { HOSTS_DIR } from './hoststate.ts'
import { JOBS_DIR, MANUAL_IN, a5rDirOf, beatOf, beatPath, effectiveOf, effectiveText, inboxPath, jobPath, needsPerson, noticeKey, parseJob, preemptOf, preemptPath, withBeat, withPreempt, type Job, type NoticeKey } from './jobs.ts'

/** A declared host as the link sees it: its id, label, whether it is manual, its roots, its (guarded) adapter and card. */
export type LinkHost = { id: string; label: string; manual: boolean; a5rRoot?: string; lockRoot?: string; adapter: Adapter; card: HostCard | null }
/** One PR's after-the-fact score (register.ts's scorer): its GitHub state, whether it passed (null: not scored now), the
 * failing rules. */
export type PrScore = { state: string; ok: boolean | null; lines: string[] }
export type LinkIo = DeskIo & { scorePr?: (n: number, slug: string) => Promise<PrScore>; takePass?: (keys: readonly string[]) => Promise<boolean> }
/** The hand-off desk's own reads and its one writer (handoffhost.ts). */
export type HandoffFiles = { read: (io: FileIo) => Promise<Handoff[]>; write: (io: DeskIo, prev: Handoff | null, next: Handoff) => Promise<string | null> }

export const SCORE_EVERY_MS = 10 * 60_000

/** The readable packet of a manual hand-off (scenario 7): what to do there, and the one line to paste back here. */
export const packetText = (h: Handoff, label: string): string =>
  [
    `Hand-off ${h.id} for ${label} (manual: a person carries this).`,
    `Task: ${h.task}`,
    `Base: ${h.base.remote}/${h.base.ref} at ${h.base.sha}`,
    ...(h.intent.branch ? [`Branch: ${h.intent.branch}`] : []),
    ...(h.wants.length ? [`Needs roles: ${h.wants.join(', ')}`] : []),
    ...(Object.keys(h.needs).length ? [`Needs: ${JSON.stringify(h.needs)}`] : []),
    ...(h.claims.length ? [`Claims: ${h.claims.map(c => `${c.exclusive ? '!' : ''}${c.path}`).join(', ')}`] : []),
    ...(h.proof ? [`Proof: ${h.proof}`] : []),
    `Result as: ${h.result.kind}${h.result.target ? ` (${h.result.target})` : ''}`,
    `On ${label}: check out the base, do the task, push the result (a PR, a branch, or a report).`,
    `Back here: /a5r handoff result ${h.id} <PR url | #N | branch | report path>`,
    'JSON:',
    JSON.stringify(h),
  ].join('\n')

export const handoffLink = (h: { dir: () => string; coord: () => string; me8: () => string }, files: HandoffFiles) => {
  const copyPath = (host: string, id: string) => `${h.coord()}/${HOSTS_DIR}/${host}/${JOBS_DIR}/${id}.json`
  const manualPath = (id: string) => `${h.dir()}/handoffs/${id}${MANUAL_IN}`
  /** The answer the origin has for an L2 hand-off: the pasted one (manual), else the copy of the host's job. */
  const answerOf = async (io: FileIo, ho: Handoff): Promise<Job | null> => parseJob(await io.read(ho.via === 'manual' ? manualPath(ho.id) : copyPath(ho.host, ho.id)))

  /** The inbox copy through the adapter (D21); the hand-off records when it landed. */
  const deliver = async (io: LinkIo, ho: Handoff, x: LinkHost): Promise<Handoff> => {
    if (!x.adapter.writeFile || !x.a5rRoot) return ho
    const w = await x.adapter.writeFile(inboxPath(a5rDirOf(x.a5rRoot), ho.id), JSON.stringify(ho))
    if (!w.ok) return ho
    const next = { ...ho, deliveredAt: await io.now(), updatedAt: await io.now() }
    return (await files.write(io, ho, next)) ? ho : next
  }

  /** Decision 7: what an L2 hand-off to this host lacks, or null. */
  const problem = async (x: LinkHost, needs: Handoff['needs']): Promise<[string, string] | null> => {
    if (x.manual) return null
    if (!x.adapter.writeFile || !x.a5rRoot) return [`NO_ADAPTER_OP: the ${x.adapter.kind} adapter of ${x.id} cannot write the host's inbox (${x.adapter.writeFile ? 'no reach.options.a5rRoot' : 'no writeFile'})`, `declare reach.options.a5rRoot (/a5r host set ${x.id}), use an adapter with writeFile, or record it by hand (manual)`]
    if ((needs.pie || needs.build) && x.card?.source !== 'a5r') {
      const lock = x.lockRoot && x.adapter.readFile ? await x.adapter.readFile(`${x.lockRoot.replace(/[\\/]+$/, '')}/Saved/EDITOR_OWNER.txt`) : null
      if (x.card?.editor.running === 'unknown' || !x.card || !lock?.ok) return [`NO_EDITOR_PROTOCOL: ${x.id} runs no A5R and its Editor lock could not be read`, 'hand off a job that needs no Editor, or install A5R on the host']
    }
    return null
  }

  /** The tool's create for a declared host (L2): checked, written (one writer), delivered. */
  const create = async (io: LinkIo, ho: Handoff, x: LinkHost): Promise<string> => {
    const bad = await problem(x, ho.needs)
    if (bad) return noticeText(HANDOFF_GATE, ...bad)
    const first = { ...ho, via: x.manual ? ('manual' as const) : ('adapter' as const) }
    const refused = await files.write(io, null, first)
    if (refused) return refused
    if (x.manual) return `A5R · hand-off ${first.id} for ${x.label} (manual). Give this packet to a person there:\n${packetText(first, x.label)}`
    const sent = await deliver(io, first, x)
    return `A5R · hand-off ${first.id} for ${x.label}: ${sent.deliveredAt ? 'delivered to its inbox' : 'not delivered yet (the next minute tries again)'}. Its claims hold here; its job state shows in the Hosts tile.`
  }

  /** `/a5r handoff result <id> <ref>` for a manual hand-off: the pasted answer in the job's form (decision 5); the
   * minute takes it into the hand-off as it takes a host's job. */
  const pasteResult = async (io: FileIo, ho: Handoff, ref: string): Promise<string> => {
    const now = await io.now()
    const job: Job = { v: 1, id: ho.id, receivedAt: now, state: 'done', result: { kind: resultKindOf(ref), ref }, source: 'manual', updatedAt: now }
    await io.write(manualPath(ho.id), JSON.stringify(job))
    return `A5R · hand-off ${ho.id}: result ${ref} pasted (done); the next minute takes it in.`
  }

  /** `/a5r handoff merged <id>` (F-a4): a branch or report result the origin took. A PR merges by its score. */
  const merged = async (io: LinkIo, ho: Handoff): Promise<string> => {
    const e = effectiveOf(ho, await answerOf(io, ho), await io.now())
    if (ho.result.kind === 'pr') return noticeText(HANDOFF_GATE, `hand-off ${ho.id}'s result is a PR`, `it becomes merged once the PR is merged and its score passed (or /a5r pass ${ho.id})`)
    if (!ho.result.ref || (e.state !== 'done' && e.state !== 'returned')) return noticeText(HANDOFF_GATE, `hand-off ${ho.id} is ${effectiveText(e)} with no result to take`, `wait for its result, or /a5r handoff result ${ho.id} <ref>`)
    return (await files.write(io, ho, { ...ho, state: 'merged', updatedAt: await io.now() })) ?? `A5R · hand-off ${ho.id} merged: its claims are released.`
  }

  /** Decision 6: a done job's result into the hand-off; a merged PR whose score passed (or was passed) merges it. GitHub is
   * read at most once per 10 min per hand-off; a score that could not be read keeps the lines it had. */
  const settle = async (io: LinkIo, ho: Handoff, job: Job | null, now: number): Promise<Handoff> => {
    let next = ho
    const n = job?.result ? prNumberOf(job.result.ref) : null
    if (job?.state === 'done' && job.result && (ho.result.ref !== job.result.ref || (n !== null && ho.resultPr === undefined)))
      next = { ...ho, result: { ...ho.result, kind: job.result.kind, ref: job.result.ref }, ...(n !== null ? { resultPr: n } : {}), updatedAt: now }
    if (next.resultPr !== undefined && io.scorePr && now - (next.scoredAt ?? 0) >= SCORE_EVERY_MS) {
      const s = await io.scorePr(next.resultPr, next.intent.slug)
      const passed = s.ok === true || (s.state === 'MERGED' && s.ok === false && (await io.takePass?.([next.id, `#${next.resultPr}`])) === true)
      next = { ...next, scoredAt: now, scoreLines: s.ok === null ? (next.scoreLines ?? []) : passed ? [] : s.lines, ...(s.state === 'MERGED' && passed ? { state: 'merged' as const } : {}), updatedAt: now }
    }
    if (next === ho) return ho
    return (await files.write(io, ho, next)) ? ho : next
  }

  /** The status writer's part for one adapter hand-off: deliver until it lands, then keep the copy of the host's job. */
  const fetch = async (io: LinkIo, ho: Handoff, x: LinkHost): Promise<Handoff> => {
    const sent = ho.deliveredAt === undefined ? await deliver(io, ho, x) : ho
    if (!x.adapter.readFile || !x.a5rRoot) return sent
    const dir = a5rDirOf(x.a5rRoot)
    const r = await x.adapter.readFile(jobPath(dir, ho.id))
    const got = r.ok ? parseJob(r.value) : null
    if (!got || got.id !== ho.id) return sent
    const live = got.state === 'running' || got.state === 'parked'
    const [beat, pre] = live ? [await x.adapter.readFile(beatPath(dir, ho.id)), await x.adapter.readFile(preemptPath(dir, ho.id))] : [null, null]
    const job = withPreempt(withBeat(got, beatOf(beat?.ok ? beat.value : null)), preemptOf(pre?.ok ? pre.value : null))
    if (JSON.stringify(job) !== JSON.stringify(parseJob(await io.read(copyPath(ho.host, ho.id))))) await io.write(copyPath(ho.host, ho.id), JSON.stringify(job))
    return sent
  }

  /** The last notice key told per hand-off in this session (the notice id also dedups across reloads). */
  const said = new Map<string, string>()
  /** The minute, one pass: the status writer delivers, copies and settles (decisions 4 to 6); every session tells its own
   * hand-offs' transitions and gets each open L2 hand-off's effective state for the tile. */
  const follow = async (io: LinkIo, hosts: readonly LinkHost[], now: number, isWriter: boolean): Promise<{ notices: Notice[]; states: Map<string, string>; attention: NoticeKey[] }> => {
    const notices: Notice[] = []
    const attention: NoticeKey[] = [] // this session's hand-offs that need a person now (the compact line, F-d4)
    const states = new Map<string, string>()
    for (let ho of (await files.read(io)).filter(x => isOpen(x) && x.via)) {
      const x = hosts.find(s => s.id === ho.host)
      if (isWriter && x && ho.via === 'adapter') ho = await fetch(io, ho, x)
      const job = await answerOf(io, ho)
      const e = effectiveOf(ho, job, now) // before settle: a job done and merged in one minute is still told done
      if (isWriter) ho = await settle(io, ho, job, now)
      const key = noticeKey(e, job)
      if (ho.by?.id8 === h.me8() && key && needsPerson(key) && isOpen(ho)) attention.push(key)
      if (ho.by?.id8 === h.me8() && key && said.get(ho.id) !== key) {
        said.set(ho.id, key)
        const why = job?.reason ?? job?.result?.ref
        const next = key === 'done' ? `take the result; it merges ${ho.result.kind === 'pr' ? 'once the PR is merged and scored' : `with /a5r handoff merged ${ho.id}`}` : `cancel it (/a5r handoff cancel ${ho.id}) or hand it off again`
        notices.push({ id: `handoff:${ho.id}:${key}`, text: noticeText(`hand-off ${ho.id}`, `${key} on ${x?.label ?? ho.host}${why ? `: ${why}` : ''}`, next), isActionable: needsPerson(key) })
      }
      if (isOpen(ho)) states.set(ho.id, [effectiveText(effectiveOf(ho, job, now)), ...(ho.scoreLines?.length ? [`score: ${ho.scoreLines.join('; ')}`] : [])].join(' · '))
    }
    return { notices, states, attention }
  }

  return { create, merged, pasteResult, follow }
}
