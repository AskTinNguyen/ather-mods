import { expect, test } from 'claude-code/testing'
import { blankSession, newSync, parseSyncFile, type SessionFile, type SyncFile } from '../hooks/coord.ts'
import { LOCK, ME, NOW, PENDING, PROJ, opts, refused, world, type Rec } from './world.ts'

// Rev 4 through the engine: the freeze as a lease (A13), the merge guard (A14), the sync's own commands (A15),
// the sync worker (A12) and the session overview (A16). Other sessions are only their files.
const HF = 'E:/s2/Saved/HaiFlow'
const SYNC = `${HF}/sync.json`
const ME8 = ME.slice(0, 8)
const START = { cwd: PROJ, surface: 'terminal', isInteractive: true } as never
const T = (h: number, m: number) => new Date(2026, 9, 6, h, m).getTime()
const MIN = 60_000
const B = { session: 'bbbbbbbb-1111-4000-8000-000000000000', id8: 'bbbbbbbb', lane: 'sync-lane' }
const PLANNED_BY_B = 'sync-lane (session bbbbbbbb)'

const out = (ran: { result?: unknown; text?: string; deny?: string }): string => String(ran.deny ?? ran.result ?? ran.text ?? '')
const peer = (id8: string, o: Partial<SessionFile> = {}): string => JSON.stringify({ ...blankSession(`${id8}-1111-4000-8000-000000000000`, id8 === 'bbbbbbbb' ? 'sync-lane' : `lane-${id8}`, '', NOW), ...o })
const prompts = (w: ReturnType<typeof world>): string[] => (w.calls['prompt.submit'] ?? []).map(e => String((e as { text?: string }).text))
const syncOf = (w: ReturnType<typeof world>): SyncFile | null => parseSyncFile(w.read(SYNC) || null)
const a5 = async ($: any, args: string): Promise<string> => String((await $.command.run({ command: 'a5', args } as never)).text)
const idle = async ($: any) => $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
/** Another session's hai-flow keeps its file fresh every minute while `alive`; the test does it for it. */
const advance = async (w: ReturnType<typeof world>, minutes: number, id8: string | null = 'bbbbbbbb') => {
  for (let n = 0; n < minutes; n += 1) {
    const at = w.clock.now() + MIN
    if (id8) w.put(`${HF}/editor/${id8}.json`, peer(id8, { heartbeatAt: at }), at)
    await w.clock.advance(MIN)
  }
}
const repo = (w: ReturnType<typeof world>, root: string, linked = false) => (linked ? w.put(`${root}/.git`, 'gitdir: E:/s2/.git/worktrees/x') : w.put(`${root}/.git/HEAD`, 'ref: refs/heads/HaiHuynh/20261005'))
const titled = (w: ReturnType<typeof world>) => w.seen.filter(e => e.tool === 'mcp__ccd_session_mgmt__set_session_title').map(e => String(e.title))
const COMMIT = 'git -C E:/s2 commit -m "wip: tail"'

// ---------- A14: the merge guard ----------
test('A14: while .git/MERGE_HEAD exists, a non-holder\'s git writes in the shared checkout are refused, whatever sync.json says', opts(), async ($, on) => {
  const w = world(on)
  repo(w, 'E:/s2')
  repo(w, 'E:/wt/x', true)
  w.put('E:/s2/.git/MERGE_HEAD', '1a2b3c\n')
  w.put(SYNC, JSON.stringify({ ...newSync(T(14, 0), B, PLANNED_BY_B, NOW - 60 * MIN), state: 'expired', endedAt: T(14, 30), note: 'its hard end 14:45 passed' }))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb'))
  await $.session.start(START)
  expect(refused(await $.tool.call({ tool: 'Bash', command: COMMIT }))).toBe('hai-flow · Merge guard — a merge is in progress in the shared checkout (.git/MERGE_HEAD; sync-lane holds the sync at 14:00 (expired)): no git commit there until it is finished or aborted → leave the merge state alone (no commit, reset, abort or stash of yours); its holder or Hai ends it; work without git or in your own worktree')
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git -C E:/s2 merge --abort' }))).toContain('Merge guard')
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git -C E:/s2 status && git -C E:/s2 diff --stat' }))).toBeUndefined()
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git -C E:/wt/x commit -m "own worktree"' }))).toBeUndefined()
  w.files.delete('e:/s2/.git/merge_head') // the merge is finished: the guard lifts with it
  expect(refused(await $.tool.call({ tool: 'Bash', command: COMMIT }))).toBeUndefined()
})

test('A14: a merge left behind with no sync open is one 🟥 for Hai; the holder of the last sync may still end it', opts(), async ($, on) => {
  const w = world(on)
  repo(w, 'E:/s2')
  w.put(PENDING, '')
  w.put('E:/s2/.git/MERGE_HEAD', '1a2b3c\n', T(14, 20))
  await $.session.start(START)
  expect(w.read(PENDING)).toContain('A merge is in progress in the shared S2 checkout (.git/MERGE_HEAD since 14:20) and no sync is open')
  expect(titled(w).some(t => t.startsWith('🟥'))).toBe(true)
  expect(refused(await $.tool.call({ tool: 'Bash', command: COMMIT }))).toContain('no sync is open (a merge left behind)')
  await advance(w, 3, null)
  expect(w.read(PENDING).split('\n').filter(l => l.includes('MERGE_HEAD')).length).toBe(1)
  // This session held the last sync: its own git there passes the guard (to finish or abort that merge).
  w.put(SYNC, JSON.stringify({ ...newSync(T(14, 0), { session: ME, id8: ME8, lane: '3️⃣-Loco-fix' }, 'me', NOW - 60 * MIN), state: 'aborted', endedAt: T(14, 30) }))
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git -C E:/s2 merge --abort' }))).toBeUndefined()
})

// ---------- A15: the sync's own commands pass A5 ----------
const MINE = { session: ME, id8: ME8, lane: '3️⃣-Loco-fix' }
const OURS = 'git -C E:/s2 checkout --ours -- Source/S2/Foo.cpp'

test('A15: in its frozen phase the holder\'s worker runs the sync\'s own git commands; reset --hard still stops it', opts(), async ($, on) => {
  const w = world(on)
  repo(w, 'E:/s2')
  w.put('E:/s2/.git/MERGE_HEAD', '1a2b3c\n')
  w.put(SYNC, JSON.stringify(newSync(T(14, 30), MINE, 'me', NOW - 30 * MIN)))
  await $.session.start(START)
  const asWorker = (command: string) => $.tool.call({ tool: 'Bash', command, agentId: 'w-sync' } as never)
  for (const c of [OURS, 'git -C E:/s2 add -- Source/S2/Foo.cpp', 'git -C E:/s2 commit --no-edit', 'git -C E:/s2 merge --abort', 'git -C E:/s2 revert -m 1 1a2b3c4d --no-edit'])
    expect([c, refused(await asWorker(c))]).toEqual([c, undefined])
  expect(refused(await asWorker('git -C E:/s2 reset --hard'))).toContain('a worker does not ask Hai')
  expect(refused(await asWorker('git -C E:/s2 stash'))).toContain('a worker does not ask Hai')
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git -C E:/s2 reset --hard' }))).toContain("needs Hai's approval") // the holder's own loop too
})

test('A15: before T (and for any session not holding the sync) the same commands keep A5\'s rules and the freeze', opts(), async ($, on) => {
  const w = world(on)
  repo(w, 'E:/s2')
  w.put(SYNC, JSON.stringify(newSync(T(15, 0), MINE, 'me', NOW))) // 14:40: the cutoff, not the freeze
  await $.session.start(START)
  expect(refused(await $.tool.call({ tool: 'Bash', command: OURS, agentId: 'w-sync' } as never))).toContain('a worker does not ask Hai')
  w.put(SYNC, JSON.stringify(newSync(T(14, 30), B, PLANNED_BY_B, NOW - 30 * MIN))) // frozen, held by another session
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb'))
  expect(refused(await $.tool.call({ tool: 'Bash', command: OURS, agentId: 'w-sync' } as never))).toContain('Sync main freeze')
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git -C E:/s2 commit --no-edit' }))).toContain('Sync main freeze')
})

// ---------- A13: the freeze is a lease ----------
test('A13: at its hard end the freeze expires for every session: marked expired, a notice, one 🟥 for Hai', opts(), async ($, on) => {
  const w = world(on)
  on('turn.complete', async () => ({ text: '' }))
  repo(w, 'E:/s2')
  w.put(PENDING, '')
  w.put(SYNC, JSON.stringify(newSync(T(14, 45), B, PLANNED_BY_B, NOW)))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb'))
  await $.session.start(START) // 14:40: the cutoff notice
  await idle($)
  await advance(w, 20) // 15:00: frozen
  expect(refused(await $.tool.call({ tool: 'Bash', command: COMMIT }))).toContain('Sync main freeze')
  await idle($)
  await advance(w, 30) // 15:30: the hard end (T + 45)
  expect([syncOf(w)?.state, syncOf(w)?.note]).toEqual(['expired', 'its hard end 15:30 passed'])
  expect(prompts(w).some(p => p.includes('hai-flow · Sync main — the sync at 14:45 expired at 15:30 without done or abort (its hard end 15:30 passed) → git and the Editor are open again'))).toBe(true)
  expect(w.read(PENDING)).toContain('Sync main 14:45 (holder sync-lane) expired without done or abort: its hard end 15:30 passed')
  expect(titled(w).some(t => t.startsWith('🟥'))).toBe(true)
  expect(w.seen.some(e => e.tool === 'mcp__ccd_sidebar__set_unread' && e.unread === true)).toBe(true)
  expect(refused(await $.tool.call({ tool: 'Bash', command: COMMIT }))).toBeUndefined()
  // One 🟥 for all sessions: the alert file names who raised it; a second look raises nothing new.
  expect(JSON.parse(w.read(`${HF}/alerts/sync-expired-${syncOf(w)?.id}-${T(14, 45)}.json`)).by).toBe(ME8)
  await advance(w, 3)
  expect(w.read(PENDING).split('\n').filter(l => l.includes('expired without done')).length).toBe(1)
})

test('A13: the freeze ends at once when the holder session is gone (expired, 🟥), never waiting for its hard end', opts(), async ($, on) => {
  const w = world(on)
  on('turn.complete', async () => ({ text: '' }))
  repo(w, 'E:/s2')
  w.put(PENDING, '')
  w.put(SYNC, JSON.stringify(newSync(T(14, 41), B, PLANNED_BY_B, NOW)))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb'))
  await $.session.start(START)
  await idle($)
  await advance(w, 2) // 14:42: frozen, the holder alive
  expect(refused(await $.tool.call({ tool: 'Bash', command: COMMIT }))).toContain('Sync main freeze')
  await idle($)
  await advance(w, 4, null) // the holder's file stops: gone after 3 min
  expect([syncOf(w)?.state, syncOf(w)?.note]).toEqual(['expired', 'its holder sync-lane (session bbbbbbbb) is gone'])
  expect(w.read(PENDING)).toContain('expired without done or abort: its holder sync-lane (session bbbbbbbb) is gone')
  expect(refused(await $.tool.call({ tool: 'Bash', command: COMMIT }))).toBeUndefined()
})

test('A13: every sync has a hard end (45 min, 90 with a build, from the options); the holder is told 10 min before it', { options: { a5WhenPresent: 'deny', editorLock: LOCK, pendingFile: PENDING, syncMergeMinutes: 30 } }, async ($, on) => {
  const w = world(on)
  on('turn.complete', async () => ({ text: '' }))
  repo(w, 'E:/s2')
  await $.session.start(START)
  expect(await a5($, 'sync 16:00 build')).toContain('with a build: cutoff 15:30')
  expect(syncOf(w)?.hardEnd).toBe(T(17, 30))
  expect(await a5($, 'sync build off')).toContain('at the latest until 16:30')
  expect(await a5($, 'sync move 14:45')).toContain('at the latest until 15:15')
  await idle($)
  for (let n = 0; n < 25; n += 1) {
    await w.clock.advance(MIN)
    await idle($)
  }
  // 15:05: ten minutes before the hard end 15:15, the holder is told once.
  expect(prompts(w).filter(p => p.includes('hai-flow · Sync main — the freeze of the sync at 14:45 ends at 15:15 (its hard end) and the sync is not done → finish it with done or abort before then')).length).toBe(1)
})
