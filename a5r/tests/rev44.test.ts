import { expect, test } from 'claude-code/testing'
import { blankSession, newSync, type SyncFile } from '../hooks/coord.ts'
import { walkDeep } from '../hooks/gitshared.ts'
import { LOCK_UNREAD_LOOK, cutProblem, goneAfter, heldBy, parseGitTurn, raisedTimeout, staleLockAct, staleLockName, turnKey, turnVerb, type GitTurn } from '../hooks/gitturn.ts'
import { NO_TIMES, STEPS, aheadOf, bandLine, buildMsOf, editNeed, editorWaits, freezeStepOf, parseSyncTimes, timelineLine, type SyncTimes } from '../hooks/syncplan.ts'
import { LOCK, ME, NOW, PROJ, k, opts, refused, text, world } from './world.ts'

// Rev 44 (L-48): A128 one git writer at a time, A129 a git write never killed halfway, A130 a stale index.lock moved
// aside, A131 the freeze lifts in steps, A132 frozen sessions woken when they can go on, A133 what you wait for and until
// when, A134 the freeze seen in every S2 session.
const HF = 'E:/s2/Saved/A5R'
const S2 = 'E:/s2'
const ME8 = ME.slice(0, 8)
const MIN = 60_000
const TURN = `${HF}/git-turn/cccccccc.json` // another session's claim
const MY_TURN = `${HF}/git-turn/${ME8}.json`
const START = { cwd: PROJ, surface: 'terminal', isInteractive: true } as never
const SID = (id8: string) => `${id8}-1111-4000-8000-000000000000`
const peer = (id8: string, at = NOW + 600 * MIN, lane = `lane-${id8}`): string => JSON.stringify({ ...blankSession(SID(id8), lane, '', NOW), heartbeatAt: at })
const shared = (w: ReturnType<typeof world>) => w.put(`${S2}/.git/HEAD`, 'ref: refs/heads/HaiHuynh/20261005')
const bashRan = (w: ReturnType<typeof world>) => w.seen.filter(e => e.tool === 'Bash').length
const lastBash = (w: ReturnType<typeof world>) => w.seen.filter(e => e.tool === 'Bash').pop() as { command?: string; timeout?: number } | undefined
const prompts = (w: ReturnType<typeof world>): string[] => (w.calls['prompt.submit'] ?? []).map(e => String((e as { text?: string }).text))
const idle = async ($: any) => $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
const turnOfPeer = (id8: string, startedAt = NOW): string => JSON.stringify({ v: 1, session: SID(id8), id8, lane: `lane-${id8}`, command: 'git commit', startedAt })
const MINE = 'tools/MHMarkerlessBatch/locate.py'
const ADD = `git -C ${S2} add -- ${MINE}`
const B = { session: SID('bbbbbbbb'), id8: 'bbbbbbbb', lane: 'sync-main' }
const at = (h: number, m: number) => new Date(2026, 9, 6, h, m).getTime()
const settle = async (until: () => boolean) => {
  for (let n = 0; n < 200 && !until(); n += 1) await new Promise(r => (globalThis as unknown as { setTimeout: (f: (v: unknown) => void, ms: number) => void }).setTimeout(r, 2))
}

// ---------- A128: one git writer at a time ----------
test('A128: unit: the turn is held by the earliest live claim of another session that has not lapsed (its session gone, or no git of the checkout for 2 min)', () => {
  const t = parseGitTurn(turnOfPeer('cccccccc')) as GitTurn
  const u = parseGitTurn(turnOfPeer('dddddddd', NOW - MIN)) as GitTurn
  expect(t.command).toBe('git commit')
  expect(parseGitTurn('null')).toBeNull()
  const live = () => true
  const none = new Map<string, number>()
  expect(heldBy([], { me8: ME8, now: NOW, isLive: live, gone: none, fresh: new Set() })).toBeNull()
  expect(heldBy([t], { me8: 'cccccccc', now: NOW, isLive: live, gone: none, fresh: new Set() })).toBeNull() // its own
  expect(heldBy([t], { me8: ME8, now: NOW, isLive: live, gone: none, fresh: new Set() })).toBe(t)
  expect(heldBy([t, u], { me8: ME8, now: NOW, isLive: live, gone: none, fresh: new Set() })).toBe(u) // the earlier claim
  expect(heldBy([t], { me8: ME8, now: NOW, isLive: () => false, gone: none, fresh: new Set() })).toBeNull() // its session gone
  const gone = goneAfter(none, [t], false, NOW)
  expect(goneAfter(gone, [t], false, NOW + MIN).get(turnKey(t))).toBe(NOW) // the first sighting counts
  expect(heldBy([t], { me8: ME8, now: NOW + MIN, isLive: live, gone, fresh: new Set() })).toBe(t)
  expect(heldBy([t], { me8: ME8, now: NOW + 2 * MIN, isLive: live, gone, fresh: new Set() })).toBeNull()
  expect(heldBy([t], { me8: ME8, now: NOW + 2 * MIN, isLive: live, gone, fresh: new Set([turnKey(t)]) })).toBe(t) // its owner rewrote it: its call runs
  expect(goneAfter(gone, [t], true, NOW + MIN).size).toBe(0) // git seen running again
  expect(goneAfter(gone, [t], null, NOW + MIN).size).toBe(0) // an unread process list never counts as gone
  expect(heldBy([t], { me8: ME8, now: NOW + 9 * MIN, isLive: live, gone: goneAfter(none, [{ ...t, startedAt: 1 }], false, NOW), fresh: new Set() })).toBe(t) // another claim's sighting
})

test('A128: a second writer is refused at once naming the holder, and is woken when the turn frees', opts(), async ($, on) => {
  const w = world(on)
  on('turn.complete', async () => ({ text: '' }))
  shared(w)
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc'))
  w.put(TURN, turnOfPeer('cccccccc'))
  w.machine.procs = [{ name: 'git', pid: 47320, gb: 0.1, parentAlive: true, cmd: `git -C ${S2} commit -m wip` }]
  await $.session.start(START)
  expect(refused(await $.tool.call({ tool: 'Bash', command: ADD }))).toBe('A5R · Git turn — git busy: lane-cccccccc runs `git commit` since 14:40 → A5R tells you when it is free (work without git meanwhile; never delete .git/index.lock)')
  expect(bashRan(w)).toBe(0)
  await idle($)
  await w.clock.advance(MIN)
  expect(prompts(w).filter(p => p.includes('git is free'))).toEqual([]) // still held
  w.put(TURN, 'null') // its commit returned
  await w.clock.advance(MIN)
  expect(prompts(w).filter(p => p.includes('git is free'))).toEqual(["A5R · Git turn — git is free again in the shared checkout (lane-cccccccc's `git commit` returned) → run your git command again now"])
  expect(refused(await $.tool.call({ tool: 'Bash', command: ADD }))).toBeUndefined()
  await idle($)
  await w.clock.advance(MIN)
  expect(prompts(w).filter(p => p.includes('git is free')).length).toBe(1) // once
})

test('A128: this session holds the turn while its git write runs (its own parallel write passes) and gives it back when the call returns', opts(), async ($, on) => {
  const w = world(on)
  shared(w)
  await $.session.start(START)
  let release = () => {}
  w.toolHolds.set(ADD, new Promise<void>(r => (release = r)))
  const first = $.tool.call({ tool: 'Bash', command: ADD } as never)
  await settle(() => w.read(MY_TURN).includes(ME8))
  expect(JSON.parse(w.read(MY_TURN))).toMatchObject({ v: 1, id8: ME8, command: 'git add' })
  expect(refused(await $.tool.call({ tool: 'Bash', command: `git -C ${S2} add -- tools/other.py` }))).toBeUndefined()
  expect(w.read(MY_TURN)).toContain(ME8) // the first still runs
  release()
  await first
  expect(w.read(MY_TURN)).toBe('null')
})

test('A128: two sessions claiming at once both step back (each writes only its own claim, none is lost)', opts(), async ($, on) => {
  const w = world(on)
  shared(w)
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc'))
  await $.session.start(START)
  // The other session's claim lands right after this session wrote its own, before its second read.
  w.writeEffects.set(`git-turn/${ME8}`, () => w.put(TURN, turnOfPeer('cccccccc', NOW + 1)))
  expect(refused(await $.tool.call({ tool: 'Bash', command: ADD }))).toContain('git busy: lane-cccccccc')
  expect(bashRan(w)).toBe(0)
  expect(w.read(MY_TURN)).toBe('null') // stepped back
  expect(w.read(TURN)).toBe(turnOfPeer('cccccccc', NOW + 1)) // the other's claim stands untouched
})

test('A128: a lapsed turn: its session gone, or no git of the checkout and no index.lock for 2 min', opts(), async ($, on) => {
  const w = world(on)
  shared(w)
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc', NOW - 30 * MIN)) // gone: stale, no lane
  w.put(TURN, turnOfPeer('cccccccc'))
  await $.session.start(START)
  expect(refused(await $.tool.call({ tool: 'Bash', command: ADD }))).toBeUndefined()
  expect(bashRan(w)).toBe(1)
  // A live holder whose git has been gone 2 min: the turn lapses, not before.
  w.put(`${HF}/editor/dddddddd.json`, peer('dddddddd'))
  w.put(`${HF}/git-turn/dddddddd.json`, turnOfPeer('dddddddd', NOW))
  await w.clock.advance(MIN) // seen gone from here
  expect(refused(await $.tool.call({ tool: 'Bash', command: ADD }))).toContain('git busy: lane-dddddddd')
  await w.clock.advance(MIN)
  expect(refused(await $.tool.call({ tool: 'Bash', command: ADD }))).toContain('git busy: lane-dddddddd')
  await w.clock.advance(MIN) // 2 min after it was first seen gone
  expect(refused(await $.tool.call({ tool: 'Bash', command: ADD }))).toBeUndefined()
})

test('A128: git reads and a worktree take no turn and pass while another session holds it', opts(), async ($, on) => {
  const w = world(on)
  shared(w)
  w.put('E:/wt/x/.git', 'gitdir: E:/s2/.git/worktrees/x')
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc'))
  w.put(TURN, turnOfPeer('cccccccc'))
  await $.session.start(START)
  for (const c of [`git -C ${S2} status`, `git -C ${S2} log -1`, `git -C ${S2} diff --cached --name-only`, 'git -C E:/wt/x commit -m "own worktree"', 'git -C E:/wt/x add -- a.md']) expect([c, refused(await $.tool.call({ tool: 'Bash', command: c }))]).toEqual([c, undefined])
  expect(lastBash(w)?.timeout).toBeUndefined() // a worktree's call is left as it is (A129)
  expect(w.read(TURN)).toBe(turnOfPeer('cccccccc'))
})

// ---------- A129: a git write is never killed halfway ----------
test('A129: unit: a git write piped into head/tail, or under timeout/kill, is cut short; reads and other segments are not', () => {
  const seg = (c: string) => walkDeep(c, PROJ).segs
  const cut = (c: string) => {
    const segs = seg(c)
    return cutProblem(c, segs, segs.filter(s => turnVerb(s) !== ''))
  }
  expect(cut('git -C E:/s2 commit -m x -- a.md | tail -3')?.why).toContain('pipes a git write in the shared checkout into tail')
  expect(cut('git -C E:/s2 commit -m x -- a.md | head')?.alt).toBe('run the git command alone, in the foreground and unwrapped: git -C E:/s2 commit -m x -- a.md (A5R gives the call a 10-min timeout; a slow commit is fine)')
  expect(cut('timeout 60 git -C E:/s2 add -- a.md')?.why).toContain('puts a time limit on a git write')
  expect(cut('git -C E:/s2 add -- a.md & sleep 30; kill %1')?.why).toContain('can kill it halfway')
  expect(cut('git -C E:/s2 log -3 | tail -1')).toBeNull()
  expect(cut('git -C E:/s2 commit -m x -- a.md || tail -1 log.txt')).toBeNull() // || is no pipe
  expect(cut('git -C E:/s2 commit -m x -- a.md 2>&1')).toBeNull()
  expect(cut('git -C E:/s2 log -1 | tail -1; git -C E:/s2 commit -m x -- a.md')).toBeNull() // the pipe is the read's
  expect(cut('git -C E:/s2 add -- a.md; git -C E:/s2 add -- a.md | tail -1')?.why).toContain('into tail') // the second of two same segments
  expect(raisedTimeout(undefined, false)).toBe(600_000)
  expect(raisedTimeout(120_000, false)).toBe(600_000)
  expect(raisedTimeout(600_000, false)).toBeNull()
  expect(raisedTimeout(undefined, true)).toBeNull() // a background call is left as it is
})

test('A129: the call gets a 10-min timeout; piped and timeout-wrapped forms are refused with the plain form; a worktree is untouched', opts(), async ($, on) => {
  const w = world(on)
  shared(w)
  w.put('E:/wt/x/.git', 'gitdir: E:/s2/.git/worktrees/x')
  await $.session.start(START)
  expect(refused(await $.tool.call({ tool: 'Bash', command: ADD }))).toBeUndefined()
  expect(lastBash(w)?.timeout).toBe(600_000)
  expect(refused(await $.tool.call({ tool: 'Bash', command: ADD, timeout: 900_000 } as never))).toBeUndefined()
  expect(lastBash(w)?.timeout).toBe(900_000)
  expect(refused(await $.tool.call({ tool: 'Bash', command: ADD, run_in_background: true } as never))).toBeUndefined()
  expect(lastBash(w)?.timeout).toBeUndefined()
  const n = bashRan(w)
  expect(refused(await $.tool.call({ tool: 'Bash', command: `git -C ${S2} commit -m "wip" -- ${MINE} | tail -3` }))).toBe(`A5R · Git turn — \`git -C ${S2} commit -m "wip" -- ${MINE} | tail\` pipes a git write in the shared checkout into tail, which can end it halfway and leave .git/index.lock behind → run the git command alone, in the foreground and unwrapped: git -C ${S2} commit -m wip -- ${MINE} (A5R gives the call a 10-min timeout; a slow commit is fine)`)
  expect(refused(await $.tool.call({ tool: 'PowerShell', command: `timeout 120 git -C ${S2} add -- ${MINE}` }))).toContain('puts a time limit on a git write in the shared checkout')
  expect(bashRan(w)).toBe(n)
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git -C E:/wt/x commit -m x 2>&1 | tail -1' }))).toBeUndefined()
  expect(lastBash(w)?.timeout).toBeUndefined()
})

// ---------- A130: a stale index.lock moved aside ----------
test('A130: unit: every condition must hold for a move; an unread process list asks for a look', () => {
  expect(staleLockAct({ lockAgeMs: 3 * MIN, gitPids: [], isTurnHeld: false })).toBe('move')
  expect(staleLockAct({ lockAgeMs: null, gitPids: [], isTurnHeld: false })).toBe('none')
  expect(staleLockAct({ lockAgeMs: 90_000, gitPids: [], isTurnHeld: false })).toBe('none')
  expect(staleLockAct({ lockAgeMs: 3 * MIN, gitPids: [47320], isTurnHeld: false })).toBe('none')
  expect(staleLockAct({ lockAgeMs: 3 * MIN, gitPids: [], isTurnHeld: true })).toBe('none')
  expect(staleLockAct({ lockAgeMs: 3 * MIN, gitPids: null, isTurnHeld: false })).toBe('unread')
  expect(LOCK_UNREAD_LOOK.next).toContain('never delete it')
  expect(staleLockName(at(11, 24))).toBe('index.lock.stale-20261006-1124')
})

const LOCKF = `${S2}/.git/index.lock`
const moves = (w: ReturnType<typeof world>) => w.runs.filter(r => r.includes('Move-Item'))
const mover = (w: ReturnType<typeof world>) =>
  w.runEffects.set('Move-Item', () => {
    const to = /-Destination '([^']+)'/.exec(moves(w).pop() ?? '')?.[1] ?? ''
    w.put(to, w.read(LOCKF))
    w.files.delete(k(LOCKF))
  })

test('A130: a lock 2 min old with no git of the checkout and no turn is moved aside (never deleted), keeps its content, is logged, and the session it failed is told', opts(), async ($, on) => {
  const FAIL = `git -C ${S2} add -- ${MINE}`
  const w = world(on, { out: { [FAIL]: "fatal: Unable to create 'E:/s2/.git/index.lock': File exists." } })
  on('turn.complete', async () => ({ text: '' }))
  shared(w)
  mover(w)
  w.put(LOCKF, 'DIRC\u0000lock bytes of a killed commit', NOW - 90_000)
  await $.session.start(START)
  expect(moves(w)).toEqual([]) // 1.5 min old
  expect(refused(await $.tool.call({ tool: 'Bash', command: FAIL }))).toBeUndefined() // git itself failed on the lock
  await idle($)
  await w.clock.advance(MIN)
  expect(moves(w)).toEqual([`powershell -NoProfile -Command Move-Item -LiteralPath '${LOCKF}' -Destination '${HF}/index.lock.stale-20261006-1441'`])
  expect(w.read(`${HF}/index.lock.stale-20261006-1441`)).toBe('DIRC\u0000lock bytes of a killed commit')
  expect(w.files.has(k(LOCKF))).toBe(false)
  expect(w.runs.some(r => /Remove-Item|\brm\b|\bdel\b/i.test(r))).toBe(false)
  expect(w.read(`${HF}/orchestrate.log`)).toContain('| rule=stale-index-lock |')
  expect(prompts(w).filter(p => p.startsWith('A5R · Git — .git/index.lock'))).toEqual(['A5R · Git — .git/index.lock in the shared checkout was 2 min old with no git of the checkout running and no git turn held: A5R moved it aside to Saved/A5R/index.lock.stale-20261006-1441 at 14:41 (never deleted) → run your git command again; tell the person if a commit of yours was cut short then'])
})

test('A130: each condition alone stops the move: a younger lock, a git of the checkout running, a git turn held', opts(), async ($, on) => {
  const w = world(on)
  shared(w)
  mover(w)
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc'))
  w.put(LOCKF, 'lock', NOW - 30_000)
  await $.session.start(START)
  await w.clock.advance(MIN) // 1.5 min old
  expect(moves(w)).toEqual([])
  w.machine.procs = [{ name: 'git', pid: 47320, gb: 0.1, parentAlive: true, cmd: `git -C ${S2} commit -m wip` }]
  await w.clock.advance(3 * MIN)
  expect(moves(w)).toEqual([])
  w.machine.procs = []
  w.put(TURN, turnOfPeer('cccccccc', w.clock.now()))
  await w.clock.advance(MIN) // the turn's git is first seen gone now: it holds a while yet
  expect(moves(w)).toEqual([])
  expect(w.read(LOCKF)).toBe('lock')
})

// ---------- A131: the freeze in steps ----------
const BUILD_LOG = (s: SyncFile) => `${HF}/${s.id}-build.log`
const syncIn = (w: ReturnType<typeof world>, stage: SyncFile['stage'], log: string | null = 'Building 412 actions with 32 processes...') => {
  const base = newSync(NOW - 20 * MIN, B, 'sync-main (session bbbbbbbb)', NOW - 60 * MIN, true)
  const s: SyncFile = { ...base, workerAt: NOW - 20 * MIN, stage, stageAt: NOW - 5 * MIN, preHead: 'def5678', mergeSha: stage ? 'abc1234' : '', buildLog: stage === 'building' ? BUILD_LOG(base) : '' }
  w.put(`${HF}/sync.json`, JSON.stringify(s))
  if (log !== null && stage === 'building') w.put(BUILD_LOG(base), log, NOW - MIN)
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', NOW + 600 * MIN, 'sync-main'))
  return s
}
const edit = (file: string) => ({ tool: 'Edit', file_path: `${S2}/${file}`, old_string: 'a', new_string: 'b' })
const SHARED_BUILD = `"D:/E/Engine/Build/BatchFiles/Build.bat" S2Editor Win64 Development -project=${S2}/S2.uproject -WaitMutex`

test('A131: unit: what each step holds, the step from the stage and the build log, and the edits a build step holds', () => {
  expect([...STEPS.merging.held].sort()).toEqual(['build', 'edit', 'editor', 'git', 'source'])
  expect([...STEPS.building.held].sort()).toEqual(['build', 'editor', 'git', 'source'])
  expect([...STEPS.testing.held].sort()).toEqual(['build', 'editor'])
  expect([...STEPS['build-failed'].held].length).toBe(5)
  expect(STEPS.cutoff.held.size).toBe(0)
  expect(freezeStepOf('frozen', 'building', 'Failed')).toBe('build-failed')
  expect(freezeStepOf('frozen', 'building', 'running')).toBe('building')
  expect(freezeStepOf('frozen', null, null)).toBe('merging')
  expect(freezeStepOf('cutoff', null, null)).toBe('cutoff')
  expect(freezeStepOf('done', 'testing', null)).toBeNull()
  const changed = new Set(['config/defaultgame.ini'])
  expect(['Source/S2/A.cpp', 'Plugins/X/x.uplugin', 'Config/DefaultGame.ini', 'docs/notes.md'].map(r => editNeed(r, changed))).toEqual(['source', 'source', 'source', 'edit'])
})

test('A131: while building, edits are allowed again outside Source/, Plugins/ and the files the merge changed; git, builds and the Editor still wait', opts(), async ($, on) => {
  const w = world(on, { git: { 'diff --name-only': { stdout: 'Config/DefaultGame.ini\0Source/S2/Bird.cpp\0' } } })
  shared(w)
  syncIn(w, 'building')
  await $.session.start(START)
  await w.clock.advance(MIN) // the merge's files read
  expect(refused(await $.tool.call(edit('Source/S2/Foo.cpp') as never))).toContain('A5R · Sync main freeze — sync-main merges origin/main since 14:20: no edits under Source/ and Plugins/ (or of the files the merge changed) until its build succeeds (now building) · Sync main 14:20 · ▸ building')
  expect(refused(await $.tool.call(edit('Config/DefaultGame.ini') as never))).toContain('no edits under Source/ and Plugins/ (or of the files the merge changed)')
  expect(refused(await $.tool.call(edit('docs/notes.md') as never))).toBeUndefined()
  expect(refused(await $.tool.call({ tool: 'Bash', command: ADD }))).toContain('no git add in the shared checkout until its build succeeds (now building)')
  expect(refused(await $.tool.call({ tool: 'Bash', command: SHARED_BUILD }))).toContain('builds of the shared project wait until the sync is done')
  expect(refused(await $.tool.call({ tool: 'mcp__unreal-mcp__call_tool', name: 'get_actor' } as never))).toContain('the Editor waits until the sync is done')
})

test('A131: before the merge commit edits wait too; after the build\'s Result: Succeeded git and Source/ edits run while builds and the Editor wait for the tests', opts(), async ($, on) => {
  const w = world(on)
  shared(w)
  syncIn(w, null)
  await $.session.start(START)
  expect(refused(await $.tool.call(edit('docs/notes.md') as never))).toContain('no edits in the shared checkout until the merge is committed (now merging)')
  syncIn(w, 'testing')
  await w.clock.advance(MIN)
  expect(refused(await $.tool.call(edit('Source/S2/Foo.cpp') as never))).toBeUndefined()
  expect(refused(await $.tool.call({ tool: 'Bash', command: ADD }))).toBeUndefined()
  expect(refused(await $.tool.call({ tool: 'Bash', command: SHARED_BUILD }))).toContain('builds of the shared project wait until the sync is done (now testing)')
  expect(refused(await $.tool.call({ tool: 'mcp__unreal-mcp__call_tool', method: 'set_actor_property', arguments: {} } as never))).toContain('the Editor waits until the sync is done (now testing)')
  expect(refused(await $.tool.call({ tool: 'Bash', command: '"D:/E/Engine/Build/BatchFiles/Build.bat" S2Editor Win64 Development -project=D:/wt/s2-bird/S2.uproject' }))).toBeUndefined() // a worktree's build
})

test('A131: a failed build keeps everything frozen', opts(), async ($, on) => {
  const w = world(on)
  shared(w)
  syncIn(w, 'building', 'error C2039: ...\nResult: Failed (OtherCompilationError)\nTotal execution time: 1561.88 seconds')
  await $.session.start(START)
  expect(refused(await $.tool.call(edit('docs/notes.md') as never))).toContain('no edits in the shared checkout until the holder ends the sync (now build failed)')
  expect(refused(await $.tool.call({ tool: 'Bash', command: ADD }))).toContain('until the holder ends the sync')
})

// ---------- A132: frozen sessions woken when they can go on ----------
test('A132: an idle session refused in the freeze is woken at the step that frees it, once, with the timeline', opts(), async ($, on) => {
  const w = world(on)
  on('turn.complete', async () => ({ text: '' }))
  shared(w)
  syncIn(w, null)
  await $.session.start(START)
  expect(refused(await $.tool.call(edit('docs/notes.md') as never))).toContain('(now merging)')
  await idle($)
  await w.clock.advance(MIN)
  expect(prompts(w).filter(p => p.includes('Sync main — building'))).toEqual([])
  syncIn(w, 'building')
  await w.clock.advance(MIN)
  const woken = prompts(w).filter(p => p.includes('Sync main — building'))
  expect(woken.length).toBe(1)
  expect(woken[0]).toContain('A5R · Sync main — building: allowed again: edits in the shared checkout; still waiting: git writes, edits under Source/ and Plugins/ (and of the files the merge changed), the Editor (launch, PIE, MCP), builds of the shared project · Sync main 14:20 · ▸ building')
  await idle($)
  await w.clock.advance(2 * MIN)
  expect(prompts(w).filter(p => p.includes('Sync main — building')).length).toBe(1)
})

test('A132: a busy session is told the step with its next tool result and is not woken (nor told twice)', opts(), async ($, on) => {
  const w = world(on)
  shared(w)
  syncIn(w, null)
  await $.session.start(START)
  expect(refused(await $.tool.call(edit('docs/notes.md') as never))).toContain('(now merging)')
  syncIn(w, 'building')
  await w.clock.advance(MIN)
  expect(prompts(w)).toEqual([]) // busy: no wake
  const told = ((await $.tool.call({ tool: 'Bash', command: 'echo working' } as never)) as { context?: string[] }).context ?? []
  expect(told.filter(c => c.includes('Sync main — building: allowed again')).length).toBe(1)
  await w.clock.advance(MIN)
  const again = ((await $.tool.call({ tool: 'Bash', command: 'echo more' } as never)) as { context?: string[] }).context ?? []
  expect(again.filter(c => c.includes('Sync main — building'))).toEqual([])
  expect(prompts(w)).toEqual([])
})

// ---------- A133: what everyone waits for, and until when ----------
const T = { merge: [10 * MIN], build: [20 * MIN, 26 * MIN, 30 * MIN], tests: [15 * MIN] } satisfies SyncTimes
const S = (o: Partial<SyncFile> = {}): SyncFile => ({ ...newSync(at(11, 45), B, 'sync-main', at(10, 48), true), ...o })

test('A133: unit: the timeline line per stage: only the steps ahead, the current one marked, ~ estimates from the measured times, late, time unknown', () => {
  expect(timelineLine(S(), 'planned', null, T, at(11, 0))).toBe('Sync main 11:45 · cutoff 11:15 · freeze ~11:45–12:36')
  expect(timelineLine(S(), 'cutoff', 'cutoff', T, at(11, 20))).toBe('Sync main 11:45 · cutoff 11:15 · freeze ~11:45–12:36')
  expect(timelineLine(S({ workerAt: at(11, 45) }), 'frozen', 'merging', T, at(11, 50))).toBe('Sync main 11:45 · ▸ merging ~11:55 → build ~12:21 → tests ~12:36 → you can build again ~12:36')
  expect(timelineLine(S({ stage: 'building', stageAt: at(11, 56) }), 'frozen', 'building', T, at(12, 0))).toBe('Sync main 11:45 · ▸ building ~12:22 → tests ~12:37 → you can build again ~12:37')
  expect(timelineLine(S({ stage: 'building', stageAt: at(11, 56) }), 'frozen', 'building', T, at(12, 40))).toBe('Sync main 11:45 · ▸ building ~12:22 late → tests ~12:55 → you can build again ~12:55')
  expect(timelineLine(S({ stage: 'building', stageAt: at(11, 56) }), 'frozen', 'building', T, at(12, 36))).toBe('Sync main 11:45 · ▸ building ~12:22 → tests ~12:51 → you can build again ~12:51') // 14 min over: not late yet
  expect(timelineLine(S({ stage: 'testing', stageAt: at(12, 20) }), 'frozen', 'testing', T, at(12, 25))).toBe('Sync main 11:45 · ▸ testing ~12:35 → you can build again ~12:35')
  expect(timelineLine(S(), 'frozen', 'merging', NO_TIMES, at(11, 50))).toBe('Sync main 11:45 · ▸ merging (time unknown) → build (time unknown) → tests (time unknown) → you can build again when the sync is done (time unknown, at the latest 13:15)')
  expect(timelineLine(S(), 'frozen', 'merging', { ...NO_TIMES, build: [26 * MIN] }, at(11, 50))).toBe('Sync main 11:45 · ▸ merging (time unknown) → build ~26 min → tests (time unknown) → you can build again when the sync is done (time unknown, at the latest 13:15)')
  expect(timelineLine(S(), 'cutoff', 'cutoff', NO_TIMES, at(11, 20))).toBe('Sync main 11:45 · cutoff 11:15 · freeze from 11:45, end time unknown (at the latest 13:15)')
  expect(timelineLine(S({ stage: 'building', stageAt: at(11, 56) }), 'frozen', 'build-failed', T, at(12, 30))).toBe('Sync main 11:45 · ▸ build failed: the holder reverts or fixes it → you can build again when the sync is done (time unknown, at the latest 13:15)')
  expect(timelineLine(S({ build: false }), 'frozen', 'merging', T, at(11, 50))).toBe('Sync main 11:45 · ▸ merging ~11:55 → tests ~12:10 → you can build again ~12:10')
  expect(aheadOf(S(), 'testing', T, at(12, 0)).steps.map(a => a.run)).toEqual(['tests'])
})

test('A133: unit: the measured times: UnrealBuildTool\'s own total from a build log, the holders\' merge and tests lines, medians of the last five', () => {
  expect(buildMsOf('...\nResult: Succeeded\nTotal execution time: 1191.04 seconds\n')).toBe(1_191_040)
  expect(buildMsOf('Result: Succeeded')).toBeNull()
  const t = parseSyncTimes('{"id":"a","step":"merge","ms":600000,"at":1}\nnot json\n{"id":"a","step":"tests","ms":900000,"at":2}\n{"id":"b","step":"oops","ms":5}', [1, 2, 3, 4, 5, 6])
  expect(t).toEqual({ merge: [600000], build: [2, 3, 4, 5, 6], tests: [900000] })
})

test('A133: unit: each Editor wait says what it waits for, with estimated starts (unknown without data)', () => {
  const starts = new Map([['aaaaaaaa', at(12, 35)], ['cccccccc', at(13, 5)]])
  const rows = [{ id8: 'aaaaaaaa', lane: 'loco' }, { id8: 'cccccccc', lane: 'talab' }]
  const waits = editorWaits({ holder: { lane: 'avian', isSyncSlot: false }, rows, sync: { lane: 'sync-main', word: 'build and tests', at: at(12, 5) }, starts, isKnown: true })
  expect(waits.get('aaaaaaaa')).toBe("after sync-main's build and tests (~12:05) and avian's turn (~12:35)")
  expect(waits.get('cccccccc')).toBe("after sync-main's build and tests (~12:05) and loco's turn (~13:05)")
  const unknown = editorWaits({ holder: { lane: 'sync-main', isSyncSlot: true }, rows: rows.slice(0, 1), sync: { lane: 'sync-main', word: 'build and tests', at: null }, starts, isKnown: false })
  expect(unknown.get('aaaaaaaa')).toBe("after sync-main's build and tests (time unknown)")
})

test('A133: an Editor refusal says what this session waits for and when its turn is expected', opts(), async ($, on) => {
  const w = world(on)
  w.put(LOCK, `HELD lane=lane-cccccccc session=cccccccc since=14:30 2026-10-06 pid=none end=15:20 mode=interactive note=x`)
  w.put(`${HF}/editor/cccccccc.json`, JSON.stringify({ ...JSON.parse(peer('cccccccc')), holding: { since: NOW - 10 * MIN, end: NOW + 40 * MIN, extended: 0 } }))
  await $.session.start(START)
  expect(refused(await $.tool.call({ tool: 'mcp__unreal-mcp__call_tool', method: 'set_actor_property', arguments: {} } as never))).toContain("· this session's turn comes after lane-cccccccc's turn (~15:20) → ")
})

// ---------- A134: the freeze seen in every S2 session ----------
const BAND = { surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props: { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 100, scroll: { offset: 0, bodyRows: 8 } } }
const atherBand = { type: 'Box', props: { key: 'ather-band' }, children: [{ type: 'Text', props: {}, children: ['Ather'] }] }

test('A134: unit: the band per step', () => {
  expect(bandLine(S({ stage: 'building', stageAt: at(11, 56) }), 'building', T, at(12, 0))).toBe('⏸ Sync main · building ~12:22 → tests ~12:37 · new git/Editor/build work waits until ~12:37 · edits OK outside Source/ and Plugins/')
  expect(bandLine(S({ stage: 'testing', stageAt: at(12, 20) }), 'testing', T, at(12, 25))).toBe('⏸ Sync main · testing ~12:35 · new Editor/build work waits until ~12:35 · edits OK')
  expect(bandLine(S(), 'merging', NO_TIMES, at(11, 50))).toBe('⏸ Sync main · merging (time unknown) → build (time unknown) → tests (time unknown) · new git/Editor/build work waits until the sync is done (time unknown, at the latest 13:15) · edits wait too')
  expect(bandLine(S(), 'cutoff', T, at(11, 20))).toBe('⏸ Sync main 11:45 · cutoff: commit your own paths, the Editor is released by 11:35 · freeze ~11:45–12:36')
})

test('A134: every S2 session draws the band above Ather\'s during the freeze, per step, and none once the sync is lifted', opts(), async ($, on) => {
  const w = world(on)
  shared(w)
  on('ui.render', { component: 'AbovePrompt' }, async () => atherBand as never)
  syncIn(w, 'building')
  await $.session.start(START)
  await w.clock.advance(MIN)
  const band = await $.ui.render(BAND as never)
  expect(text(band)).toBe('⏸ Sync main · building (time unknown) → tests (time unknown) · new git/Editor/build work waits until the sync is done (time unknown, at the latest 15:50) · edits OK outside Source/ and Plugins/Ather')
  syncIn(w, 'testing')
  await w.clock.advance(MIN)
  expect(text(await $.ui.render(BAND as never))).toContain('⏸ Sync main · testing (time unknown) · new Editor/build work waits')
  w.put(`${HF}/sync.json`, JSON.stringify({ ...JSON.parse(w.read(`${HF}/sync.json`)), state: 'done', endedAt: w.clock.now(), note: 'merged; 291 passed' }))
  await w.clock.advance(MIN)
  expect(await $.ui.render(BAND as never)).toEqual(atherBand)
})

test('A134: a person\'s prompt in the freeze carries one context line and shows one toast per sync; outside it neither', opts(), async ($, on) => {
  const w = world(on)
  shared(w)
  await $.session.start(START)
  const submit = async (t: string) => {
    await $.prompt.submit({ text: t, wait: false, origin: { kind: 'composer' } } as never)
    return ((w.calls['prompt.submit'] ?? []).pop() as { context?: string[] }).context ?? []
  }
  const toasts = () => (w.calls['ui.toast'] ?? []).map(t => String((t as { text?: unknown }).text ?? t)).filter(t => t.startsWith('Sync main in progress'))
  expect((await submit('no sync')).filter(c => c.includes('Sync main'))).toEqual([])
  expect(toasts()).toEqual([])
  syncIn(w, 'building')
  await w.clock.advance(MIN)
  const ctx = await submit('go on')
  expect(ctx.filter(c => c.startsWith('A5R · Sync main is building'))).toEqual(['A5R · Sync main is building: git writes, edits under Source/ and Plugins/ (and of the files the merge changed), the Editor (launch, PIE, MCP), builds of the shared project wait until the sync is done (time unknown, at the latest 15:50); nothing is blocked for plans, reads and edits outside Source/ and Plugins/. Plan, edit what is allowed and read meanwhile; do not start work that needs what waits.'])
  expect(toasts()).toEqual(['Sync main in progress until the sync is done (time unknown, at the latest 15:50): this session can plan and edit; git, Editor and builds wait'])
  expect((await submit('more')).filter(c => c.startsWith('A5R · Sync main is building')).length).toBe(1)
  expect(toasts().length).toBe(1) // once per sync
})

test('A134: Saved/A5R/status.json says the sync\'s phase, stage, steps and estimates, the Editor holder and queue with their waits, and the focus', opts(), async ($, on) => {
  const w = world(on)
  shared(w)
  const s = syncIn(w, 'building')
  w.put(`${HF}/sync-times.jsonl`, `${JSON.stringify({ id: 'x', step: 'tests', ms: 15 * MIN, at: 1 })}\n`)
  w.put(`${HF}/sync-20261005-1145-f41dc683-build.log`, 'Result: Succeeded\nTotal execution time: 1560.00 seconds\n')
  // This session is first in the queue: the one writer of status.json (Fable 11).
  w.put(`${HF}/editor/${ME8}.json`, JSON.stringify({ ...blankSession(ME, 'lane-me', '', NOW), heartbeatAt: NOW + 600 * MIN, want: { what: 'PIE retest', minutes: 30, pie: true, build: false, launch: true, mode: 'interactive', pausable: true, nextSafe: '', requestedAt: NOW - 10 * MIN, since: NOW - 10 * MIN } }))
  await $.session.start(START)
  await w.clock.advance(MIN)
  const st = JSON.parse(w.read(`${HF}/status.json`))
  expect(st.v).toBe(1)
  expect(st.sync).toMatchObject({ id: s.id, holder: 'sync-main', holderId8: 'bbbbbbbb', phase: 'frozen', stage: 'building', step: 'building', held: ['git', 'source', 'editor', 'build'], hardEnd: s.hardEnd })
  expect(st.sync.steps).toEqual([{ run: 'build', word: 'building', endsAt: s.stageAt + 1_560_000, isNow: true, isLate: false }, { run: 'tests', word: 'tests', endsAt: s.stageAt + 1_560_000 + 15 * MIN, isNow: false, isLate: false }])
  expect(st.sync.liftAt).toBe(s.stageAt + 1_560_000 + 15 * MIN)
  expect(st.sync.line).toBe('Sync main 14:20 · ▸ building ~15:01 → tests ~15:16 → you can build again ~15:16')
  expect(st.sync.band).toContain('⏸ Sync main · building ~15:01')
  expect(st.focus).toBeNull()
  expect(st.editor.queue.map((r: { id8: string }) => r.id8)).toContain(ME8)
  expect(st.editor.queue.find((r: { id8: string }) => r.id8 === ME8).waitsFor).toContain("after sync-main's build and tests (~15:16)")
})
