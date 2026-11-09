import { expect, test } from 'claude-code/testing'
import { COMMAND_OPS, commandAdapter, fill, opsProblems } from '../hooks/adapters/command.ts'
import { handleOf, herdrAdapter, noHcText, runStateOf } from '../hooks/adapters/herdr.ts'
import { OP_NAMES, callOp, type Adapter, type Proc, type RunOut } from '../hooks/adapters/types.ts'
import { needsOf, parseHandoff, prNumberOf, type Handoff } from '../hooks/handoff.ts'
import { packetText } from '../hooks/handofflink.ts'
import type { HostCard } from '../hooks/hostcard.ts'
import { FIX, checkLine, runChecks } from '../hooks/hostchecks.ts'
import type { AsHost } from '../hooks/hosts.ts'
import { coordinationFor, declProblems } from '../hooks/hosts.ts'
import { JOB_STATES, answerOf, effectiveOf, jobCounts, mayJobMove, noticeKey, parseJob, type Job, type JobState } from '../hooks/jobs.ts'
import { c13 } from '../hooks/l2checks.ts'

// a5r-hosts S-d (L2), part 1, unit: the job state machine with its illegal steps (A7), the host's answer and its decline
// codes in decision 1's order, the effective state with unanswered, silent and lost from time, the herdr and command
// adapters on a fake transport (A4's contract), C13's pass, fail and skip, and the hand-off's L2 fields.
const NOW = Date.UTC(2026, 10, 10, 9, 0)
const MIN = 60_000
const AS: AsHost = { enabled: true, roles: ['ue', 'mocap'], trust: ['hai-1a2b3c4d'], availability: { state: 'yes' } }
const HO: Handoff = {
  v: 1,
  id: '1a2b3c4d-2611100900-1',
  createdAt: NOW,
  from: 'hai-1a2b3c4d',
  by: { id8: 'ab12cd34', lane: 'lane' },
  intent: { slug: 'x', branch: 'intent/x' },
  task: 'do x',
  wants: ['ue'],
  base: { remote: 'origin', ref: 'intent/x', sha: 'abc1234' },
  claims: [],
  needs: {},
  proof: '',
  result: { kind: 'pr' },
  host: 'rig',
  state: 'proposed',
  via: 'adapter',
  updatedAt: NOW,
}
const job = (state: JobState, more: Partial<Job> = {}): Job => ({ v: 1, id: HO.id, receivedAt: NOW, state, updatedAt: NOW, ...more })

test('S-d (A7): unit: the job state machine allows only section 5 steps; every illegal one is refused', () => {
  const legal: [JobState | null, JobState][] = [
    [null, 'accepted'],
    [null, 'declined'],
    ['accepted', 'running'],
    ['running', 'running'],
    ['running', 'done'],
    ['running', 'failed'],
    ['running', 'parked'],
    ['running', 'returned'],
    ['parked', 'running'],
    ['parked', 'returned'],
  ]
  for (const from of [null, ...JOB_STATES])
    for (const to of JOB_STATES) expect([from, to, mayJobMove(from, to)]).toEqual([from, to, legal.some(([a, b]) => a === from && b === to)])
  // Illegal examples, named: a new job cannot start running, a done one cannot fail, a declined one cannot be accepted.
  expect([mayJobMove(null, 'running'), mayJobMove('done', 'failed'), mayJobMove('declined', 'accepted'), mayJobMove('accepted', 'done')]).toEqual([false, false, false, false])
})

test('S-d (A7, D12, D13): unit: the host answers in decision 1 order: SECRET, NO_TRUST, NO_ROLE, UNAVAILABLE, FROZEN, BUSY, else accepted', () => {
  const x = { asHost: AS, now: NOW, frozen: false, active: 0, secrets: ['ghp_[A-Za-z0-9]{10}'] }
  const raw = JSON.stringify(HO)
  expect(answerOf(raw, HO, x)).toEqual({ v: 1, id: HO.id, receivedAt: NOW, state: 'accepted', updatedAt: NOW })
  const code = (j: Job) => `${j.state} ${(j.reason ?? '').split(' ')[0]}`
  // All wrong at once: the first in the order wins.
  const all = { ...x, asHost: { ...AS, trust: [], roles: [], availability: { state: 'no' as const } }, frozen: true, active: 5 }
  expect(code(answerOf(`${raw} ghp_abcdefghij`, HO, all))).toBe('declined SECRET')
  expect(code(answerOf(raw, HO, all))).toBe('declined NO_TRUST')
  expect(code(answerOf(raw, HO, { ...all, asHost: { ...all.asHost, trust: ['*'] } }))).toBe('declined NO_ROLE')
  expect(code(answerOf(raw, HO, { ...all, asHost: { ...all.asHost, trust: ['*'], roles: ['ue'] } }))).toBe('declined UNAVAILABLE')
  expect(code(answerOf(raw, HO, { ...x, frozen: true, active: 5 }))).toBe('declined FROZEN')
  expect(code(answerOf(raw, HO, { ...x, active: 1 }))).toBe('declined BUSY')
  expect(code(answerOf(raw, HO, { ...x, active: 1, asHost: { ...AS, capacity: { ramGb: 64, maxEditors: 1, maxJobs: 2 } } }))).toBe('accepted ')
  expect(answerOf(raw, HO, { ...x, asHost: { ...AS, availability: { state: 'yes', until: NOW - 1 } } }).reason).toBe('UNAVAILABLE past its until')
})

test('S-d (A7): unit: the effective state: the origin wins for merged and cancelled; flags from time (undelivered, unanswered after 30 min, silent after 3 min, lost after 15 or past a preempt deadline)', () => {
  expect(effectiveOf({ ...HO, state: 'merged' }, job('done'), NOW)).toEqual({ state: 'merged' })
  expect(effectiveOf({ ...HO, state: 'cancelled' }, job('running'), NOW)).toEqual({ state: 'cancelled' })
  expect(effectiveOf(HO, null, NOW)).toEqual({ state: 'proposed', flag: 'undelivered' })
  expect(effectiveOf({ ...HO, deliveredAt: NOW }, null, NOW + 30 * MIN)).toEqual({ state: 'proposed' })
  expect(effectiveOf({ ...HO, deliveredAt: NOW }, null, NOW + 30 * MIN + 1)).toEqual({ state: 'proposed', flag: 'unanswered' })
  expect(effectiveOf({ ...HO, via: undefined }, null, NOW)).toEqual({ state: 'proposed' })
  const run = job('running', { startedAt: NOW, heartbeatAt: NOW })
  expect(effectiveOf(HO, run, NOW + 3 * MIN)).toEqual({ state: 'running' })
  expect(effectiveOf(HO, run, NOW + 3 * MIN + 1)).toEqual({ state: 'running', flag: 'silent' })
  expect(effectiveOf(HO, run, NOW + 15 * MIN + 1)).toEqual({ state: 'running', flag: 'lost' })
  expect(effectiveOf(HO, { ...run, preempt: { at: NOW, reason: 'owner', deadline: NOW + MIN } }, NOW + 2 * MIN)).toEqual({ state: 'running', flag: 'lost' })
  expect(effectiveOf(HO, job('declined', { reason: 'NO_ROLE x' }), NOW)).toEqual({ state: 'declined' })
  // Which transitions tell the session (decision 4).
  expect(['declined', 'failed', 'returned', 'done', 'accepted', 'running'].map(s => noticeKey({ state: s as JobState }, null))).toEqual(['declined', 'failed', 'returned', 'done', null, null])
  expect(noticeKey({ state: 'running', flag: 'lost' }, run)).toBe('lost')
  expect(jobCounts([job('running'), job('accepted'), job('parked'), job('done')])).toEqual({ running: 1, queued: 2 })
})

test('S-d (A7): unit: a job and a hand-off\'s L2 fields read back; needs typed field by field; a PR number from a result ref; the manual packet', () => {
  const j = job('done', { result: { kind: 'pr', ref: 'https://github.com/o/r/pull/42' }, source: 'manual', heartbeatAt: NOW })
  expect(parseJob(JSON.stringify(j))).toEqual(j)
  expect([parseJob('{"v":1,"id":"x","state":"weird","receivedAt":1}'), parseJob('nope')]).toEqual([null, null])
  const ho = { ...HO, needs: { pie: true, ramGb: 30 }, deliveredAt: NOW, resultPr: 42, scoreLines: ['R3 unity'], noop: true }
  expect(parseHandoff(JSON.stringify(ho))).toEqual(ho)
  expect(needsOf({ pie: true, minutes: 90, ramGb: -1, other: 1 })).toEqual({ minutes: 90, pie: true })
  expect(needsOf({ pie: 'true', readOnly: 'yes', ramGb: '12' })).toEqual({}) // strict: text is not a flag or a number (the command types its words)
  expect([prNumberOf('#42'), prNumberOf('https://github.com/o/r/pull/7'), prNumberOf('intent/x')]).toEqual([42, 7, null])
  const p = packetText(HO, 'Rig')
  expect(p.split('\n').slice(0, 3)).toEqual(['Hand-off 1a2b3c4d-2611100900-1 for Rig (manual: a person carries this).', 'Task: do x', 'Base: origin/intent/x at abc1234'])
  expect(p).toContain(`Back here: /a5r handoff result ${HO.id} <PR url | #N | branch | report path>`)
})

/** A fake transport: each local argv (joined) answered by the first matching rule; records every call. */
const fake = (rules: [RegExp, (stdin?: string) => RunOut | null][]): Proc & { calls: { argv: string[]; stdin?: string; timeoutMs: number }[] } => {
  const calls: { argv: string[]; stdin?: string; timeoutMs: number }[] = []
  const f = (async (argv: readonly string[], init: { stdin?: string; timeoutMs: number }) => {
    calls.push({ argv: [...argv], ...(init.stdin !== undefined ? { stdin: init.stdin } : {}), timeoutMs: init.timeoutMs })
    const hit = rules.find(([rx]) => rx.test(argv.join(' ')))
    return hit ? hit[1](init.stdin) : { exitCode: 0, stdout: '', stderr: '' }
  }) as Proc & { calls: typeof calls }
  f.calls = calls
  return f
}
const out = (stdout: string, exitCode = 0): RunOut => ({ exitCode, stdout, stderr: '' })

/** A4's shared contract: every op the adapter has answers { ok, … } and never throws; a missing op is NO_ADAPTER_OP; a
 * runner that does not answer is TIMEOUT (a link code, counted by D16). */
const contract = async (a: Adapter, silent: Adapter, root = 'D:/h') => {
  for (const op of OP_NAMES) {
    const args: Record<string, unknown[]> = { probe: [], readFile: [`${root}/Saved/A5R/jobs/x.json`], writeFile: [`${root}/Saved/A5R/inbox/x.json`, '{}'], run: [['git', 'status']], envInfo: [], status: ['t7'], deliver: ['hi'] }
    const r = (await (callOp as (a: Adapter, op: string, ...xs: unknown[]) => Promise<{ ok: boolean; error?: { code: string } }>)(a, op, ...(args[op] ?? [])))
    expect([op, typeof r.ok]).toEqual([op, 'boolean'])
    if (!a[op]) expect([op, r.error?.code]).toEqual([op, 'NO_ADAPTER_OP'])
    const s = await (callOp as (a: Adapter, op: string, ...xs: unknown[]) => Promise<{ ok: boolean; error?: { code: string } }>)(silent, op, ...(args[op] ?? []))
    if (silent[op]) expect([op, s.ok ? 'ok' : s.error?.code]).toEqual([op, op === 'probe' ? 'LINK' : 'TIMEOUT'])
  }
}

test('S-d (A4): unit: the herdr adapter: every op through hc with --on (argv as given, no shell), the 30 s timeout, bg run handle, status, deliver only with deliverTo; the shared contract', async () => {
  const p = fake([
    [/exec .* -- cmd \/c echo a5r %OS%/, () => out('a5r Windows_NT\r\n')],
    [/^hc file read/, () => out('{"v":1}')],
    [/^hc run --bg/, () => out('{"id":"f20/t7"}')],
    [/^hc get --json/, () => out('{"status":"exited","exit_code":0}')],
  ])
  const a = herdrAdapter('f20', { a5rRoot: 'D:/h', deliverTo: 'hai-desktop/t6' }, p)
  expect(await a.probe?.()).toEqual({ ok: true, value: { os: 'windows', shell: 'cmd' } })
  expect(await a.run?.(['git', 'status'], { cwd: 'D:/h' })).toEqual({ ok: true, value: out('') })
  expect(p.calls[1]).toEqual({ argv: ['hc', 'exec', '--on', 'f20', '--timeout', '30', '--cwd', 'D:/h', '--', 'git', 'status'], timeoutMs: 35_000 })
  expect(await a.run?.(['claude', '-p', 'x y'], { bg: true, cwd: 'D:/lanes/l1' })).toEqual({ ok: true, value: out('f20/t7') })
  expect(p.calls[2]?.argv).toEqual(['hc', 'run', '--bg', '--outlive-parent', '--no-parent', '--no-notify', '--json', '--on', 'f20', '--cwd', 'D:/lanes/l1', '--', 'claude', '-p', 'x y'])
  expect(await a.status?.('f20/t7')).toEqual({ ok: true, value: { running: false, exitCode: 0 } })
  expect(await a.readFile?.('D:/h/Saved/A5R/jobs/x.json')).toEqual({ ok: true, value: '{"v":1}' })
  expect(await a.writeFile?.('D:/h/Saved/A5R/inbox/x.json', '{}')).toEqual({ ok: true, value: null })
  expect(p.calls.at(-1)).toEqual({ argv: ['hc', 'file', 'write', '--on', 'f20', 'D:/h/Saved/A5R/inbox/x.json'], stdin: '{}', timeoutMs: 35_000 })
  expect((await a.writeFile?.('C:/Windows/x', '{}'))?.ok).toBe(false)
  expect(await a.deliver?.('job done')).toEqual({ ok: true, value: null })
  expect(p.calls.at(-1)?.argv).toEqual(['hc', 'send', 'hai-desktop/t6', 'job done'])
  expect(herdrAdapter('f20', {}, p).deliver).toBe(undefined)
  expect([handleOf('t9\n'), runStateOf('{"status":"working"}'), runStateOf('x')]).toEqual(['t9', { running: true, exitCode: null }, null])
  // A missing client: the runner answers null; C1 fails with what to do, then its own fix line.
  const none = herdrAdapter('f20', { hc: 'C:/no/hc.exe' }, async () => null)
  const rep = await runChecks({ adapter: none, local: async () => null, now: async () => NOW, prior: {} }, ['C1'], 7 * 24 * 60 * MIN)
  expect(checkLine('C1', rep.checks.C1)).toBe(`C1 fail · origin to host: C:/no/hc.exe exec --on f20 did not answer within 30 s (or ${noHcText('C:/no/hc.exe')}) → ${FIX.C1}`)
  await contract(herdrAdapter('f20', { a5rRoot: 'D:/h', deliverTo: 't6' }, p), herdrAdapter('f20', { a5rRoot: 'D:/h', deliverTo: 't6' }, async () => null, { os: 'windows', shell: 'cmd' }))
})

test('S-d (A4): unit: the command adapter: one argv template per op, placeholders inside one element each, {argv} spliced whole and never joined, a missing op is NO_ADAPTER_OP; the shared contract', async () => {
  const ops = { probe: ['q', 'ping', '{target}'], readFile: ['q', 'cat', '{target}:{path}'], writeFile: ['q', 'put', '{target}:{path}'], run: ['q', 'exec', '{target}', '--', '{argv}'], runBg: ['q', 'submit', '{target}', '{argv}'], status: ['q', 'state', '{handle}'], deliver: ['q', 'say', '{message}'] }
  expect(opsProblems(ops)).toEqual([])
  expect(opsProblems({ run: ['q', 'x {argv}'], nope: ['a'], probe: [] })).toEqual([
    'reach.options.ops.run: {argv} must be a whole element (it is never joined into one string)',
    'reach.options.ops.nope is not an op (probe, readFile, writeFile, run, runBg, status, deliver, envInfo)',
    'reach.options.ops.probe must be a non-empty list of argv strings',
  ])
  expect(COMMAND_OPS.length).toBe(8)
  expect(fill(ops.run, { target: 'bot', argv: ['echo', 'a b; rm -rf /'] })).toEqual(['q', 'exec', 'bot', '--', 'echo', 'a b; rm -rf /'])
  expect(fill(['x', '{message}'], { target: 't', message: '"$(boom)" & del *' })).toEqual(['x', '"$(boom)" & del *'])
  const p = fake([
    [/^q ping/, () => out('pong')],
    [/^q state/, () => out('running')],
    [/^q submit/, () => out('job-77 queued')],
  ])
  const a = commandAdapter('bot', { ops, a5rRoot: '/srv/s2' }, p)
  expect(await a.probe?.()).toEqual({ ok: true, value: { os: 'posix', shell: 'sh' } })
  expect(await a.run?.(['make'], { bg: true })).toEqual({ ok: true, value: out('job-77') })
  expect(await a.status?.('job-77')).toEqual({ ok: true, value: { running: true, exitCode: null } })
  expect(await a.writeFile?.('/srv/s2/Saved/A5R/inbox/x.json', '{"a":1}')).toEqual({ ok: true, value: null })
  expect(p.calls.at(-1)).toEqual({ argv: ['q', 'put', 'bot:/srv/s2/Saved/A5R/inbox/x.json'], stdin: '{"a":1}', timeoutMs: 30_000 })
  const bare = commandAdapter('bot', { ops: { probe: ['q', 'ping'] } }, p)
  expect([bare.readFile, bare.run, bare.deliver]).toEqual([undefined, undefined, undefined])
  expect(await callOp(bare, 'readFile', 'x')).toEqual({ ok: false, error: { code: 'NO_ADAPTER_OP', text: 'the command adapter has no readFile' } })
  await contract(a, commandAdapter('bot', { ops, a5rRoot: '/srv/s2' }, async () => null), '/srv/s2')
  // Declarations: the herdr client and the templates are checked; both are the person's (PERSON_ONLY_OPTIONS).
  expect(declProblems('bot', { label: 'Bot', owner: '', reach: { kind: 'command', target: 'bot', options: { ops: { run: ['q', 'x{argv}'] } } } })).toEqual(['hosts.bot.reach.options.ops.run: {argv} must be a whole element (it is never joined into one string)'])
  expect(declProblems('f20', { label: 'Rig', owner: '', reach: { kind: 'herdr', target: 'f20', options: { hc: 'C:/bin/evil.exe' } } })).toEqual(['hosts.f20.reach.options.hc must be the herdr client (hc, hc.exe or hc.cmd)'])
})

test('S-d (A3): unit: C13 passes when the card accepts this origin (or any), fails when not, and skips with "trust unknown" on a probe card', () => {
  const card = (acceptsFrom?: string[]) => ({ v: 1, at: NOW, source: acceptsFrom ? 'a5r' : 'probe', machine: { freeRamGb: 1, totalRamGb: 1, freeDiskGb: 1 }, editor: { holder: null, queue: 0, running: false }, availability: { state: 'yes' }, freeze: null, lanes: [], jobs: { running: 0, queued: 0 }, account: { shared: 'unknown' }, skew: { ms: 0 }, ...(acceptsFrom ? { acceptsFrom } : {}) }) as HostCard
  const x = (c: HostCard | null) => ({ hostId: 'rig', originId: 'hai-1a2b3c4d', card: c, sleep: async () => undefined })
  expect(c13(x(card(['hai-1a2b3c4d'])))).toEqual({ status: 'pass', value: 'origin hai-1a2b3c4d is accepted' })
  expect(c13(x(card(['*'])))).toEqual({ status: 'pass', value: 'origin hai-1a2b3c4d is accepted (any origin)' })
  expect(c13(x(card(['bob-00000000'])))).toEqual({ status: 'fail', value: "origin hai-1a2b3c4d is not in the host's trust list (accepts bob-00000000)" })
  expect(c13(x(card()))).toEqual({ status: 'skip', value: 'trust unknown' })
  expect(checkLine('C13', { status: 'fail', value: 'origin x is not in the host\'s trust list (accepts y)', checkedAt: NOW })).toBe(`C13 fail · origin x is not in the host's trust list (accepts y) → ${FIX.C13}`)
})

test('S-d (A16, D19, decision 7): unit: a session in a lane under asHost.laneRoot coordinates through asHost.coordinationRoot; any other tree, or no asHost, is its own', async () => {
  const file = JSON.stringify({ v: 1, hosts: {}, asHost: { enabled: true, roles: [], trust: [], laneRoot: 'D:/lanes', coordinationRoot: 'E:/s2' }, sums: { hosts: {} } })
  const read = async (p: string) => (p === 'C:/Users/h/.claude/a5r/hosts.json' ? file : null)
  expect(await coordinationFor({ tree: 'D:/Lanes/l1' }, read, 'C:/Users/h')).toEqual({ tree: 'E:/s2' })
  expect(await coordinationFor({ tree: 'E:/s2' }, read, 'C:/Users/h')).toEqual({ tree: 'E:/s2' })
  expect(await coordinationFor({ tree: 'D:/Projects/ather-mods' }, read, 'C:/Users/h')).toEqual({ tree: 'D:/Projects/ather-mods' })
  expect(await coordinationFor({ tree: 'D:/lanes/l1' }, async () => null, 'C:/Users/h')).toEqual({ tree: 'D:/lanes/l1' })
  expect(await coordinationFor('no-repo', read, 'C:/Users/h')).toBe('no-repo')
})
