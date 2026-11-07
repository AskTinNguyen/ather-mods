import { expect, test } from 'claude-code/testing'
import { blankSession, newSync, parseSyncFile, type SyncFile } from '../hooks/coord.ts'
import { isSharedGitArgv, walkDeep } from '../hooks/gitshared.ts'
import { cannotOwnLock, untargetedGitPids } from '../hooks/gitturn.ts'
import { MERGE_END, NO_RESULT, diedNote, isMergeScriptAlive, mergeOutcome, workerEndOf, mergeScriptText, mergeStartCommand, mergeWaitCommand, syncMergeLog, syncMergeScript } from '../hooks/mergescript.ts'
import { STEPS, commandNeeds, freezeStepOf, freezeWhy, holdsReads } from '../hooks/syncplan.ts'
import { SYNC_WORKER_PROMPT, syncWorkerTask } from '../hooks/syncworker.ts'
// The real half (the script on temporary repositories, started by the worker's own command) runs with node, as the test
// runner has no file system, processes or git: node --experimental-strip-types a5r/tests/merge-script-smoke.mjs
import { A5RPANE, LOCK, MERGE_BODY_TEXT, NOW, PROJ, k, opts, refused, world, type Proc, type Rec } from './world.ts'

// Rev 46 (L-51): A142 the sync merge runs as A5R's script and never leaves a half-merged tree; A143 A5R keeps out of the
// index during the merge step; A144 a stale index.lock is moved again (the desktop app's panel readers no longer block
// the move; a gone session's claim is cleared; the merge script runs detached).
const HF = 'E:/s2/Saved/A5R'
const S2 = 'E:/s2'
const MIN = 60_000
const START = { cwd: PROJ, surface: 'terminal', isInteractive: true } as never
const SID = (id8: string) => `${id8}-1111-4000-8000-000000000000`
const peer = (id8: string, at = NOW + 600 * MIN, lane = `lane-${id8}`): string => JSON.stringify({ ...blankSession(SID(id8), lane, '', NOW), heartbeatAt: at })
const B = { session: SID('bbbbbbbb'), id8: 'bbbbbbbb', lane: 'sync-main' }
type W = ReturnType<typeof world>
const shared = (w: W) => w.put(`${S2}/.git/HEAD`, 'ref: refs/heads/HaiHuynh/20261005')
const idle = async ($: any) => $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
/** The measured desktop-app panel reader (2026-11-08 01:46), no -C, run in the checkout. */
const PANEL = '"C:\\Program Files\\Git\\cmd\\git.exe" -c core.quotepath=false -c safe.directory=* -c core.fsmonitor= -c branch.autoSetupMerge=false -c core.useReplaceRefs=false -c core.hooksPath=\\\\.\\NUL -c filter.lfs.clean= -c filter.lfs.smudge= -c filter.lfs.process= -c filter.lfs.required=false -c diff.ignoreSubmodules=dirty -c diff.submodule=short -c status.submoduleSummary=false -c submodule.recurse=false -c log.showSignature=false -c alias.remote-denied_by_claude_desktop.command= -c help.autocorrect=0 -c core.splitIndex=false diff --ignore-submodules=dirty --submodule=short --no-textconv --numstat -z -M d9d57ae416bab9b0eb18da78514286e09c20c5c1'
const PANEL_LS = '"C:\\Program Files\\Git\\cmd\\git.exe" -c core.quotepath=false -c core.fsmonitor= ls-files --others --exclude-standard -z'
/** Another session's sync (holder sync-main) in a stage (null: merging, its worker started). */
const syncIn = (w: W, stage: SyncFile['stage']) => {
  const base = newSync(NOW - 20 * MIN, B, 'sync-main (session bbbbbbbb)', NOW - 60 * MIN, false)
  const s: SyncFile = { ...base, workerAt: NOW - 20 * MIN, stage, stageAt: NOW - 5 * MIN, preHead: 'def5678', mergeSha: stage ? 'abc1234' : '' }
  w.put(`${HF}/sync.json`, JSON.stringify(s))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', NOW + 600 * MIN, 'sync-main'))
  return s
}
const LOCKF = `${S2}/.git/index.lock`
const moves = (w: W) => w.runs.filter(r => r.includes('Move-Item'))
const mover = (w: W) =>
  w.runEffects.set('Move-Item', () => {
    const to = /-Destination '([^']+)'/.exec(moves(w).pop() ?? '')?.[1] ?? ''
    w.put(to, w.read(LOCKF))
    w.files.delete(k(LOCKF))
  })

// ---------- A142: the merge script ----------
test('A142: unit: the script is its param block (the checkout, the sync, the rules as regular expressions, the waits) over the plugin\'s body, CRLF; a body that is not the script writes none', () => {
  const text = mergeScriptText(MERGE_BODY_TEXT, { checkout: "E:/Hai's s2", syncId: 'sync-x', rules: [{ side: 'theirs', pattern: 'Content/**/*.uasset' }, { side: 'ours', pattern: 'Config/' }] }) ?? ''
  const lines = text.split('\r\n')
  expect(lines[0]).toBe('param(')
  expect(lines).toContain("  [string]$Checkout = 'E:\\Hai''s s2',")
  expect(lines).toContain("  [string]$Target = 'origin/main',")
  expect(lines).toContain("  [string]$Log = 'E:\\Hai''s s2\\Saved\\A5R\\sync-x-merge.log',")
  expect(lines).toContain("  [object[]]$Rules = @(@{ Side = 'theirs'; Re = '^Content/(?:.*/)?[^/]*\\.uasset$'; Pattern = 'Content/**/*.uasset' }, @{ Side = 'ours'; Re = '^Config/'; Pattern = 'Config/' }),")
  expect(lines).toContain('  [int]$RenameWaitSec = 180')
  expect(lines[lines.indexOf(')') + 1]).toBe('# A5R sync merge (A142, rev 46). The body.')
  expect(text.endsWith("$ErrorActionPreference = 'Stop'\r\n")).toBe(true)
  expect(text.replace(/\r\n/g, '').includes('\n')).toBe(false)
  expect(mergeScriptText('', { checkout: 'E:/s2', syncId: 'x', rules: [] })).toBeNull() // an unread body
  expect(mergeScriptText('<html>404</html>', { checkout: 'E:/s2', syncId: 'x', rules: [] })).toBeNull()
  expect(syncMergeScript('E:/s2', 'sync-x')).toBe('E:/s2/Saved/A5R/sync-x-merge.ps1')
})

test('A142 / A144: unit: the worker\'s command starts the script detached and waits for it; the wait command finds it by its file; the result line', () => {
  const run = mergeStartCommand('E:/my s2/Saved/A5R/sync-x-merge.ps1', 'E:/my s2/Saved/A5R/sync-x-merge.log')
  expect(run.startsWith("$p = Start-Process -FilePath powershell.exe -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File','\"E:\\my s2\\Saved\\A5R\\sync-x-merge.ps1\"' -WindowStyle Hidden -PassThru; 'A5R merge script pid ' + $p.Id; ")).toBe(true)
  expect(run.endsWith(mergeWaitCommand('E:/my s2/Saved/A5R/sync-x-merge.ps1', 'E:/my s2/Saved/A5R/sync-x-merge.log'))).toBe(true) // then the same wait tail
  expect(run).toContain("Get-Content -LiteralPath 'E:\\my s2\\Saved\\A5R\\sync-x-merge.log' -Tail 25")
  expect(mergeWaitCommand('E:/s2/Saved/A5R/sync-x-merge.ps1', 'E:/s2/Saved/A5R/sync-x-merge.log')).toContain("$_.ProcessId -ne $PID -and $_.CommandLine -like '*-File*sync-x-merge.ps1*'")
  expect(MERGE_END.exec('x\r\n2026-11-08 02:15:36.234 rule=sync-merge A5R merge refused conflict: 2 conflicted path(s)\r\n')?.[1]).toBe('refused')
  expect(MERGE_END.exec('2026-11-08 rule=sync-merge A5R merge merged 7b68b894 (3 path(s) written)')?.[1]).toBe('merged')
  expect(MERGE_END.exec('2026-11-08 rule=sync-merge start: checkout E:\\s2')).toBeNull()
  expect(isMergeScriptAlive([{ name: 'powershell', cmd: 'powershell.exe -NoProfile -File "E:\\s2\\Saved\\A5R\\sync-x-merge.ps1"' }])).toBe(true)
  expect(isMergeScriptAlive([{ name: 'powershell', cmd: 'powershell.exe -File build.ps1' }, { name: 'cmd', cmd: 'x-merge.ps1' }])).toBe(false)
  expect(isMergeScriptAlive([{ name: 'powershell', cmd: `powershell -Command ${mergeWaitCommand('E:/s2/Saved/A5R/sync-x-merge.ps1', 'E:/s2/Saved/A5R/sync-x-merge.log')}` }])).toBe(false) // the shell running the wait command
  expect(isMergeScriptAlive(null)).toBeNull()
  // The process the start command launches, as Windows writes its command line, is the script; the shells running the
  // start and wait commands are not (the two matchers, TS and PowerShell, kept in step).
  const launched = `"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "E:\\my s2\\Saved\\A5R\\sync-x-merge.ps1"`
  expect(isMergeScriptAlive([{ name: 'powershell', cmd: launched }])).toBe(true)
  expect(isMergeScriptAlive([{ name: 'powershell', cmd: `powershell -Command ${run}` }])).toBe(false)
})

test('A142: unit: the worker merges only with the script, makes no git write of its own, reads the script\'s result into its SYNC line; the task gives both commands, or says no script was written', () => {
  expect(SYNC_WORKER_PROMPT).toContain('You make no git write yourself: the merge is A5R\'s merge script (rule 5)')
  expect(SYNC_WORKER_PROMPT).not.toContain('git merge --no-edit origin/main')
  expect(SYNC_WORKER_PROMPT).toContain('`A5R merge refused <kind>: <why> [paths]`: end with `SYNC ABORT <kind>: <why, with the paths> state=clean at <pre-merge HEAD>`')
  expect(SYNC_WORKER_PROMPT).toContain('during the merge step even git reads wait')
  expect(SYNC_WORKER_PROMPT).toContain('a .uasset or .umap no rule names')
  const s = { ...newSync(NOW, B, 'sync-main', NOW - MIN, false), id: 'sync-x' }
  const run = mergeStartCommand(syncMergeScript(S2, 'sync-x'), syncMergeLog(S2, 'sync-x'))
  const task = syncWorkerTask(s, S2, 'FREE', null, run)
  expect(task).toContain(`Merge (rule 5): run this one PowerShell command: ${run}; while its output has no \`A5R merge\` result line, run this one PowerShell command again: ${mergeWaitCommand(syncMergeScript(S2, 'sync-x'), syncMergeLog(S2, 'sync-x'))}`)
  expect(syncWorkerTask(s, S2, 'FREE', null, '')).toContain('Merge (rule 5): A5R wrote no merge script (its write failed): do not merge; end with SYNC ABORT A5R wrote no merge script state=clean at <pre-merge HEAD>.')
})

test('A142: at T the holder\'s A5R writes the merge script (its rules in) before the worker starts, and the worker\'s task gives the command that starts it', opts(), async ($, on) => {
  const w = world(on, { ram: '40', git: { 'rev-parse HEAD': { stdout: '9f8e7d6c0000\n' } } })
  on('turn.complete', async () => ({ text: '' }))
  shared(w)
  w.put(LOCK, 'free since 14:20\n')
  await $.session.start(START)
  await $.tool.call({ tool: 'mcp__a5r__sync', action: 'plan', at: '14:45', rules: ['theirs Content/**'] } as never)
  await idle($)
  for (let n = 0; n < 6; n += 1) await w.clock.advance(MIN)
  const s = parseSyncFile(w.read(`${HF}/sync.json`) || null)
  expect(s?.workerAt).toBeTruthy()
  const script = w.read(syncMergeScript(S2, s?.id ?? ''))
  expect(script).toContain("[object[]]$Rules = @(@{ Side = 'theirs'; Re = '^Content/.*$'; Pattern = 'Content/**' }),")
  expect(script).toContain('# A5R sync merge (A142, rev 46). The body.')
  const task = String(((w.calls['agent.spawn'] ?? [])[0] as Rec | undefined)?.prompt ?? '')
  expect(task).toContain(mergeStartCommand(syncMergeScript(S2, s?.id ?? ''), syncMergeLog(S2, s?.id ?? '')))
})

test('A142: after the worker hands the sync back, the holder\'s new rules write the merge script again and the answer gives the command to rerun it; before the hand-back, rules stay refused once the worker started', opts(), async ($, on) => {
  const w = world(on, { ram: '40', git: { 'rev-parse HEAD': { stdout: '9f8e7d6c0000\n' }, 'log -1 --format=%H %P HEAD': { stdout: '9f8e7d6c0000 1111\n' } } })
  on('turn.complete', async () => ({ text: '' }))
  shared(w)
  w.put(LOCK, 'free since 14:20\n')
  await $.session.start(START)
  const sync = async (input: Rec) => (r => String(r.deny ?? r.result ?? r.text ?? ''))((await $.tool.call({ tool: 'mcp__a5r__sync', ...input } as never)) as { result?: unknown; text?: string; deny?: string })
  await sync({ action: 'plan', at: '14:45', rules: ['theirs Content/**'] })
  await idle($)
  for (let n = 0; n < 6; n += 1) await w.clock.advance(MIN)
  const id = parseSyncFile(w.read(`${HF}/sync.json`) || null)?.id ?? ''
  expect(await sync({ action: 'rules', rules: ['ours Docs/'] })).toContain('the sync worker started at 14:45 with the rules it had')
  // The script's own log: its git processes and its refusal, copied into orchestrate.log when the worker ends.
  w.put(syncMergeLog(S2, id), '2026-10-06 14:46:10.000 rule=sync-merge process pid=13020 parent=13328 name=git.exe cmd=git -c core.fsmonitor= status\r\n2026-10-06 14:46:10.100 rule=sync-merge A5R merge refused conflict: 1 conflicted path(s) that no rule resolves (nothing written) [Docs/a.md (no rule matches)]; HEAD, index and working tree are as before\r\n')
  await $.turn.complete({ agentId: 'w-sync', answer: 'SYNC ABORT conflict: 1 conflicted path(s) that no rule resolves [Docs/a.md (no rule matches)] state=clean at 9f8e7d6c0000', durationMs: 1, isAborted: false, turnId: 'tw', reason: 'answer' } as never)
  await w.clock.advance(MIN)
  expect(parseSyncFile(w.read(`${HF}/sync.json`) || null)?.stage).toBe('manual')
  const logged = w.read(`${HF}/orchestrate.log`).split('\n').find(l => l.includes('| rule=sync-merge |')) ?? ''
  expect(logged).toContain('| procs=git |')
  expect(logged).toContain('note=A5R merge refused conflict: 1 conflicted path(s)')
  const said = await sync({ action: 'rules', rules: ['theirs Content/**', 'ours Docs/'] })
  expect(said).toContain(`its merge script was written again with them: rerun it with this one PowerShell command: ${mergeStartCommand(syncMergeScript(S2, id), syncMergeLog(S2, id))}`)
  expect(w.read(syncMergeScript(S2, id))).toContain("@{ Side = 'ours'; Re = '^Docs/'; Pattern = 'Docs/' }")
})

// ---------- A143: A5R keeps out of the index during the merge step ----------
test('A143: unit: the merge step (frozen before the merge commit, or a merge script running), A5R\'s own shared-checkout git, a git read\'s need, held only while merging', () => {
  expect(holdsReads(freezeStepOf('frozen', null, null, false))).toBe(true)
  expect(holdsReads(freezeStepOf('frozen', 'building', null, false))).toBe(false)
  expect(freezeStepOf('frozen', 'manual', null, isMergeScriptAlive([{ name: 'powershell', cmd: 'powershell -File E:\\s2\\Saved\\A5R\\s-merge.ps1' }]))).toBe('merging') // the holder finishing by hand
  expect(freezeStepOf('frozen', 'manual', null, null)).toBe('manual') // an unread process list says nothing
  expect(holdsReads(freezeStepOf('cutoff', null, null, null))).toBe(false)
  expect(isSharedGitArgv(['git', '-C', 'E:/s2', 'status'], S2)).toBe(true)
  expect(isSharedGitArgv(['git', '-C', 'E:\\s2\\Source', 'diff'], S2)).toBe(true)
  expect(isSharedGitArgv(['git', '-C', 'E:/s2-wt', 'status'], S2)).toBe(false)
  expect(isSharedGitArgv(['powershell', '-C', 'E:/s2'], S2)).toBe(false)
  const needs = (c: string) => commandNeeds(walkDeep(c, PROJ).segs, S2, new Set())
  expect(needs(`git -C ${S2} status`)).toEqual(['read'])
  expect(needs(`git -C ${S2} --version`)).toEqual([])
  expect(needs('git -C E:/other status')).toEqual([])
  expect(STEPS.merging.held.has('read')).toBe(true)
  for (const step of ['building', 'build-failed', 'testing', 'manual'] as const) expect(STEPS[step].held.has('read')).toBe(false)
  const s = newSync(NOW, B, 'sync-main', NOW - MIN, false)
  expect(freezeWhy(s, 'merging', 'read', '', 'LINE').why).toBe('sync-main merges origin/main since 14:40: no git command in the shared checkout, not even a read, while the merge writes its index, until the merge is committed (now merging) · LINE')
})

test('A143: another session\'s git read of the shared checkout is refused in the merge step with the timeline, and runs once the merge is committed; reads elsewhere run', opts(), async ($, on) => {
  const w = world(on)
  shared(w)
  syncIn(w, null)
  await $.session.start(START)
  const why = refused(await $.tool.call({ tool: 'Bash', command: `git -C ${S2} status --porcelain` }))
  expect(why).toContain('A5R · Sync main freeze — sync-main merges origin/main since 14:20: no git command in the shared checkout, not even a read, while the merge writes its index, until the merge is committed (now merging) · Sync main 14:20')
  expect(why).toContain('read the files themselves (Read, Grep) or use your own worktree')
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git -C E:/proj log -1' }))).toBeUndefined()
  syncIn(w, 'testing')
  await w.clock.advance(MIN)
  expect(refused(await $.tool.call({ tool: 'Bash', command: `git -C ${S2} status --porcelain` }))).toBeUndefined()
  // Handed back, the holder reruns the merge script by hand: the merge step again while it runs.
  syncIn(w, 'manual')
  w.machine.procs = [{ name: 'powershell', pid: 7, gb: 0.1, parentAlive: true, cmd: 'powershell.exe -File "E:\\s2\\Saved\\A5R\\sync-x-merge.ps1"' }]
  await w.clock.advance(MIN)
  expect(refused(await $.tool.call({ tool: 'Bash', command: `git -C ${S2} diff --stat` }))).toContain('not even a read')
  w.machine.procs = []
  await w.clock.advance(MIN)
  expect(refused(await $.tool.call({ tool: 'Bash', command: `git -C ${S2} diff --stat` }))).toBeUndefined()
})

test('A143: A5R runs no git of its own in the shared checkout during the merge step (the pane\'s branch reads are skipped), and runs them again after', opts(), async ($, on) => {
  const w = world(on, { cwd: S2 })
  shared(w)
  syncIn(w, null)
  await $.session.start({ cwd: S2, surface: 'terminal', isInteractive: true } as never)
  const mine = () => w.runs.filter(r => /^git -C E:\/s2 /i.test(r))
  const pane = { ...A5RPANE, surface: 'terminal' } as never
  await $.ui.render(pane)
  await w.clock.advance(50)
  await w.clock.advance(4 * MIN)
  await $.ui.render(pane)
  await w.clock.advance(50)
  expect(mine()).toEqual([])
  syncIn(w, 'testing')
  await w.clock.advance(4 * MIN)
  await $.ui.render(pane)
  await w.clock.advance(50)
  expect(mine().some(r => r.includes('rev-list'))).toBe(true)
})

test('A143: a stale index.lock is never moved during the merge step (its script holds it), a rerun by hand included, and is once no merge runs', opts(), async ($, on) => {
  const w = world(on)
  shared(w)
  mover(w)
  syncIn(w, null)
  w.put(LOCKF, 'A5R sync merge sync-x pid 1', NOW - 5 * MIN)
  await $.session.start(START)
  for (let n = 0; n < 3; n += 1) await w.clock.advance(MIN)
  expect(moves(w)).toEqual([])
  syncIn(w, 'manual') // handed back to the holder, who reruns the script by hand
  w.machine.procs = [{ name: 'powershell', pid: 7, gb: 0.1, parentAlive: true, cmd: 'powershell.exe -File "E:\\s2\\Saved\\A5R\\sync-x-merge.ps1"' }]
  await w.clock.advance(2 * MIN)
  expect(moves(w)).toEqual([]) // its script runs: still the merge step
  w.machine.procs = []
  await w.clock.advance(2 * MIN)
  expect(moves(w).length).toBe(1)
})

// ---------- A144: a stale index.lock is moved again ----------
test('A144 / Fable 5: unit: as MEASURED, a lock-free read never owns a lock, a refresh only one written before it started, anything else may', () => {
  const LOCK_AT = NOW - 8 * MIN
  // MEASURED 2026-11-08 (a temp repo, stat-dirty files): ls-files, log and the object reads never rewrite the index; status,
  // diff and describe do, with or without -c core.fsmonitor=, unless --no-optional-locks.
  for (const c of [PANEL_LS, 'git log -1', 'git show HEAD', 'git cat-file -p HEAD', 'git rev-parse HEAD', 'git ls-tree HEAD', 'git merge-base HEAD origin/main', 'git --no-optional-locks status --porcelain', 'git --no-optional-locks diff --numstat HEAD~1']) expect([c, cannotOwnLock(c, 0, LOCK_AT)]).toEqual([c, true])
  for (const c of [PANEL, 'git status', 'git -c core.fsmonitor= status -z', 'git diff --stat', 'git describe --dirty']) {
    expect([c, cannotOwnLock(c, LOCK_AT - MIN, LOCK_AT)]).toEqual([c, false]) // it may have taken it
    expect([c, cannotOwnLock(c, 0, LOCK_AT)]).toEqual([c, false]) // an unknown start never counts as after
    expect([c, cannotOwnLock(c, LOCK_AT + MIN, LOCK_AT)]).toEqual([c, true]) // started after it was written: it found it taken
  }
  for (const c of ['git commit -m wip', 'git add -A', 'git fetch origin', 'git -c core.fsmonitor= commit -m x', 'git', 'git --git-dir .git commit -m x']) expect([c, cannotOwnLock(c, LOCK_AT + MIN, LOCK_AT)]).toEqual([c, false])
  const probe = { freeGb: 1, diskGb: null, procs: [{ name: 'git', pid: 1, gb: 0, parentAlive: true, cmd: PANEL, startedAt: LOCK_AT + MIN }, { name: 'git', pid: 2, gb: 0, parentAlive: true, cmd: 'git commit -m wip' }, { name: 'git', pid: 3, gb: 0, parentAlive: true, cmd: 'git status', startedAt: LOCK_AT - MIN }, { name: 'git-lfs', pid: 4, gb: 0, parentAlive: true }, { name: 'git', pid: 5, gb: 0, parentAlive: true, cmd: PANEL_LS }] }
  expect(untargetedGitPids(probe as never, LOCK_AT)).toEqual([2, 3, 4])
})

test('A144: the desktop app\'s panel readers (no -C, started after the lock) do not block the move of a stale lock; an untargeted git commit still does', opts(), async ($, on) => {
  const w = world(on)
  shared(w)
  mover(w)
  w.put(LOCKF, 'a partial index write', NOW - 8 * MIN)
  w.machine.procs = [{ name: 'git', pid: 15504, gb: 0.1, parentAlive: true, cmd: PANEL, startedAt: NOW - MIN }, { name: 'git', pid: 15505, gb: 0.1, parentAlive: true, cmd: PANEL_LS }, { name: 'git', pid: 37412, gb: 0.1, parentAlive: true, cmd: 'git fsmonitor--daemon run --detach --ipc-threads=8' }, { name: 'git', pid: 47320, gb: 0.1, parentAlive: true, cmd: 'git commit -m "slow lfs commit"' }]
  await $.session.start(START)
  await w.clock.advance(2 * MIN)
  expect(moves(w)).toEqual([])
  w.machine.procs = w.machine.procs.filter(p => p.pid !== 47320)
  await w.clock.advance(MIN)
  expect(moves(w).length).toBe(1)
  expect(w.read(`${HF}/orchestrate.log`)).toContain('| rule=stale-index-lock |')
})

test('A144: a claim that lapsed because its session is gone is cleared (written null); a live session\'s claim is not', opts(), async ($, on) => {
  const w = world(on)
  shared(w)
  const claim = (id8: string) => JSON.stringify({ v: 1, session: SID(id8), id8, lane: `lane-${id8}`, command: 'git commit', startedAt: NOW - 3 * 24 * 60 * MIN })
  w.put(`${HF}/editor/41c6fc3c.json`, peer('41c6fc3c', NOW - 4 * 24 * 60 * MIN)) // gone since 04/11
  w.put(`${HF}/git-turn/41c6fc3c.json`, claim('41c6fc3c'))
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc'))
  w.put(`${HF}/git-turn/cccccccc.json`, claim('cccccccc'))
  await $.session.start(START)
  await w.clock.advance(MIN)
  expect(w.read(`${HF}/git-turn/41c6fc3c.json`)).toBe('null')
  expect(w.read(`${HF}/git-turn/cccccccc.json`)).toBe(claim('cccccccc'))
})

// ---------- Fable's review of rev 46 ----------
const ME8 = 'ab12cd34'
const SCRIPT_PROC = (id: string): Proc => ({ name: 'powershell', pid: 7001, gb: 0.1, parentAlive: false, cmd: `powershell.exe -NoProfile -File "E:\\s2\\Saved\\A5R\\${id}-merge.ps1"` })
/** This session's own sync at 14:45 planned, its worker started at T (the merge step). */
const mineAtT = async ($: any, on: any, cwd = PROJ, head = '9f8e7d6c0000 1111') => {
  const w = world(on, { ram: '40', cwd, git: { 'rev-parse HEAD': { stdout: '9f8e7d6c0000\n' }, 'log -1 --format=%H %P HEAD': { stdout: `${head}\n` } } })
  on('turn.complete', async () => ({ text: '' }))
  shared(w)
  w.put(LOCK, 'free since 14:20\n')
  await $.session.start({ cwd, surface: 'terminal', isInteractive: true } as never)
  await $.tool.call({ tool: 'mcp__a5r__sync', action: 'plan', at: '14:45' } as never)
  await idle($)
  for (let n = 0; n < 6; n += 1) await w.clock.advance(MIN)
  const s = parseSyncFile(w.read(`${HF}/sync.json`) || null) as SyncFile
  expect(s.workerAt).toBeTruthy()
  return { w, s, sync: () => parseSyncFile(w.read(`${HF}/sync.json`) || null) as SyncFile }
}
const workerEnds = async ($: any, answer: string) => $.turn.complete({ agentId: 'w-sync', answer, durationMs: 1, isAborted: false, turnId: 'tw', reason: 'answer' } as never)

test('Fable 1: in the merge step the holder\'s own A5R reads of the checkout are skipped too (the pane\'s branch reads)', opts(), async ($, on) => {
  const { w } = await mineAtT($, on, S2)
  expect(parseSyncFile(w.read(`${HF}/sync.json`) || null)?.holder.id8).toBe(ME8)
  const before = w.runs.length
  const pane = { ...A5RPANE, surface: 'terminal' } as never
  await w.clock.advance(4 * MIN)
  await $.ui.render(pane)
  await w.clock.advance(50)
  expect(w.runs.slice(before).filter(r => /^git -C E:\/s2 (rev-list|status|diff|log -1 --format=%h)/i.test(r))).toEqual([])
})

test('Fable 2: the worker ends while its merge script still runs: the merge step stays; the script\'s result line ends it, with its sha', opts(), async ($, on) => {
  const { w, s, sync } = await mineAtT($, on)
  w.machine.procs = [SCRIPT_PROC(s.id)]
  w.put(syncMergeLog(S2, s.id), '2026-10-06 14:46:00.000 rule=sync-merge start: checkout E:\\s2\r\n2026-10-06 14:46:30.000 rule=sync-merge index rename refused (try 1, Windows error 5); retrying\r\n')
  await workerEnds($, 'SYNC ABORT the merge script did not finish in 9 minutes state=unknown')
  await w.clock.advance(MIN)
  expect(sync().stage).toBeNull() // not ended: the script runs
  w.put(syncMergeLog(S2, s.id), `${w.read(syncMergeLog(S2, s.id))}2026-10-06 14:49:00.000 rule=sync-merge A5R merge merged 7b68b8940000aaaa (12 path(s) written)\r\n`)
  w.machine.procs = []
  await w.clock.advance(MIN)
  expect([sync().stage, sync().mergeSha]).toEqual(['testing', '7b68b8940000aaaa']) // the result line's sha, not git's (1111…)
})

test('Fable 4: a script that died without a result: the worker\'s commands print one ending line; A5R records the checkout it finds and hands the sync back', opts(), async ($, on) => {
  expect(mergeWaitCommand('E:/s2/Saved/A5R/x-merge.ps1', 'E:/s2/Saved/A5R/x-merge.log')).toContain(`{ '${NO_RESULT}' }`)
  expect(mergeStartCommand('E:/s2/Saved/A5R/x-merge.ps1', 'E:/s2/Saved/A5R/x-merge.log')).toContain(`{ '${NO_RESULT}' }`)
  const { w, s, sync } = await mineAtT($, on, PROJ, '7b68b8940000 9f8e7d6c0000 aaaa1111') // killed after update-ref: the branch moved
  w.put(syncMergeLog(S2, s.id), '2026-10-06 14:46:00.000 rule=sync-merge start: checkout E:\\s2\r\n2026-10-06 14:47:00.000 rule=sync-merge refs/heads/HaiHuynh/20261005 moved 9f8e7d6c0000 -> 7b68b894\r\n')
  w.put(LOCKF, 'A5R sync merge sync-x pid 7001')
  w.machine.procs = []
  await workerEnds($, NO_RESULT)
  await w.clock.advance(MIN)
  expect(sync().stage).toBe('manual')
  const line = w.read(`${HF}/orchestrate.log`).split('\n').find(l => l.includes('| rule=sync-merge |')) ?? ''
  expect(line).toContain('note=no result from the merge script: HEAD 7b68b8940000, a merge on 9f8e7d6c0000 (the branch moved)')
  expect(line).toContain("; index.lock left, the script's own")
})

test('Fable 2 / 4: unit: the outcome from the log and the process; the end it makes; what a death left', () => {
  const merged = 'x rule=sync-merge A5R merge merged 7B68B894 (3 path(s) written)'
  expect(mergeOutcome(merged, true)).toEqual({ kind: 'merged', sha: '7b68b894', note: 'A5R merge merged 7B68B894 (3 path(s) written)' })
  expect(mergeOutcome('x rule=sync-merge start', true).kind).toBe('running')
  expect(mergeOutcome('x rule=sync-merge start', null).kind).toBe('running') // unread: wait, never taken for dead
  expect(mergeOutcome('x rule=sync-merge start', false).kind).toBe('died')
  expect(mergeOutcome(null, null).kind).toBe('none')
  expect(mergeOutcome(null, true).kind).toBe('running')
  expect(mergeOutcome('x rule=sync-merge A5R merge up-to-date abc (nothing written)', false).kind).toBe('refused')
  const G = { state: 'unknown' } as const
  expect(workerEndOf({ kind: 'merged', sha: 'abc1234', note: '' }, G, '', { kind: 'merged', sha: 'ffff000', buildLog: 'L', note: '' }).end).toEqual({ kind: 'merged', sha: 'abc1234', buildLog: 'L', note: '' })
  expect(workerEndOf({ kind: 'merged', sha: 'abc1234', note: '' }, G, '', { kind: 'abort', why: 'gave up', note: '' }).end?.kind).toBe('merged')
  expect(workerEndOf({ kind: 'died', procs: ['git'] }, G, 'gone', null)).toEqual({ end: { kind: 'abort', why: 'gone', note: 'gone' }, git: G, log: { note: 'gone', procs: ['git'] } })
  expect(workerEndOf({ kind: 'none' }, G, '', null)).toEqual({ end: null, git: G, log: null })
  expect(mergeOutcome('x rule=sync-merge A5R merge merged (3 path(s) written)', false).kind).toBe('refused') // a merged line without its sha is no merge
  expect(diedNote({ state: 'none' }, '9f8e7d6c0000', null)).toBe('no result from the merge script: HEAD still 9f8e7d6c0000; index.lock none')
  expect(diedNote({ state: 'unknown' }, 'a', { text: null, size: 104_000_000 })).toBe('no result from the merge script: HEAD unread; index.lock left, 104000000 bytes')
})

test('Fable 3: a live merge script keeps the merge step past the hard end, the sync does not expire under it, and its marked lock is never moved', opts(), async ($, on) => {
  expect(freezeStepOf('expired', null, null, true)).toBe('merging')
  expect(freezeStepOf('done', 'testing', null, true)).toBe('merging')
  const { w, s, sync } = await mineAtT($, on)
  mover(w)
  w.machine.procs = [SCRIPT_PROC(s.id)]
  w.put(LOCKF, `A5R sync merge ${s.id} pid 7001`, NOW)
  for (let n = 0; n < 50; n += 1) await w.clock.advance(MIN) // past the hard end (15:30)
  expect(sync().state).toBe('planned')
  expect(moves(w)).toEqual([])
  w.machine.procs = []
  await w.clock.advance(2 * MIN)
  expect(sync().state).toBe('expired')
})

test('Fable 3: unit: the mover leaves a lock whose marker names a live merge script, outside any sync too', opts(), async ($, on) => {
  const w = world(on)
  shared(w)
  mover(w)
  w.put(LOCKF, 'A5R sync merge sync-x pid 7001', NOW - 5 * MIN)
  w.machine.procs = [SCRIPT_PROC('sync-x')]
  await $.session.start(START)
  await w.clock.advance(3 * MIN)
  expect(moves(w)).toEqual([])
})
