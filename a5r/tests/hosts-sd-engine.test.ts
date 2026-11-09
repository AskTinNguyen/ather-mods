import { expect, test } from 'claude-code/testing'
import { HANDOFF_USAGE, parseHandoff } from '../hooks/handoff.ts'
import { FIX, checkLine, runChecks } from '../hooks/hostchecks.ts'
import { hostsDesk } from '../hooks/hostdesk.ts'
import { commandAdapter } from '../hooks/adapters/command.ts'
import { jobsDesk } from '../hooks/jobdesk.ts'
import { JOB_USAGE, parseJob } from '../hooks/jobs.ts'
import { AS_HOST, MIN, OPS, ORIGIN, create, ho, idOf, minute, pair, truth } from './hostpair.fixture.ts'
import { NOW } from './world.ts'

// a5r-hosts S-d (L2), part 1, through the desks of two machines: the origin hands off to a declared host over the real
// command adapter (its readFile and writeFile templates reach the host's files; it has no deliver: the reverse direction
// is cut), the host's a5r answers the inbox on its minute, a session there takes the job, reports progress and done; the
// origin's minute follows it to done, takes the PR and merges it once the PR is merged and scored (A7, D21). The same over
// manual (scenario 7); a failing score that keeps it at done; declines (scenario 3); startCommand and heartbeats
// (decisions 2, 3); NO_ADAPTER_OP and NO_EDITOR_PROTOCOL (decision 7, A16); C12 through the real file path.

test('S-d (A7, D21, A11 scenario 2): engine: proposed -> accepted -> running -> done -> merged over the command adapter with the reverse direction cut', async () => {
  const p = await pair({ scores: [{ state: 'OPEN', ok: true, lines: [] }, { state: 'MERGED', ok: true, lines: [] }] })
  const said = await create(p)
  const id = idOf(said)
  expect(said).toBe(`A5R · hand-off ${id} for Rig: delivered to its inbox. Its claims hold here; its job state shows in the Hosts tile.`)
  // D21: the origin wrote the inbox copy on the host (origin to host only; the adapter has no deliver).
  expect(parseHandoff(p.host.files.get(`D:/h/Saved/A5R/inbox/${id}.json`) ?? null)?.state).toBe('proposed')
  expect(ho(p, id)?.deliveredAt).toBe(NOW)
  expect(p.reached.some(r => /send|deliver/.test(r))).toBe(false)
  // The host's minute accepts; the origin's minute copies the job.
  expect(await minute(p)).toEqual([])
  expect(parseJob(p.host.files.get(`D:/h/Saved/A5R/jobs/${id}.json`) ?? null)?.state).toBe('accepted')
  expect(parseJob(p.origin.files.get(`E:/o/Saved/A5R/hosts/rig/jobs/${id}.json`) ?? null)?.state).toBe('accepted')
  // No startCommand: the host's tile names the waiting job; a session there takes it (the first idle lane).
  expect(await p.hd.command(p.hio, `job take ${id}`)).toBe(`A5R · job ${id} taken: lane l1, session cd56ef78. Report with /a5r job progress|done|fail ${id}.`)
  expect(await p.hd.command(p.hio, `job progress ${id} "built it"`)).toBe(`A5R · job ${id}: progress noted.`)
  await minute(p)
  expect(parseJob(p.origin.files.get(`E:/o/Saved/A5R/hosts/rig/jobs/${id}.json`) ?? null)?.state).toBe('running')
  expect(await p.hd.command(p.hio, `job done ${id} #42`)).toBe(`A5R · job ${id} done: #42. Its origin reads it on its next minute.`)
  // The origin tells the session that created it once; takes the PR (decision 6); OPEN: not merged yet.
  const told = await minute(p)
  expect(told.map(n => [n.id, n.isActionable])).toEqual([[`handoff:${id}:done`, false]])
  expect(told[0]?.text).toBe(`A5R · hand-off ${id} — done on Rig: #42 → take the result; it merges once the PR is merged and scored`)
  expect([ho(p, id)?.state, ho(p, id)?.resultPr, ho(p, id)?.result.ref, p.scored]).toEqual(['proposed', 42, '#42', [42]])
  expect(await minute(p)).toEqual([]) // told once
  expect(p.scored).toEqual([42]) // GitHub read at most once per 10 min
  await minute(p, 10 * MIN)
  expect([ho(p, id)?.state, p.scored]).toEqual(['merged', [42, 42]])
  // Merged: the claims are released (no open hand-off), the host's file never changed by the origin.
  expect(p.od.handoffs.open()).toEqual([])
})

test('S-d (A7): engine: a failing PR score keeps the hand-off at done (its lines in the tile) and out of merged; /a5r pass <id> lets it merge', async () => {
  const p = await pair({ scores: [{ state: 'MERGED', ok: false, lines: ['R2 study', 'R5 honest'] }, { state: 'MERGED', ok: false, lines: ['R2 study'] }] })
  const id = idOf(await create(p))
  await minute(p)
  await p.hd.command(p.hio, `job take ${id}`)
  await p.hd.command(p.hio, `job done ${id} https://github.com/o/r/pull/77`)
  await minute(p)
  expect([ho(p, id)?.state, ho(p, id)?.resultPr, ho(p, id)?.scoreLines]).toEqual(['proposed', 77, ['R2 study', 'R5 honest']])
  expect(p.passes).toEqual([[id, '#77']])
  expect(await p.od.command(p.oio, `handoff merged ${id}`)).toBe(`A5R · handoff — hand-off ${id}'s result is a PR → it becomes merged once the PR is merged and its score passed (or /a5r pass ${id})`)
  const pp = await pair({ scores: [{ state: 'MERGED', ok: false, lines: ['R2 study'] }], pass: true })
  const id2 = idOf(await create(pp))
  await minute(pp)
  await pp.hd.command(pp.hio, `job take ${id2}`)
  await pp.hd.command(pp.hio, `job done ${id2} #78`)
  await minute(pp)
  expect(ho(pp, id2)?.state).toBe('merged')
})

test('S-d (A7, A11 scenario 7): engine: the same path over manual: the packet, the pasted result, done, then merged', async () => {
  const p = await pair({ manual: true, scores: [{ state: 'MERGED', ok: true, lines: [] }] })
  const said = await create(p)
  const id = /hand-off (\S+) for/.exec(said)?.[1] ?? ''
  expect(said.split('\n')[0]).toBe(`A5R · hand-off ${id} for Rig (manual). Give this packet to a person there:`)
  expect(said).toContain(`Back here: /a5r handoff result ${id} <PR url | #N | branch | report path>`)
  expect(await p.od.command(p.oio, `handoff packet ${id}`)).toContain(`Hand-off ${id} for Rig (manual: a person carries this).`)
  expect(p.host.files.size).toBe(1) // only the host's own hosts file: nothing crossed
  await minute(p)
  expect(ho(p, id)?.state).toBe('proposed')
  await p.od.command(p.oio, `handoff result ${id} #43`)
  expect(parseJob(p.origin.files.get(`E:/o/Saved/A5R/handoffs/${id}.manual-in.json`) ?? null)).toEqual({ v: 1, id, receivedAt: p.clock.now, state: 'done', result: { kind: 'pr', ref: '#43' }, source: 'manual', updatedAt: p.clock.now })
  const told = await minute(p)
  expect(told.map(n => n.id)).toEqual([`handoff:${id}:done`])
  expect([ho(p, id)?.state, ho(p, id)?.resultPr]).toEqual(['merged', 43])
  // A branch result merges by the explicit command (F-a4).
  const q = await pair({ manual: true })
  const id3 = idOf(await create(q, { kind: 'branch' }))
  expect(await q.od.command(q.oio, `handoff merged ${id3}`)).toBe(`A5R · handoff — hand-off ${id3} is proposed with no result to take → wait for its result, or /a5r handoff result ${id3} <ref>`)
  expect(await q.od.command(q.oio, `handoff result ${id3} intent/x-done`)).toBe(`A5R · hand-off ${id3}: result intent/x-done pasted (done); the next minute takes it in.`)
  await minute(q)
  expect(await q.od.command(q.oio, `handoff merged ${id3}`)).toBe(`A5R · hand-off ${id3} merged: its claims are released.`)
})

test('S-d (A7, D12, A11 scenario 3): engine: a teammate\'s host declines (NO_TRUST, NO_ROLE, UNAVAILABLE outside its window) and the creating session is told once, with the code', async () => {
  const p = await pair({ asHost: { trust: ['bob-00000000'] } })
  const id = idOf(await create(p))
  const told = await minute(p)
  expect(told).toEqual([{ id: `handoff:${id}:declined`, text: `A5R · hand-off ${id} — declined on Rig: NO_TRUST origin ${ORIGIN} is not in this host's trust list → cancel it (/a5r handoff cancel ${id}) or hand it off again`, isActionable: true }])
  expect(await minute(p)).toEqual([])
  const r = await pair()
  expect(await r.hd.command(r.hio, 'job take nope')).toBe('A5R · job — no job nope on this host → list them: /a5r job list')
  const id2 = idOf(await create(r, { wants: ['mocap'] }))
  expect((await minute(r))[0]?.text).toContain('declined on Rig: NO_ROLE this host has no role mocap')
  const night = await pair({ asHost: { availability: { state: 'yes', windows: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], from: '22:00', to: '06:00', tz: 'UTC' }] } } })
  const id3 = idOf(await create(night))
  expect((await minute(night))[0]?.text).toContain('declined on Rig: UNAVAILABLE outside its windows')
  void id2
  void id3
})

test('S-d (decisions 2, 3, A16): engine: startCommand starts an accepted job once (argv, no shell); heartbeats while its session is alive; a job by another session or a hand edit is refused; the card counts jobs', async () => {
  const p = await pair({ asHost: { startCommand: ['hc', 'run', '--bg', 'claude', '-p', 'run {packet}', '--name', 'job-{id}'] } })
  const id = idOf(await create(p))
  await minute(p)
  await minute(p)
  expect(p.host.started).toEqual([['hc', 'run', '--bg', 'claude', '-p', `run D:/h/Saved/A5R/inbox/${id}.json`, '--name', `job-${id}`]])
  expect(JSON.parse(p.host.files.get(`D:/h/Saved/A5R/jobs/${id}.start`) ?? '{}')).toEqual({ at: NOW + MIN, ok: true, said: 'exit 0' })
  expect(parseJob(p.host.files.get(`D:/h/Saved/A5R/jobs/${id}.json`) ?? null)?.state).toBe('accepted') // the minute never rewrites the job
  // The card the host publishes counts it (queued: accepted, no session yet).
  expect(JSON.parse(p.host.files.get('D:/h/Saved/A5R/card.json') ?? '{}').jobs).toEqual({ running: 0, queued: 1 })
  await p.hd.command(p.hio, `job take ${id}`)
  const t0 = p.clock.now
  await minute(p, 2 * MIN)
  expect(p.host.files.get(`D:/h/Saved/A5R/jobs/${id}.beat`)).toBe(String(t0 + 2 * MIN)) // the beat, a file of its own
  expect(parseJob(p.origin.files.get(`E:/o/Saved/A5R/hosts/rig/jobs/${id}.json`) ?? null)?.heartbeatAt).toBe(t0 + 2 * MIN) // folded into the origin's copy
  expect(JSON.parse(p.host.files.get('D:/h/Saved/A5R/card.json') ?? '{}').jobs).toEqual({ running: 1, queued: 0 })
  // Another session on the host cannot report it; an origin-side session is not a host.
  const other = hostsDesk({ dir: () => 'D:/h/Saved/A5R', root: () => 'D:/h', me8: () => 'ffff0000', lane: () => 'x', home: () => 'C:/Users/h', isWriter: () => false, alive: () => true, local: () => truth() })
  expect(await other.command(p.hio, `job done ${id} #1`)).toBe(`A5R · job — job ${id} is run by session cd56ef78 → only that session reports it; or /a5r job take ${id} once it is parked`)
  expect(await p.od.command(p.oio, `job done ${id} #1`)).toBe('A5R · job — this machine serves no one (asHost is not enabled) → jobs live on a host: /a5r host set --asHost …')
  expect(await p.hd.command(p.hio, `job fail ${id}`)).toBe(`A5R · job — failed needs a reason (a code, then text) → ${JOB_USAGE}`)
  expect((await p.hd.touch(p.hio, [`Saved/A5R/jobs/${id}.json`])).deny).toBe(`A5R · job — Saved/A5R/inbox and Saved/A5R/jobs are written by a5r alone (the origin's delivery, this host's answer) → ${JOB_USAGE}`)
  // Its session gone: no heartbeat; the origin shows silent, then lost (told once).
  const q = await pair()
  const id2 = idOf(await create(q))
  await minute(q)
  await q.hd.command(q.hio, `job take ${id2}`)
  const dead = hostsDesk({ dir: () => 'D:/h/Saved/A5R', root: () => 'D:/h', me8: () => 'cd56ef78', lane: () => 'x', home: () => 'C:/Users/h', isWriter: () => true, alive: () => false, local: () => truth() })
  q.clock.now += 16 * MIN
  await dead.tick(q.hio, q.clock.now)
  const lost = await q.od.tick(q.oio, q.clock.now)
  expect(lost.map(n => [n.id, n.isActionable])).toEqual([[`handoff:${id2}:lost`, true]])
})

test('S-d (decision 7, A16): engine: NO_ADAPTER_OP without an inbox to write; NO_EDITOR_PROTOCOL for a PIE or build job on a probe-only host whose lock cannot be read', async () => {
  const p = await pair()
  // The declaration without a5rRoot: no inbox.
  await p.od.command(p.oio, `host add rig --reach command:rig --ops '${JSON.stringify({ probe: ['q', 'ping'] })}'`)
  expect(await create(p)).toBe('A5R · handoff — NO_ADAPTER_OP: the command adapter of rig cannot write the host\'s inbox (no writeFile) → declare reach.options.a5rRoot (/a5r host set rig), use an adapter with writeFile, or record it by hand (manual)')
  const q = await pair()
  // A probe card (no A5R there), Editor state unread: a PIE job is refused; a job that needs no Editor goes.
  q.origin.files.set('E:/o/Saved/A5R/hosts/rig/card.json', JSON.stringify({ v: 1, at: q.clock.now, source: 'probe', machine: { freeRamGb: 40, totalRamGb: 64, freeDiskGb: null }, editor: { holder: null, queue: 0, running: 'unknown' }, availability: { state: 'unknown' }, freeze: null, lanes: [], jobs: { running: 0, queued: 0 }, account: { shared: 'unknown' }, skew: { ms: null } }))
  expect(await create(q, { needs: { pie: true } })).toBe('A5R · handoff — NO_EDITOR_PROTOCOL: rig runs no A5R and its Editor lock could not be read → hand off a job that needs no Editor, or install A5R on the host')
  expect(await create(q, { needs: { readOnly: true } })).toContain('delivered to its inbox')
  // The command's words typed into needs: pie=true reaches the same check.
  expect(await q.od.command(q.oio, 'handoff record host=rig branch=intent/x task="t" pie=true')).toBe('A5R · handoff — NO_EDITOR_PROTOCOL: rig runs no A5R and its Editor lock could not be read → hand off a job that needs no Editor, or install A5R on the host')
  // An L0 record (no declared host) is unchanged, and packet/merged are for declared hosts only.
  expect(await q.od.tool(q.oio, { action: 'handoff', op: 'packet', id: 'x' })).toBe(`A5R · handoff — packet is for a hand-off to a declared host → ${HANDOFF_USAGE}`)
})

test('S-d (A3): engine: C12 sends a no-op hand-off through the real file path (inbox write, job read) with the reverse direction absent; it passes when the host answers, fails with what stalled, skips with no inbox', async () => {
  const p = await pair()
  // The same command adapter the origin built, rebuilt here with the same templates: no deliver.
  const adapter = commandAdapter('rig', { ops: JSON.parse(OPS), a5rRoot: 'D:/h' }, p.oio.proc)
  expect(adapter.deliver).toBe(undefined)
  const host = jobsDesk({ coord: () => 'D:/h/Saved/A5R', coordRoot: () => 'D:/h', me8: () => 'cd56ef78' })
  const l2 = (sleep: (ms: number) => Promise<void>, a5rRoot: string | undefined = 'D:/h', waitMs?: number) => ({ hostId: 'rig', ...(a5rRoot ? { a5rRoot } : {}), originId: ORIGIN, card: null, sleep, ...(waitMs ? { waitMs } : {}) })
  // The host's minute runs while C12 waits (the simulated clock moves with each wait).
  const answering = async (ms: number) => {
    p.clock.now += ms
    await host.tick(p.hio, { asHost: { ...AS_HOST, availability: { state: 'yes' } } as never, now: p.clock.now, frozen: false, lanes: [], alive: () => true, warnMs: 15 * MIN })
  }
  const ctx = (sleep: (ms: number) => Promise<void>, a5rRoot?: string, waitMs?: number) => ({ adapter, local: async () => null, now: async () => p.clock.now, prior: { C1: { status: 'pass' as const, checkedAt: p.clock.now } }, os: { os: 'windows' as const, shell: 'cmd' as const }, l2: l2(sleep, a5rRoot, waitMs) })
  const ok = await runChecks(ctx(answering), ['C12'], 7 * 24 * 60 * MIN)
  expect(checkLine('C12', ok.checks.C12)).toBe('C12 pass · proposed -> accepted -> done in 10 s (inbox write, job read; no reverse link)')
  // Nobody answers: fail with what stalled, then the fix line.
  const quiet = await runChecks(ctx(async ms => void (p.clock.now += ms)), ['C12'], 7 * 24 * 60 * MIN)
  expect(checkLine('C12', quiet.checks.C12)).toMatch(/^C12 fail · no answer in jobs\/1a2b3c4d-c12-\d+\.json after 150 s: the inbox copy was written, the host's a5r did not answer it \(asHost\.enabled\? its status writer live\?\) → /)
  expect(checkLine('C12', quiet.checks.C12).endsWith(FIX.C12)).toBe(true)
  const none = await runChecks(ctx(answering, ''), ['C12'], 7 * 24 * 60 * MIN)
  expect(checkLine('C12', none.checks.C12)).toBe('C12 skip · no reach.options.a5rRoot: there is no inbox to write')
})
