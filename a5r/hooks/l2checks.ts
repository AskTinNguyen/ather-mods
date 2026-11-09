// a5r-hosts S-d (L2): the health checks that need the hand-off path. C12 sends a no-op hand-off through the real file
// path, origin to host only (D21: the inbox copy written with writeFile, the host's job read with readFile; no deliver,
// no reverse link) and waits for the host's a5r to answer it on its minute. C13 reads whether the host's card accepts
// this origin. Pure: the adapter, the clock and the wait are closures.
import type { Adapter } from './adapters/types.ts'
import type { Handoff } from './handoff.ts'
import type { HostCard } from './hostcard.ts'
import { INBOX_DIR, JOBS_DIR, a5rDirOf, inboxPath, jobPath, parseJob } from './jobs.ts'

/** What C12 and C13 read: the host's A5R root (where its inbox and jobs are), this origin's id, the host's card, and a
 * wait (the engine's clock in a5r, a simulated one in tests). */
export type L2Ctx = { hostId: string; a5rRoot?: string; originId: string; card: HostCard | null; sleep: (ms: number) => Promise<void>; waitMs?: number }
export type L2One = { status: 'pass' | 'fail' | 'skip'; value: string }

/** C12 waits this long for the host's minute to answer (two ticks and a margin). */
export const C12_WAIT_MS = 150_000
const POLL_MS = 10_000

/** The no-op hand-off C12 sends (read-only, wants nothing, claims nothing). */
export const noopHandoff = (id: string, from: string, host: string, now: number): Handoff => ({
  v: 1,
  id,
  createdAt: now,
  from,
  intent: { slug: 'a5r-c12' },
  task: 'C12: a no-op round trip (answer it and write done)',
  wants: [],
  base: { remote: 'origin', ref: '', sha: '' },
  claims: [],
  needs: { readOnly: true },
  proof: '',
  result: { kind: 'report' },
  host,
  state: 'proposed',
  noop: true,
  updatedAt: now,
})

export const c12 = async (a: Adapter, x: L2Ctx, now: () => Promise<number>): Promise<L2One> => {
  if (!x.a5rRoot) return { status: 'skip', value: 'no reach.options.a5rRoot: there is no inbox to write' }
  if (!a.writeFile || !a.readFile) return { status: 'skip', value: `the ${a.kind} adapter cannot write and read the host's files (NO_ADAPTER_OP)` }
  const t0 = await now()
  const id = `${x.originId.slice(-8)}-c12-${t0}`
  const dir = a5rDirOf(x.a5rRoot)
  const w = await a.writeFile(inboxPath(dir, id), JSON.stringify(noopHandoff(id, x.originId, x.hostId, t0)))
  if (!w.ok) return { status: 'fail', value: `the inbox copy ${INBOX_DIR}/${id}.json could not be written: ${w.error.text}` }
  const wait = x.waitMs ?? C12_WAIT_MS
  while ((await now()) - t0 < wait) {
    await x.sleep(POLL_MS)
    const r = await a.readFile(jobPath(dir, id))
    const job = r.ok ? parseJob(r.value) : null
    const secs = Math.round(((await now()) - t0) / 1000)
    if (job?.state === 'done') return { status: 'pass', value: `proposed -> accepted -> done in ${secs} s (inbox write, job read; no reverse link)` }
    if (job?.state === 'declined') return { status: 'fail', value: `the host declined the no-op job: ${job.reason ?? 'no reason'}` }
  }
  return { status: 'fail', value: `no answer in ${JOBS_DIR}/${id}.json after ${Math.round(wait / 1000)} s: the inbox copy was written, the host's a5r did not answer it (asHost.enabled? its status writer live?)` }
}

export const c13 = (x: L2Ctx): L2One => {
  const c = x.card
  if (!c) return { status: 'skip', value: 'no card read yet' }
  if (!c.acceptsFrom) return { status: 'skip', value: 'trust unknown' }
  return c.acceptsFrom.includes('*') || c.acceptsFrom.includes(x.originId)
    ? { status: 'pass', value: `origin ${x.originId} is accepted${c.acceptsFrom.includes('*') ? ' (any origin)' : ''}` }
    : { status: 'fail', value: `origin ${x.originId} is not in the host's trust list (accepts ${c.acceptsFrom.join(', ') || 'none'})` }
}
