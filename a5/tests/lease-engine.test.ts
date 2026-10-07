import { expect, test } from 'claude-code/testing'
import { blankSession, newSync, parseSyncFile, type SessionFile, type SyncFile } from '../hooks/coord.ts'
import { LOCK, ME, NOW, A5PANE, PENDING, PROJ, atherTree, find, opts, refused, text, world, type Rec } from './world.ts'

// Rev 4 through the engine: the freeze as a lease (A13), the merge guard (A14), the sync's own commands (A15),
// the sync worker (A12) and the session overview (A16). Other sessions are only their files.
const HF = 'E:/s2/Saved/A5'
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
/** Another session's a5 keeps its file fresh every minute while `alive`; the test does it for it. */
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
  expect(refused(await $.tool.call({ tool: 'Bash', command: COMMIT }))).toBe('A5 · Merge guard — a merge is in progress in the shared checkout (.git/MERGE_HEAD; sync-lane holds the sync at 14:00 (expired)): no git commit there until it is finished or aborted → leave the merge state alone (no commit, reset, abort or stash of yours); its holder or Hai ends it; work without git or in your own worktree')
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

// ---------- A12: the sync worker ----------
const spawns = (w: ReturnType<typeof world>) => (w.calls['agent.spawn'] ?? []) as Rec[]
const planMine = async ($: any, _w: ReturnType<typeof world>) => {
  expect(await a5($, 'sync 14:45')).toContain('planned')
  await idle($)
}

test('A12: at T the holder\'s a5 spawns the sync worker once, with the non-interactive procedure; the model is never offered it', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  on('turn.complete', async () => ({ text: '' }))
  repo(w, 'E:/s2')
  w.put(LOCK, 'free since 14:20\n')
  await $.session.start(START)
  const spec = (w.calls['agent.register'] ?? [])[0] as Rec
  expect([spec?.name, spec?.background]).toEqual(['sync', true])
  for (const must of ['GIT_TERMINAL_PROMPT=0', 'GCM_INTERACTIVE=never', 'never close, kill or drive that Editor', 'list its dirty packages first', 'never rebase', 'git checkout --ours -- <path>', 'git merge --abort', 'git revert -m 1 <merge sha> --no-edit', 'mcp__a5__sync'])
    expect([must, String(spec?.prompt).includes(must)]).toEqual([must, true])
  expect(await $.agent.offer({ agent: 'a5:sync', description: 'x', source: 'plugin', provider: { plugin: 'a5', tier: 'user' } } as never)).toEqual({ isOffered: false })
  await planMine($, w)
  await w.clock.advance(4 * MIN)
  expect(spawns(w)).toEqual([])
  await idle($)
  await w.clock.advance(MIN) // 14:45
  expect(spawns(w).length).toBe(1)
  expect(spawns(w)[0]?.subagent_type ?? spawns(w)[0]?.subagentType).toBe('a5:sync')
  expect(String(spawns(w)[0]?.prompt)).toContain('Run the sync of origin/main planned for 14:45 in E:/s2 (holder 3️⃣-Loco-fix, session ab12cd34). Hard end 15:30')
  expect([syncOf(w)?.workerId, syncOf(w)?.workerAt]).toEqual(['w-sync', T(14, 45)])
  await w.clock.advance(3 * MIN)
  expect(spawns(w).length).toBe(1)
})

test('A12: a worker that ends without done or abort aborts the sync for it; the holder is told; the freeze lifts', opts(), async ($, on) => {
  const w = world(on)
  on('turn.complete', async () => ({ text: '' }))
  repo(w, 'E:/s2')
  await $.session.start(START)
  await planMine($, w)
  await w.clock.advance(5 * MIN) // 14:45: the worker runs
  await idle($)
  await $.turn.complete({ agentId: 'w-sync', answer: 'Stopped: git reset --hard was refused.', durationMs: 1, isAborted: false, turnId: 'tw', reason: 'answer' } as never)
  expect(syncOf(w)?.state).toBe('aborted')
  expect(syncOf(w)?.note).toBe('the sync worker ended without done or abort: Stopped: git reset --hard was refused.')
  expect(prompts(w).some(p => p.includes('A5 · Sync main — the sync worker ended without done or abort, so the sync at 14:45 was aborted for it'))).toBe(true)
})

test('A12: the worker ends the sync with done: the sync is done and its end is no abort', opts(), async ($, on) => {
  const w = world(on)
  on('turn.complete', async () => ({ text: '' }))
  repo(w, 'E:/s2')
  await $.session.start(START)
  await planMine($, w)
  await w.clock.advance(5 * MIN)
  expect(out(await $.tool.call({ tool: 'mcp__a5__sync', action: 'done', note: 'merged 1a2b3c (pre-merge 9f8e7d)', agentId: 'w-sync' } as never))).toContain('done: git and the Editor are open again')
  await $.turn.complete({ agentId: 'w-sync', answer: 'Merged 1a2b3c.', durationMs: 1, isAborted: false, turnId: 'tw', reason: 'answer' } as never)
  expect([syncOf(w)?.state, syncOf(w)?.note]).toEqual(['done', 'merged 1a2b3c (pre-merge 9f8e7d)'])
  expect(prompts(w).some(p => p.includes('worker ended without done'))).toBe(false)
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

// ---------- A16: the session overview ----------
const LANES = 'E:/s2/Saved/AtherAutomata/lanes'
const SID_B = 'bbbbbbbb-1111-4000-8000-000000000000'
const SID_D = 'dddddddd-2222-4000-8000-000000000000'
const laneFile = (sessionId: string, intent: string) => JSON.stringify({ sessionId, intent, branch: 'HaiHuynh/20261005', updatedAt: NOW, hasEnded: false })
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const CLIENTS = JSON.stringify([
  { sessionId: 'local_1', title: 'Loco', cwd: 'E:\\s2', isArchived: false, isRunning: true, lastActivityAt: ago(MIN) },
  { sessionId: 'local_2', title: 'Mods', cwd: 'D:\\Projects\\ather-mods', isArchived: false, isRunning: false, lastActivityAt: ago(5 * MIN) },
  { sessionId: 'local_3', title: 'Old', cwd: 'E:\\s2', isArchived: false, isRunning: false, lastActivityAt: ago(3 * 3_600_000) },
])
/** Two S2 sessions besides this one: B runs a5 0.4 (a fresh session file) and holds the Editor; D runs only Ather. */
const machine = (w: ReturnType<typeof world>) => {
  w.put(`${LANES}/${SID_B}.json`, laneFile(SID_B, 'tail-vfx'))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb'))
  w.put(`${LANES}/${SID_D}.json`, laneFile(SID_D, 'loco'))
  w.put(LOCK, 'HELD lane=sync-lane session=sync-lane since=14:30 2026-10-06 pid=none end=15:10 mode=interactive pausable=yes next_safe=after save note=capture · held by sync-lane, session bbbbbbbb, until 15:10\n')
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`A16 (${surface}): the panel counts the sessions, by intent, names who holds what and who runs without a5 0.4`, opts(), async ($, on) => {
    const w = world(on, { out: { mcp__ccd_session_mgmt__list_sessions: CLIENTS } })
    on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
    machine(w)
    await $.session.start({ cwd: PROJ, surface, isInteractive: true } as never)
    const tree = await $.ui.render({ ...A5PANE, surface } as never)
    // Since 0.8 (A26) the overview is a named list (one row per session) instead of one line; the same facts.
    expect(text(find(tree, 'hai-overview-head'))).toBe('Sessions · 3 in S2 · 1 elsewhere')
    expect(text(find(tree, `hai-session-${ME.slice(0, 8)}`))).toBe('●3️⃣ Loco fix (this session)no intent · active now')
    expect(text(find(tree, 'hai-session-bbbbbbbb'))).toBe('●bbbbbbbbtail-vfx · Editor until 15:10 · seen now')
    expect(text(find(tree, 'hai-session-dddddddd'))).toBe('●ddddddddloco · seen nowno a5')
  })
}

test('A16: without the client\'s session list the overview falls back to Ather\'s lanes and a5\'s files', opts(), async ($, on) => {
  const w = world(on, { out: { mcp__ccd_session_mgmt__list_sessions: 'Error: No such tool available: mcp__ccd_session_mgmt__list_sessions' } })
  on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
  machine(w)
  await $.session.start(START)
  const tree = await $.ui.render(A5PANE as never)
  expect(text(find(tree, 'hai-overview-head'))).toBe('Sessions · 3 in S2')
  expect(['bbbbbbbb', 'dddddddd'].map(id8 => Boolean(find(tree, `hai-session-${id8}`)))).toEqual([true, true])
})

test('A16: at the cutoff the holder sends each live S2 session without a5 0.4 one standard message, and its notice names them', opts(), async ($, on) => {
  const w = world(on)
  repo(w, 'E:/s2')
  machine(w)
  await $.session.start(START)
  expect(await a5($, 'sync 15:00')).toContain('The cutoff is already past')
  await advance(w, 1)
  expect(w.sent.length).toBe(1)
  expect(JSON.stringify(w.sent[0])).toContain(SID_D)
  expect(String(w.sent[0]?.text)).toBe('Sync main (a5): 3️⃣-Loco-fix merges origin/main into E:/s2 at 15:00. This session runs without a5 0.4, so nothing freezes it: before 15:00 commit your own paths (exact paths), write your resume note, stop PIE and release the Editor by 14:50; from 15:00 until the holder is done (at the latest 15:45) make no git writes in that checkout and do not use the Editor.')
  expect(syncOf(w)?.messaged).toEqual([SID_D])
  expect(prompts(w)[0]).toContain('A5 · Sync main — 1 live S2 session without a5 0.4 cannot be frozen for the sync at 15:00: loco (session dddddddd, HaiHuynh/20261005)')
  await advance(w, 2)
  expect(w.sent.length).toBe(1) // once per sync
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
  expect(prompts(w).some(p => p.includes('A5 · Sync main — the sync at 14:45 expired at 15:30 without done or abort (its hard end 15:30 passed) → git and the Editor are open again'))).toBe(true)
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
  expect(prompts(w).filter(p => p.includes('A5 · Sync main — the freeze of the sync at 14:45 ends at 15:15 (its hard end) and the sync is not done → finish it with done or abort before then')).length).toBe(1)
})
