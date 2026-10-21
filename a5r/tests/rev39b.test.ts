import { expect, test } from 'claude-code/testing'
import { blankSession, newSync } from '../hooks/coord.ts'
import { headOwner, mayClaim, parseHeadOwner, withOp } from '../hooks/opguard.ts'
import { ME, NOW, PROJ, opts, refused, world, type Rec } from './world.ts'

// Rev 39, the Fable adversary review of 4b51c86 (git 2.45.1 measured: status, checkout --ours/--theirs, add and diff
// leave the head file's mtime alone; --continue onto the next conflicting commit writes a new head file): D1 a coinciding
// command never takes another session's head file; D2 the notice during a planned sync; D3 /clear keeps the owner; D4 a
// backgrounded operation is claimed at the minute.
const HF = 'E:/s2/Saved/A5R'
const SYNC = `${HF}/sync.json`
const OWNER = `${HF}/head-owner.json`
const ME8 = ME.slice(0, 8)
const START = { cwd: PROJ, surface: 'terminal', isInteractive: true } as never
const T = (h: number, m: number) => new Date(2026, 9, 6, h, m).getTime()
const MIN = 60_000
const B = { session: 'bbbbbbbb-1111-4000-8000-000000000000', id8: 'bbbbbbbb', lane: 'sync-lane' }
const C = { session: 'cccccccc-1111-4000-8000-000000000000', id8: 'cccccccc', lane: 'lane-cccccccc' }
const peer = (id8: string, at = NOW + 300 * MIN): string => JSON.stringify({ ...blankSession(`${id8}-1111-4000-8000-000000000000`, id8 === 'bbbbbbbb' ? 'sync-lane' : `lane-${id8}`, '', NOW), heartbeatAt: at })
const prompts = (w: ReturnType<typeof world>): string[] => (w.calls['prompt.submit'] ?? []).map(e => String((e as Rec).text))
const repo = (w: ReturnType<typeof world>) => w.put('E:/s2/.git/HEAD', 'ref: refs/heads/HaiHuynh/20261005')
const ownerOfFile = (w: ReturnType<typeof world>) => parseHeadOwner(w.read(OWNER))?.id8 ?? null

// ---------- D1 ----------
test('D1: unit: a session claims a head file only when it coordinates, its own operation can have left it, after it started, with no valid record', () => {
  const h = { head: 'REVERT_HEAD' as const, mtimeMs: T(14, 41) }
  const op = { verbs: ['revert'], at: T(14, 40) }
  expect(mayClaim(h, op, null, true)).toBe(true)
  expect(mayClaim(h, op, null, false)).toBe(false) // no liveness: a gone owner could never be taken over
  expect(mayClaim(h, { verbs: ['pull'], at: T(14, 40) }, null, true)).toBe(false) // a pull leaves MERGE_HEAD only
  expect(mayClaim(h, { verbs: ['revert'], at: T(14, 42) }, null, true)).toBe(false) // the file is older than the command
  expect(mayClaim(h, op, headOwner(h, C, T(14, 41), 'started'), true)).toBe(false) // a valid record is never overwritten
  expect(mayClaim(h, op, headOwner({ ...h, mtimeMs: T(13, 0) }, C, T(13, 0), 'started'), true)).toBe(true) // an older file's record
  expect(withOp({ verbs: ['pull'], at: T(14, 40) }, { verbs: ['revert'], at: T(14, 45) })).toEqual({ verbs: ['pull', 'revert'], at: T(14, 40) })
})

test('D1: a pull that runs while another session\'s revert stops on a conflict never takes its head file, recorded or not', opts(), async ($, on) => {
  const w = world(on)
  repo(w)
  const PULL = 'git -C E:/s2 pull --no-edit'
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc'))
  // Not yet recorded by C when this session's pull returns: a pull leaves MERGE_HEAD, never REVERT_HEAD.
  w.toolEffects.set(PULL, () => w.put('E:/s2/.git/REVERT_HEAD', 'abc1234\n', NOW))
  await $.session.start(START)
  expect(refused(await $.tool.call({ tool: 'Bash', command: PULL }))).toBeUndefined()
  expect(w.read(OWNER)).toBe('')
  // Recorded by C first: a record valid for this very file is never overwritten, whatever the command.
  w.put(OWNER, JSON.stringify(headOwner({ head: 'REVERT_HEAD', mtimeMs: NOW }, C, NOW, 'started')))
  w.files.delete('e:/s2/.git/revert_head')
  const REVERT = 'git -C E:/s2 revert 1a2b3c4'
  w.toolEffects.set(REVERT, () => w.put('E:/s2/.git/REVERT_HEAD', 'abc1234\n', NOW)) // C's file, same mtime as its record
  expect(refused(await $.tool.call({ tool: 'Bash', command: REVERT }))).toBeUndefined()
  expect(ownerOfFile(w)).toBe('cccccccc')
  // C keeps its own continue; this session is refused it.
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git -C E:/s2 revert --continue' }))).toContain('lane-cccccccc started it at')
})

test('D1: a head file older than the command is not claimed; the owner\'s --continue onto the next conflict claims the new one', opts(), async ($, on) => {
  const w = world(on)
  repo(w)
  w.put(SYNC, JSON.stringify({ ...newSync(T(14, 0), { session: ME, id8: ME8, lane: 'me' }, 'me', NOW - 60 * MIN), state: 'done', endedAt: T(14, 30) })) // this session owns by the old rule
  w.put('E:/s2/.git/CHERRY_PICK_HEAD', 'abc1234\n', T(14, 35))
  await $.session.start(START)
  const CONTINUE = 'git -C E:/s2 cherry-pick --continue'
  expect(refused(await $.tool.call({ tool: 'Bash', command: CONTINUE }))).toBeUndefined()
  expect(w.read(OWNER)).toBe('') // the file was there before the command started
  w.toolEffects.set(CONTINUE, () => w.put('E:/s2/.git/CHERRY_PICK_HEAD', 'def5678\n', w.clock.now())) // the next commit conflicts
  expect(refused(await $.tool.call({ tool: 'Bash', command: CONTINUE }))).toBeUndefined()
  expect(parseHeadOwner(w.read(OWNER))).toEqual(expect.objectContaining({ head: 'CHERRY_PICK_HEAD', id8: ME8, mtimeMs: NOW }))
})

// ---------- D2 ----------
test('D2: a head file left by a gone session during a planned sync is told (Editor grants wait on it); the taker needs no new sync', opts(), async ($, on) => {
  const w = world(on)
  on('turn.complete', async () => ({ text: '' }))
  repo(w)
  const old = NOW - 3 * 24 * 60 * MIN
  w.put(SYNC, JSON.stringify(newSync(T(16, 0), B, 'sync-lane (session bbbbbbbb)', NOW - 60 * MIN)))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb'))
  w.put('E:/s2/.git/REVERT_HEAD', 'abc1234\n', old)
  w.put(OWNER, JSON.stringify(headOwner({ head: 'REVERT_HEAD', mtimeMs: old }, C, old, 'started')))
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc', old), old) // gone
  await $.session.start(START)
  const told = prompts(w).filter(p => p.includes('A5R · Merge guard'))
  expect(told.length).toBe(1)
  expect(told[0]).toContain('a revert is in progress in the shared S2 checkout (.git/REVERT_HEAD since ')
  expect(told[0]).toContain(') during the sync at 16:00 by sync-lane (planned) → its holder is gone, so this session takes it over')
  expect(told[0]).not.toContain('then plan a new sync')
})

// ---------- D3 ----------
test('D3: after /clear the operation this session owns stays its own', opts(), async ($, on) => {
  const w = world(on)
  repo(w)
  const NEW = 'cd34ef56-0000-4000-8000-000000000000'
  w.put('E:/s2/.git/REVERT_HEAD', 'abc1234\n', T(14, 30))
  w.put(OWNER, JSON.stringify(headOwner({ head: 'REVERT_HEAD', mtimeMs: T(14, 30) }, { session: ME, id8: ME8, lane: 'me' }, T(14, 30), 'started')))
  await $.session.start(START)
  w.ids.current = NEW
  await $.session.end({ reason: 'clear', sessionId: ME, resume: { id: ME } } as never)
  await w.clock.advance(1_000)
  expect(parseHeadOwner(w.read(OWNER))).toEqual(expect.objectContaining({ session: NEW, id8: NEW.slice(0, 8), mtimeMs: T(14, 30) }))
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git -C E:/s2 revert --continue' }))).toBeUndefined()
})

// ---------- D4 ----------
test('D4: a backgrounded revert that stops on a conflict later is claimed at the next minute; a finished foreground one claims nothing later', opts(), async ($, on) => {
  const w = world(on)
  repo(w)
  await $.session.start(START)
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git -C E:/s2 commit -m "x"' }))).toBeUndefined()
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git -C E:/s2 revert 9f8e7d6' }))).toBeUndefined() // foreground, clean
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git -C E:/s2 revert 1a2b3c4', run_in_background: true } as never))).toBeUndefined()
  expect(w.read(OWNER)).toBe('') // still running
  w.put('E:/s2/.git/REVERT_HEAD', 'abc1234\n', NOW + 30_000)
  await w.clock.advance(MIN)
  expect(ownerOfFile(w)).toBe(ME8)
})

test('D4: a backgrounded operation waits for its head file while its git runs in the checkout, and is forgotten once none runs', opts(), async ($, on) => {
  const w = world(on)
  repo(w)
  w.machine.procs = [{ name: 'git', pid: 7, gb: 0.1, parentAlive: true, cmd: 'git -C E:/s2 cherry-pick 1a2b3c4 5d6e7f8' }]
  await $.session.start(START)
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git -C E:/s2 cherry-pick 1a2b3c4 5d6e7f8', run_in_background: true } as never))).toBeUndefined()
  await w.clock.advance(2 * MIN) // still picking: kept
  w.put('E:/s2/.git/CHERRY_PICK_HEAD', 'abc1234\n', w.clock.now())
  w.machine.procs = []
  await w.clock.advance(MIN)
  expect(ownerOfFile(w)).toBe(ME8)
  // A clean one: once its git ended with no head file it is forgotten, so a later head file (another session's) is not claimed.
  w.files.delete('e:/s2/.git/cherry_pick_head')
  w.files.delete(OWNER.toLowerCase())
  w.machine.procs = [{ name: 'git', pid: 8, gb: 0.1, parentAlive: true, cmd: 'git -C E:/s2 revert 9f8e7d6' }]
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git -C E:/s2 revert 9f8e7d6', run_in_background: true } as never))).toBeUndefined()
  await w.clock.advance(MIN) // still running
  w.machine.procs = []
  await w.clock.advance(MIN) // ended clean: forgotten
  w.put('E:/s2/.git/REVERT_HEAD', 'def5678\n', w.clock.now())
  await w.clock.advance(2 * MIN)
  expect(w.read(OWNER)).toBe('')
})

test('D4: a backgrounded operation no reading has seen running yet (a probe older than the command) is kept, and claimed when its head file appears', opts(), async ($, on) => {
  const w = world(on)
  repo(w)
  await $.session.start(START)
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git -C E:/s2 cherry-pick 1a2b3c4..5d6e7f8', run_in_background: true } as never))).toBeUndefined()
  await w.clock.advance(2 * MIN) // the probe lists no git of the checkout: not seen, kept
  w.put('E:/s2/.git/CHERRY_PICK_HEAD', 'abc1234\n', w.clock.now())
  await w.clock.advance(MIN)
  expect(ownerOfFile(w)).toBe(ME8)
})

test('D4: with no backgrounded operation of its own, a head file another session leaves is never claimed at the minute', opts(), async ($, on) => {
  const w = world(on)
  repo(w)
  await $.session.start(START)
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git -C E:/s2 revert 9f8e7d6' }))).toBeUndefined() // foreground, clean
  w.put('E:/s2/.git/REVERT_HEAD', 'abc1234\n', NOW + 30_000)
  await w.clock.advance(2 * MIN)
  expect(w.read(OWNER)).toBe('')
})

// ---------- D5 (documented, not built) ----------
test('D5: a session outside the checkout (editorLock set) is guarded, but never recorded owner, even after an A5R tool gave it a session file', opts(), async ($, on) => {
  const w = world(on, { cwd: 'E:/other' })
  repo(w)
  w.put('E:/other/.git/HEAD', 'ref: refs/heads/main')
  const PICK = 'git -C E:/s2 cherry-pick 1a2b3c4'
  w.toolEffects.set(PICK, () => w.put('E:/s2/.git/CHERRY_PICK_HEAD', 'abc1234\n', NOW))
  await $.session.start({ cwd: 'E:/other', surface: 'terminal', isInteractive: true } as never)
  await $.tool.call({ tool: 'mcp__a5r__sync', action: 'status' } as never) // restores its session file
  expect(refused(await $.tool.call({ tool: 'Bash', command: PICK }))).toBeUndefined()
  expect(w.read(OWNER)).toBe('') // no liveness: a gone owner could never be taken over
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git -C E:/s2 commit -m "x"' }))).toContain('Merge guard')
})
