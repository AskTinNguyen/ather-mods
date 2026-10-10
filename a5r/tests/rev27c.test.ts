import { expect, test } from 'claude-code/testing'
import { A5R } from '../hooks/a5r.ts'
import { blankSession, type SessionFile } from '../hooks/coord.ts'
import { gitPlace, walk } from '../hooks/gitshared.ts'
import { CONFIG } from './config.fixture.ts'
import { ME, NOW, PROJ, opts, refused, world } from './world.ts'

// Rev 27 follow-ups (0.15.1, from the re-review): a session's own stash comes back (stash pop/apply checked on the paths
// it holds); `git checkout <file>` is a path checkout; dotless top-level files are files; the kit guard reads redirect
// and tee targets and git's read-only sub-verbs; `cd ~` and --work-tree / --git-dir are followed.
const HF = 'E:/s2/Saved/A5R'
const S2 = 'E:/s2'
const START = { cwd: PROJ, surface: 'terminal', isInteractive: true } as never
const SID = (id8: string) => `${id8}-1111-4000-8000-000000000000`
const peer = (id8: string, o: Partial<SessionFile> = {}): string => JSON.stringify({ ...blankSession(SID(id8), `lane-${id8}`, `title ${id8}`, NOW), ...o })
const shared = (w: ReturnType<typeof world>) => w.put(`${S2}/.git/HEAD`, 'ref: refs/heads/HaiHuynh/20261005')
const bash = async ($: any, command: string) => refused(await $.tool.call({ tool: 'Bash', command }))

test('follow-up: stash push -- <paths> then stash pop runs when the stash\'s paths are clean (S2\'s s2-pie-perf-loop)', opts(), async ($, on) => {
  const w = world(on, { git: { 'stash show': { stdout: 'Config/DefaultEngine.ini\nSource/S2/Perf.cpp\n' }, 'status --porcelain': { stdout: '' } } })
  shared(w)
  await $.session.start(START)
  expect(await bash($, `git -C ${S2} stash push -- Config/DefaultEngine.ini Source/S2/Perf.cpp`)).toBeUndefined()
  expect(await bash($, `git -C ${S2} stash pop`)).toBeUndefined()
  expect(w.runs.find(r => r.includes('stash show'))).toBe(`git -C ${S2} stash show --name-only --include-untracked stash@{0}`)
  expect(w.runs.filter(r => r.includes('status --porcelain')).at(-1)).toBe(`git -C ${S2} status --porcelain=v1 -z --untracked-files=all -- Config/DefaultEngine.ini Source/S2/Perf.cpp`)
})

test('follow-up: stash apply over another session\'s change is refused naming it; an unreadable stash is refused', opts(), async ($, on) => {
  const w = world(on, { git: { 'stash show': { stdout: 'Source/S2/Perf.cpp\n' }, 'status --porcelain': { stdout: ' M Source/S2/Perf.cpp\0' } } })
  shared(w)
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc', { heartbeatAt: NOW }))
  w.put(`${HF}/touch/cccccccc.json`, JSON.stringify({ session: SID('cccccccc'), id8: 'cccccccc', lane: 'perf', paths: ['Source/S2/Perf.cpp'], updatedAt: NOW }))
  await $.session.start(START)
  expect(await bash($, `git -C ${S2} stash apply stash@{1}`)).toContain("Source/S2/Perf.cpp (perf's, session cccccccc)")
})

test('follow-up: stash pop of a stash that cannot be read is refused with the alternative', opts(), async ($, on) => {
  const w = world(on, { git: { 'stash show': { stdout: '', exitCode: 1 } } })
  shared(w)
  await $.session.start(START)
  expect(await bash($, `git -C ${S2} stash pop`)).toContain('name a stash that exists')
})

test('follow-up: git checkout <existing file> is a path checkout (fact check); checkout <branch> keeps the worktree alternative', opts(), async ($, on) => {
  const w = world(on, { git: { 'rev-parse --verify --quiet tools/a.py': { stdout: '', exitCode: 1 }, 'status --porcelain': { stdout: '' } } })
  shared(w)
  w.put(`${S2}/tools/a.py`, 'x = 1\n')
  await $.session.start(START)
  expect(await bash($, `git -C ${S2} checkout tools/a.py`)).toBeUndefined()
  expect(w.runs.filter(r => r.includes('status --porcelain')).at(-1)).toBe(`git -C ${S2} status --porcelain=v1 -z --untracked-files=no -- tools/a.py`)
  expect(await bash($, `git -C ${S2} checkout feature/x`)).toContain('work in a worktree of your own')
})

test('follow-up: a dotless top-level file (LICENSE) is a file; a top folder still needs exact paths', opts(), async ($, on) => {
  const w = world(on, { git: { 'status --porcelain': { stdout: '' } } })
  shared(w)
  w.put(`${S2}/LICENSE`, 'MIT\n')
  w.put(`${S2}/Source/S2/a.cpp`, 'int a;\n')
  await $.session.start(START)
  expect(await bash($, `git -C ${S2} checkout HEAD -- LICENSE`)).toBeUndefined()
  expect(await bash($, `git -C ${S2} checkout HEAD -- Source`)).toContain('a whole top folder')
})

test('follow-up: unit: after cd into the live kit, redirects and tee outside it and git\'s read-only sub-verbs run', () => {
  const KIT = 'D:/Projects/ather-mods/a5r'
  const a5r = new A5R(CONFIG, { KIT, HOME: 'C:/Users/hai.huynh', USERPROFILE: 'C:/Users/hai.huynh', TEMP: 'C:/Users/HAI~1.HUY/AppData/Local/Temp', LOCALAPPDATA: 'C:/Users/hai.huynh/AppData/Local' })
  const pre = (c: string) => a5r.preShell(c, PROJ, {})?.key ?? null
  for (const c of [`cd ${KIT} && git stash list`, `cd ${KIT} && git stash show -p`, `cd ${KIT} && grep -rn x hooks > C:/tmp/x.txt`, `cd ${KIT} && grep -rn x hooks | tee C:/tmp/x.txt`, `cd ${KIT} && git config --list`, `cd ${KIT} && git worktree list`, `cd ${KIT} && bun test 2>&1 | tail -5`])
    expect([c, pre(c)]).toEqual([c, null])
  for (const c of [`cd ${KIT} && echo x > hooks/a.ts`, `cd ${KIT} && echo x | tee hooks/a.ts`, `cd ${KIT} && git stash`, `cd ${KIT} && git config core.x y`])
    expect([c, pre(c)]).toEqual([c, 'kit'])
})

test('follow-up: unit: walk follows cd ~ (and a bare cd) to the home; gitPlace honours --work-tree and --git-dir', () => {
  const home = 'C:/Users/hai.huynh'
  expect(walk('cd ~ && git status', PROJ, home)[0]?.dir).toBe(home)
  expect(walk('cd ~/s2 && git status', PROJ, home)[0]?.dir).toBe(`${home}/s2`)
  expect(walk('cd && git status', PROJ, home)[0]?.dir).toBe(home)
  const seg = (c: string) => walk(c, PROJ, home)[0]!
  expect(gitPlace(seg('git --work-tree=E:/wt/x --git-dir=E:/wt/x/.git checkout -B main')).dir).toBe('E:/wt/x')
  expect(gitPlace(seg('git --git-dir=E:/s2/.git checkout -- a.py')).dir).toBe('E:/s2')
  expect(gitPlace(seg('git --work-tree E:/s2 checkout -- a.py')).args).toEqual(['checkout', '--', 'a.py'])
})

test('follow-up: --work-tree into a worktree of one\'s own runs; the same command on the shared checkout is refused', opts(), async ($, on) => {
  const w = world(on)
  shared(w)
  w.put('E:/wt/x/.git', 'gitdir: E:/s2/.git/worktrees/x')
  await $.session.start(START)
  expect(await bash($, 'git --work-tree=E:/wt/x checkout -B main origin/main')).toBeUndefined()
  expect(await bash($, `git --work-tree=${S2} checkout -B main origin/main`)).toContain('worktree')
})
