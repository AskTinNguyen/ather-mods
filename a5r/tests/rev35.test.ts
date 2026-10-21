import { expect, test } from 'claude-code/testing'
import { blankSession, checkoutGitPids, gitBusyNote, isListAtT, newSync, NO_GIT_BUSY, NOTICES, parseProbe, parseSyncFile, SYNC_WORKER_PROMPT, syncWorkerTask, type SessionFile, type SyncFile } from '../hooks/coord.ts'
import { dryKey, dryStep, FETCH_MS, fetchArgv, fetchWhy, shaOf, staleOf, START_WAIT_MS, withDryRun, withDryRunFailed } from '../hooks/dryrun.ts'
import { LOCK, ME, NOW, PROJ, opts, refused, world, type Proc, type Rec } from './world.ts'

// Rev 35 (L-39, the sync conductor's report on the first 0.20 sync, 2026-10-20 13:45). A107: the 13:15 cutoff dry-run read
// the last fetched origin/main (no fetch) and missed 15 avian conflicts from e81deaf1, which landed after it; the dry-run
// now fetches first, and runs again at T before the worker. A108: the worker ended "Waiting for the resolution script to
// finish" while its own git checkout --ours still ran.
const HF = 'E:/s2/Saved/A5R'
const S2 = 'E:/s2'
const SYNC = `${HF}/sync.json`
const ME8 = ME.slice(0, 8)
const START = { cwd: PROJ, surface: 'terminal', isInteractive: true } as never
const T = (h: number, m: number) => new Date(2026, 9, 6, h, m).getTime()
const MIN = 60_000
const PRE = '9f8e7d6c0000'
const TREE = '7e4887eb85fc0a6b1638a284733984d7d06b39f5'
const MAIN1 = '1111111111111111111111111111111111111111'
const MAIN2 = 'e81deaf100000000000000000000000000000000'
const SID = (id8: string) => `${id8}-1111-4000-8000-000000000000`
const B = { session: SID('bbbbbbbb'), id8: 'bbbbbbbb', lane: 'sync-lane' }
type W = ReturnType<typeof world>
type Git = Record<string, { stdout: string; exitCode?: number; deny?: string; hold?: Promise<void> }>
const out = (ran: { result?: unknown; text?: string; deny?: string }): string => String(ran.deny ?? ran.result ?? ran.text ?? '')
const prompts = (w: W): string[] => (w.calls['prompt.submit'] ?? []).map(e => String((e as Rec).text))
const told = (w: W): string => prompts(w).join('\n')
const count = (text: string, part: string): number => text.split(part).length - 1
const syncOf = (w: W): SyncFile | null => parseSyncFile(w.read(SYNC) || null)
const spawns = (w: W) => (w.calls['agent.spawn'] ?? []) as Rec[]
const fetches = (w: W) => w.inits.filter(r => r.argv.includes(' fetch '))
const idle = async ($: any) => $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
const workerEnds = async ($: any, answer: string) => $.turn.complete({ agentId: 'w-sync', answer, durationMs: 1, isAborted: false, turnId: 'tw', reason: 'answer' } as never)
const sleep = (ms: number): Promise<void> => new Promise(r => (globalThis as unknown as { setTimeout: (f: () => void, ms: number) => void }).setTimeout(r, ms))
const peer = (id8: string, o: Partial<SessionFile> = {}): string => JSON.stringify({ ...blankSession(SID(id8), id8 === 'bbbbbbbb' ? 'sync-lane' : `lane-${id8}`, '', NOW), ...o })
/** Minutes pass; the peer's a5r keeps its file fresh meanwhile, and this session is idle after each one. */
const minutes = async ($: any, w: W, n: number, peerId = '') => {
  for (let k = 0; k < n; k += 1) {
    const at = w.clock.now() + MIN
    if (peerId) w.put(`${HF}/editor/${peerId}.json`, peer(peerId, { heartbeatAt: at }), at)
    await w.clock.advance(MIN)
    await idle($)
  }
}
const mergeTree = (...paths: string[]) => ({ stdout: `${TREE}\n${paths.join('\n')}\n\n`, exitCode: paths.length ? 1 : 0 })
/** This session holds a sync at 14:45 planned at 14:40 (the cutoff is already past: its dry-run runs at the next tick). */
const holder = async ($: any, on: any, git: Git) => {
  const w = world(on, { ram: '40', git })
  on('turn.complete', async () => ({ text: '' }))
  w.put(`${S2}/.git/HEAD`, 'ref: refs/heads/HaiHuynh/20261005')
  w.put(LOCK, 'free since 14:20\n')
  await $.session.start(START)
  expect(String((await $.command.run({ command: 'a5r', args: 'sync 14:45' } as never)).text)).toContain('planned')
  await idle($)
  return w
}

// ---------- A107 ----------
test('A107: unit: the dry-run owed at the cutoff and at T, one at a time, each once; the worker waits for T\'s, at most 10 min', () => {
  const s: SyncFile = newSync(T(14, 45), B, 'x', NOW)
  const done = (round: 'cutoff' | 'start') => ({ key: dryKey(s, round), isDone: true })
  expect(dryStep(s, 'planned', null, T(14, 0))).toEqual({ start: null, mayStartWorker: false })
  expect(dryStep(s, 'cutoff', null, T(14, 20))).toEqual({ start: 'cutoff', mayStartWorker: false })
  expect(dryStep(s, 'cutoff', { key: dryKey(s, 'cutoff'), isDone: false }, T(14, 21)).start).toBe(null) // running
  expect(dryStep(s, 'cutoff', done('cutoff'), T(14, 22)).start).toBe(null) // failed (no list): not again in a loop
  const listed: SyncFile = { ...s, conflicts: [], conflictsAt: T(14, 20), conflictsSource: 'merge-tree' }
  expect(dryStep(listed, 'cutoff', done('cutoff'), T(14, 30)).start).toBe(null)
  expect(dryStep(listed, 'frozen', done('cutoff'), T(14, 45))).toEqual({ start: 'start', mayStartWorker: false })
  expect(dryStep(listed, 'frozen', { key: dryKey(s, 'start'), isDone: false }, T(14, 48))).toEqual({ start: null, mayStartWorker: false })
  expect(dryStep(listed, 'frozen', done('start'), T(14, 49))).toEqual({ start: null, mayStartWorker: true }) // even a failed one
  expect(dryStep({ ...listed, conflictsAt: T(14, 46) }, 'frozen', null, T(14, 47))).toEqual({ start: null, mayStartWorker: true }) // a list made at T
  expect(dryStep({ ...listed, conflictsAt: T(14, 46), conflictsSource: 'holder' }, 'frozen', null, T(14, 47)).start).toBe('start') // the holder's hand list is no dry-run
  // A cutoff dry-run still running at T: neither a second fetch nor the worker until it ends; past 10 min, no T round.
  expect(dryStep(s, 'frozen', { key: dryKey(s, 'cutoff'), isDone: false }, T(14, 45))).toEqual({ start: null, mayStartWorker: false })
  expect(dryStep(s, 'frozen', { key: dryKey(s, 'cutoff'), isDone: false }, T(14, 45) + START_WAIT_MS)).toEqual({ start: null, mayStartWorker: false })
  expect(dryStep(s, 'frozen', done('cutoff'), T(14, 45) + START_WAIT_MS)).toEqual({ start: null, mayStartWorker: true })
  expect(dryStep({ ...listed, workerAt: T(14, 45) }, 'frozen', null, T(14, 50))).toEqual({ start: null, mayStartWorker: false })
  // The fetch: origin's main only, no prompt, no tags, no maintenance left behind; LFS skip not set.
  expect(fetchArgv(S2)).toEqual(['git', '-C', S2, 'fetch', '--no-tags', '--no-auto-maintenance', 'origin', 'main'])
  expect([FETCH_MS.cutoff, FETCH_MS.start]).toEqual([5 * MIN, 2 * MIN]) // review 5: at T the fetch must not eat the merge's window
  expect([fetchWhy({ exitCode: 0, stderr: 'From github' }, 5 * MIN), fetchWhy({ exitCode: 128, stderr: 'remote: x\nfatal: unable to access\n' }, 5 * MIN), fetchWhy(null, 2 * MIN)]).toEqual(['', 'exit 128: fatal: unable to access', 'it did not run or did not finish within 2 min'])
  expect([shaOf(`${MAIN2}\n`), shaOf('HaiHuynh/20261005'), shaOf(undefined)]).toEqual([MAIN2, '', ''])
  // The lists with what the dry-run read; a failed one marks a list on file stale; the holder's own list reads nothing.
  const cut = withDryRun(s, { conflicts: [{ path: 'Source/S2/Foo.cpp', kind: 'foreign' }], untracked: ['Content/Old.uasset'], main: MAIN1, stale: '' }, T(14, 20))
  expect([cut.conflictsAt, cut.conflictsSource, cut.dry, isListAtT(cut)]).toEqual([T(14, 20), 'merge-tree', { main: MAIN1, stale: '' }, false])
  const atT = withDryRun(cut, { conflicts: [], untracked: null, main: MAIN2, stale: staleOf('exit 128') }, T(14, 45))
  expect([atT.untracked, atT.dry, isListAtT(atT)]).toEqual([null, { main: MAIN2, stale: 'git fetch origin main failed (exit 128); origin/main as last fetched' }, true])
  expect(staleOf('')).toBe('')
  expect(withDryRunFailed(cut, T(14, 45)).dry).toEqual({ main: MAIN1, stale: 'the latest dry-run did not finish; this list is older' })
  expect(withDryRunFailed(s, T(14, 45))).toBe(s) // no list: nothing to mark
  expect(parseSyncFile(JSON.stringify(atT))?.dry).toEqual(atT.dry)
  expect(parseSyncFile(JSON.stringify(s))?.dry).toBe(null)
})

test('A107: the holder fetches before the cutoff dry-run and again at T before the worker; a conflict new at T is told to the holder once; the task carries the T list, its time and main', opts(), async ($, on) => {
  const git: Git = { 'merge-tree': mergeTree('Source/S2/Foo.cpp'), 'rev-parse --verify --quiet origin/main': { stdout: `${MAIN1}\n` } }
  const w = await holder($, on, git)
  await minutes($, w, 1) // 14:41: the cutoff's fetch, then its dry-run
  expect(fetches(w).length).toBe(1)
  expect(w.runs.findIndex(r => r.includes(' fetch '))).toBeLessThan(w.runs.findIndex(r => r.includes('merge-tree')))
  const f = fetches(w)[0]
  expect(f?.argv).toBe('git -C E:/s2 fetch --no-tags --no-auto-maintenance origin main')
  expect([f?.env?.GIT_TERMINAL_PROMPT, f?.env?.GCM_INTERACTIVE, f?.env?.GIT_LFS_SKIP_SMUDGE, f?.timeoutMs]).toEqual(['0', 'never', undefined, 5 * MIN])
  expect([syncOf(w)?.conflicts, syncOf(w)?.conflictsAt, syncOf(w)?.dry?.main]).toEqual([[{ path: 'Source/S2/Foo.cpp', kind: 'foreign' }], T(14, 41), MAIN1])
  expect(told(w)).toContain('dry-run for 14:45: 1 conflict (0 self, 1 foreign): Source/S2/Foo.cpp → owner unknown')
  // e81deaf1 lands after the cutoff.
  git['merge-tree'] = mergeTree('Source/S2/Foo.cpp', 'Source/S2/Avian.cpp')
  git['rev-parse --verify --quiet origin/main'] = { stdout: `${MAIN2}\n` }
  await minutes($, w, 4) // 14:45: fetch, dry-run, then the worker
  expect(fetches(w).length).toBe(2)
  expect(w.runs.filter(r => r.includes('merge-tree')).length).toBe(2)
  const s = syncOf(w)
  expect([s?.conflictsAt, s?.dry, s?.workerAt]).toEqual([T(14, 45), { main: MAIN2, stale: '' }, T(14, 45)])
  expect(spawns(w).length).toBe(1)
  const task = String(spawns(w)[0]?.prompt)
  expect(task).toContain('Dry-run at T: Source/S2/Foo.cpp (foreign); Source/S2/Avian.cpp (foreign).')
  expect(task).toContain(`That list: made at 14:45 against origin/main ${MAIN2.slice(0, 12)}. It may be older than your merge: the merge's own unmerged paths (git diff --name-only --diff-filter=U) decide.`)
  expect(told(w)).toContain('A5R · Sync main — the dry-run at T: 1 conflict (0 self, 1 foreign): Source/S2/Avian.cpp → owner unknown')
  expect(count(told(w), 'Source/S2/Foo.cpp → owner unknown')).toBe(1) // the cutoff's conflict is not told again
  await minutes($, w, 3)
  expect([fetches(w).length, spawns(w).length]).toEqual([2, 1]) // each round once; no fetch once the worker runs
})

test('A107: a conflict new at T reaches the session that edited it once, as found at T while frozen; the cutoff\'s conflict is not told again', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  on('turn.complete', async () => ({ text: '' }))
  w.put(`${S2}/.git/HEAD`, 'ref: refs/heads/HaiHuynh/20261005')
  for (const p of ['Source/S2/Foo.cpp', 'Source/S2/Avian.cpp']) w.put(`${S2}/${p}`, 'int x = 1;\n')
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', { heartbeatAt: NOW }))
  const cut: SyncFile = { ...newSync(T(14, 45), B, 'sync-lane (session bbbbbbbb)', NOW), conflicts: [{ path: 'Source/S2/Foo.cpp', kind: 'foreign' }], conflictsAt: T(14, 20), conflictsSource: 'merge-tree', dry: { main: MAIN1, stale: '' } }
  w.put(SYNC, JSON.stringify(cut))
  await $.session.start(START)
  for (const p of ['Source/S2/Foo.cpp', 'Source/S2/Avian.cpp']) await $.tool.call({ tool: 'Edit', file_path: `${S2}/${p}`, old_string: 'int x = 1;', new_string: 'int x = 2;' })
  await idle($)
  await minutes($, w, 1, 'bbbbbbbb') // 14:41: the cutoff's notices
  expect(told(w)).toContain('foreign change on main in Source/S2/Foo.cpp for the sync at 14:45; this session edited that path → before 14:45: commit your own version (exact paths)')
  await minutes($, w, 4, 'bbbbbbbb') // 14:45: the holder's A5R wrote the T list
  w.put(SYNC, JSON.stringify(withDryRun(cut, { conflicts: [{ path: 'Source/S2/Foo.cpp', kind: 'foreign' }, { path: 'Source/S2/Avian.cpp', kind: 'foreign' }], untracked: [], main: MAIN2, stale: '' }, T(14, 45))))
  await minutes($, w, 2, 'bbbbbbbb')
  const all = told(w)
  expect(all).toContain('A5R · Sync main — foreign change on main in Source/S2/Avian.cpp for the sync at 14:45, found by the dry-run at T; this session edited that path → the sync is frozen, so make no git write; the worker reads no messages and aborts on a conflict that is not mechanical and no rule settles, then sync-lane finishes the merge by hand: tell sync-lane how the two sides combine (never discard either side)')
  expect(count(all, 'foreign change on main in Source/S2/Foo.cpp')).toBe(1)
  expect(count(all, 'foreign change on main in Source/S2/Avian.cpp')).toBe(1)
  expect(all).not.toContain('Source/S2/Foo.cpp, Source/S2/Avian.cpp') // never the two again in one notice
})

test('A107: a failed fetch is told to the holder (at the cutoff and at T) and the worker\'s list is marked stale', opts(), async ($, on) => {
  const git: Git = { ' fetch ': { stdout: '', deny: 'timed out' }, 'merge-tree': mergeTree('Source/S2/Foo.cpp'), 'rev-parse --verify --quiet origin/main': { stdout: `${MAIN1}\n` } }
  const w = await holder($, on, git)
  await minutes($, w, 1) // 14:41
  expect(told(w)).toContain('A5R · Sync main — git fetch origin main failed at the cutoff (it did not run or did not finish within 5 min), so the conflict dry-run reads origin/main as last fetched → fetch it yourself')
  expect([syncOf(w)?.conflictsAt, syncOf(w)?.dry?.stale]).toEqual([T(14, 41), 'git fetch origin main failed (it did not run or did not finish within 5 min); origin/main as last fetched'])
  git[' fetch '] = { stdout: '', exitCode: 128 }
  await minutes($, w, 5) // 14:45: it fails, is tried again 5 s later, fails again
  expect(fetches(w).length).toBe(3) // the cutoff's (killed: not tried again), T's twice
  expect(told(w)).toContain("A5R · Sync main — git fetch origin main failed at T (14:45) (exit 128), so the conflict dry-run reads origin/main as last fetched → nothing to do: the worker's task marks its list stale")
  const task = String(spawns(w)[0]?.prompt)
  expect(task).toContain(`against origin/main ${MAIN1.slice(0, 12)}, STALE: git fetch origin main failed (exit 128); origin/main as last fetched.`)
  expect(count(told(w), 'Source/S2/Foo.cpp → owner unknown')).toBe(1) // the same conflict as at the cutoff: not told again
})

test('A107 (review 4): a fetch that fails at once (another fetch holds the ref lock) is tried once more; the list is then fresh', opts(), async ($, on) => {
  const git: Git = { 'merge-tree': mergeTree('Source/S2/Foo.cpp'), 'rev-parse --verify --quiet origin/main': { stdout: `${MAIN1}\n` } }
  const lockFail = { stdout: '', exitCode: 1 }
  const ok = { stdout: '' }
  // The first fetch meets another process's ref lock; the second succeeds.
  Object.defineProperty(git, ' fetch ', { enumerable: true, get: () => (fetchCount() === 1 ? lockFail : ok) })
  const w = await holder($, on, git)
  const fetchCount = () => w.runs.filter(r => r.includes(' fetch ')).length
  await minutes($, w, 2) // 14:42
  expect(fetches(w).length).toBe(2)
  expect([syncOf(w)?.conflicts?.length, syncOf(w)?.dry]).toEqual([1, { main: MAIN1, stale: '' }])
  expect(told(w)).not.toContain('git fetch origin main failed')
})

test('A107 (review 3): a holder\'s own write lands on sync.json as it is then: a list and other writes that came during its conflicts action stay', opts(), async ($, on) => {
  let release = () => {}
  const hold = new Promise<void>(r => {
    release = r
  })
  const git: Git = { 'merge-tree': mergeTree('Source/S2/Foo.cpp'), 'rev-parse --verify --quiet origin/main': { stdout: `${MAIN1}\n` }, 'origin/main:Source/S2/Hand.cpp': { stdout: '', hold } }
  const w = await holder($, on, git)
  await minutes($, w, 1) // 14:41: the cutoff's list
  const action = $.tool.call({ tool: 'mcp__a5r__sync', action: 'conflicts', paths: ['Source/S2/Hand.cpp'] } as never)
  for (let n = 0; n < 100 && !w.runs.some(r => r.includes('origin/main:Source/S2/Hand.cpp')); n += 1) await sleep(10)
  // While the action classifies its path, other writes land: a list's untracked files, a message record, a rule.
  const now = syncOf(w) as SyncFile
  w.put(SYNC, JSON.stringify({ ...now, untracked: ['Content/New.uasset'], messaged: ['cccccccc-1'], rules: [{ side: 'theirs', pattern: 'Content/' }], updatedAt: now.updatedAt + 1 }))
  release()
  expect(out(await action)).toContain('recorded 1 conflicted path')
  const s = syncOf(w)
  expect([s?.conflicts, s?.conflictsSource, s?.untracked, s?.messaged, s?.rules]).toEqual([[{ path: 'Source/S2/Hand.cpp', kind: 'foreign' }], 'holder', ['Content/New.uasset'], ['cccccccc-1'], [{ side: 'theirs', pattern: 'Content/' }]])
})

test('A107 (review of the fixes, C1): a holder\'s action held while another session takes the sync over is refused, never undoing the take-over', opts(), async ($, on) => {
  let release = () => {}
  const hold = new Promise<void>(r => {
    release = r
  })
  const w = world(on, { ram: '40', git: { 'origin/main:Source/S2/Hand.cpp': { stdout: '', hold } } })
  on('turn.complete', async () => ({ text: '' }))
  w.put(`${S2}/.git/HEAD`, 'ref: refs/heads/HaiHuynh/20261005')
  const gone = { session: SID('dddddddd'), id8: 'dddddddd', lane: 'gone-lane' }
  w.put(SYNC, JSON.stringify(newSync(T(15, 30), gone, 'gone-lane', NOW)))
  w.put(`${HF}/editor/dddddddd.json`, peer('dddddddd', { heartbeatAt: NOW - 10 * MIN }), NOW - 10 * MIN) // its file stopped 10 min ago
  await $.session.start(START)
  const action = $.tool.call({ tool: 'mcp__a5r__sync', action: 'conflicts', paths: ['Source/S2/Hand.cpp'] } as never)
  for (let n = 0; n < 100 && !w.runs.some(r => r.includes('origin/main:Source/S2/Hand.cpp')); n += 1) await sleep(10)
  w.put(SYNC, JSON.stringify({ ...(syncOf(w) as SyncFile), holder: B, updatedAt: NOW + 1 })) // B takes it over meanwhile
  release()
  expect(out(await action)).toContain('sync.json changed')
  expect([syncOf(w)?.holder.id8, syncOf(w)?.conflicts]).toEqual(['bbbbbbbb', null])
})

test('A107: a dry-run at T that does not finish is told; the worker starts with the cutoff\'s list marked stale', opts(), async ($, on) => {
  const git: Git = { 'merge-tree': mergeTree('Source/S2/Foo.cpp'), 'rev-parse --verify --quiet origin/main': { stdout: `${MAIN1}\n` } }
  const w = await holder($, on, git)
  await minutes($, w, 1) // 14:41
  git['merge-tree'] = { stdout: '', exitCode: 128 }
  await minutes($, w, 4) // 14:45
  expect(told(w)).toContain('A5R · Sync main — the conflict dry-run (git merge-tree) did not finish (exit 128)')
  expect(spawns(w).length).toBe(1)
  expect(String(spawns(w)[0]?.prompt)).toContain(`Dry-run at the cutoff: Source/S2/Foo.cpp (foreign).`)
  expect(String(spawns(w)[0]?.prompt)).toContain(`That list: made at 14:41 against origin/main ${MAIN1.slice(0, 12)}, STALE: the latest dry-run did not finish; this list is older.`)
})

test('A107 (review C1): a list that lands only in the freeze is still told, once, in the freeze\'s words: made after T (found at T) or before T but read after it', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  on('turn.complete', async () => ({ text: '' }))
  w.put(`${S2}/.git/HEAD`, 'ref: refs/heads/HaiHuynh/20261005')
  for (const p of ['Source/S2/Foo.cpp', 'Source/S2/Late.cpp']) w.put(`${S2}/${p}`, 'int x = 1;\n')
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', { heartbeatAt: NOW }))
  const plan: SyncFile = newSync(T(14, 45), B, 'sync-lane (session bbbbbbbb)', NOW)
  w.put(SYNC, JSON.stringify(plan))
  await $.session.start(START)
  for (const p of ['Source/S2/Foo.cpp', 'Source/S2/Late.cpp']) await $.tool.call({ tool: 'Edit', file_path: `${S2}/${p}`, old_string: 'int x = 1;', new_string: 'int x = 2;' })
  await idle($)
  await minutes($, w, 4, 'bbbbbbbb') // 14:44: no list yet
  // The holder's list lands at 14:44:30 (before T); this session's next tick is at 14:45, in the freeze.
  const early = withDryRun(plan, { conflicts: [{ path: 'Source/S2/Foo.cpp', kind: 'foreign' }], untracked: [], main: MAIN1, stale: '' }, T(14, 44) + 30_000)
  w.put(SYNC, JSON.stringify(early))
  await minutes($, w, 1, 'bbbbbbbb')
  expect(told(w)).toContain('foreign change on main in Source/S2/Foo.cpp for the sync at 14:45; this session edited that path → the sync is frozen, so make no git write; the worker reads no messages and aborts on a conflict that is not mechanical and no rule settles, then sync-lane finishes the merge by hand: tell sync-lane how the two sides combine (never discard either side)')
  // The holder's late dry-run (it ran past T) lands at 14:47 with one more path.
  w.put(SYNC, JSON.stringify(withDryRun(early, { conflicts: [{ path: 'Source/S2/Foo.cpp', kind: 'foreign' }, { path: 'Source/S2/Late.cpp', kind: 'foreign' }], untracked: [], main: MAIN2, stale: '' }, T(14, 47))))
  await minutes($, w, 3, 'bbbbbbbb')
  const all = told(w)
  expect(all).toContain('foreign change on main in Source/S2/Late.cpp for the sync at 14:45, found by the dry-run at T; this session edited that path → the sync is frozen')
  expect([count(all, 'foreign change on main in Source/S2/Foo.cpp'), count(all, 'foreign change on main in Source/S2/Late.cpp')]).toEqual([1, 1])
})

test('A107 (review C1): the holder\'s cutoff dry-run held past T: no second fetch beside it, its list is told once in the freeze, then the worker starts', opts(), async ($, on) => {
  let release = () => {}
  const hold = new Promise<void>(r => {
    release = r
  })
  const git: Git = { ' fetch ': { stdout: '', hold }, 'merge-tree': mergeTree('Source/S2/Foo.cpp'), 'rev-parse --verify --quiet origin/main': { stdout: `${MAIN1}\n` } }
  const w = await holder($, on, git)
  await minutes($, w, 7) // 14:47: the cutoff's fetch still runs
  expect([fetches(w).length, spawns(w).length]).toEqual([1, 0])
  release()
  for (let n = 0; n < 100 && spawns(w).length === 0; n += 1) await sleep(10)
  await idle($)
  expect([fetches(w).length, spawns(w).length, syncOf(w)?.conflictsAt]).toEqual([1, 1, T(14, 47)]) // its list is at T: no second round
  expect(count(told(w), 'the dry-run at T: 1 conflict (0 self, 1 foreign): Source/S2/Foo.cpp → owner unknown')).toBe(1)
})

test('A107: the fetch runs off the tick chain: a tool that waits on a tick answers while it runs; one fetch at a time; the worker starts only after T\'s dry-run', opts(), async ($, on) => {
  let release = () => {}
  const hold = new Promise<void>(r => {
    release = r
  })
  const git: Git = { 'merge-tree': mergeTree(), 'rev-parse --verify --quiet origin/main': { stdout: `${MAIN1}\n` } }
  const w = await holder($, on, git)
  await minutes($, w, 1) // 14:41: the cutoff's round, fetch not held
  git[' fetch '] = { stdout: '', hold }
  await minutes($, w, 4) // 14:45: T's fetch hangs
  const answer = await Promise.race([$.tool.call({ tool: 'mcp__a5r__editor', action: 'status' } as never).then(out), sleep(3_000).then(() => 'STILL WAITING')])
  expect(answer).not.toBe('STILL WAITING')
  await minutes($, w, 3) // 14:48
  expect([fetches(w).length, spawns(w).length, syncOf(w)?.workerAt]).toEqual([2, 0, null])
  release()
  for (let n = 0; n < 100 && spawns(w).length === 0; n += 1) await sleep(10)
  expect(spawns(w).length).toBe(1)
  expect(syncOf(w)?.conflictsAt).toBe(T(14, 48))
  expect(String(spawns(w)[0]?.prompt)).toContain('Dry-run at T: no conflicts.')
})

// ---------- A108 ----------
test('A108: unit: the worker prompt keeps every command in the foreground and never ends while one runs; the hand-back waits only on index.lock and names the checkout\'s own git', () => {
  expect(SYNC_WORKER_PROMPT).toContain('Run every git command in the foreground, to its end, in one tool call: never with `&`, never as a background tool run, never by Start-Process without -Wait, never from a script you leave running; the build of rule 6 is the only command you start to outlive your turn.')
  expect(SYNC_WORKER_PROMPT).toContain('7. End: never end your turn while a command you started (other than the build of rule 6) still runs, and never end with "waiting" or "until … finishes": wait for each such command in the foreground first.')
  expect(SYNC_WORKER_PROMPT).toContain("The dry-run list in your task may be older than your merge (main can move after it): the merge's own unmerged paths (`git diff --name-only --diff-filter=U`) decide, listed or not.")
  // Review 1: only git whose command line names the checkout; never the fsmonitor daemon (core.fsmonitor=true on S2).
  const git = (pid: number, cmd?: string): Proc => ({ name: 'git', pid, gb: 0.1, parentAlive: true, ...(cmd === undefined ? {} : { cmd }) })
  const probe = { freeGb: 30, diskGb: 100, procs: [git(1, 'git -C E:/Projects/s2 checkout --ours -- a.cpp'), git(2, '"C:\\Program Files\\Git\\cmd\\git.exe" -C "E:\\Projects\\S2" add -- a.cpp'), git(3, 'git fsmonitor--daemon run --detach --ipc-threads=8'), git(4, 'git -C E:/Projects/s2-old status'), git(5, 'git -C D:/Projects/ather-mods status'), git(6), git(7, 'git -C E:/Projects/s2 fsmonitor--daemon run --detach'), git(8, 'git -C D:/other diff --no-index E:/Projects/s2/x'), git(9, 'git -C E:/Projects/s2/Source status')] }
  expect(checkoutGitPids(probe, 'E:/Projects/s2')).toEqual([1, 2, 9]) // by -C, never a path named elsewhere
  expect(checkoutGitPids(null, 'E:/Projects/s2')).toBe(null)
  expect(parseProbe(JSON.stringify({ freeGb: 30, diskGb: 1, procs: [{ name: 'git', pid: 7, gb: 0, parentAlive: true, cmd: 'git -C E:/s2 status' }, { name: 'S2', pid: 8, gb: 1, parentAlive: true, cmd: '' }] }))?.procs.map(p => p.cmd)).toEqual(['git -C E:/s2 status', undefined])
  // Review 2: index.lock is the only wait; stale at 10 min with no checkout git running (or none known).
  expect(gitBusyNote(NO_GIT_BUSY)).toEqual({ fact: '', step: '' })
  expect(gitBusyNote({ gitPids: [1, 2, 3, 4, 5, 6], lockAgeMs: null })).toEqual({ fact: '; 6 git processes of the checkout still run (PID 1, 2, 3, 4, 5, …)', step: '' })
  expect(gitBusyNote({ gitPids: [4242], lockAgeMs: 30_000 }).fact).toBe('; 1 git process of the checkout still runs (PID 4242) and .git/index.lock exists (0 min old)')
  expect(gitBusyNote({ gitPids: [], lockAgeMs: 3 * MIN }).step).toContain('wait until .git/index.lock is gone before you touch the index')
  expect(gitBusyNote({ gitPids: null, lockAgeMs: 3 * MIN })).toMatchObject({ fact: '; the process list could not be read and .git/index.lock exists (3 min old)' })
  expect(gitBusyNote({ gitPids: [4242], lockAgeMs: 12 * MIN }).step).toContain('wait until .git/index.lock is gone') // git still works there
  expect(gitBusyNote({ gitPids: [], lockAgeMs: 12 * MIN })).toEqual({ fact: '; .git/index.lock exists (12 min old) and no git of the checkout runs: git left it behind', step: 'remove that stale lock first (rm <checkout>/.git/index.lock)' })
  expect(gitBusyNote({ gitPids: null, lockAgeMs: 12 * MIN })).toEqual({ fact: '; .git/index.lock exists (12 min old) and the process list could not be read: git left it behind', step: 'remove that stale lock first (rm <checkout>/.git/index.lock)' }) // none known
  const s: SyncFile = { ...newSync(T(14, 45), B, 'x', NOW), stage: 'manual', note: 'the sync worker ended without a SYNC line' }
  expect(NOTICES.syncManual(s, { gitPids: [4242], lockAgeMs: 0 })).toContain("until done, abort or 15:30; 1 git process of the checkout still runs (PID 4242) and .git/index.lock exists (0 min old) → keep the lock (the sync tool's done or abort gives it back; the editor tool's release does not); wait until .git/index.lock is gone before you touch the index")
  expect(NOTICES.syncManual(s, NO_GIT_BUSY)).toBe(NOTICES.syncManual(s))
  expect(syncWorkerTask(s, S2, 'FREE', null)).toContain('That list: none made. It may be older than your merge')
})

/** The holder's sync at 14:45; the worker starts at T; git's HEAD stays the pre-merge HEAD (no merge commit). */
const atT = async ($: any, on: any) => {
  const w = await holder($, on, { 'rev-parse HEAD': { stdout: `${PRE}\n` }, 'log -1 --format=%H %P HEAD': { stdout: `${PRE} 1111aaaa\n` } })
  await minutes($, w, 5)
  expect(spawns(w).length).toBe(1)
  return w
}
const FSMONITOR: Proc[] = [3, 4, 5].map(pid => ({ name: 'git', pid: 9000 + pid, gb: 0.05, parentAlive: true, cmd: 'git fsmonitor--daemon run --detach --ipc-threads=8' }))
const handBack = (w: W): string[] => prompts(w).filter(p => p.includes('is back in your hands'))

test('A108: the worker ends while its git still runs: the hand-back names the checkout\'s git and has the holder wait for index.lock', opts(), async ($, on) => {
  const w = await atT($, on)
  w.machine.procs = [...FSMONITOR, { name: 'git', pid: 4242, gb: 0.1, parentAlive: false, cmd: 'git -C E:/s2 checkout --ours -- Source/S2/A.cpp' }, { name: 'git', pid: 88, gb: 0.1, parentAlive: true, cmd: 'git -C D:/Projects/ather-mods status' }]
  w.put(`${S2}/.git/index.lock`, '', w.clock.now())
  await workerEnds($, 'Resolved 13 self conflicts. Waiting for the resolution script to finish.')
  expect(syncOf(w)?.stage).toBe('manual')
  const back = handBack(w)
  expect(back.length).toBe(1)
  expect(back[0]).toContain('; 1 git process of the checkout still runs (PID 4242) and .git/index.lock exists (0 min old) →')
  expect(back[0]).toContain('wait until .git/index.lock is gone before you touch the index')
  expect(back[0]).not.toMatch(/9003|9004|9005|PID 88/)
})

test('A108 (review 1): with only git\'s fsmonitor daemons running and no index.lock, the hand-back asks no wait', opts(), async ($, on) => {
  const w = await atT($, on)
  w.machine.procs = [...FSMONITOR]
  await workerEnds($, 'SYNC ABORT conflicts state=merge in progress')
  const back = handBack(w)
  expect(back.length).toBe(1)
  expect(back[0]).not.toMatch(/git process|index\.lock|wait until/)
})

test('A108 (review 2): an index.lock 12 min old with no git of the checkout running is stale: the holder may remove it (A5R lets the rm run)', opts(), async ($, on) => {
  const w = await atT($, on)
  w.machine.procs = [...FSMONITOR]
  w.put(`${S2}/.git/index.lock`, '', w.clock.now() - 12 * MIN)
  await workerEnds($, 'SYNC ABORT conflicts state=merge in progress')
  const back = handBack(w)
  expect(back[0]).toContain('; .git/index.lock exists (12 min old) and no git of the checkout runs: git left it behind →')
  expect(back[0]).toContain('remove that stale lock first (rm <checkout>/.git/index.lock); then either finish it by hand')
  expect(refused(await $.tool.call({ tool: 'Bash', command: `rm ${S2}/.git/index.lock` }))).toBe(undefined)
})
