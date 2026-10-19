import { expect, test } from 'claude-code/testing'
import { NOTICES, blankSession, newSync, parseLockLine, parseSyncEnd, parseSyncFile, type SessionFile, type SyncFile } from '../hooks/coord.ts'
import { afterWorker, buildResultOf, mergeOnTop, stageNext, testsOf } from '../hooks/syncstage.ts'
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
const LOG = 'E:/s2/Saved/Logs/sync-build-1445.log'
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
const atT = async ($: any, on: any, git: Record<string, { stdout: string; exitCode?: number }> = MERGE_HEAD) => {
  const w = world(on, { ram: '40', git: { 'rev-parse HEAD': { stdout: `${PRE}\n` }, ...git } })
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
  expect(mergeOnTop(`7b68b894aaaa ${PRE} 1c153b41bbbb\n`, PRE)).toBe('7b68b894aaaa')
  expect([mergeOnTop(`7b68b894aaaa 111111 1c153b41bbbb`, PRE), mergeOnTop(`7b68b894aaaa ${PRE}`, PRE)]).toEqual([null, null])
  const s = { stage: 'building' as const, extended: false, hardEnd: T(16, 15), updatedAt: T(14, 50) }
  const step = (o: Partial<typeof s>, f: { result?: 'Succeeded' | 'Failed' | null; isBuilding?: boolean; now: number }) => stageNext({ ...s, ...o }, { result: null, isBuilding: true, ...f }, 10 * MIN)
  expect([step({}, { now: T(16, 6) }).extendTo, step({}, { now: T(16, 4) }).extendTo, step({}, { now: T(16, 6), isBuilding: false }).extendTo, step({ extended: true }, { now: T(16, 6) }).extendTo]).toEqual([T(16, 45), null, null, null])
  expect(step({}, { now: T(15, 0), result: 'Succeeded' })).toEqual({ extendTo: null, next: 'testing', tell: 'testing' })
  expect(step({}, { now: T(15, 0), result: 'Failed' }).tell).toBe('build-failed')
  expect([step({}, { now: T(14, 51), isBuilding: false }).tell, step({}, { now: T(14, 53), isBuilding: false }).tell]).toEqual([null, 'build-unknown'])
  // Git, not the worker, says whether the merge happened.
  expect(afterWorker(parseSyncEnd(MERGED), '7b68b894', true)).toEqual({ kind: 'stage', stage: 'building', mergeSha: '7b68b894', buildLog: LOG, note: `merged 7b68b894; build log ${LOG}` })
  expect(afterWorker(parseSyncEnd(MERGED), null, true)).toEqual({ kind: 'no-merge' })
  expect(afterWorker(parseSyncEnd('SYNC DONE 7b68b894 pre=x build=Succeeded conflicts=none'), '7b68b894', true)).toMatchObject({ kind: 'stage', stage: 'testing' })
  expect(afterWorker(parseSyncEnd('SYNC ABORT conflict in X.uasset state=merge aborted'), '7b68b894', true)).toMatchObject({ kind: 'end', state: 'aborted' })
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
  expect(prompts(w).some(p => /build log is not known|aborted|Sync main — done/.test(p))).toBe(false)
  w.put(LOG, 'Building 4127 actions...\nResult: Succeeded\nTotal execution time: 2160 seconds\n')
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
  w.put(LOG, 'Building...\nResult: Failed (OtherCompilationError)\n')
  await workerEnds($, MERGED)
  await minutes(w, 1)
  expect(syncOf(w)?.state).toBe('planned')
  expect(prompts(w).some(p => p.includes('revert it: git -C <checkout> revert -m 1 7b68b894 --no-edit, then call the sync tool abort'))).toBe(true)
  expect(await sync($, { action: 'abort', note: 'build failed: S2Foo.cpp(12) error C2065; reverted 7b68b894' })).toContain('aborted')
  expect(syncOf(w)?.state).toBe('aborted')
})

test('A93: a worker ending with no SYNC line while a merge commit sits on top of the pre-merge HEAD is merged (build log unknown): frozen; no build process → the holder is told to read the result', opts(), async ($, on) => {
  const w = await atT($, on, { 'log -1 --format=%H %P HEAD': { stdout: `7b68b894aaaa ${PRE} 1c153b41bbbb\n` } })
  w.machine.procs = [UBT]
  await workerEnds($, 'I\'m waiting for the build to print its own "Result:" line.')
  expect([syncOf(w)?.state, syncOf(w)?.stage, syncOf(w)?.mergeSha, syncOf(w)?.buildLog]).toEqual(['planned', 'building', '7b68b894aaaa', ''])
  await minutes(w, 5)
  expect(prompts(w).some(p => p.includes('build log is not known'))).toBe(false) // the build process still runs
  w.machine.procs = []
  await minutes(w, 3)
  expect(prompts(w).filter(p => p.includes('A5R · Sync main — the merge 7b68b894aaaa is in but its build log is not known and no build process runs')).length).toBe(1)
  expect(syncOf(w)?.state).toBe('planned')
})

test('A93: no SYNC line and no merge commit on top of the pre-merge HEAD → aborted, as before', opts(), async ($, on) => {
  const w = await atT($, on, { 'log -1 --format=%H %P HEAD': { stdout: `${PRE} 111111\n` } })
  await workerEnds($, 'Stopped: the fetch failed.')
  expect([syncOf(w)?.state, syncOf(w)?.note]).toEqual(['aborted', 'the sync worker ended without a SYNC line and no merge commit sits on top of the pre-merge HEAD: Stopped: the fetch failed.'])
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
