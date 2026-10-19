import { expect, test } from 'claude-code/testing'
import { NOTICES, blankSession, newSync, parseLockLine, parseSyncEnd, parseSyncFile, type SessionFile, type SyncFile } from '../hooks/coord.ts'
import { afterWorker, buildResultOf, readMerge, stageNext, syncBuildLog, testsOf } from '../hooks/syncstage.ts'
import { LOCK, ME, NOW, PROJ, opts, world, type Proc, type Rec } from './world.ts'

// Rev 32 (L-36), A93-A95. MEASURED 2026-10-19: sync-20261019-1145-f41dc683 (T 11:10, hard end 12:40) merged 7b68b894;
// its worker ended at 11:25 "waiting for the build to print its own Result: line", A5R recorded aborted and broadcast it;
// sessions committed at 11:29 and 11:39 and one edited S2 C++ under the still-running build (UBT log 11:14-11:50).
// A93: a sync is aborted only by a real abort; after the merge it runs in stages (building, testing) with the freeze in
// place. A94: the holder's build for its sync goes first and is not capped. A95: done carries the post-merge test line.
const HF = 'E:/s2/Saved/A5R'
const SYNC = `${HF}/sync.json`
const ME8 = ME.slice(0, 8)
const START = { cwd: PROJ, surface: 'terminal', isInteractive: true } as never
const T = (h: number, m: number) => new Date(2026, 9, 6, h, m).getTime()
const MIN = 60_000
const LOG = 'E:/s2/Saved/A5R/sync-20261006-1445-ab12cd34-build.log' // the sync's own log, named by A5R in the worker's task
const PRE = '9f8e7d6c0000'
const UBT: Proc = { name: 'UnrealBuildTool', pid: 900, gb: 2, parentAlive: true }
const MERGED = `Merged origin/main (7b68b894), the build runs in the background.\nSYNC MERGED 7b68b894 build-log=${LOG}`
const TESTS = 'tests: TEST COMPLETE. EXIT CODE: 0'
type W = ReturnType<typeof world>
const out = (ran: { result?: unknown; text?: string; deny?: string }): string => String(ran.deny ?? ran.result ?? ran.text ?? '')
const prompts = (w: W): string[] => (w.calls['prompt.submit'] ?? []).map(e => String((e as Rec).text))
const syncOf = (w: W): SyncFile | null => parseSyncFile(w.read(SYNC) || null)
const idle = async ($: any) => $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
const workerEnds = async ($: any, answer: string) => $.turn.complete({ agentId: 'w-sync', answer, durationMs: 1, isAborted: false, turnId: 'tw', reason: 'answer' } as never)
const sync = async ($: any, input: Rec) => out(await $.tool.call({ tool: 'mcp__a5r__sync', ...input } as never))
const minutes = async (w: W, n: number) => {
  for (let k = 0; k < n; k += 1) await w.clock.advance(MIN)
}
/** The holder's build sync at 14:45 (hard end 16:15), its worker started at T with the pre-merge HEAD recorded. */
// git's HEAD after the merge: the merge commit 7b68b894 on top of the pre-merge HEAD (git, not the worker, says it merged).
const MERGE_HEAD = { 'log -1 --format=%H %P HEAD': { stdout: `7b68b894 ${PRE} 1c153b41\n` } }
type Git = Record<string, { stdout: string; exitCode?: number; deny?: string }>
/** `git` is the map the world answers from (a test may change it later). */
const atT = async ($: any, on: any, git: Git = { ...MERGE_HEAD }) => {
  git['rev-parse HEAD'] = { stdout: `${PRE}\n` }
  const w = world(on, { ram: '40', git })
  on('turn.complete', async () => ({ text: '' }))
  w.put('E:/s2/.git/HEAD', 'ref: refs/heads/HaiHuynh/20261005')
  w.put(LOCK, 'free since 14:20\n')
  await $.session.start(START)
  expect(String((await $.command.run({ command: 'a5r', args: 'sync 14:45 build' } as never)).text)).toContain('planned')
  await idle($)
  await minutes(w, 5) // 14:45: frozen, the worker starts
  expect([syncOf(w)?.preHead, syncOf(w)?.hardEnd]).toEqual([PRE, T(16, 15)])
  return w
}

test('A93: unit: the MERGED line, the build\'s own Result line, a merge commit on top of the pre-merge HEAD, the one extension', () => {
  expect(parseSyncEnd(MERGED)).toEqual({ kind: 'merged', sha: '7b68b894', buildLog: LOG, note: `merged 7b68b894; build log ${LOG}` })
  expect(parseSyncEnd('SYNC MERGED 7b68b894 build-log=none')).toMatchObject({ kind: 'merged', buildLog: '' })
  expect(parseSyncEnd('Template: SYNC MERGED <merge sha> build-log=<path>')).toBe(null)
  expect([buildResultOf('Building...\nResult: Failed (OtherCompilationError)\n...\nResult: Succeeded\n'), buildResultOf('Building 43 actions...'), buildResultOf('Result: Failed (x)')]).toEqual(['Succeeded', null, 'Failed'])
  expect(syncBuildLog('E:/s2', 'sync-20261006-1445-ab12cd34')).toBe('E:/s2/Saved/A5R/sync-20261006-1445-ab12cd34-build.log')
  // Git's three answers: merged on top of the pre-merge HEAD; positive no merge (HEAD still the pre-merge HEAD); unknown.
  expect(readMerge(`7b68b894aaaa ${PRE} 1c153b41bbbb\n`, PRE)).toEqual({ state: 'merged', sha: '7b68b894aaaa' })
  expect([readMerge(`${PRE} 111111\n`, PRE), readMerge(null, PRE), readMerge(`7b68b894aaaa 111111 1c153b41bbbb`, PRE), readMerge('cafe1234 111111', PRE)]).toEqual([{ state: 'none' }, { state: 'unknown' }, { state: 'unknown' }, { state: 'unknown' }])
  const s = { stage: 'building' as const, extended: false, hardEnd: T(16, 15), stageAt: T(14, 50) }
  const step = (o: Partial<typeof s>, f: { result?: 'Succeeded' | 'Failed' | null; isBuilding?: boolean; isBusy?: boolean; now: number }) => stageNext({ ...s, ...o }, { result: null, isBuilding: f.isBuilding ?? true, isBusy: f.isBusy ?? f.isBuilding ?? true, ...f }, 10 * MIN)
  expect([step({}, { now: T(16, 6) }).extendTo, step({}, { now: T(16, 4) }).extendTo, step({}, { now: T(16, 6), isBuilding: false }).extendTo, step({ extended: true }, { now: T(16, 6) }).extendTo]).toEqual([T(16, 45), null, null, null])
  expect(stageNext({ ...s, stage: 'testing' }, { result: null, isBuilding: false, isBusy: true, now: T(16, 6) }, 10 * MIN).extendTo).toBe(T(16, 45)) // a test or Editor run, or no reading
  expect(step({}, { now: T(15, 0), result: 'Succeeded' })).toEqual({ extendTo: null, next: 'testing', tell: 'testing' })
  expect(step({}, { now: T(15, 0), result: 'Failed' }).tell).toBe('build-failed')
  expect([step({}, { now: T(14, 51), isBuilding: false }).tell, step({}, { now: T(14, 53), isBuilding: false }).tell]).toEqual([null, 'build-unknown'])
  // Git, not the worker, says whether the merge happened.
  const merged = { state: 'merged' as const, sha: '7b68b894' }
  expect(afterWorker(parseSyncEnd(MERGED), merged, true)).toEqual({ kind: 'stage', stage: 'building', mergeSha: '7b68b894', note: `merged 7b68b894; build log ${LOG}` })
  // Given up only on positive evidence of no merge and no MERGED line; an unreadable HEAD, or the worker's MERGED, keeps the
  // stage. A96 (rev 33, by design): giving up is the manual stage, not an end.
  expect(afterWorker(null, { state: 'none' }, true)).toMatchObject({ kind: 'stage', stage: 'manual' })
  expect(afterWorker(parseSyncEnd(MERGED), { state: 'none' }, true)).toMatchObject({ kind: 'stage', stage: 'building', mergeSha: '' })
  expect(afterWorker(null, { state: 'unknown' }, true)).toMatchObject({ kind: 'stage', stage: 'building', mergeSha: '' })
  expect(afterWorker(parseSyncEnd('SYNC DONE 7b68b894 pre=x build=Succeeded conflicts=none'), merged, true)).toMatchObject({ kind: 'stage', stage: 'testing' })
  expect(afterWorker(parseSyncEnd('SYNC ABORT conflict in X.uasset state=merge aborted'), merged, true)).toMatchObject({ kind: 'stage', stage: 'manual' })
})

test('A93 / A95: the worker ends with SYNC MERGED: still frozen through the build; Result: Succeeded wakes the holder to test; done needs the test line, then lifts', opts(), async ($, on) => {
  const w = await atT($, on)
  w.machine.procs = [UBT]
  w.put(LOG, 'Building 4127 actions...\n')
  await workerEnds($, MERGED)
  expect([syncOf(w)?.state, syncOf(w)?.stage, syncOf(w)?.mergeSha, syncOf(w)?.buildLog]).toEqual(['planned', 'building', '7b68b894', LOG])
  expect(w.read(LOCK)).toContain('note=Sync main 14:45') // the sync keeps the Editor down through its build
  await minutes(w, 10) // 14:55: still building
  expect(syncOf(w)?.stage).toBe('building')
  expect(prompts(w).some(p => /has no Result: line|aborted|Sync main — done/.test(p))).toBe(false)
  w.put(LOG, 'Building 4127 actions...\nResult: Succeeded\nTotal execution time: 2160 seconds\n', w.clock.now())
  w.machine.procs = []
  await minutes(w, 1)
  expect(syncOf(w)?.stage).toBe('testing')
  const told = prompts(w).filter(p => p.includes('the post-merge headless tests are part of the sync'))
  expect(told.length).toBe(1)
  expect(told[0]).toContain('-ExecCmds="Automation RunTests Sipher" -TestExit="Automation Test Queue Empty"')
  expect(told[0]).toContain('docs/skills/s2-build-test.md')
  expect(await sync($, { action: 'done', note: 'merged 7b68b894, build Succeeded' })).toContain('done needs the post-merge test result line')
  expect(syncOf(w)?.state).toBe('planned')
  expect(await sync($, { action: 'done', note: `merged 7b68b894, build Succeeded; ${TESTS}` })).toContain('done: git and the Editor are open again')
  expect(syncOf(w)?.state).toBe('done')
  await minutes(w, 1)
  expect(parseLockLine(w.read(LOCK)).kind).toBe('free') // the sync's lock given back at its end
})

test('A93: Result: Failed wakes the holder to revert the merge and abort; aborted only then', opts(), async ($, on) => {
  const w = await atT($, on)
  await workerEnds($, MERGED)
  await minutes(w, 1)
  w.put(LOG, 'Building...\nResult: Failed (OtherCompilationError)\n', w.clock.now())
  await minutes(w, 1)
  expect(syncOf(w)?.state).toBe('planned')
  expect(prompts(w).some(p => p.includes('revert it: git -C <checkout> revert -m 1 7b68b894 --no-edit, then call the sync tool abort'))).toBe(true)
  expect(await sync($, { action: 'abort', note: 'build failed: S2Foo.cpp(12) error C2065; reverted 7b68b894' })).toContain('aborted')
  expect(syncOf(w)?.state).toBe('aborted')
})

test('A93: a worker ending with no SYNC line while a merge commit sits on top of the pre-merge HEAD is merged: frozen; no build process and no Result line → the holder is told to read the result', opts(), async ($, on) => {
  const w = await atT($, on, { 'log -1 --format=%H %P HEAD': { stdout: `7b68b894aaaa ${PRE} 1c153b41bbbb\n` } })
  w.machine.procs = [UBT]
  await workerEnds($, 'I\'m waiting for the build to print its own "Result:" line.')
  expect([syncOf(w)?.state, syncOf(w)?.stage, syncOf(w)?.mergeSha, syncOf(w)?.buildLog]).toEqual(['planned', 'building', '7b68b894aaaa', LOG])
  await minutes(w, 5)
  expect(prompts(w).some(p => p.includes('has no Result: line'))).toBe(false) // the build process still runs
  w.machine.procs = []
  await minutes(w, 3)
  expect(prompts(w).filter(p => p.includes(`A5R · Sync main — the merge 7b68b894aaaa is in but no build process runs and its build log (${LOG}) has no Result: line of this run`)).length).toBe(1)
  expect(syncOf(w)?.state).toBe('planned')
})

// A96 (rev 33, by design): no longer aborted: handed back to the holder in the manual stage.
test('A93 / A96: no SYNC line and no merge commit on top of the pre-merge HEAD → the manual stage', opts(), async ($, on) => {
  const w = await atT($, on, { 'log -1 --format=%H %P HEAD': { stdout: `${PRE} 111111\n` } })
  await workerEnds($, 'Stopped: the fetch failed.')
  expect([syncOf(w)?.state, syncOf(w)?.stage, syncOf(w)?.note]).toEqual(['planned', 'manual', 'the sync worker ended without a SYNC line and no merge commit sits on top of the pre-merge HEAD: Stopped: the fetch failed.'])
})

test('A93: the hard end moves once by 30 min while the build still runs near it; the sync expires only past the new end', opts(), async ($, on) => {
  const w = await atT($, on)
  w.machine.procs = [UBT]
  w.put(LOG, 'Building 4127 actions...\n')
  await workerEnds($, MERGED)
  await minutes(w, 81) // 16:06: within 10 min of the hard end 16:15, the build still runs
  expect([syncOf(w)?.hardEnd, syncOf(w)?.extended, syncOf(w)?.state]).toEqual([T(16, 45), true, 'planned'])
  await minutes(w, 15) // 16:21: past the old end, still frozen
  expect(syncOf(w)?.state).toBe('planned')
  await minutes(w, 25) // 16:46: past the new end, still building: it expires (never a second extension)
  expect(syncOf(w)?.state).toBe('expired')
})

// ---------- A94 ----------
test('A94: in its sync\'s building stage the holder\'s build request goes ahead of the queue, is not capped at 45 min, and ends with the sync', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put('E:/s2/.git/HEAD', 'ref: refs/heads/HaiHuynh/20261005')
  w.put(LOCK, 'free since 14:35\n')
  const peer = (id8: string, at: number): string => JSON.stringify({ ...blankSession(`${id8}-1111-4000-8000-000000000000`, `lane-${id8}`, '', NOW), heartbeatAt: NOW + 120 * MIN, want: { minutes: 30, pie: true, build: false, what: 'waits for the merged build', mode: 'interactive', pausable: true, nextSafe: 'after save', requestedAt: at } } as SessionFile)
  for (const [id8, at] of [['c1c1c1c1', T(14, 20)], ['c2c2c2c2', T(14, 25)], ['c3c3c3c3', T(14, 30)], ['c4c4c4c4', T(14, 32)]] as const) w.put(`${HF}/editor/${id8}.json`, peer(id8, at))
  const s: SyncFile = { ...newSync(T(14, 30), { session: ME, id8: ME8, lane: '3️⃣-Loco-fix' }, '3️⃣-Loco-fix', NOW - 60 * MIN, true), hardEnd: T(16, 0), workerAt: T(14, 30), workerId: 'w-gone', stage: 'building', mergeSha: '7b68b894', preHead: PRE }
  w.put(SYNC, JSON.stringify(s))
  await $.session.start(START)
  const ran = out(await $.tool.call({ tool: 'mcp__a5r__editor', action: 'request', minutes: 120, build: true, launch: false, what: 'post-merge build of 7b68b894' } as never))
  expect(ran).not.toContain('at most 45 min')
  expect(ran).toContain('this session holds the Editor until 16:00')
  expect(parseLockLine(w.read(LOCK)).id8).toBe(ME8)
})

// ---------- A95 ----------
test('A95: done without a test line is refused; "tests skipped: <why>" or a result line is accepted, and the done notice names it', opts(), async ($, on) => {
  expect([testsOf(`merged x; ${TESTS}`), testsOf('merged x; tests skipped: the Editor build failed upstream'), testsOf('merged x; 312 passed, 0 failed'), testsOf('merged x, build Succeeded')]).toEqual([TESTS, 'tests skipped: the Editor build failed upstream', '312 passed, 0 failed', null])
  const done = { ...newSync(T(14, 0), { session: 'b', id8: 'bbbbbbbb', lane: 'sync-lane' }, 'x', NOW), state: 'done' as const, endedAt: T(15, 0), note: `merged 7b68b894; ${TESTS}` }
  expect(NOTICES.lifted(done)).toContain(`done at 15:00 · ${TESTS}`)
  expect(NOTICES.lifted({ ...done, note: 'merged 7b68b894; 312 passed, 0 failed' })).toContain('done at 15:00 · tests: 312 passed, 0 failed')
  const w = await atT($, on)
  await workerEnds($, 'SYNC MERGED 7b68b894 build-log=none')
  expect(syncOf(w)?.stage).toBe('building') // a build sync without a log: the build state is unknown, still frozen
  expect(await sync($, { action: 'done', note: 'merged 7b68b894' })).toContain('done needs the post-merge test result line in its note → run the post-merge headless tests')
  expect(await sync($, { action: 'done', note: 'merged 7b68b894; tests skipped: no free memory for a headless run' })).toContain('done: git and the Editor are open again')
  expect([syncOf(w)?.state, testsOf(syncOf(w)?.note ?? '')]).toEqual(['done', 'tests skipped: no free memory for a headless run'])
})

// ---------- review of rev 32 ----------
const GONE_B = { session: 'bbbbbbbb-1111-4000-8000-000000000000', id8: 'bbbbbbbb', lane: 'sync-lane' }
/** A build sync at 14:30 already in a stage (hard end `hardEnd`), held by `holder`, its worker gone. */
const staged = (w: W, o: Partial<SyncFile>, holder = { session: ME, id8: ME8, lane: '3️⃣-Loco-fix' }) =>
  w.put(SYNC, JSON.stringify({ ...newSync(T(14, 30), holder, holder.lane, NOW - 60 * MIN, true), hardEnd: T(16, 0), workerAt: T(14, 30), workerId: 'w-gone', stage: 'building', mergeSha: '7b68b894', preHead: PRE, buildLog: LOG, stageAt: T(14, 35), ...o } as SyncFile))

test('A93 (review): git timing out at the worker\'s end keeps the sync building, never lifted on uncertainty; the sha is read once git answers', opts(), async ($, on) => {
  const git: Git = { 'log -1 --format=%H %P HEAD': { stdout: '', deny: 'timed out after 30000 ms' } }
  const w = await atT($, on, git)
  w.machine.procs = [UBT]
  await workerEnds($, 'I am waiting for the build to print its own "Result:" line.')
  expect([syncOf(w)?.state, syncOf(w)?.stage, syncOf(w)?.mergeSha]).toEqual(['planned', 'building', ''])
  expect(prompts(w).some(p => p.includes('aborted') || p.includes('Sync main — done'))).toBe(false)
  git['log -1 --format=%H %P HEAD'] = { stdout: `7b68b894 ${PRE} 1c153b41\n` }
  await minutes(w, 1)
  expect([syncOf(w)?.state, syncOf(w)?.mergeSha]).toEqual(['planned', '7b68b894'])
})

test('A93 (review): a SYNC MERGED line keeps the sync building even when git shows HEAD unchanged', opts(), async ($, on) => {
  const w = await atT($, on, { 'log -1 --format=%H %P HEAD': { stdout: `${PRE} 1111aaaa\n` } })
  await workerEnds($, MERGED)
  expect([syncOf(w)?.state, syncOf(w)?.stage]).toEqual(['planned', 'building'])
})

test('A93 (review): the holder gone mid-build: the sync is handed to a live session, still frozen, told the stage and the build log', opts(), async ($, on) => {
  const w = world(on, { ram: '40', procs: [UBT] })
  w.put('E:/s2/.git/HEAD', 'ref: refs/heads/HaiHuynh/20261005')
  w.put(`${HF}/editor/bbbbbbbb.json`, JSON.stringify({ ...blankSession(GONE_B.session, GONE_B.lane, '', NOW), heartbeatAt: NOW - 30 * MIN } as SessionFile), NOW - 30 * MIN)
  staged(w, {}, GONE_B)
  w.put(LOG, 'Building 4127 actions...\n', T(14, 36))
  await $.session.start(START)
  await minutes(w, 1)
  expect([syncOf(w)?.state, syncOf(w)?.holder.id8, syncOf(w)?.stage]).toEqual(['planned', ME8, 'building'])
  const told = prompts(w).filter(p => p.includes('was held by sync-lane, which is gone'))
  expect(told.length).toBe(1)
  expect(told[0]).toContain(`the merge 7b68b894 is in, so this session now holds it, in its building stage (build log ${LOG}), frozen until 16:00 at the latest`)
})

for (const [what, procs, deny] of [['an UnrealEditor-Cmd test run', [{ name: 'UnrealEditor-Cmd', pid: 70, gb: 13, parentAlive: true }], false], ['no process reading at all', [], true]] as const)
  test(`A93 (review): in the testing stage near its hard end, ${what} moves the hard end once by 30 min`, opts(), async ($, on) => {
    const w = world(on, { ram: '40', procs: [...procs], git: deny ? { 'ConvertTo-Json': { stdout: '', deny: 'probe failed' } } : {} })
    w.put('E:/s2/.git/HEAD', 'ref: refs/heads/HaiHuynh/20261005')
    staged(w, { stage: 'testing', hardEnd: T(14, 48) })
    await $.session.start(START)
    await minutes(w, 1)
    expect([syncOf(w)?.state, syncOf(w)?.hardEnd, syncOf(w)?.extended]).toEqual(['planned', T(15, 18), true])
  })

test('A93 (review): a stale Result line is ignored: a log written before the stage began does not count; this run\'s does', opts(), async ($, on) => {
  const w = world(on, { ram: '40', procs: [UBT] })
  w.put('E:/s2/.git/HEAD', 'ref: refs/heads/HaiHuynh/20261005')
  staged(w, {})
  w.put(LOG, 'Building 4127 actions...\nResult: Succeeded\n', T(14, 0)) // an earlier run's log, before the stage began
  await $.session.start(START)
  await minutes(w, 2)
  expect(syncOf(w)?.stage).toBe('building')
  w.put(LOG, 'Building 4127 actions...\nResult: Succeeded\n', w.clock.now()) // this run, written fresh with >
  await minutes(w, 1)
  expect(syncOf(w)?.stage).toBe('testing')
})

test('A94 (review): the holder\'s own Editor request in its open sync is the sync\'s slot, released at done', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put('E:/s2/.git/HEAD', 'ref: refs/heads/HaiHuynh/20261005')
  w.put(LOCK, 'free since 14:35\n')
  staged(w, { stage: 'testing' })
  await $.session.start(START)
  expect(out(await $.tool.call({ tool: 'mcp__a5r__editor', action: 'request', minutes: 60, build: true, launch: false, what: 'post-merge tests' } as never))).toContain('this session holds the Editor until 16:00')
  const want = (JSON.parse(w.read(`${HF}/editor/${ME8}.json`)) as SessionFile).want
  expect([want?.what, want?.sync]).toEqual(['post-merge tests', { at: T(14, 30), role: 'holder' }])
  expect(await sync($, { action: 'done', note: `merged 7b68b894; ${TESTS}` })).toContain('done:')
  await minutes(w, 1)
  expect(parseLockLine(w.read(LOCK)).kind).toBe('free')
})
