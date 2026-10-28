import { expect, test } from 'claude-code/testing'
import { blankSession, newSync, noticeIds, parseSyncEnd, parseSyncFile, SYNC_WORKER_PROMPT, ymd, type SessionFile, type SyncFile } from '../hooks/coord.ts'
import { leasePushTargets } from '../hooks/gitshared.ts'
import { LOCK, ME, NOW, PROJ, opts, refused, world, type Rec } from './world.ts'

// Rev 28 (L-31): the sync worker uses no A5R tool (A79), fast routes in one's own branch or worktree (A80), a long
// build window when nobody waits (A81), each notice once, to whom it concerns (A82).
const HF = 'E:/s2/Saved/A5R'
const SYNC = `${HF}/sync.json`
const ME8 = ME.slice(0, 8)
const START = { cwd: PROJ, surface: 'terminal', isInteractive: true } as never
const T = (h: number, m: number) => new Date(2026, 9, 6, h, m).getTime()
const MIN = 60_000
const B = { session: 'bbbbbbbb-1111-4000-8000-000000000000', id8: 'bbbbbbbb', lane: 'sync-lane' }
const MINE = { session: ME, id8: ME8, lane: '3️⃣-Loco-fix' }

type W = ReturnType<typeof world>
const out = (ran: { result?: unknown; text?: string; deny?: string }): string => String(ran.deny ?? ran.result ?? ran.text ?? '')
const peer = (id8: string, o: Partial<SessionFile> = {}): string => JSON.stringify({ ...blankSession(`${id8}-1111-4000-8000-000000000000`, id8 === 'bbbbbbbb' ? 'sync-lane' : `lane-${id8}`, '', NOW), ...o })
const prompts = (w: W): string[] => (w.calls['prompt.submit'] ?? []).map(e => String((e as { text?: string }).text))
const syncOf = (w: W): SyncFile | null => parseSyncFile(w.read(SYNC) || null)
const spawns = (w: W) => (w.calls['agent.spawn'] ?? []) as Rec[]
const a5r = async ($: any, args: string): Promise<string> => String((await $.command.run({ command: 'a5r', args } as never)).text)
const idle = async ($: any) => $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
const workerEnds = async ($: any, answer: string) => $.turn.complete({ agentId: 'w-sync', answer, durationMs: 1, isAborted: false, turnId: 'tw', reason: 'answer' } as never)
const repo = (w: W, root: string, linked = false) => (linked ? w.put(`${root}/.git`, 'gitdir: E:/s2/.git/worktrees/x') : w.put(`${root}/.git/HEAD`, 'ref: refs/heads/HaiHuynh/20261005'))
/** Other sessions' a5r keep their files fresh every minute while the clock runs; the test does it for them. */
const advance = async (w: W, minutes: number, ids: string[] = ['bbbbbbbb']) => {
  for (let n = 0; n < minutes; n += 1) {
    const at = w.clock.now() + MIN
    for (const id8 of ids) w.put(`${HF}/editor/${id8}.json`, peer(id8, { heartbeatAt: at }), at)
    await w.clock.advance(MIN)
  }
}
/** Every notice text a session received: prompts its a5r submitted and the context its tool results carried. */
const heard = (w: W, contexts: string[]): string[] => [...prompts(w), ...contexts]
const call = async ($: any, contexts: string[], input: Rec) => {
  const ran = await $.tool.call(input as never)
  for (const c of (ran as { context?: string[] }).context ?? []) contexts.push(c)
  return ran
}
/** The holder's sync at 14:45, planned from this session (the clock is 14:40). */
const planMine = async ($: any) => {
  expect(await a5r($, 'sync 14:45')).toContain('planned')
  await idle($)
}

// ---------- A79: the sync worker without A5R tools ----------
test('A79 (review 2): unit: the last SYNC line reads leniently: Markdown, backticks, colons, case, the quoted template, other SYNC lines', () => {
  const T1 = 'SYNC DONE <merge sha> pre=<pre-merge HEAD> build=<Succeeded|skipped> conflicts=<none, or path:how; path:how>'
  const T2 = 'SYNC ABORT <why, one line> state=<the state the checkout is in>'
  const done = (a: string) => {
    const e = parseSyncEnd(a)
    return e === null ? null : e.kind === 'done' ? e : { ...e, sha: undefined }
  }
  expect(done('**SYNC DONE** 1a2b3c4 pre=9f8e7d6 build=skipped conflicts=none')).toEqual({ kind: 'done', sha: '1a2b3c4', note: 'merged 1a2b3c4 pre=9f8e7d6 build=skipped conflicts=none' })
  expect(done('SYNC DONE: 1a2b3c4 pre=9f8e7d6 build=skipped conflicts=none')?.sha).toBe('1a2b3c4')
  expect(done('SYNC DONE `1a2b3c4` pre=`9f8e7d6` build=Succeeded conflicts=none')?.sha).toBe('1a2b3c4')
  expect(done('## SYNC DONE 1a2b3c4 pre=9f8e7d6 build=skipped conflicts=none')?.sha).toBe('1a2b3c4')
  expect(done('SYNC DONE 1A2B3C4 pre=9f8e7d6 build=skipped conflicts=none')?.sha).toBe('1a2b3c4')
  // 0.16.1: the keywords in capitals, in the last three lines; a DONE with a sha wins over a later prose ABORT.
  expect(done('sync done 1a2b3c4 pre=9f8e7d6 build=skipped conflicts=none')).toBe(null)
  expect(done('Sync done: the merge finished, see below.')).toBe(null)
  expect(done('SYNC DONE 1a2b3c4 pre=9f8e7d6 build=skipped conflicts=none\nSYNC ABORT was not needed.')?.kind).toBe('done')
  expect(parseSyncEnd('Tried twice.\nSYNC DONE (merge left half-way)\nSYNC ABORT conflict in X.uasset state=merge aborted')?.kind).toBe('abort') // no sha on the DONE
  expect(done('SYNC DONE 1a2b3c4 pre=x build=skipped conflicts=none\nThen I looked again.\nOne more note.\nThe end.')).toBe(null) // not in the last three lines
  expect(done(`My procedure ends with one of:\n${T1}\n${T2}\nSYNC worker report: merged cleanly.\nSYNC DONE 1a2b3c4 pre=9f8e7d6 build=skipped conflicts=none`)?.sha).toBe('1a2b3c4')
  expect(done(`${T1}\n${T2}`)).toBe(null) // only the template quoted: no last word
  expect(done('SYNC ABORT fetch failed state=clean\nthen retried\nSYNC DONE 1a2b3c4 pre=x build=skipped conflicts=none')?.kind).toBe('done') // the last one wins
  expect(done('SYNC DONE merged, sha not at hand')).toEqual({ kind: 'done', sha: '', note: 'merged (sha unread) merged, sha not at hand' })
  expect(parseSyncEnd('**SYNC ABORT:** binary conflict in X.uasset state=merge aborted')).toEqual({ kind: 'abort', why: 'binary conflict in X.uasset', note: 'binary conflict in X.uasset state=merge aborted' })
})

test('A79: unit: the worker\'s last line reads as done or abort; anything else is none', () => {
  expect(parseSyncEnd('Merged.\nSYNC DONE 1a2b3c4d pre=9f8e7d6 build=skipped conflicts=none')).toEqual({ kind: 'done', sha: '1a2b3c4d', note: 'merged 1a2b3c4d pre=9f8e7d6 build=skipped conflicts=none' })
  expect(parseSyncEnd('Report\n`SYNC DONE ABCDEF1 pre=1234567 build=Succeeded conflicts=Source/A.cpp:ours`')?.kind).toBe('done')
  expect(parseSyncEnd('Stopped.\nSYNC ABORT Content/S2/X.uasset conflicts (binary) state=merge aborted, clean at 9f8e7d6')).toEqual({ kind: 'abort', why: 'Content/S2/X.uasset conflicts (binary)', note: 'Content/S2/X.uasset conflicts (binary) state=merge aborted, clean at 9f8e7d6' })
  expect(parseSyncEnd('I could not finish.')).toBe(null)
  expect(parseSyncEnd('SYNC DONE pre=9f8e7d6 build=skipped')?.note).toBe('merged (sha unread) pre=9f8e7d6 build=skipped') // review 2: still done
  expect(SYNC_WORKER_PROMPT.includes('mcp__a5r__')).toBe(false)
})

test('A79: at T the holder\'s a5r takes the Editor lock for the sync in code, spawns the worker, and a SYNC DONE answer ends it done with the lock released', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  on('turn.complete', async () => ({ text: '' }))
  repo(w, 'E:/s2')
  w.put(LOCK, 'free since 14:20\n')
  await $.session.start(START)
  await planMine($)
  await w.clock.advance(5 * MIN) // 14:45: frozen, the worker starts
  expect(spawns(w).length).toBe(1)
  expect(w.read(LOCK)).toContain('note=Sync main 14:45')
  expect(w.read(LOCK)).toContain(`session ${ME8}, until 15:30`) // up to the hard end (T + 45)
  expect(String(spawns(w)[0]?.prompt)).toContain(`Editor lock now: HELD lane=`)
  expect(String(spawns(w)[0]?.prompt)).toContain(`(the sync's lock names session ${ME8})`)
  expect(String(spawns(w)[0]?.prompt).includes('mcp__a5r__')).toBe(false)
  expect(prompts(w).some(p => p.includes('Editor — granted'))).toBe(false) // the sync's slot wakes nobody to launch an Editor
  await idle($)
  await w.clock.advance(20 * MIN) // the worker runs: no lease or idle notice for the sync's slot
  expect(prompts(w).some(p => /Editor lease/.test(p))).toBe(false)
  await workerEnds($, 'Merged origin/main, no conflicts.\nSYNC DONE 1a2b3c4d pre=9f8e7d6c build=skipped conflicts=none tests: EXIT CODE: 0') // A95 (by design): done carries the tests
  expect([syncOf(w)?.state, syncOf(w)?.note]).toEqual(['done', 'merged 1a2b3c4d pre=9f8e7d6c build=skipped conflicts=none tests: EXIT CODE: 0'])
  expect(w.read(LOCK)).toMatch(/^FREE since=.* note=Editor closed; Sync main 14:45 ended /)
  expect(prompts(w).some(p => p.includes('A5R · Sync main — the sync worker finished the sync at 14:45: done (merged 1a2b3c4d'))).toBe(true)
  expect(prompts(w).some(p => p.includes('without a SYNC DONE'))).toBe(false)
})

// A96 (rev 33, by design): a SYNC ABORT hands the sync back to its holder with the lock; the holder's abort ends it.
test('A79 / A96: a SYNC ABORT answer hands the sync back to its holder with its reason, the lock kept; a build sync asks for its window with build', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  on('turn.complete', async () => ({ text: '' }))
  repo(w, 'E:/s2')
  w.put(LOCK, 'free since 14:20\n')
  await $.session.start(START)
  expect(await a5r($, 'sync 14:45 build')).toContain('with a build')
  await idle($)
  await w.clock.advance(5 * MIN)
  expect(w.read(LOCK)).toContain('note=Sync main 14:45 (build)')
  expect(w.read(LOCK)).toContain('until 16:15') // T + 90 with a build
  await workerEnds($, 'The merge hit a binary conflict.\nSYNC ABORT Content/S2/X.uasset conflicts (binary, owner level-lane) state=merge aborted, clean at 9f8e7d6')
  expect([syncOf(w)?.state, syncOf(w)?.stage, syncOf(w)?.note]).toEqual(['planned', 'manual', 'the sync worker aborted: Content/S2/X.uasset conflicts (binary, owner level-lane) state=merge aborted, clean at 9f8e7d6'])
  expect(w.read(LOCK)).toContain('note=Sync main 14:45 (build)')
  expect(prompts(w).some(p => p.includes('A5R · Sync main — the sync at 14:45 is back in your hands (the sync worker aborted: Content/S2/X.uasset conflicts'))).toBe(true)
  expect(out(await $.tool.call({ tool: 'mcp__a5r__sync', action: 'abort', note: 'binary conflict, owner level-lane resolves it after' } as never))).toContain('aborted')
  expect(w.read(LOCK)).toMatch(/^FREE since=/)
})

test('A79: with another lane on the lock at T, the sync\'s request waits first in the queue and is granted when it comes free; any other answer hands the sync back with its first line (A96)', opts(), async ($, on) => {
  // A93 (by design): git shows HEAD still at the pre-merge HEAD (positive evidence of no merge).
  const w = world(on, { ram: '40', git: { 'rev-parse HEAD': { stdout: '9f8e7d6c0000\n' }, 'log -1 --format=%H %P HEAD': { stdout: '9f8e7d6c0000 1111aaaa\n' } } })
  on('turn.complete', async () => ({ text: '' }))
  repo(w, 'E:/s2')
  w.put(LOCK, 'HELD lane=lane-cccccccc session=lane-cccccccc since=14:30 2026-10-06 pid=none end=14:50 mode=interactive pausable=yes next_safe=after save note=capture · held by lane-cccccccc, session cccccccc, until 14:50\n')
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc', { holding: { since: T(14, 30), end: T(14, 50), extended: 0 } }))
  await $.session.start(START)
  await planMine($)
  await advance(w, 5, ['cccccccc']) // 14:45
  expect(spawns(w).length).toBe(1)
  expect(w.read(LOCK)).toContain('session cccccccc') // never taken from its holder
  expect(String(spawns(w)[0]?.prompt)).toContain('Editor lock now: HELD lane=lane-cccccccc')
  w.put(LOCK, 'FREE since=2026-10-06 14:47 by=lane-cccccccc note=Editor closed background=none · free since 14:47\n')
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc', { heartbeatAt: w.clock.now() }))
  await advance(w, 2, ['cccccccc'])
  expect(w.read(LOCK)).toContain(`note=Sync main 14:45`)
  expect(w.read(LOCK)).toContain(`session ${ME8}`)
  await workerEnds($, 'I stopped before the merge: the fetch failed.')
  // A96 (rev 33, by design): the manual stage, the sync's lock kept for the holder.
  expect([syncOf(w)?.state, syncOf(w)?.stage, syncOf(w)?.note]).toEqual(['planned', 'manual', 'the sync worker ended without a SYNC line and no merge commit sits on top of the pre-merge HEAD: I stopped before the merge: the fetch failed.'])
  expect(w.read(LOCK)).toContain(`note=Sync main 14:45`)
})

// Review 6: the engine never delivers a plugin-spawned agent's calls to that plugin's tool.call hook (F-7), so this test covers
// only the case "if A5R does see them": then they pass as the frozen holder's. It is no proof that the worker's git runs.
test('A79 (F-7, only if A5R sees the worker\'s calls): its sync git passes as the frozen holder\'s (same session id)', opts(), async ($, on) => {
  const w = world(on, { git: { 'status --porcelain': { stdout: 'UU Source/S2/Foo.cpp\0' } } })
  repo(w, 'E:/s2')
  w.put('E:/s2/.git/MERGE_HEAD', '1a2b3c\n')
  w.put(SYNC, JSON.stringify(newSync(T(14, 30), MINE, 'me', NOW - 30 * MIN)))
  await $.session.start(START)
  const asWorker = (command: string) => $.tool.call({ tool: 'Bash', command, agentId: 'w-sync' } as never)
  for (const c of ['GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never git -C E:/s2 merge --no-edit origin/main', 'git -C E:/s2 checkout --ours -- Source/S2/Foo.cpp', 'git -C E:/s2 add -- Source/S2/Foo.cpp', 'git -C E:/s2 commit --no-edit'])
    expect([c, refused(await asWorker(c))]).toEqual([c, undefined])
})

// ---------- A80: fast routes in one's own branch or worktree ----------
test('A80: unit: the branches a lease push writes', () => {
  expect(leasePushTargets(['push', '--force-with-lease', 'origin', 'HaiHuynh/x'])).toEqual(['HaiHuynh/x'])
  expect(leasePushTargets(['push', '--force-with-lease=HaiHuynh/x:abc', '--force-if-includes', 'origin', 'HEAD:refs/heads/HaiHuynh/x'])).toEqual(['HaiHuynh/x'])
  expect(leasePushTargets(['push', '--force-with-lease', 'origin'])).toEqual([''])
  expect(leasePushTargets(['push', '--force-with-lease', 'origin', 'HEAD'])).toEqual([''])
  expect(leasePushTargets(['push', '--force-with-lease', '--all', 'origin'])).toEqual(['*'])
  expect(leasePushTargets(['push', 'origin', 'HaiHuynh/x'])).toBe(null)
  expect(leasePushTargets(['push', '--force', 'origin', 'HaiHuynh/x'])).toBe(null) // rule 1's
  // Review 1: redirections and pipes are no refspec.
  expect(leasePushTargets(['push', '--force-with-lease', 'origin', '2>&1'])).toEqual([''])
  expect(leasePushTargets(['push', '--force-with-lease', 'origin', '>', 'push.log'])).toEqual([''])
  expect(leasePushTargets(['push', '--force-with-lease', 'origin', '&>', 'push.log'])).toEqual([''])
  expect(leasePushTargets(['push', '--force-with-lease', 'origin', 'HaiHuynh/x>push.log'])).toEqual(['HaiHuynh/x'])
  expect(leasePushTargets(['push', '--force-with-lease', 'origin', 'HaiHuynh/x', '2>', 'err.log'])).toEqual(['HaiHuynh/x'])
  expect(leasePushTargets(['push', '--force-with-lease', 'origin', '|', 'tail'])).toEqual([''])
})

test('A80: --force-with-lease to a branch of one\'s own runs; to main or the shared checkout\'s branch it is refused; plain force stays refused with the lease as its alternative', opts(), async ($, on) => {
  const w = world(on, { git: { 'E:/wt/x rev-parse': { stdout: 'HaiHuynh/x\n' } } }) // the shared checkout is on HaiHuynh/20261005
  repo(w, 'E:/s2')
  repo(w, 'E:/wt/x', true)
  await $.session.start(START)
  const run = async (command: string) => refused(await $.tool.call({ tool: 'Bash', command }))
  expect(await run('git push --force-with-lease origin HaiHuynh/x')).toBeUndefined()
  expect(await run('git -C E:/wt/x push --force-with-lease --force-if-includes origin HEAD:HaiHuynh/x')).toBeUndefined()
  expect(await run('git -C E:/wt/x push --force-with-lease origin')).toBeUndefined() // its current branch, HaiHuynh/x
  expect(await run('git push --force-with-lease origin HaiHuynh/20261005')).toContain('the branch the shared checkout has checked out (every session commits on it) → push your commits to a branch of your own')
  expect(await run('git -C E:/s2 push --force-with-lease origin')).toContain('HaiHuynh/20261005, the branch the shared checkout has checked out')
  expect(await run('git push --force-with-lease origin main')).toContain('open a PR')
  expect(await run('git push --force-with-lease --all origin')).toContain('push one branch of your own by name')
  for (const c of ['git push --force origin HaiHuynh/x', 'git push -f origin HaiHuynh/x', 'git push origin +HaiHuynh/x'])
    expect([c, (await run(c))?.includes('use git push --force-with-lease to a branch of your own')]).toEqual([c, true])
  // Review 1: a redirection or a pipe after the remote is no refspec: the push writes the current branch, the shared one.
  for (const c of ['git -C E:/s2 push --force-with-lease origin 2>&1', 'git -C E:/s2 push --force-with-lease origin > push.log', 'git -C E:/s2 push --force-with-lease origin 2>&1 | tail -3'])
    expect([c, (await run(c))?.includes('HaiHuynh/20261005, the branch the shared checkout has checked out')]).toEqual([c, true])
  expect(await run('bash -c "git push --force-with-lease origin HaiHuynh/20261005"')).toContain('the branch the shared checkout has checked out')
  expect(await run('bash -c "git push --force-with-lease origin HaiHuynh/x"')).toBeUndefined()
  expect(await run('eval "git push --force-with-lease origin HaiHuynh/x"')).toContain('write it as one plain git command')
  expect(await run('git commit -m "note: prefer --force-with-lease"')).toBeUndefined() // names the flag, pushes nothing
  // 0.16.1: wrapper verbs are read through; text in echo/printf is no command; a script or a fed shell is unread.
  expect(await run('timeout 120 git push --force-with-lease origin HaiHuynh/x')).toBeUndefined()
  expect(await run('timeout 120 git -C E:/s2 push --force-with-lease origin')).toContain('HaiHuynh/20261005, the branch the shared checkout has checked out')
  expect(await run('echo "next: git push --force-with-lease origin HaiHuynh/20261005"')).toBeUndefined()
  expect(await run("printf '%s\\n' 'git push --force-with-lease origin main'")).toBeUndefined()
  expect(await run('bash push.sh --force-with-lease')).toContain('write it as one plain git command')
  expect(await run('./push.sh --force-with-lease origin HaiHuynh/x')).toContain('write it as one plain git command')
})

test('A80: git add . / -A / --all is refused only in the shared S2 checkout; in a worktree or another repository it runs', opts(), async ($, on) => {
  const w = world(on)
  repo(w, 'E:/s2')
  repo(w, 'E:/wt/x', true)
  repo(w, 'D:/Projects/other')
  await $.session.start(START)
  const run = async (command: string) => refused(await $.tool.call({ tool: 'Bash', command }))
  for (const c of ['git -C E:/wt/x add -A', 'git -C E:/wt/x add .', 'cd E:/wt/x && git add --all', 'git -C D:/Projects/other add -A', 'git add .'])
    expect([c, await run(c)]).toEqual([c, undefined]) // `git add .` from this session's own repository (E:/proj)
  for (const c of ['git -C E:/s2 add .', 'git -C E:/s2 add -A', 'cd E:/s2 && git add --all'])
    expect([c, (await run(c))?.includes('stage exact paths')]).toEqual([c, true])
})

// ---------- A81: the build window fits the queue ----------
test('A81: with nobody queued a build window of 60 or 120 min is granted; with someone queued 45 min stays the cap', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, 'free since 14:20\n')
  await $.session.start(START)
  const long = out(await $.tool.call({ tool: 'mcp__a5r__editor', action: 'request', minutes: 120, build: true, what: 'C++ build' } as never))
  expect(long).toContain('granted to this session until 16:40')
  expect(long).not.toContain('at most 45 min')
  out(await $.tool.call({ tool: 'mcp__a5r__editor', action: 'release' } as never))
  // Another session waits for the Editor: the S2 standard's 45 minutes.
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc', { want: { minutes: 20, pie: false, build: false, what: 'PIE proof', mode: 'interactive', pausable: true, nextSafe: 'after save', requestedAt: NOW - MIN } }))
  const queued = out(await $.tool.call({ tool: 'mcp__a5r__editor', action: 'request', minutes: 60, build: true, what: 'C++ build' } as never))
  expect(queued).toBe('A5R · Editor — 1 session is queued for the Editor (lane-cccccccc), so a build window is at most 45 min (S2 standard); 60 asked → batch the code changes into one window of ≤ 45 min and ask again')
  expect(out(await $.tool.call({ tool: 'mcp__a5r__editor', action: 'request', minutes: 45, build: true, what: 'C++ build' } as never))).not.toContain('at most 45 min')
})

test('A81: a long build window that would cross a sync cutoff is refused with the room left', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, 'free since 14:20\n')
  w.put(SYNC, JSON.stringify(newSync(T(16, 0), B, 'sync-lane (session bbbbbbbb)', NOW)))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb'))
  await $.session.start(START)
  expect(out(await $.tool.call({ tool: 'mcp__a5r__editor', action: 'request', minutes: 120, build: true, what: 'C++ build' } as never))).toBe('A5R · Editor — a 120-min build window would cross the cutoff 15:30 of the sync at 16:00 → ask for ≤ 50 min (it ends by the cutoff), or after the sync is done')
  expect(out(await $.tool.call({ tool: 'mcp__a5r__editor', action: 'request', minutes: 50, build: true, what: 'C++ build' } as never))).toContain('granted to this session until 15:30')
})

// ---------- A82: each notice once, to whom it concerns ----------
// Review 6: these two passed at e1e3cb6 too (the delivery was already once per id, F-6): regression guards, not A82's proof.
test('A82 (guard): one grant is one notice, across many tool calls, turns and minutes', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  on('turn.complete', async () => ({ text: '' }))
  w.put(LOCK, 'free since 14:20\n')
  await $.session.start(START)
  const contexts: string[] = []
  const first = out(await call($, contexts, { tool: 'mcp__a5r__editor', action: 'request', minutes: 30, what: 'PIE proof' }))
  for (let n = 0; n < 12; n += 1) {
    await call($, contexts, { tool: 'Bash', command: `echo ${n}` })
    await idle($)
    await w.clock.advance(MIN)
  }
  const all = [first, ...heard(w, contexts)].join('\n')
  expect(all.split('Editor — granted to this session until 15:10').length - 1).toBe(1)
})

test('A82 (guard for once a day; proof for the text): the disk notice is said once a day per session and says what to clean, not "tell Hai"', opts(), async ($, on) => {
  const w = world(on, { disk: 15 })
  await $.session.start(START)
  const contexts: string[] = []
  for (let n = 0; n < 30; n += 1) {
    await call($, contexts, { tool: 'Bash', command: `echo ${n}` })
    await w.clock.advance(MIN)
  }
  const disk = heard(w, contexts).filter(t => t.includes('A5R · Disk —'))
  expect(disk.length).toBe(1)
  expect(disk[0]).toContain('E: has 15 GB free, under 20 GB (the DDC refuses writes under 10 GB) → free space yourself: delete your own temp builds and scratch copies, move old Saved/_restore_backup*')
  expect(disk[0]).not.toContain('tell Hai')
  // The notice id is the day's (a day of minute ticks is too long for the test clock): the next day says it once again.
  expect(noticeIds.disk(ymd(NOW))).not.toBe(noticeIds.disk(ymd(NOW + 24 * 60 * MIN)))
  expect(noticeIds.disk(ymd(NOW))).toBe(noticeIds.disk(ymd(NOW + 9 * 60 * MIN)))
})

test('A82 / A125: an idle session with nothing uncommitted and no Editor request gets no cutoff and no freeze notice, only the lift at its next turn', opts(), async ($, on) => {
  const w = world(on)
  on('turn.complete', async () => ({ text: '' }))
  repo(w, 'E:/s2')
  w.put(SYNC, JSON.stringify(newSync(T(15, 0), B, 'sync-lane (session bbbbbbbb)', NOW)))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb'))
  await $.session.start(START) // 14:40: inside the cutoff
  await idle($)
  await advance(w, 21) // 15:01: frozen
  expect(prompts(w)).toEqual([]) // never woken
  const contexts: string[] = []
  await call($, contexts, { tool: 'Bash', command: 'echo working' })
  expect(contexts.filter(c => c.startsWith('A5R · Sync main'))).toEqual([]) // A125 (rev 42): the freeze line too goes only to the sessions it concerns
  await idle($)
  w.put(SYNC, JSON.stringify({ ...newSync(T(15, 0), B, 'sync-lane (session bbbbbbbb)', NOW), state: 'done', endedAt: T(15, 10), note: 'merged 1a2b3c' }))
  await advance(w, 10)
  expect(prompts(w)).toEqual([]) // the lift waits for its next turn
  await call($, contexts, { tool: 'Bash', command: 'echo again' })
  expect(contexts.filter(c => c.includes('Sync main — done at 15:10')).length).toBe(1)
})

// ---------- review fixes ----------
// 0.16.1: an S2 session's working folder IS the shared checkout, so the tests run from there.
const START_S2 = { cwd: 'E:/s2', surface: 'terminal', isInteractive: true } as never
const cutoffs = (w: W) => prompts(w).filter(p => p.includes('Sync main — cutoff: sync-lane merges origin/main at 15:30')).length

test('A82 (review 4, 0.16.1): from the shared checkout, reads leave a session out of the cutoff; a command that may write there brings it in (kept in its session file)', opts(), async ($, on) => {
  const w = world(on, { cwd: 'E:/s2' })
  on('turn.complete', async () => ({ text: '' }))
  repo(w, 'E:/s2')
  w.put(SYNC, JSON.stringify(newSync(T(15, 30), B, 'sync-lane (session bbbbbbbb)', NOW))) // cutoff 15:00
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb'))
  await $.session.start(START_S2)
  for (const c of ['git log -3', 'git status --short', 'git diff --stat', 'git branch --list', 'ls Source', 'rg TODO Source', 'cat AGENTS.md | head -20', 'timeout 60 git rev-parse HEAD'])
    await $.tool.call({ tool: 'Bash', command: c } as never)
  await idle($)
  await advance(w, 21) // 15:01: inside the cutoff
  expect(cutoffs(w)).toBe(0)
  await $.tool.call({ tool: 'Bash', command: 'python tools/gen.py' } as never) // may write files in the checkout
  expect(typeof JSON.parse(w.read(`${HF}/editor/${ME8}.json`)).sharedShellAt).toBe('number') // survives a reload
  await idle($)
  await advance(w, 1)
  expect(cutoffs(w)).toBe(1)
})

test('A82 (review 4, 0.16.1): after a commit in the shared checkout and nothing written there since, the session is not told at the cutoff', opts(), async ($, on) => {
  const w = world(on, { cwd: 'E:/s2' })
  on('turn.complete', async () => ({ text: '' }))
  repo(w, 'E:/s2')
  w.put(SYNC, JSON.stringify(newSync(T(15, 30), B, 'sync-lane (session bbbbbbbb)', NOW)))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb'))
  await $.session.start(START_S2)
  await $.tool.call({ tool: 'Bash', command: 'python tools/gen.py' } as never)
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "wip: gen" -- tools/out.json' } as never)
  await $.tool.call({ tool: 'Bash', command: 'git log -1' } as never)
  expect(JSON.parse(w.read(`${HF}/editor/${ME8}.json`)).sharedShellAt).toBeUndefined()
  await idle($)
  await advance(w, 20)
  expect(cutoffs(w)).toBe(0)
})

test('A82 (0.16.1): a redirect into the shared checkout counts from any folder', opts(), async ($, on) => {
  const w = world(on)
  on('turn.complete', async () => ({ text: '' }))
  repo(w, 'E:/s2')
  w.put(SYNC, JSON.stringify(newSync(T(15, 30), B, 'sync-lane (session bbbbbbbb)', NOW)))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb'))
  await $.session.start(START)
  await $.tool.call({ tool: 'Bash', command: 'git -C E:/s2 log -3 > notes.txt' } as never) // a read, written outside
  await idle($)
  await advance(w, 21)
  expect(cutoffs(w)).toBe(0)
  await $.tool.call({ tool: 'Bash', command: 'python report.py > E:/s2/Docs/report.md' } as never)
  await idle($)
  await advance(w, 1)
  expect(cutoffs(w)).toBe(1)
})

test('A81 (review 3): extending a 45-min build lease past 45 min in all is refused while someone is queued; with nobody queued it runs', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, 'free since 14:20\n')
  await $.session.start(START)
  expect(out(await $.tool.call({ tool: 'mcp__a5r__editor', action: 'request', minutes: 45, build: true, what: 'C++ build' } as never))).toContain('granted to this session until 15:25')
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc', { want: { minutes: 20, pie: false, build: false, what: 'PIE proof', mode: 'interactive', pausable: true, nextSafe: 'after save', requestedAt: NOW } }))
  expect(out(await $.tool.call({ tool: 'mcp__a5r__editor', action: 'extend', minutes: 120 } as never))).toBe('A5R · Editor — 1 session is queued for the Editor, so a build window is at most 45 min (S2 standard); extended to 17:25 it would be 165 min → finish the build by 15:25, release, and ask again for the rest')
  w.files.delete(`${HF}/editor/cccccccc.json`.toLowerCase())
  expect(out(await $.tool.call({ tool: 'mcp__a5r__editor', action: 'extend', minutes: 30 } as never))).toContain('extended until 15:55')
})

test('A79 (review 5): a SYNC DONE that arrives after the hard end, before anyone wrote the expiry, is recorded as done', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  on('turn.complete', async () => ({ text: '' }))
  repo(w, 'E:/s2')
  await $.session.start(START)
  // The worker ran past the hard end and no tick has written the expiry yet.
  w.put(SYNC, JSON.stringify({ ...newSync(T(13, 50), MINE, 'me', NOW - 90 * MIN), workerId: 'w-sync', workerAt: T(13, 50) })) // hard end 14:35
  await workerEnds($, 'SYNC DONE 1a2b3c4 pre=9f8e7d6 build=skipped conflicts=none tests: EXIT CODE: 0')
  expect([syncOf(w)?.state, syncOf(w)?.note]).toEqual(['done', 'merged 1a2b3c4 pre=9f8e7d6 build=skipped conflicts=none tests: EXIT CODE: 0'])
})

test('A79 (review 5): /a5r off while the worker runs: its SYNC line is still recorded and the sync\'s lock released', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  on('turn.complete', async () => ({ text: '' }))
  repo(w, 'E:/s2')
  w.put(LOCK, 'free since 14:20\n')
  await $.session.start(START)
  await planMine($)
  await w.clock.advance(5 * MIN)
  expect(w.read(LOCK)).toContain('note=Sync main 14:45')
  expect(await a5r($, 'off')).toContain('A5R off')
  await workerEnds($, 'SYNC DONE 1a2b3c4 pre=9f8e7d6 build=skipped conflicts=none tests: EXIT CODE: 0')
  expect(syncOf(w)?.state).toBe('done')
  expect(w.read(LOCK)).toMatch(/^FREE since=/)
})

test('A79 (review 5): the holder still on the Editor at T: the sync takes that lease, the cutoff notice says so, and the lock is released at the end', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  on('turn.complete', async () => ({ text: '' }))
  repo(w, 'E:/s2')
  w.put(LOCK, 'free since 14:20\n')
  await $.session.start(START)
  expect(out(await $.tool.call({ tool: 'mcp__a5r__editor', action: 'request', minutes: 30, what: 'PIE proof' } as never))).toContain('granted to this session until 15:10')
  await planMine($) // 14:45: inside the cutoff already
  await w.clock.advance(5 * MIN)
  expect(prompts(w).some(p => p.includes('the sync takes that lease: its worker uses or closes that Editor after a dirty-package check, and a5r releases it when the sync ends'))).toBe(true)
  expect(w.read(LOCK)).toContain(`session ${ME8}`)
  await workerEnds($, 'SYNC DONE 1a2b3c4 pre=9f8e7d6 build=skipped conflicts=none tests: EXIT CODE: 0')
  expect(w.read(LOCK)).toMatch(/^FREE since=.*Sync main 14:45 ended/)
})
