import { expect, test } from 'claude-code/testing'
import { blankSession, gitWrites, newSync, type SyncFile } from '../hooks/coord.ts'
import { walkDeep } from '../hooks/gitshared.ts'
import { cutProblem, turnVerb, untargetedGitPids } from '../hooks/gitturn.ts'
import { freezeStepOf, shellNeeds } from '../hooks/syncplan.ts'
import { ME, NOW, PROJ, k, opts, refused, text, world } from './world.ts'

// Rev 44, the Fable adversary review's findings 1-12 (S146): each test fails without its fix.
const HF = 'E:/s2/Saved/A5R'
const S2 = 'E:/s2'
const ME8 = ME.slice(0, 8)
const MIN = 60_000
const START = { cwd: PROJ, surface: 'terminal', isInteractive: true } as never
const SID = (id8: string) => `${id8}-1111-4000-8000-000000000000`
const peer = (id8: string, at = NOW + 600 * MIN, lane = `lane-${id8}`): string => JSON.stringify({ ...blankSession(SID(id8), lane, '', NOW), heartbeatAt: at })
const shared = (w: ReturnType<typeof world>) => w.put(`${S2}/.git/HEAD`, 'ref: refs/heads/HaiHuynh/20261005')
const claim = (id8: string, startedAt = NOW): string => JSON.stringify({ v: 1, session: SID(id8), id8, lane: `lane-${id8}`, command: 'git commit', startedAt })
const LOCKF = `${S2}/.git/index.lock`
const ADD = `git -C ${S2} add -- tools/x.py`
const moves = (w: ReturnType<typeof world>) => w.runs.filter(r => r.includes('Move-Item'))
const prompts = (w: ReturnType<typeof world>): string[] => (w.calls['prompt.submit'] ?? []).map(e => String((e as { text?: string }).text))
const B = { session: SID('bbbbbbbb'), id8: 'bbbbbbbb', lane: 'sync-main' }

test('Fable 1: a live claim with a dead git and an old index.lock lapses, then the lock is moved; nobody waits until its owner exits', opts(), async ($, on) => {
  const w = world(on)
  shared(w)
  w.runEffects.set('Move-Item', () => w.files.delete(k(LOCKF)))
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc')) // its session lives on
  w.put(`${HF}/git-turn/cccccccc.json`, claim('cccccccc', NOW - 5 * MIN), NOW - 5 * MIN) // a backgrounded commit's claim
  w.put(LOCKF, 'lock', NOW - 5 * MIN) // its git died; the lock stays
  await $.session.start(START)
  expect(refused(await $.tool.call({ tool: 'Bash', command: ADD }))).toContain('git busy: lane-cccccccc')
  for (let n = 0; n < 3; n += 1) await w.clock.advance(MIN)
  expect(moves(w).length).toBe(1)
  expect(refused(await $.tool.call({ tool: 'Bash', command: ADD }))).toBeUndefined()
})

test('Fable 1: a claim its owner keeps rewriting (its foreground call runs) does not lapse, though no git is seen', opts(), async ($, on) => {
  const w = world(on)
  shared(w)
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc'))
  w.put(`${HF}/git-turn/cccccccc.json`, claim('cccccccc'))
  await $.session.start(START)
  for (let n = 0; n < 4; n += 1) {
    w.put(`${HF}/git-turn/cccccccc.json`, claim('cccccccc'), w.clock.now()) // the owner's minute rewrite
    await w.clock.advance(MIN)
  }
  expect(refused(await $.tool.call({ tool: 'Bash', command: ADD }))).toContain('git busy: lane-cccccccc')
})

test('Fable 1: this session rewrites its claim each minute while its git write runs, so the others never lapse it', opts(), async ($, on) => {
  const w = world(on)
  shared(w)
  await $.session.start(START)
  let release = () => {}
  w.toolHolds.set(ADD, new Promise<void>(r => (release = r)))
  const call = $.tool.call({ tool: 'Bash', command: ADD } as never)
  for (let n = 0; n < 50 && !w.read(`${HF}/git-turn/${ME8}.json`).includes(ME8); n += 1) await new Promise(r => (globalThis as unknown as { setTimeout: (f: (v: unknown) => void, ms: number) => void }).setTimeout(r, 2))
  await w.clock.advance(3 * MIN)
  expect(w.mtimes.get(k(`${HF}/git-turn/${ME8}.json`))).toBe(w.clock.now()) // written again at the last minute
  release()
  await call
})

const syncMine = (w: ReturnType<typeof world>) => {
  const s: SyncFile = { ...newSync(NOW - 5 * MIN, { session: ME, id8: ME8, lane: 'sync-main' }, 'sync-main', NOW - 60 * MIN), workerAt: NOW - 5 * MIN }
  w.put(`${HF}/sync.json`, JSON.stringify(s))
}

test('Fable 2: the holder\'s own merge waits while another session\'s claim or an index.lock stands, and is woken when git is free', opts(), async ($, on) => {
  const w = world(on)
  on('turn.complete', async () => ({ text: '' }))
  shared(w)
  syncMine(w)
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc'))
  w.put(`${HF}/git-turn/cccccccc.json`, claim('cccccccc'))
  await $.session.start(START)
  expect(refused(await $.tool.call({ tool: 'Bash', command: `git -C ${S2} merge --no-edit origin/main` }))).toContain('git busy: lane-cccccccc runs `git commit`')
  w.put(`${HF}/git-turn/cccccccc.json`, 'null')
  w.put(LOCKF, 'lock', NOW)
  expect(refused(await $.tool.call({ tool: 'Bash', command: `git -C ${S2} merge --no-edit origin/main` }))).toContain('git busy: .git/index.lock stands in the shared checkout')
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
  w.files.delete(k(LOCKF))
  await w.clock.advance(MIN)
  expect(prompts(w).filter(p => p.includes('git is free again')).length).toBe(1)
  expect(refused(await $.tool.call({ tool: 'Bash', command: `git -C ${S2} merge --no-edit origin/main` }))).toBeUndefined()
})

test('Fable 2: the sync worker does not start at T over another session\'s live git claim; it starts once the claim is gone', opts(), async ($, on) => {
  const w = world(on)
  shared(w)
  const s = newSync(NOW + MIN, { session: ME, id8: ME8, lane: 'sync-main' }, 'sync-main', NOW - 60 * MIN)
  w.put(`${HF}/sync.json`, JSON.stringify({ ...s, conflicts: [], conflictsAt: NOW + MIN, conflictsSource: 'merge-tree', untracked: [], dry: { main: 'abc', stale: '' } }))
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc'))
  w.put(`${HF}/git-turn/cccccccc.json`, claim('cccccccc'))
  w.machine.procs = [{ name: 'git', pid: 47320, gb: 0.1, parentAlive: true, cmd: `git -C ${S2} commit -m wip` }]
  await $.session.start(START)
  for (let n = 0; n < 3; n += 1) {
    w.put(`${HF}/git-turn/cccccccc.json`, claim('cccccccc'), w.clock.now())
    await w.clock.advance(MIN)
  }
  const spawned = () => (w.calls['agent.spawn'] ?? []).length
  expect(spawned()).toBe(0)
  w.put(`${HF}/git-turn/cccccccc.json`, 'null')
  w.machine.procs = []
  for (let n = 0; n < 12 && spawned() === 0; n += 1) await w.clock.advance(MIN)
  expect(spawned()).toBe(1)
})

test('Fable 3: a session outside the S2 checkout writing its git with -C takes the turn and the long timeout', opts(), async ($, on) => {
  const w = world(on, { cwd: 'D:/Projects/ather-mods' })
  shared(w)
  w.put('D:/Projects/ather-mods/.git/HEAD', 'ref: refs/heads/main')
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc'))
  w.put(`${HF}/git-turn/cccccccc.json`, claim('cccccccc'))
  await $.session.start({ cwd: 'D:/Projects/ather-mods', surface: 'terminal', isInteractive: true } as never)
  await w.clock.advance(MIN)
  expect(refused(await $.tool.call({ tool: 'Bash', command: ADD }))).toContain('git busy: lane-cccccccc runs `git commit` since 14:40 → run it again in a minute')
  w.put(`${HF}/git-turn/cccccccc.json`, 'null')
  expect(refused(await $.tool.call({ tool: 'Bash', command: ADD }))).toBeUndefined()
  expect((w.seen.filter(e => e.tool === 'Bash').pop() as { timeout?: number }).timeout).toBe(600_000)
})

test('Fable 4: a git whose folder its command line does not name may hold the lock: no move while one runs', opts(), async ($, on) => {
  expect(untargetedGitPids({ freeGb: 1, diskGb: null, procs: [{ name: 'git.exe', pid: 1, gb: 0, parentAlive: true, cmd: 'git commit -m wip' }, { name: 'git', pid: 2, gb: 0, parentAlive: true, cmd: 'git -C E:/other status' }, { name: 'git-lfs', pid: 3, gb: 0, parentAlive: true }, { name: 'git', pid: 4, gb: 0, parentAlive: true, cmd: 'git fsmonitor--daemon run' }] } as never)).toEqual([1, 3])
  const w = world(on)
  shared(w)
  w.put(LOCKF, 'lock', NOW - 5 * MIN)
  w.machine.procs = [{ name: 'git', pid: 47320, gb: 0.1, parentAlive: true, cmd: 'git commit -m "slow lfs commit"' }]
  await $.session.start(START)
  await w.clock.advance(2 * MIN)
  expect(moves(w)).toEqual([])
})

test('Fable 6: git writes are coord.ts gitWrites\'s, one list: stash list/show read; lfs pull/checkout write', () => {
  const v = (c: string) => turnVerb(walkDeep(c, PROJ).segs[0] as never)
  expect([v('git -C E:/s2 stash list'), v('git -C E:/s2 stash show -p'), v('git -C E:/s2 stash'), v('git -C E:/s2 lfs pull'), v('git -C E:/s2 lfs checkout x'), v('git -C E:/s2 lfs fetch'), v('git -C E:/s2 push')]).toEqual(['', '', 'stash', 'lfs', 'lfs', '', ''])
  expect(gitWrites('git -C E:/s2 lfs pull').map(w => w.verb)).toEqual(['lfs'])
})

test('Fable 7: a kill beside a git write is refused only when it can reach the git', () => {
  const cut = (c: string) => {
    const segs = walkDeep(c, PROJ).segs
    return cutProblem(c, segs, segs.filter(s => turnVerb(s) !== ''))
  }
  expect(cut('git -C E:/s2 commit -m x -- a.md && taskkill /IM LiveCodingConsole.exe /F')).toBeNull()
  expect(cut('git -C E:/s2 commit -m x -- a.md; taskkill /IM git.exe /F')?.why).toContain('can kill it halfway')
  expect(cut('git -C E:/s2 commit -m x -- a.md & sleep 5; kill $!')?.why).toContain('can kill it halfway')
})

test('Fable 8: the build\'s own Result: Succeeded in the log lifts git and Source/ edits while the stage still says building', opts(), async ($, on) => {
  expect(freezeStepOf('frozen', 'building', 'Succeeded', null)).toBe('testing')
  const w = world(on)
  shared(w)
  const base = newSync(NOW - 20 * MIN, B, 'sync-main', NOW - 60 * MIN, true)
  const log = `${HF}/${base.id}-build.log`
  w.put(`${HF}/sync.json`, JSON.stringify({ ...base, workerAt: NOW - 20 * MIN, stage: 'building', stageAt: NOW - 5 * MIN, buildLog: log, mergeSha: 'abc', preHead: 'def' }))
  w.put(log, 'Building...\nResult: Succeeded\nTotal execution time: 900.00 seconds', NOW - MIN)
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', NOW + 600 * MIN, 'sync-main'))
  await $.session.start(START)
  expect(refused(await $.tool.call({ tool: 'Edit', file_path: `${S2}/Source/S2/Foo.cpp`, old_string: 'a', new_string: 'b' } as never))).toBeUndefined()
  expect(refused(await $.tool.call({ tool: 'Bash', command: ADD }))).toBeUndefined()
  expect(refused(await $.tool.call({ tool: 'Bash', command: `"D:/E/Engine/Build/BatchFiles/Build.bat" S2Editor Win64 Development -project=${S2}/S2.uproject` }))).toContain('(now testing)')
})

test('Fable 9: a shell write into the shared tree is an edit to the freeze (merging), a Source/ write while building', opts(), async ($, on) => {
  const needs = (c: string) => shellNeeds(walkDeep(c, PROJ).segs, S2, new Set(['config/defaultgame.ini']))
  expect(needs('echo x > E:/s2/docs/a.md')).toEqual(['edit'])
  expect(needs('cd E:/s2/Source/S2 && cp ../a.cpp b.cpp')).toEqual(['source'])
  expect(needs('echo x > E:/s2/Config/DefaultGame.ini')).toEqual(['source']) // a file the merge changed (pass 3, C1)
  expect(needs('cat E:/s2/docs/a.md; echo x > out.txt')).toEqual([])
  const w = world(on)
  shared(w)
  w.put(`${HF}/sync.json`, JSON.stringify({ ...newSync(NOW - 5 * MIN, B, 'sync-main', NOW - 60 * MIN), workerAt: NOW - 5 * MIN }))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', NOW + 600 * MIN, 'sync-main'))
  await $.session.start(START)
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'echo note >> E:/s2/docs/notes.md' }))).toContain('no edits in the shared checkout until the merge is committed (now merging)')
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'echo note >> E:/proj/notes.md' }))).toBeUndefined()
})

test('Fable 10: the files the merge changed are read with the step, not a minute later', opts(), async ($, on) => {
  const w = world(on, { git: { 'diff --name-only': { stdout: 'Config/DefaultGame.ini\0' } } })
  shared(w)
  await $.session.start(START)
  const base = newSync(NOW - 20 * MIN, B, 'sync-main', NOW - 60 * MIN, true)
  w.put(`${HF}/sync.json`, JSON.stringify({ ...base, workerAt: NOW - 20 * MIN, stage: 'building', stageAt: NOW, buildLog: `${HF}/${base.id}-build.log`, mergeSha: 'abc', preHead: 'def' }))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', NOW + 600 * MIN, 'sync-main'))
  expect(refused(await $.tool.call({ tool: 'Edit', file_path: `${S2}/Config/DefaultGame.ini`, old_string: 'a', new_string: 'b' } as never))).toContain('or of the files the merge changed')
})

test('Fable 11: one session writes status.json (the first live one in the queue order), not every session', opts(), async ($, on) => {
  const w = world(on)
  shared(w)
  w.put(`${HF}/editor/cccccccc.json`, JSON.stringify({ ...JSON.parse(peer('cccccccc')), want: { what: 'PIE', minutes: 30, pie: true, build: false, launch: true, mode: 'interactive', pausable: true, nextSafe: '', requestedAt: NOW - 10 * MIN } }))
  await $.session.start(START)
  for (let n = 0; n < 3; n += 1) await w.clock.advance(MIN)
  expect(w.read(`${HF}/status.json`)).toBe('') // lane-cccccccc, first in the queue, writes it
})

test('Fable 11: a sync build log without its total is not read again until it changes', opts(), async ($, on) => {
  const w = world(on)
  shared(w)
  const LOG = `${HF}/sync-20261005-1145-f41dc683-build.log`
  w.put(LOG, 'Building... (stopped, no total)', NOW - 60 * MIN)
  const base = newSync(NOW - 20 * MIN, B, 'sync-main', NOW - 60 * MIN, true)
  w.put(`${HF}/sync.json`, JSON.stringify({ ...base, workerAt: NOW - 20 * MIN, stage: 'building', stageAt: NOW - 5 * MIN, buildLog: `${HF}/${base.id}-build.log`, mergeSha: 'abc', preHead: 'def' }))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', NOW + 600 * MIN, 'sync-main'))
  await $.session.start(START) // this session alone: the writer
  await w.clock.advance(MIN)
  w.put(LOG, 'Result: Succeeded. Total execution time: 1560.00 seconds', NOW - 60 * MIN) // same write time: the same log as read
  await w.clock.advance(6 * MIN)
  expect(JSON.parse(w.read(`${HF}/status.json`)).sync.steps[0]).toMatchObject({ run: 'build', endsAt: null })
  w.put(LOG, 'Result: Succeeded. Total execution time: 1560.00 seconds', w.clock.now()) // written again: read again
  await w.clock.advance(6 * MIN)
  expect(JSON.parse(w.read(`${HF}/status.json`)).sync.steps[0].endsAt).toBe(NOW - 5 * MIN + 1_560_000)
})
