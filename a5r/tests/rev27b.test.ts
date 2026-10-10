import { expect, test } from 'claude-code/testing'
import { A5R } from '../hooks/a5r.ts'
import { score, type AcceptInput } from '../hooks/accept.ts'
import { blankSession, type SessionFile } from '../hooks/coord.ts'
import { classifyGit } from '../hooks/gitshared.ts'
import { CONFIG } from './config.fixture.ts'
import { ME, NOW, PROJ, opts, refused, world, type Rec } from './world.ts'

// Rev 27, after the adversary review (8 CONFIRMED issues): discards with no paths or a top folder refused with exact
// alternatives (a whole-tree status takes 36-82 s on S2); clean -x/-X refused; every discarding git form covered; the
// folder each segment runs in tracked; another live session's claim wins over this one's; global config and p4
// obliterate refused where they break things, other records surfaced at nghiệm thu; dialogs really counted; reads and
// tests after a cd into the kit allowed.
const HF = 'E:/s2/Saved/A5R'
const S2 = 'E:/s2'
const ME8 = ME.slice(0, 8)
const START = { cwd: PROJ, surface: 'terminal', isInteractive: true } as never
const SID = (id8: string) => `${id8}-1111-4000-8000-000000000000`
const peer = (id8: string, o: Partial<SessionFile> = {}): string => JSON.stringify({ ...blankSession(SID(id8), `lane-${id8}`, `title ${id8}`, NOW), ...o })
const touch = (w: ReturnType<typeof world>, id8: string, paths: string[], lane = `lane-${id8}`) =>
  w.put(`${HF}/touch/${id8}.json`, JSON.stringify({ session: id8 === ME8 ? ME : SID(id8), id8, lane, paths, updatedAt: NOW }))
const shared = (w: ReturnType<typeof world>) => w.put(`${S2}/.git/HEAD`, 'ref: refs/heads/HaiHuynh/20261005')
const statusRuns = (w: ReturnType<typeof world>) => w.runs.filter(r => r.includes('status --porcelain'))
const bash = async ($: any, command: string) => refused(await $.tool.call({ tool: 'Bash', command }))

// ---------- 1, 2, 3: every discarding form, refused with an exact alternative or checked on exact paths ----------
test('review 1: discards with no paths, `.` or a top folder are refused with the same command on exact paths; no whole-tree status', opts(), async ($, on) => {
  const w = world(on, { git: { 'status --porcelain': { stdout: '' } } })
  shared(w)
  await $.session.start(START)
  const cases: [string, string][] = [
    [`git -C ${S2} reset --hard`, 'use git checkout <ref> -- <paths>'],
    [`git -C ${S2} stash`, 'git stash push -- <paths>'],
    [`git -C ${S2} clean -fd`, 'git clean -f -- <paths>'],
    [`git -C ${S2} checkout .`, 'git checkout <ref> -- <paths>'],
    [`git -C ${S2} restore .`, 'git restore -- <paths>'],
    [`git -C ${S2} checkout HEAD -- Source`, 'git checkout <ref> -- <paths>'],
    [`git -C ${S2} checkout HEAD -- $files`, 'git checkout <ref> -- <paths>'],
  ]
  for (const [c, alt] of cases) expect([c, (await bash($, c))?.includes(alt)]).toEqual([c, true])
  expect(statusRuns(w)).toEqual([])
})

test('review 1: path-scoped checks read untracked files only for clean', opts(), async ($, on) => {
  const w = world(on, { git: { 'status --porcelain': { stdout: '' } } })
  shared(w)
  await $.session.start(START)
  for (const c of [`git -C ${S2} checkout HEAD -- tools/TALab/x.py`, `git -C ${S2} restore tools/TALab/x.py`, `git -C ${S2} stash push -- tools/TALab/x.py`, `git -C ${S2} clean -f -- tools/TALab/tmp.txt`])
    expect([c, await bash($, c)]).toEqual([c, undefined])
  expect(statusRuns(w).map(r => /--untracked-files=(\w+)/.exec(r)?.[1])).toEqual(['no', 'no', 'no', 'all'])
})

test('review 2: git clean -x / -X / -fdx in the shared checkout is refused (Saved/, Intermediate/, Binaries/ are ignored, not unused)', opts(), async ($, on) => {
  const w = world(on, { git: { 'status --porcelain': { stdout: '' } } })
  shared(w)
  await $.session.start(START)
  for (const c of [`git -C ${S2} clean -fdx`, `git -C ${S2} clean -fX`, `git -C ${S2} clean -f -x -- Saved/`]) expect([c, (await bash($, c))?.includes('without -x/-X')]).toEqual([c, true])
  expect(w.seen.filter(e => e.tool === 'Bash').length).toBe(0)
})

test('review 3: unit: every discarding or tree-moving git form has an act', () => {
  const act = (c: string) => {
    const a = classifyGit(c.split(' ').slice(1))
    return a ? a.kind : null
  }
  expect({
    'git rm -r tools/TALab': act('git rm -r tools/TALab'), 'git rm -rf tools/x.py': act('git rm -rf tools/x.py'), 'git rm --cached a.py': act('git rm --cached a.py'),
    'git clean --force -d': act('git clean --force -d'), 'git clean -d --force': act('git clean -d --force'), 'git clean -n': act('git clean -n'),
    'git checkout -b feat origin/main': act('git checkout -b feat origin/main'), 'git checkout -B main origin/main': act('git checkout -B main origin/main'), 'git switch -c feat': act('git switch -c feat'),
    'git apply -R p.diff': act('git apply -R p.diff'), 'git apply --reverse p.diff': act('git apply --reverse p.diff'), 'git apply --check -R p.diff': act('git apply --check -R p.diff'),
    'git worktree remove --force E:/wt/x': act('git worktree remove --force E:/wt/x'), 'git worktree remove E:/wt/x': act('git worktree remove E:/wt/x'),
    'git branch -D other': act('git branch -D other'), 'git branch -d other': act('git branch -d other'), 'git submodule update --init --force': act('git submodule update --init --force'),
    'git stash pop': act('git stash pop'), 'git stash drop': act('git stash drop'), 'git stash list': act('git stash list'), 'git restore --staged a.py': act('git restore --staged a.py'),
  }).toEqual({
    'git rm -r tools/TALab': 'check', 'git rm -rf tools/x.py': 'check', 'git rm --cached a.py': null,
    'git clean --force -d': 'check', 'git clean -d --force': 'check', 'git clean -n': null,
    'git checkout -b feat origin/main': 'refuse', 'git checkout -B main origin/main': 'refuse', 'git switch -c feat': 'refuse',
    'git apply -R p.diff': 'refuse', 'git apply --reverse p.diff': 'refuse', 'git apply --check -R p.diff': null,
    'git worktree remove --force E:/wt/x': 'refuse', 'git worktree remove E:/wt/x': null,
    'git branch -D other': 'refuse', 'git branch -d other': null, 'git submodule update --init --force': 'refuse',
    'git stash pop': 'refuse', 'git stash drop': 'stash-drop', 'git stash list': null, 'git restore --staged a.py': null,
  })
})

test('review 3: in the shared checkout git rm -rf over another session\'s change and checkout -B main are refused; in a worktree of your own they run', opts(), async ($, on) => {
  const w = world(on, { git: { 'status --porcelain': { stdout: ' M tools/TALab/stages/patterns.py\0' } } })
  shared(w)
  w.put('E:/wt/x/.git', 'gitdir: E:/s2/.git/worktrees/x')
  await $.session.start(START)
  expect(await bash($, `git -C ${S2} rm -rf tools/TALab`)).toContain('tools/TALab/stages/patterns.py (no session claims it)')
  expect(await bash($, `git -C ${S2} checkout -B main origin/main`)).toContain('worktree')
  expect(await bash($, `git -C ${S2} branch -D HaiHuynh/other`)).toContain('git branch -d <name>')
  expect(await bash($, 'git -C E:/wt/x checkout -B main origin/main')).toBeUndefined()
  expect(await bash($, 'git -C E:/wt/x clean -fdx')).toBeUndefined()
})

// ---------- 4: the folder each segment runs in ----------
test('review 4: cd into a subfolder, then checkout -- a relative path: the status reads the repo-relative path and refuses over another session\'s change', opts(), async ($, on) => {
  const w = world(on, { git: { 'status --porcelain': { stdout: ' M tools/TALab/stages/patterns.py\0' } } })
  shared(w)
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc', { heartbeatAt: NOW }))
  touch(w, 'cccccccc', ['tools/TALab/stages/patterns.py'], 'talab-walker')
  await $.session.start(START)
  expect(await bash($, `cd ${S2}/tools/TALab && git checkout -- stages/patterns.py`)).toContain("tools/TALab/stages/patterns.py (talab-walker's, session cccccccc)")
  expect(statusRuns(w)[0]).toBe(`git -C ${S2} status --porcelain=v1 -z --untracked-files=no -- tools/TALab/stages/patterns.py`)
  expect(await bash($, `pushd ${S2}/tools && popd && git -C ${S2} checkout -- tools/TALab/stages/patterns.py`)).toContain('talab-walker')
})

// ---------- 5: another live session's claim wins; commits prune the touch set ----------
test('review 5: a path this session touched that another live session also claims and changed is refused, naming both', opts(), async ($, on) => {
  const w = world(on, { git: { 'status --porcelain': { stdout: ' M tools/TALab/stages/patterns.py\0' } } })
  shared(w)
  touch(w, ME8, ['tools/TALab/stages/patterns.py'])
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc', { heartbeatAt: NOW }))
  touch(w, 'cccccccc', ['tools/TALab/stages/patterns.py'], 'other')
  await $.session.start(START)
  expect(await bash($, `git -C ${S2} checkout 5569 -- tools/TALab/stages/patterns.py`)).toContain("tools/TALab/stages/patterns.py (other's, session cccccccc; this session touched it too)")
})

test('review 5: after this session commits, committed paths leave its touch set', opts(), async ($, on) => {
  const w = world(on, { git: { 'status --porcelain': { stdout: ' M tools/b.py\0' } } })
  shared(w)
  touch(w, ME8, ['tools/a.py', 'tools/b.py'])
  await $.session.start(START)
  expect(await bash($, `git -C ${S2} commit -m "a" -- tools/a.py`)).toBeUndefined()
  expect((JSON.parse(w.read(`${HF}/touch/${ME8}.json`)) as { paths: string[] }).paths).toEqual(['tools/b.py'])
})

// ---------- 6: global config, p4, and every record at nghiệm thu ----------
test('review 6: global git keys that break every repository and p4 obliterate are refused with an alternative; others run and are recorded', opts(), async ($, on) => {
  const w = world(on)
  shared(w)
  await $.session.start(START)
  for (const c of ['git config --global credential.helper ""', 'git config --global lfs.url http://x', 'git config --global core.autocrlf true', 'git config --global core.hooksPath x', 'git config --global filter.lfs.smudge x'])
    expect([c, (await bash($, c))?.includes('git config --local')]).toEqual([c, true])
  expect(await bash($, 'p4 obliterate -y //depot/x/...')).toContain('p4 delete')
  expect(await bash($, 'git config --global user.name Hai')).toBeUndefined()
  expect(await bash($, 'p4 revert //depot/x/a.txt')).toBeUndefined()
  const rec = (JSON.parse(w.read(`${HF}/recorded/${ME8}.json`)) as { entries: Rec[] }).entries
  expect(rec.map(e => [e.kind, e.target])).toEqual([['git-config-global', 'user.name'], ['p4-destructive', '//depot/x/a.txt']])
})

test('review 6: every record kind surfaces at nghiệm thu (rule 5) until progress.md or findings.md names it', () => {
  const base: AcceptInput = { slug: 'tail', branch: 'b', files: ['Source/S2/Foo.cpp'], added: new Map(), prompt: '# t\n- Status: active\nChange `Source/` only.\n## Acceptance\n- A1: x. Proof: y.', progress: '| A1 | met | tests: 3 pass 0 fail |', findings: '', promptDiff: '', proof: null, body: 'x', othersTouch: [], otherIntents: [], untrackedLeft: [], strayWorktrees: [], runningAgents: [], cfg: CONFIG, kitDirs: [],
    recorded: [
      { kind: 'git-config-global', path: 'git config --global user.name Hai', target: 'user.name', at: NOW, lane: 'tail', mine: true },
      { kind: 'delete', path: 'rm -rf E:/Projects/s2/Content/X', target: 'E:/Projects/s2/Content/X', at: NOW, lane: 'tail', mine: true },
      { kind: 'p4-destructive', path: 'p4 revert //depot/x', target: '//depot/x', at: NOW, lane: 'tail', mine: true },
      { kind: 'shared:settings.json', path: 'C:/Users/hai.huynh/.claude/settings.json', at: NOW, lane: 'tail', mine: true },
      { kind: 'delete', path: 'rm -rf E:/other', target: 'E:/other', at: NOW, lane: 'someone-else', mine: false },
    ] }
  const r5 = score(base).find(s => s.rule === 5)?.issues.map(i => i.what.replace(/\d\d:\d\d/, 'HH:MM')) ?? []
  expect(r5).toEqual([
    'a global git config change ran at HH:MM (tail): user.name',
    'a recursive delete ran at HH:MM (tail): E:/Projects/s2/Content/X',
    'a Perforce revert or delete ran at HH:MM (tail): //depot/x',
    'a shared config edit ran at HH:MM (tail): C:/Users/hai.huynh/.claude/settings.json',
  ])
  const ok = score({ ...base, findings: 'user.name set for the build bot; E:/Projects/s2/Content/X was a stale export; //depot/x reverted on purpose; C:/Users/hai.huynh/.claude/settings.json gains the hook' })
  expect(ok.find(s => s.rule === 5)?.state).toBe('pass')
})

// ---------- 7: dialogs really counted; the real temp delete ----------
test('review 7: the dialog counter is real (an AskUserQuestion is counted, answered or not)', opts(), async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'Run it?', options: [] }] } as never)
  expect((w.calls.ask ?? []).length).toBe(1)
})

test('review 7: the real refusal (rm -rf of a shell variable, live kit layout) now runs and is recorded', opts(), async ($, on) => {
  const live = new A5R(CONFIG, { KIT: 'D:/Projects/ather-mods/a5r', HOME: 'C:/Users/hai.huynh', USERPROFILE: 'C:/Users/hai.huynh', TEMP: 'C:/Users/HAI~1.HUY/AppData/Local/Temp', LOCALAPPDATA: 'C:/Users/hai.huynh/AppData/Local' })
  const cmd = 'S="C:/Users/HAI~1.HUY/AppData/Local/Temp/claude/x/scratchpad/red18"; rm -rf "$S"'
  expect(live.preShell(cmd, PROJ, { TEMP: 'C:/Users/HAI~1.HUY/AppData/Local/Temp' })?.key).toBe('delete') // 0.14.3 asked here ("Recursive delete outside the temp folders")
  expect(live.preShell('rm -rf "$TEMP/a5r-red18"', PROJ, { TEMP: 'C:/Users/HAI~1.HUY/AppData/Local/Temp' })).toBeNull()
  const w = world(on)
  await $.session.start(START)
  expect(await bash($, cmd)).toBeUndefined()
  expect(w.read(`${HF}/recorded/${ME8}.json`)).toContain('rm -rf')
  expect((w.calls.ask ?? []).length).toBe(0)
})

// ---------- 8: after a cd into the kit, reads, tests and builds run ----------
test('review 8: unit: after cd into the live kit, tests, type checks and pushd/popd run; only file writes are refused', () => {
  const KIT = 'D:/Projects/ather-mods/a5r'
  const a5r = new A5R(CONFIG, { KIT, HOME: 'C:/Users/hai.huynh', USERPROFILE: 'C:/Users/hai.huynh', TEMP: 'C:/Users/HAI~1.HUY/AppData/Local/Temp', LOCALAPPDATA: 'C:/Users/hai.huynh/AppData/Local' })
  const pre = (c: string) => a5r.preShell(c, PROJ, {})?.key ?? null
  for (const c of [`cd ${KIT} && bun test`, `cd ${KIT} && npx tsc --noEmit`, `cd ${KIT} && claude plugin test .`, `pushd ${KIT}; popd; rm x`, `cd ${KIT} && node --test tests/`, `cd ${KIT} && grep -rn x hooks > /dev/null`])
    expect([c, pre(c)]).toEqual([c, null])
  for (const c of [`cd ${KIT} && npm install`, `cd ${KIT} && echo x > hooks/a.ts`, `cd ${KIT} && git checkout -- hooks/a.ts`, `cd ${KIT} && mv a b`])
    expect([c, pre(c)]).toEqual([c, 'kit'])
})
