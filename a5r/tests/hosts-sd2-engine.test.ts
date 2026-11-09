import { expect, test } from 'claude-code/testing'
import { parseHandoff } from '../hooks/handoff.ts'
import { hostsDesk } from '../hooks/hostdesk.ts'
import { parseJob, type Job } from '../hooks/jobs.ts'
import { AS_HOST, MIN, SHA, create, ho, idOf, minute, pair, truth, type Pair } from './hostpair.fixture.ts'
import { NOW } from './world.ts'

// a5r-hosts S-d part 2, through the desks of two machines on a simulated clock: preemption (A8: availability to no, the
// running job's session told, park with a pushed WIP branch, resume when available, return, lost past the deadline),
// sync interplay (A10: the base warned once at the cutoff; a frozen local sync never stops the hand-off's flow), a bot
// with its own queue (A11 scenario 4) and a host without A5R run by a plain runner (A11 scenario 6).
const PUSHED = { 'ls-remote origin refs/heads/wip/x': `${SHA}\trefs/heads/wip/x\n`, 'ls-remote origin refs/heads/main': `${SHA}\trefs/tags/release/main\n` }
const job = (p: Pair, id: string): Job | null => parseJob(p.host.files.get(`D:/h/Saved/A5R/jobs/${id}.json`) ?? null)
const setAvail = (p: Pair, availability: Record<string, unknown>) => p.hd.tool(p.hio, { action: 'set', asHost: { ...AS_HOST, availability } })
const running = async (p: Pair): Promise<string> => {
  const id = idOf(await create(p))
  await minute(p)
  await p.hd.command(p.hio, `job take ${id}`)
  return id
}

test('S-d (A8): engine: availability to no preempts the running job: its session is told, it parks with a pushed WIP branch (an unpushed one is refused), resumes only when available, and finishes', async () => {
  const p = await pair({ hostRuns: PUSHED })
  const id = await running(p)
  await setAvail(p, { state: 'no', reason: 'owner is back' })
  p.clock.now += MIN
  const hostTold = await p.hd.tick(p.hio, p.clock.now)
  const deadline = p.clock.now + 15 * MIN
  expect(hostTold).toEqual([{ id: `job:${id}:preempt:${p.clock.now}`, text: `A5R · job ${id} — preempted: owner is back; deadline ${new Date(deadline).toISOString()} → reach a safe point, push a WIP branch, then /a5r job park ${id} <branch>`, isActionable: true }])
  expect(JSON.parse(p.host.files.get(`D:/h/Saved/A5R/jobs/${id}.preempt`) ?? '{}')).toEqual({ at: p.clock.now, reason: 'owner is back', deadline })
  expect(job(p, id)?.preempt).toBe(undefined) // the job file is its session's; the preemption is a file of its own
  // The origin reads it and tells the session that created the hand-off.
  const originTold = await p.od.tick(p.oio, p.clock.now)
  expect(originTold.map(n => [n.id, n.isActionable])).toEqual([[`handoff:${id}:preempt`, true]])
  // Only the exact branch counts: a tag or another ref ending in the name is not the pushed WIP branch.
  expect(await p.hd.command(p.hio, `job park ${id} main`)).toBe(`A5R · job — main is not on the remote → push it (git push origin main), then /a5r job park ${id} main`)
  expect(await p.hd.tool(p.hio, { action: 'job', op: 'park', id, ref: '--upload-pack=x' })).toBe(`A5R · job — --upload-pack=x is not on the remote → push it (git push origin --upload-pack=x), then /a5r job park ${id} --upload-pack=x`)
  expect(await p.hd.command(p.hio, `job park ${id} wip/nope`)).toBe(`A5R · job — wip/nope is not on the remote → push it (git push origin wip/nope), then /a5r job park ${id} wip/nope`)
  expect(await p.hd.command(p.hio, `job park ${id} wip/x`)).toBe(`A5R · job ${id} parked at wip/x. Take it again when the host is available, or return it.`)
  expect([job(p, id)?.state, job(p, id)?.wip, job(p, id)?.preempt]).toEqual(['parked', 'wip/x', undefined]) // the preemption stays in its own file
  expect(await p.hd.command(p.hio, `job take ${id}`)).toBe(`A5R · job — job ${id} is parked and this host is not available (owner is back) → take it when availability is back, or /a5r job return ${id} <CODE> [text]`)
  await setAvail(p, { state: 'yes' })
  expect(await p.hd.command(p.hio, `job take ${id}`)).toBe(`A5R · job ${id} taken: lane l1, session cd56ef78. Report with /a5r job progress|done|fail ${id}.`)
  await minute(p)
  expect(job(p, id)?.preempt).toBe(undefined) // the old preemption no longer holds after the resume
  expect(await p.hd.command(p.hio, `job done ${id} #50`)).toContain('done: #50')
  expect((await minute(p)).map(n => n.id)).toEqual([`handoff:${id}:done`])
})

test('S-d (A8): engine: within warnBeforeUntilMin of until the job is preempted with deadline until; with no park by the deadline the origin shows lost; a parked job can be returned', async () => {
  const p = await pair()
  const id = await running(p)
  const until = p.clock.now + 20 * MIN
  await setAvail(p, { state: 'yes', until })
  await minute(p, 4 * MIN) // 16 min left: no preemption yet
  expect(p.host.files.has(`D:/h/Saved/A5R/jobs/${id}.preempt`)).toBe(false)
  expect((await minute(p, 2 * MIN)).map(n => n.id)).toEqual([`handoff:${id}:preempt`]) // 14 min left: preempted, deadline until
  expect(JSON.parse(p.host.files.get(`D:/h/Saved/A5R/jobs/${id}.preempt`) ?? '{}').deadline).toBe(until)
  // Heartbeats go on (the session is alive), but nobody parks: past the deadline the origin shows lost, once.
  let told: { id: string }[] = []
  for (let i = 0; i < 15; i++) told = [...told, ...(await minute(p))]
  expect(told.map(n => n.id)).toEqual([`handoff:${id}:lost`])
  const q = await pair({ hostRuns: PUSHED })
  const id2 = await running(q)
  await setAvail(q, { state: 'no' })
  await minute(q)
  await q.hd.command(q.hio, `job park ${id2} wip/x`)
  expect(await q.hd.command(q.hio, `job return ${id2} OWNER needs the machine`)).toBe(`A5R · job ${id2} returned: OWNER.`)
  expect((await minute(q)).map(n => [n.id, n.text.includes('returned on Rig: OWNER needs the machine')])).toEqual([[`handoff:${id2}:returned`, true]])
})

test('S-d (A10, D10): engine: at the local sync cutoff an open hand-off whose base is no longer reachable is warned once; a frozen local sync never stops a hand-off: it is created, delivered and followed', async () => {
  const sync = { at: NOW + 20 * MIN, hardEnd: NOW + 65 * MIN, isFrozen: false }
  const t = { sync: null as typeof sync | null }
  const p = await pair({ originTruth: () => truth({ sync: t.sync }) })
  const id = idOf(await create(p))
  await minute(p)
  // Before the cutoff nothing is checked; the branch is then force-moved on the remote: the base sha is no longer its tip
  // nor an ancestor of it.
  p.oruns['ls-remote'] = `${'f'.repeat(40)}\trefs/heads/intent/x\n`
  expect(await p.od.tick(p.oio, p.clock.now)).toEqual([])
  t.sync = sync // within 30 min of the sync: its cutoff
  const warned = await p.od.tick(p.oio, p.clock.now)
  expect(warned.map(n => [n.id, n.isActionable])).toEqual([[`handoff:${id}:base:${sync.at}`, true]])
  expect(warned[0]?.text).toBe(`A5R · hand-off ${id} — at the sync cutoff its base ${SHA.slice(0, 7)} is no longer reachable from origin/intent/x → the lane on the host goes on (the sync never waits on it); push the base again, or cancel and hand it off from the new base`)
  expect(await p.od.tick(p.oio, p.clock.now + MIN)).toEqual([]) // once per sync
  // Frozen: the local sync's freeze does not stop the flow (a new base on the remote, a new hand-off, its job).
  t.sync = { ...sync, isFrozen: true }
  p.oruns['ls-remote'] = `${SHA}\trefs/heads/intent/x\n`
  await p.hd.command(p.hio, `job take ${id}`)
  await p.hd.command(p.hio, `job done ${id} #60`)
  expect((await minute(p)).map(n => n.id)).toContain(`handoff:${id}:done`)
  const q = await pair({ originTruth: () => truth({ sync: { ...sync, isFrozen: true } }) })
  expect(await create(q)).toContain('delivered to its inbox')
  // The host's own freeze is its decline (decision 1), and suggest's FROZEN (S-c).
  const r = await pair()
  const frozenHost = hostsDesk({ dir: () => 'D:/h/Saved/A5R', root: () => 'D:/h', me8: () => 'cd56ef78', lane: () => 'x', home: () => 'C:/Users/h', isWriter: () => true, alive: () => true, local: () => truth({ sync: { ...sync, isFrozen: true } }) })
  const id3 = idOf(await create(r))
  r.clock.now += MIN
  await frozenHost.tick(r.hio, r.clock.now)
  expect(job(r, id3)?.reason).toBe("FROZEN this host's own sync freeze is on")
})

test('S-d (A11 scenario 4): engine: a bot with its own queue: the command adapter submits to it, the queue writes the job file in the exportable form, the origin follows it to done and merged', async () => {
  const p = await pair({ scores: [{ state: 'MERGED', ok: true, lines: [] }] })
  const id = idOf(await create(p, { wants: [] }))
  // The queue system (not A5R) took the inbox file and writes the job file's fields as it moves.
  const queue = (state: Job['state'], more: Partial<Job> = {}) => p.host.files.set(`D:/h/Saved/A5R/jobs/${id}.json`, JSON.stringify({ v: 1, id, receivedAt: NOW, state, updatedAt: p.clock.now, ...more }))
  expect(parseHandoff(p.host.files.get(`D:/h/Saved/A5R/inbox/${id}.json`) ?? null)?.id).toBe(id)
  queue('accepted')
  p.clock.now += MIN
  await p.od.tick(p.oio, p.clock.now)
  queue('running', { startedAt: p.clock.now, heartbeatAt: p.clock.now, progress: 'queued job 77 running' })
  p.clock.now += MIN
  await p.od.tick(p.oio, p.clock.now)
  expect(ho(p, id)?.state).toBe('proposed')
  queue('done', { result: { kind: 'pr', ref: 'https://github.com/o/s2/pull/88' } })
  p.clock.now += MIN
  const told = await p.od.tick(p.oio, p.clock.now)
  expect([told.map(n => n.id), ho(p, id)?.state, ho(p, id)?.resultPr]).toEqual([[`handoff:${id}:done`], 'merged', 88])
})

test('S-d (A11 scenario 6): engine: a host without A5R: a plain runner reads the inbox and writes the job file; the origin follows it with the reverse direction cut', async () => {
  const p = await pair()
  const id = idOf(await create(p, { wants: [], needs: { readOnly: true } }))
  /** The plain runner (S-e ships the reference one): the job file's fields, nothing else of A5R. */
  const runner = (steps: Partial<Job>[]) => {
    for (const s of steps) {
      const prev = parseJob(p.host.files.get(`D:/h/Saved/A5R/jobs/${id}.json`) ?? null)
      p.host.files.set(`D:/h/Saved/A5R/jobs/${id}.json`, JSON.stringify({ v: 1, id, receivedAt: prev?.receivedAt ?? p.clock.now, state: 'accepted', ...prev, ...s, updatedAt: p.clock.now }))
    }
  }
  expect(p.host.files.has(`D:/h/Saved/A5R/inbox/${id}.json`)).toBe(true)
  runner([{ state: 'accepted' }, { state: 'running', startedAt: p.clock.now, heartbeatAt: p.clock.now }])
  p.clock.now += 5 * MIN // no heartbeat for 5 min: silent on the tile
  await p.od.tick(p.oio, p.clock.now)
  const tile = JSON.stringify(p.od.boxes({ Box: (x: Record<string, unknown>) => x, Text: (x: Record<string, unknown>) => x } as never, p.clock.now, { ink: '#fff', quiet: '#888' }))
  expect(tile).toContain('running (silent)')
  runner([{ state: 'done', result: { kind: 'report', ref: 'reports/x.md' } }])
  p.clock.now += MIN
  expect((await p.od.tick(p.oio, p.clock.now)).map(n => n.id)).toEqual([`handoff:${id}:done`])
  await p.od.tick(p.oio, p.clock.now + MIN)
  expect(await p.od.command(p.oio, `handoff merged ${id}`)).toBe(`A5R · hand-off ${id} merged: its claims are released.`)
})
