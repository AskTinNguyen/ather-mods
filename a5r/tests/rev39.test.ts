import { expect, test } from 'claude-code/testing'
import { DEFAULT_GATES, NOTICES, blankSession, decide, isSyncCommandOnly, newSync, parseLockLine, type GrantInput, type SessionFile } from '../hooks/coord.ts'
import { endOf } from '../hooks/gitshared.ts'
import { headOwner, ownerOf, parseHeadOwner } from '../hooks/opguard.ts'
import { LOCK, ME, NOW, PROJ, opts, refused, world, type Rec } from './world.ts'

// Rev 39 (L-43, finding F-9): A115 a revert or cherry-pick left half done in the shared checkout is guarded like a merge
// (A14's merge guard, A61's grant wait): its owner alone writes there, Editor grants wait, the notice names the operation.
const HF = 'E:/s2/Saved/A5R'
const SYNC = `${HF}/sync.json`
const OWNER = `${HF}/head-owner.json`
const ME8 = ME.slice(0, 8)
const START = { cwd: PROJ, surface: 'terminal', isInteractive: true } as never
const T = (h: number, m: number) => new Date(2026, 9, 6, h, m).getTime()
const MIN = 60_000
const B = { session: 'bbbbbbbb-1111-4000-8000-000000000000', id8: 'bbbbbbbb', lane: 'sync-lane' }
const C = { session: 'cccccccc-1111-4000-8000-000000000000', id8: 'cccccccc', lane: 'lane-cccccccc' }
const FREE = 'FREE since=14:20 2026-10-06 by=lane-x note=done background=none · free since 14:20\n'
const COMMIT = 'git -C E:/s2 commit -m "wip: tail"'
const HEADS = [['REVERT_HEAD', 'revert'], ['CHERRY_PICK_HEAD', 'cherry-pick']] as const
const peer = (id8: string, at = NOW + 300 * MIN): string => JSON.stringify({ ...blankSession(`${id8}-1111-4000-8000-000000000000`, id8 === 'bbbbbbbb' ? 'sync-lane' : `lane-${id8}`, '', NOW), heartbeatAt: at })
const prompts = (w: ReturnType<typeof world>): string[] => (w.calls['prompt.submit'] ?? []).map(e => String((e as Rec).text))
const out = (ran: { result?: unknown; text?: string; deny?: string }): string => String(ran.deny ?? ran.result ?? ran.text ?? '')
const repo = (w: ReturnType<typeof world>) => w.put('E:/s2/.git/HEAD', 'ref: refs/heads/HaiHuynh/20261005')
const ended = (holder = B) => JSON.stringify({ ...newSync(T(14, 0), holder, `${holder.lane} (session ${holder.id8})`, NOW - 60 * MIN), state: 'done', endedAt: T(14, 30) })
/** git as the test's shell runs it: a command that stops on a conflict leaves its head file (what git does). */
const gitLeaves = (w: ReturnType<typeof world>, command: string, head: string, at: number) =>
  w.toolEffects.set(command, () => (head ? w.put(`E:/s2/.git/${head}`, 'abc1234\n', at) : undefined))

// ---------- units ----------
test('A115: unit: the owner is the frozen sync\'s holder, else the record of this very head file, else the last sync\'s holder', () => {
  const h = { head: 'REVERT_HEAD' as const, mtimeMs: T(14, 20) }
  const s = JSON.parse(ended()) as ReturnType<typeof newSync>
  const rec = headOwner(h, C, T(14, 20), 'started')
  expect(ownerOf(h, s, 'done', rec)).toEqual({ id8: 'cccccccc', lane: 'lane-cccccccc', why: 'lane-cccccccc started it at 14:20' })
  expect(ownerOf(h, s, 'frozen', rec)?.id8).toBe('bbbbbbbb') // the sync in its freeze runs the checkout
  expect(ownerOf({ ...h, mtimeMs: T(15, 0) }, s, 'done', rec)?.id8).toBe('bbbbbbbb') // a record of an older head file names nobody
  expect(ownerOf({ head: 'CHERRY_PICK_HEAD', mtimeMs: T(14, 20) }, s, 'done', rec)?.id8).toBe('bbbbbbbb') // nor one of another operation
  expect(ownerOf(h, null, 'none', null)).toBeNull()
  expect(parseHeadOwner(JSON.stringify(rec))).toEqual(rec)
  expect(parseHeadOwner(JSON.stringify({ ...rec, head: 'REBASE_HEAD' }))).toBeNull()
  expect(endOf('REVERT_HEAD', 'E:/s2')).toBe('git -C E:/s2 revert --abort (or finish it: resolve, git add -- <paths>, git revert --continue)')
  expect(endOf('MERGE_HEAD', 'E:/s2')).toBe('git -C E:/s2 merge --abort (or finish it: resolve, git add -- <paths>, git commit --no-edit)')
})

test('A115: unit: the sync\'s own git work includes ending a revert or cherry-pick (abort, continue), not starting a cherry-pick', () => {
  for (const c of ['git -C E:/s2 revert --abort', 'git -C E:/s2 revert --continue', 'git -C E:/s2 revert --continue --no-edit', 'git -C E:/s2 cherry-pick --abort', 'git -C E:/s2 cherry-pick --continue', 'git -C E:/s2 revert -m 1 1a2b3c4 --no-edit'])
    expect([c, isSyncCommandOnly(c)]).toEqual([c, true])
  for (const c of ['git -C E:/s2 cherry-pick 1a2b3c4', 'git -C E:/s2 revert --skip', 'git -C E:/s2 cherry-pick --abort --hard', 'git -C E:/s2 revert 1a2b3c4', 'git -C E:/s2 cherry-pick -m 1 1a2b3c4'])
    expect([c, isSyncCommandOnly(c)]).toEqual([c, false])
})

test('A115: unit: no Editor grant while a revert or cherry-pick is in progress; the wait names the operation', () => {
  const f: SessionFile = { ...blankSession(ME, 'lane-me', 'me', NOW), want: { minutes: 20, pie: false, build: false, what: 'tail', mode: 'interactive', pausable: true, nextSafe: 'after save', requestedAt: NOW - MIN } }
  const x: GrantInput = { me8: ME8, lock: parseLockLine(FREE), files: [f], lanes: [], now: NOW, sync: null, probe: { freeGb: 40, diskGb: 40, procs: [] }, gates: DEFAULT_GATES }
  expect(decide(x).kind).toBe('grant')
  for (const [head, op] of HEADS) {
    const d = decide({ ...x, conflictHead: head })
    expect(d.kind === 'wait' ? [d.code, d.why] : d).toEqual(['merge', `a ${op} is in progress in the shared checkout (.git/${head})`])
  }
})

// ---------- the Proof, through the engine ----------
for (const [head, op] of HEADS) {
  test(`A115 (${head}): a foreign commit is refused while another live session's ${op} waits; the guard names the operation and its owner`, opts(), async ($, on) => {
    const w = world(on)
    repo(w)
    w.put(`E:/s2/.git/${head}`, 'abc1234\n', T(14, 20))
    w.put(OWNER, JSON.stringify(headOwner({ head, mtimeMs: T(14, 20) }, C, T(14, 19), 'started')))
    w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc'))
    await $.session.start(START)
    expect(refused(await $.tool.call({ tool: 'Bash', command: COMMIT }))).toBe(`A5R · Merge guard — a ${op} is in progress in the shared checkout (.git/${head}; lane-cccccccc started it at 14:19): no git commit there until it is finished or aborted → leave the ${op} state alone (no commit, reset, abort or stash of yours): its holder lane-cccccccc (session cccccccc) finishes it or runs git ${op} --abort; work without git or in your own worktree meanwhile`)
    for (const c of [`git -C E:/s2 ${op} --abort`, `git -C E:/s2 ${op} --continue`, 'git -C E:/s2 add -- Source/S2/Tail.cpp']) expect([c, refused(await $.tool.call({ tool: 'Bash', command: c }))]).toEqual([c, expect.stringContaining('Merge guard')])
    expect(refused(await $.tool.call({ tool: 'Bash', command: 'git -C E:/s2 status && git -C E:/s2 diff --stat' }))).toBeUndefined() // reads run
    w.files.delete(`e:/s2/.git/${head.toLowerCase()}`) // finished: the guard lifts with it
    expect(refused(await $.tool.call({ tool: 'Bash', command: COMMIT }))).toBeUndefined()
  })

  test(`A115 (${head}): the session whose ${op} stopped on a conflict owns it: its resolution, continue and abort run`, opts(), async ($, on) => {
    const w = world(on)
    repo(w)
    w.put(SYNC, ended()) // the last sync is another live session's: without the record it would own the head file
    w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb'))
    const start = `git -C E:/s2 ${op} 1a2b3c4`
    gitLeaves(w, start, head, T(14, 41))
    await $.session.start(START)
    expect(refused(await $.tool.call({ tool: 'Bash', command: start }))).toBeUndefined()
    expect(parseHeadOwner(w.read(OWNER))).toEqual(expect.objectContaining({ head, id8: ME8, mtimeMs: T(14, 41), how: 'started' }))
    for (const c of ['git -C E:/s2 checkout --theirs -- Source/S2/Tail.cpp', 'git -C E:/s2 add -- Source/S2/Tail.cpp', `git -C E:/s2 ${op} --continue`, `git -C E:/s2 ${op} --abort`])
      expect([c, refused(await $.tool.call({ tool: 'Bash', command: c }))]).toEqual([c, undefined])
  })

  test(`A115 (${head}): while it exists no Editor grant is made, whatever sync.json says; once it is gone the head of the queue is granted`, opts(), async ($, on) => {
    const w = world(on, { ram: '40' })
    w.put(LOCK, FREE)
    w.put(`E:/s2/.git/${head}`, 'abc1234\n')
    await $.session.start(START)
    expect(out(await $.tool.call({ tool: 'mcp__a5r__editor', action: 'request', minutes: 30, what: 'tail VFX' } as never))).toContain(`a ${op} is in progress in the shared checkout (.git/${head})`)
    expect(parseLockLine(w.read(LOCK)).kind).toBe('free')
    w.files.delete(`e:/s2/.git/${head.toLowerCase()}`)
    await w.clock.advance(MIN)
    expect(parseLockLine(w.read(LOCK)).id8).toBe(ME8)
  })

  test(`A115 (${head}): left behind by a gone session (days old): the notice names the ${op}, the live session takes it over and may abort it`, opts(), async ($, on) => {
    const w = world(on)
    on('turn.complete', async () => ({ text: '' }))
    repo(w)
    const old = NOW - 3 * 24 * 60 * MIN
    w.put(`E:/s2/.git/${head}`, 'abc1234\n', old)
    w.put(OWNER, JSON.stringify(headOwner({ head, mtimeMs: old }, C, old, 'started')))
    w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc', old), old) // gone
    await $.session.start(START)
    const told = prompts(w).filter(p => p.includes('A5R · Merge guard'))
    expect(told.length).toBe(1)
    expect(told[0]).toContain(`A5R · Merge guard — a ${op} is in progress in the shared S2 checkout (.git/${head} since `)
    expect(told[0]).toContain(`its holder is gone, so this session takes it over: /a5r sync takeover (or the sync tool, action takeover), then git -C E:/s2 ${op} --abort (or finish it: resolve, git add -- <paths>, git ${op} --continue)`)
    const abort = `git -C E:/s2 ${op} --abort`
    expect(refused(await $.tool.call({ tool: 'Bash', command: abort }))).toContain(`its holder is gone: take it over with /a5r sync takeover (or the sync tool, action takeover), then run git -C E:/s2 ${op} --abort`)
    expect(out(await $.tool.call({ tool: 'mcp__a5r__sync', action: 'takeover' } as never))).toContain(`taken over the ${op} left in the shared checkout (.git/${head}): run git -C E:/s2 ${op} --abort`)
    expect(parseHeadOwner(w.read(OWNER))).toEqual(expect.objectContaining({ head, id8: ME8, how: 'took over' }))
    expect(refused(await $.tool.call({ tool: 'Bash', command: abort }))).toBeUndefined()
    expect(w.read(SYNC)).toBe('') // no sync is invented for it
  })
}

test('A115: one takeover takes both a planned sync whose holder is gone and the revert a gone session left; a live owner\'s is refused', opts(), async ($, on) => {
  const w = world(on)
  repo(w)
  const old = NOW - 3 * 24 * 60 * MIN
  w.put(SYNC, JSON.stringify(newSync(T(16, 0), B, 'sync-lane (session bbbbbbbb)', NOW - 60 * MIN))) // planned, before its cutoff
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', NOW - 30 * MIN), NOW - 30 * MIN) // gone
  w.put('E:/s2/.git/REVERT_HEAD', 'abc1234\n', old)
  w.put(OWNER, JSON.stringify(headOwner({ head: 'REVERT_HEAD', mtimeMs: old }, C, old, 'started')))
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc', old), old) // gone
  await $.session.start(START)
  expect(out(await $.tool.call({ tool: 'mcp__a5r__sync', action: 'takeover' } as never))).toContain('; and taken over the revert left in the shared checkout (.git/REVERT_HEAD): run git -C E:/s2 revert --abort')
  expect([JSON.parse(w.read(SYNC)).holder.id8, parseHeadOwner(w.read(OWNER))?.id8]).toEqual([ME8, ME8])
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git -C E:/s2 revert --abort' }))).toBeUndefined()
  // A live session's left revert (no sync open) is its own: a takeover is refused and names it.
  w.put(SYNC, ended())
  w.put('E:/s2/.git/REVERT_HEAD', 'abc1234\n', T(14, 30))
  w.put(OWNER, JSON.stringify(headOwner({ head: 'REVERT_HEAD', mtimeMs: T(14, 30) }, C, T(14, 30), 'started')))
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc'))
  expect(out(await $.tool.call({ tool: 'mcp__a5r__sync', action: 'takeover' } as never))).toContain('the revert left in the shared checkout (.git/REVERT_HEAD) is lane-cccccccc\'s (session cccccccc), which is live; only it ends it')
})

for (const isMineSync of [false, true])
  test(`A115: with a planned sync ${isMineSync ? 'this session holds' : 'a live session holds'}, a takeover takes the revert a gone session left (the sync stays)`, opts(), async ($, on) => {
    const w = world(on)
    repo(w)
    const old = NOW - 3 * 24 * 60 * MIN
    const holder = isMineSync ? { session: ME, id8: ME8, lane: 'me' } : B
    w.put(SYNC, JSON.stringify(newSync(T(16, 0), holder, `${holder.lane} (session ${holder.id8})`, NOW - 60 * MIN)))
    w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb'))
    w.put('E:/s2/.git/REVERT_HEAD', 'abc1234\n', old)
    w.put(OWNER, JSON.stringify(headOwner({ head: 'REVERT_HEAD', mtimeMs: old }, C, old, 'started')))
    w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc', old), old) // gone
    await $.session.start(START)
    const why = refused(await $.tool.call({ tool: 'Bash', command: 'git -C E:/s2 revert --abort' })) ?? ''
    expect(why).toContain('lane-cccccccc started it at') // the record outranks the planned sync's holder
    expect(why).toContain('its holder is gone: take it over with /a5r sync takeover')
    const took = out(await $.tool.call({ tool: 'mcp__a5r__sync', action: 'takeover' } as never))
    expect(took).toContain('taken over the revert left in the shared checkout (.git/REVERT_HEAD): run git -C E:/s2 revert --abort')
    expect(took).not.toContain('then plan a new sync') // one is planned
    expect([JSON.parse(w.read(SYNC)).holder.id8, parseHeadOwner(w.read(OWNER))?.id8]).toEqual([holder.id8, ME8])
    expect(refused(await $.tool.call({ tool: 'Bash', command: 'git -C E:/s2 revert --abort' }))).toBeUndefined()
  })

test('A115: a takeover says what it took and what it left: a gone holder\'s sync with a live session\'s revert; its own revert under a live holder\'s sync', opts(), async ($, on) => {
  const w = world(on)
  repo(w)
  w.put(SYNC, JSON.stringify(newSync(T(16, 0), B, 'sync-lane (session bbbbbbbb)', NOW - 60 * MIN)))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', NOW - 30 * MIN), NOW - 30 * MIN) // gone
  w.put('E:/s2/.git/REVERT_HEAD', 'abc1234\n', T(14, 30))
  w.put(OWNER, JSON.stringify(headOwner({ head: 'REVERT_HEAD', mtimeMs: T(14, 30) }, C, T(14, 30), 'started')))
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc'))
  await $.session.start(START)
  const took = out(await $.tool.call({ tool: 'mcp__a5r__sync', action: 'takeover' } as never))
  expect(took).toContain('taken over: ')
  expect(took).toContain('; and the revert left in the shared checkout (.git/REVERT_HEAD) stays with lane-cccccccc (session cccccccc), which is live')
  w.put(SYNC, JSON.stringify(newSync(T(16, 0), C, 'lane-cccccccc (session cccccccc)', NOW - 60 * MIN))) // a live session's sync
  w.put(OWNER, JSON.stringify(headOwner({ head: 'REVERT_HEAD', mtimeMs: T(14, 30) }, { session: ME, id8: ME8, lane: 'me' }, T(14, 30), 'started')))
  expect(out(await $.tool.call({ tool: 'mcp__a5r__sync', action: 'takeover' } as never))).toBe('this session already ends the revert left in the shared checkout (.git/REVERT_HEAD): run git -C E:/s2 revert --abort (or finish it: resolve, git add -- <paths>, git revert --continue)')
})

test('A115: the notice text names each operation and its end; the merge text is unchanged', () => {
  const s = JSON.parse(ended()) as ReturnType<typeof newSync>
  expect(NOTICES.mergeLeft({ head: 'CHERRY_PICK_HEAD', mtimeMs: T(14, 20) }, { lane: 'gone-lane' }, null, 'none', { lane: 'walker', isMe: true }, 'E:/s2')).toBe('A5R · Merge guard — a cherry-pick is in progress in the shared S2 checkout (.git/CHERRY_PICK_HEAD since 14:20) and no sync is open → its holder is gone, so this session takes it over: /a5r sync takeover (or the sync tool, action takeover), then git -C E:/s2 cherry-pick --abort (or finish it: resolve, git add -- <paths>, git cherry-pick --continue); then plan a new sync')
  expect(NOTICES.mergeLeft({ head: 'REVERT_HEAD', mtimeMs: T(14, 20) }, { lane: 'lane-cccccccc' }, s, 'done', null, 'E:/s2')).toBe('A5R · Merge guard — a revert is in progress in the shared S2 checkout (.git/REVERT_HEAD since 14:20) and no sync is open (the last sync, 14:00 by sync-lane, is done) → lane-cccccccc ends it (git revert --abort, or finish it); every other session makes no git write there until .git/REVERT_HEAD is gone')
  expect(NOTICES.mergeLeft({ head: 'MERGE_HEAD', mtimeMs: T(14, 20) }, s.holder, s, 'done', null, 'E:/s2')).toBe('A5R · Merge guard — a merge is in progress in the shared S2 checkout (.git/MERGE_HEAD since 14:20) and no sync is open (the last sync, 14:00 by sync-lane, is done) → sync-lane ends it (git merge --abort, or finish it); every other session makes no git write there until .git/MERGE_HEAD is gone')
})

// ---------- self-check: what must not trigger ----------
test('A115: a revert without conflicts leaves no head file: nothing is recorded and nothing is guarded', opts(), async ($, on) => {
  const w = world(on)
  repo(w)
  gitLeaves(w, 'git -C E:/s2 revert 1a2b3c4 --no-edit', '', NOW)
  await $.session.start(START)
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git -C E:/s2 revert 1a2b3c4 --no-edit' }))).toBeUndefined()
  expect(w.read(OWNER)).toBe('')
  expect(refused(await $.tool.call({ tool: 'Bash', command: COMMIT }))).toBeUndefined()
})

test('A115: a head file that appears while this session\'s own commit runs (another session\'s cherry-pick) does not make it the owner', opts(), async ($, on) => {
  const w = world(on)
  repo(w)
  gitLeaves(w, COMMIT, 'CHERRY_PICK_HEAD', T(14, 41))
  await $.session.start(START)
  expect(refused(await $.tool.call({ tool: 'Bash', command: COMMIT }))).toBeUndefined()
  expect(w.read(OWNER)).toBe('') // only a merge, pull, revert or cherry-pick leaves a head file of its own
})

test('A115: a revert or cherry-pick in a worktree or repository of a session\'s own guards nothing in it or in the shared checkout', opts(), async ($, on) => {
  const w = world(on)
  repo(w)
  w.put('E:/wt/x/.git', 'gitdir: E:/s2/.git/worktrees/x')
  w.put('E:/s2/.git/worktrees/x/REVERT_HEAD', 'abc1234\n') // a linked worktree keeps its own head files under worktrees/<name>
  w.put('E:/wt/y/.git/HEAD', 'ref: refs/heads/mine')
  w.put('E:/wt/y/.git/CHERRY_PICK_HEAD', 'abc1234\n')
  w.put(SYNC, ended())
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb'))
  await $.session.start(START)
  for (const c of ['git -C E:/wt/x commit -m "own worktree"', 'git -C E:/wt/y cherry-pick --continue', COMMIT]) expect([c, refused(await $.tool.call({ tool: 'Bash', command: c }))]).toEqual([c, undefined])
  expect(w.read(OWNER)).toBe('')
})

test('A115: a record left for an older head file names nobody: the last sync\'s holder owns the new one, as for a merge', opts(), async ($, on) => {
  const w = world(on)
  repo(w)
  w.put(SYNC, ended())
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb'))
  w.put('E:/s2/.git/REVERT_HEAD', 'abc1234\n', T(14, 30))
  w.put(OWNER, JSON.stringify(headOwner({ head: 'REVERT_HEAD', mtimeMs: T(13, 0) }, { session: ME, id8: ME8, lane: 'me' }, T(13, 0), 'started')))
  await $.session.start(START)
  expect(refused(await $.tool.call({ tool: 'Bash', command: COMMIT }))).toContain('a revert is in progress in the shared checkout (.git/REVERT_HEAD; sync-lane holds the sync at 14:00 (done))')
})
