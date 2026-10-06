import { expect, test } from 'claude-code/testing'
import { blankSession, endedSync, newSync, parseSyncFile, type SessionFile, type SyncFile } from '../hooks/coord.ts'
import { LOCK, ME, NOW, PROJ, opts, refused, world } from './world.ts'

// The Sync main holder through the engine: the plan lives in Saved/HaiFlow/sync.json (its holder writes it);
// other sessions are only their files; each session's own hai-flow tells it what concerns it.
const HF = 'E:/s2/Saved/HaiFlow'
const SYNC = `${HF}/sync.json`
const ME8 = ME.slice(0, 8)
const START = { cwd: PROJ, surface: 'terminal', isInteractive: true } as never
const T = (h: number, m: number) => new Date(2026, 9, 6, h, m).getTime()
const MIN = 60_000
const B = { session: 'bbbbbbbb-1111-4000-8000-000000000000', id8: 'bbbbbbbb', lane: 'sync-lane' }

const out = (ran: { result?: unknown; text?: string; deny?: string }): string => String(ran.deny ?? ran.result ?? ran.text ?? '')
const peer = (id8: string, o: Partial<SessionFile> = {}): string => JSON.stringify({ ...blankSession(`${id8}-1111-4000-8000-000000000000`, id8 === 'bbbbbbbb' ? 'sync-lane' : `lane-${id8}`, '', NOW), ...o })
const prompts = (w: ReturnType<typeof world>): string[] => (w.calls['prompt.submit'] ?? []).map(e => String((e as { text?: string }).text))
const syncOf = (w: ReturnType<typeof world>): SyncFile | null => parseSyncFile(w.read(SYNC) || null)
const a5 = async ($: any, args: string): Promise<string> => String((await $.command.run({ command: 'a5', args } as never)).text)
/** The model's turn ends: the session is idle, so a notice that needs action becomes one prompt. */
const idle = async ($: any) => $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
/** Another session's hai-flow keeps its file fresh every minute; the test does it for it while the clock runs. */
const advance = async (w: ReturnType<typeof world>, minutes: number, id8 = 'bbbbbbbb') => {
  for (let n = 0; n < minutes; n += 1) {
    const at = w.clock.now() + MIN
    w.put(`${HF}/editor/${id8}.json`, peer(id8, { heartbeatAt: at }), at)
    await w.clock.advance(MIN)
  }
}
/** A git repository folder in the in-memory file system: the shared S2 checkout, or a linked worktree. */
const repo = (w: ReturnType<typeof world>, root: string, linked = false) => (linked ? w.put(`${root}/.git`, 'gitdir: E:/s2/.git/worktrees/x') : w.put(`${root}/.git/HEAD`, 'ref: refs/heads/HaiHuynh/20261005'))

test('/a5 sync HH:MM: the planning session holds it; only the holder moves or cancels it', opts(), async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  expect(await a5($, 'sync 15:30')).toContain('planned: the sync at 15:30 (holder 3️⃣-Loco-fix, session ab12cd34): cutoff 15:00')
  expect(syncOf(w)?.holder.id8).toBe(ME8)
  expect(await a5($, 'sync move 16:00')).toContain('moved: the sync at 16:00')
  expect(syncOf(w)?.at).toBe(T(16, 0))
  expect(await a5($, 'sync cancel')).toContain('cancelled the sync at 16:00')
  expect(syncOf(w)?.state).toBe('cancelled')
  // Another live session's sync is not this session's to change.
  w.put(SYNC, JSON.stringify(newSync(T(16, 30), B, 'sync-lane (session bbbbbbbb)', NOW)))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb'))
  expect(await a5($, 'sync move 17:00')).toContain('only its holder changes it')
  expect(await a5($, 'sync 17:00')).toContain('only its holder changes it')
  expect(syncOf(w)?.at).toBe(T(16, 30))
})

test('/a5 sync HH:MM for <session>: the named session holds it and its hai-flow tells it so', opts(), async ($, on) => {
  const w = world(on)
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb'))
  await $.session.start(START)
  expect(await a5($, 'sync 16:00 for bbbbbbbb')).toContain('holder sync-lane, session bbbbbbbb')
  expect([syncOf(w)?.holder.id8, syncOf(w)?.plannedBy]).toEqual(['bbbbbbbb', `3️⃣-Loco-fix (session ${ME8})`])
  expect(await a5($, 'sync 16:00 for nobody')).toContain('only its holder changes it')
})

test('named holder: its own hai-flow tells it once that it holds the sync', opts(), async ($, on) => {
  const w = world(on)
  w.put(SYNC, JSON.stringify(newSync(T(16, 0), { session: ME, id8: ME8, lane: '3️⃣-Loco-fix' }, 'sync-lane (session bbbbbbbb)', NOW)))
  await $.session.start(START)
  expect(prompts(w)).toEqual(['hai-flow · Sync main — you were named holder of the sync at 16:00 (planned by sync-lane (session bbbbbbbb)) → at 15:30 the cutoff notice reaches every session; at 16:00 run s2-sync-main, then call the sync tool with done or abort'])
  await w.clock.advance(MIN)
  expect(prompts(w).length).toBe(1)
})

test('cutoff: every A5 session gets the checkpoint notice at T − 30, once, as one prompt while idle', opts(), async ($, on) => {
  const w = world(on)
  w.put(SYNC, JSON.stringify(newSync(T(15, 30), B, 'sync-lane (session bbbbbbbb)', NOW)))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb'))
  await $.session.start(START)
  expect(prompts(w)).toEqual([])
  await advance(w, 20) // 15:00
  expect(prompts(w)).toEqual([
    'hai-flow · Sync main — cutoff: sync-lane merges origin/main at 15:30 → commit your own paths now (exact paths, wip: is fine), write your resume note in Saved/LANE_NOTES/<session id>.md, stop PIE and leave the Editor alone by 15:20; keep Source/ and Plugins/ edits out of the shared tree from now; from 15:30 git writes and the Editor wait until the sync is done',
  ])
  await advance(w, 5)
  expect(prompts(w).length).toBe(1)
})

test('grants that would cross the sync are deferred; a slot that ends by the cutoff is granted', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, 'free since 14:20\n')
  w.put(SYNC, JSON.stringify(newSync(T(15, 30), B, 'sync-lane (session bbbbbbbb)', NOW)))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb'))
  await $.session.start(START)
  const late = out(await $.tool.call({ tool: 'mcp__hai-flow__editor', action: 'request', minutes: 40, what: 'PIE proof' } as never))
  expect(late).toContain('a 40-min slot would end at 15:20, past the cutoff 15:00 of the sync at 15:30 → ask again for ≤ 20 min')
  expect(w.read(LOCK)).toBe('free since 14:20\n')
  const fits = out(await $.tool.call({ tool: 'mcp__hai-flow__editor', action: 'request', minutes: 20, what: 'PIE proof' } as never))
  expect(fits).toContain('granted to this session until 15:00')
})

test('the holder dry-runs the merge at the cutoff; each conflict reaches the session that edited it, by rule 11', opts(), async ($, on) => {
  const raw = '0b05dc029956b389352543c2aa1437b25dbbe74f\n\n:100644 100644 422c2b7ab3b3c668038da977e4e93a5fc623169c 21e8403505a4e80c11ebae677985027b1ebaa40d M\tSource/S2/Foo.cpp\n091845264d603cced8bd4f79efe7f7ae6a4fb02f\n\n:000000 100644 0000000000000000000000000000000000000000 422c2b7ab3b3c668038da977e4e93a5fc623169c A\tSource/S2/Foo.cpp\n'
  const w = world(on, {
    git: {
      'merge-tree': { stdout: '7e4887eb85fc0a6b1638a284733984d7d06b39f5\nSource/S2/Foo.cpp\nContent/S2/Maps/L_TALab.umap\n\nAuto-merging Source/S2/Foo.cpp\n', exitCode: 1 },
      'rev-parse origin/main:Source/S2/Foo.cpp': { stdout: '422c2b7ab3b3c668038da977e4e93a5fc623169c\n' },
      'rev-parse origin/main:Content/S2/Maps/L_TALab.umap': { stdout: 'bec2106f4dc90d15b27c7b88b4ca1f4f54d52aff\n' },
      '-- Source/S2/Foo.cpp': { stdout: raw },
      '-- Content/S2/Maps/L_TALab.umap': { stdout: '' },
    },
  })
  on('turn.complete', async () => ({ text: '' }))
  repo(w, 'E:/s2')
  w.put('E:/s2/Source/S2/Foo.cpp', 'int x = 1;\n')
  w.put(`${HF}/touch/cccccccc.json`, JSON.stringify({ session: 'cccccccc-1', id8: 'cccccccc', lane: 'level-lane', paths: ['Content/S2/Maps/L_TALab.umap'], updatedAt: NOW }))
  await $.session.start(START)
  await $.tool.call({ tool: 'Edit', file_path: 'E:/s2/Source/S2/Foo.cpp', old_string: 'int x = 1;', new_string: 'int x = 2;' })
  expect(JSON.parse(w.read(`${HF}/touch/${ME8}.json`)).paths).toEqual(['Source/S2/Foo.cpp'])
  expect(await a5($, 'sync 15:30')).toContain('planned')
  await idle($)
  await advance(w, 20, 'cccccccc') // 15:00, the cutoff
  expect(syncOf(w)?.conflicts).toEqual([{ path: 'Source/S2/Foo.cpp', kind: 'self', match: '091845264d60' }, { path: 'Content/S2/Maps/L_TALab.umap', kind: 'foreign' }])
  expect(prompts(w).length).toBe(1)
  const told = prompts(w)[0] ?? ''
  expect(told).toContain('hai-flow · Sync main — cutoff: you hold the sync at 15:30')
  expect(told).toContain('hai-flow · Sync main — self-conflict in Source/S2/Foo.cpp (main holds our 091845264d60) for the sync at 15:30; this session edited that path → a self-conflict needs nothing from you: the holder resolves it to ours (rule 11)')
  expect(told).toContain('dry-run for 15:30: 2 conflicts (1 self, 1 foreign): Content/S2/Maps/L_TALab.umap (binary) → level-lane')
  expect(told).toContain('a logic or .uasset/.umap conflict → git merge --abort and the path goes to its owner')
})

test('a foreign conflict reaches its owner with the failure table\'s words; the owner commits, never discards', opts(), async ($, on) => {
  const w = world(on)
  on('turn.complete', async () => ({ text: '' }))
  repo(w, 'E:/s2')
  w.put('E:/s2/Content/S2/Maps/L_TALab.umap', 'pointer')
  w.put(SYNC, JSON.stringify({ ...newSync(T(16, 30), B, 'sync-lane (session bbbbbbbb)', NOW), conflicts: [{ path: 'Content/S2/Maps/L_TALab.umap', kind: 'foreign' }], conflictsAt: NOW, conflictsSource: 'merge-tree' }))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb'))
  await $.session.start(START)
  await $.tool.call({ tool: 'Write', file_path: 'E:/s2/Content/S2/Maps/L_TALab.umap', content: 'pointer 2' })
  await idle($)
  await advance(w, 1)
  expect(prompts(w)).toEqual([
    'hai-flow · Sync main — foreign change on main in Content/S2/Maps/L_TALab.umap for the sync at 16:30; this session edited that path → before 16:30: commit your own version (exact paths) and tell sync-lane how the two sides combine; a logic or .uasset/.umap conflict means the merge is aborted and you resolve it after the sync (the owner decides, never discard either side)',
  ])
})

test('freeze: from T until done, a non-holder makes no git write in the shared checkout and does not use the Editor', opts(), async ($, on) => {
  const w = world(on)
  on('turn.complete', async () => ({ text: '' }))
  repo(w, 'E:/s2')
  repo(w, 'E:/wt/x', true)
  w.put(LOCK, 'free since 14:20\n')
  w.put(SYNC, JSON.stringify(newSync(T(14, 50), B, 'sync-lane (session bbbbbbbb)', NOW)))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb'))
  await $.session.start(START)
  expect(prompts(w).map(p => p.slice(0, 40))).toEqual(['hai-flow · Sync main — cutoff: sync-lane']) // 14:40 is inside the cutoff
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git -C E:/s2 commit -m "wip: tail"' }))).toBeUndefined() // not yet frozen
  await advance(w, 10) // 14:50
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git -C E:/s2 commit -m "wip: tail"' }))).toContain('hai-flow · Sync main freeze — sync-lane merges origin/main since 14:50: no git commit in the shared checkout until the sync is done')
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git -C E:/s2 add Source/S2/Foo.cpp && git -C E:/s2 status' }))).toContain('no git add')
  expect(refused(await $.tool.call({ tool: 'PowerShell', command: 'git -C E:/s2 stash' }))).toContain('no git stash')
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git -C E:/s2 status && git -C E:/s2 log -3' }))).toBeUndefined()
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git -C E:/wt/x commit -m "own worktree"' }))).toBeUndefined()
  expect(refused(await $.tool.call({ tool: 'mcp__unreal-mcp__call_tool', name: 'get_actor' } as never))).toContain('the Editor waits until the sync is done')
  await $.turn.complete({ answer: 'waiting', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
  // The holder ends it: every session told of it hears the lift, once; git is open again.
  w.put(SYNC, JSON.stringify(endedSync(newSync(T(14, 50), B, 'sync-lane (session bbbbbbbb)', NOW), 'done', 'merged origin/main 1a2b3c', T(14, 58))))
  await advance(w, 10) // 15:00
  expect(prompts(w).length).toBe(2)
  // The lift supersedes the freeze notice that was still waiting for this session's next turn.
  expect(prompts(w)[1]).toBe('hai-flow · Sync main — done at 14:58 (merged origin/main 1a2b3c) → git and the Editor are open again: resume from your resume note and re-check the files main changed before trusting old measurements')
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git -C E:/s2 commit -m "wip: tail"' }))).toBeUndefined()
  await idle($)
  await advance(w, 2)
  expect(prompts(w).length).toBe(2)
})

test('the holder is not frozen: it is told to run the merge, then ends the sync with the sync tool', opts(), async ($, on) => {
  const w = world(on)
  on('turn.complete', async () => ({ text: '' }))
  repo(w, 'E:/s2')
  await $.session.start(START)
  expect(out(await $.tool.call({ tool: 'mcp__hai-flow__sync', action: 'plan', at: '14:45' } as never))).toContain('The cutoff is already past')
  expect(out(await $.tool.call({ tool: 'mcp__hai-flow__sync', action: 'done', note: 'too early' } as never))).toContain('has not started')
  await idle($)
  await w.clock.advance(4 * MIN) // 14:44: the cutoff notice was one prompt; that turn ends
  expect(prompts(w).map(p => p.startsWith('hai-flow · Sync main — cutoff: you hold the sync at 14:45 →'))).toEqual([true])
  await idle($)
  await w.clock.advance(MIN) // 14:45
  expect(prompts(w)[1]).toBe('hai-flow · Sync main — it is 14:45: every other session\'s git writes and Editor use are held for your sync → run s2-sync-main now (merge origin/main, self-conflicts to ours per rule 11, abort on a logic or .uasset/.umap conflict), then call the sync tool with done or abort')
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git -C E:/s2 merge origin/main' }))).toBeUndefined()
  expect(out(await $.tool.call({ tool: 'mcp__hai-flow__sync', action: 'done', note: 'merged 1a2b3c' } as never))).toContain('done: git and the Editor are open again')
  expect([syncOf(w)?.state, syncOf(w)?.note]).toEqual(['done', 'merged 1a2b3c'])
})

test('a sync whose holder is gone can be taken over (the freeze never outlives it unseen)', opts(), async ($, on) => {
  const w = world(on)
  w.put(SYNC, JSON.stringify(newSync(T(14, 30), B, 'sync-lane (session bbbbbbbb)', NOW - 30 * MIN)))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', { heartbeatAt: NOW - 10 * MIN }))
  await $.session.start(START)
  expect(await a5($, 'sync')).toContain('its holder is gone: take it over')
  expect(await a5($, 'sync takeover')).toContain('taken over')
  expect(syncOf(w)?.holder.id8).toBe(ME8)
  expect(await a5($, 'sync abort holder was gone, nothing merged')).toContain('aborted')
  expect(syncOf(w)?.state).toBe('aborted')
})

// ---------- A10: the lease follows /clear ----------
const NEW = 'cd34ef56-0000-4000-8000-000000000000'
const NEW8 = NEW.slice(0, 8)
const clear = async ($: any, w: ReturnType<typeof world>) => {
  w.ids.current = NEW
  await $.session.end({ reason: 'clear', sessionId: ME, resume: { id: ME } } as never)
  await w.clock.advance(1_000) // the new id is read 200 ms later and the files move
}
const ODD = ['named holder', 'is gone', 'was stale']

test('A10: after /clear the lease, its lock line and the sync it holds move to the new session id', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, 'free since 14:20\n')
  await $.session.start(START)
  expect(out(await $.tool.call({ tool: 'mcp__hai-flow__editor', action: 'request', minutes: 20, what: 'tail VFX' } as never))).toContain('granted')
  expect(await a5($, 'sync 15:30')).toContain('planned')
  await clear($, w)
  const line = w.read(LOCK).trim()
  expect(line.startsWith('HELD lane=3️⃣-Loco-fix session=3️⃣-Loco-fix since=14:40 2026-10-06 pid=none end=15:00')).toBe(true)
  expect(line.endsWith(`· held by 3️⃣-Loco-fix, session ${NEW8}, until 15:00`)).toBe(true)
  expect(JSON.parse(w.read(`${HF}/editor/${NEW8}.json`)).holding).toEqual({ since: NOW, end: T(15, 0), extended: 0 })
  const old = JSON.parse(w.read(`${HF}/editor/${ME8}.json`))
  expect([old.holding, old.want, old.heartbeatAt]).toEqual([null, null, 0])
  expect([syncOf(w)?.holder.id8, syncOf(w)?.plannedBy.includes(NEW8)]).toEqual([NEW8, true])
  // The cleared session keeps driving the Editor it opened, and is told of nothing odd.
  expect(refused(await $.tool.call({ tool: 'mcp__unreal-mcp__call_tool', name: 'save_assets' } as never))).toBeUndefined()
  await w.clock.advance(2 * MIN)
  expect(prompts(w).filter(p => ODD.some(word => p.includes(word)))).toEqual([])
  expect(out(await $.tool.call({ tool: 'mcp__hai-flow__editor', action: 'release' } as never))).toContain('released: FREE since=14:42')
})

test('A10: a pending request keeps its place in the queue after /clear', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, 'HELD lane=walker session=walker since=14:00 2026-10-06 pid=none end=15:30 mode=interactive pausable=no next_safe=after save note=capture · held by walker, session bbbbbbbb, until 15:30\n')
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', { holding: { since: T(14, 0), end: T(15, 30), extended: 0 } }))
  await $.session.start(START)
  expect(out(await $.tool.call({ tool: 'mcp__hai-flow__editor', action: 'request', minutes: 30, what: 'PIE proof' } as never))).toContain('walker (session bbbbbbbb) holds the Editor until 15:30')
  await clear($, w)
  const moved = JSON.parse(w.read(`${HF}/editor/${NEW8}.json`))
  expect([moved.want?.minutes, moved.want?.requestedAt]).toEqual([30, NOW])
  expect(JSON.parse(w.read(`${HF}/editor/${ME8}.json`)).want).toBe(null)
  expect(w.read(LOCK)).toContain('session bbbbbbbb') // not this session's lock: untouched
})

// ---------- A11: untracked files main would overwrite ----------
test('A11: at the cutoff the holder lists the files main adds that already exist on disk, each to the session that wrote it', opts(), async ($, on) => {
  const w = world(on, {
    git: {
      'merge-tree': { stdout: '7e4887eb85fc0a6b1638a284733984d7d06b39f5\n', exitCode: 0 },
      'diff --name-only -z --diff-filter=A HEAD origin/main': { stdout: 'Source/S2/NewFile.cpp\0Content/S2/New/A.uasset\0Config/Stray.ini\0docs/new.md\0' },
    },
  })
  on('turn.complete', async () => ({ text: '' }))
  repo(w, 'E:/s2')
  w.put('E:/s2/Content/S2/New/A.uasset', 'local copy')
  w.put('E:/s2/Config/Stray.ini', '[x]')
  w.put(`${HF}/touch/cccccccc.json`, JSON.stringify({ session: 'cccccccc-1', id8: 'cccccccc', lane: 'level-lane', paths: ['Content/S2/New/A.uasset'], updatedAt: NOW }))
  await $.session.start(START)
  await $.tool.call({ tool: 'Write', file_path: 'E:/s2/Source/S2/NewFile.cpp', content: 'int y;\n' })
  w.put('E:/s2/Source/S2/NewFile.cpp', 'int y;\n') // what the Write left on disk (the test's Write tool is a stub)
  expect(await a5($, 'sync 15:30')).toContain('planned')
  await idle($)
  await advance(w, 20, 'cccccccc') // 15:00, the cutoff
  expect(syncOf(w)?.untracked).toEqual(['Source/S2/NewFile.cpp', 'Content/S2/New/A.uasset', 'Config/Stray.ini'])
  expect(w.runs.filter(r => r.includes('--diff-filter=A')).length).toBe(1)
  expect(w.runs.some(r => /ls-files|\bstatus\b|--others/.test(r))).toBe(false) // never a whole-tree untracked scan
  const told = prompts(w)[0] ?? ''
  expect(told).toContain('hai-flow · Sync main — origin/main adds Source/S2/NewFile.cpp, which already exists untracked in the shared checkout and was written by this session')
  expect(told).toContain('before 15:30: commit it with exact paths (then it is an ordinary conflict, yours to settle) or move it out of the tree')
  expect(told).toContain('origin/main adds 3 files that already exist untracked in the shared checkout ("untracked would be overwritten"): Source/S2/NewFile.cpp → 3️⃣-Loco-fix; Content/S2/New/A.uasset → level-lane; Config/Stray.ini → owner unknown')
  expect(told).toContain('owner unknown → 🟥 to Hai')
})

test('A11: a session whose touch file names an untracked file main adds is told by its own hai-flow', opts(), async ($, on) => {
  const w = world(on)
  on('turn.complete', async () => ({ text: '' }))
  repo(w, 'E:/s2')
  w.put(SYNC, JSON.stringify({ ...newSync(T(16, 30), B, 'sync-lane (session bbbbbbbb)', NOW), conflicts: [], conflictsAt: NOW, conflictsSource: 'merge-tree', untracked: ['Content/S2/New/B.uasset'] }))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb'))
  await $.session.start(START)
  await $.tool.call({ tool: 'Write', file_path: 'E:/s2/Content/S2/New/B.uasset', content: 'x' })
  await idle($)
  await advance(w, 1)
  expect(prompts(w)).toEqual([
    'hai-flow · Sync main — origin/main adds Content/S2/New/B.uasset, which already exists untracked in the shared checkout and was written by this session; the merge at 16:30 would refuse to overwrite it (merge-tree does not see this) → before 16:30: commit it with exact paths (then it is an ordinary conflict, yours to settle) or move it out of the tree; never delete a file that may be someone else\'s',
  ])
})
