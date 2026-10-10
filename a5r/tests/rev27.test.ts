import { expect, test } from 'claude-code/testing'
import { A5R, proofGap } from '../hooks/a5r.ts'
import { score, type AcceptInput } from '../hooks/accept.ts'
import { addsNotice, blankSession, isNoticeLine, writesNoticeToIntent, type SessionFile } from '../hooks/coord.ts'
import { CONFIG } from './config.fixture.ts'
import { ME, NOW, PROJ, opts, refused, world, type Rec } from './world.ts'

// Rev 27 (L-30, MEASURED 2026-10-09/10, lane talab-upgrade in bypass mode with an away window): A5R never asks and
// never waits at the action (A73); git that can discard work in the shared checkout is checked on facts (A74); shared
// config, recursive deletes and removed assertions run and are recorded for nghiệm thu, the rest refuse with an
// alternative (A75); the kit and notice guards refuse only what they protect (A76); a repository with no build is
// proven by its tests (A77).
const HF = 'E:/s2/Saved/A5R'
const S2 = 'E:/s2'
const ME8 = ME.slice(0, 8)
const START = { cwd: PROJ, surface: 'terminal', isInteractive: true } as never
const SID = (id8: string) => `${id8}-1111-4000-8000-000000000000`
const peer = (id8: string, o: Partial<SessionFile> = {}): string => JSON.stringify({ ...blankSession(SID(id8), `lane-${id8}`, `title ${id8}`, NOW), ...o })
const touch = (w: ReturnType<typeof world>, id8: string, paths: string[], lane = `lane-${id8}`) =>
  w.put(`${HF}/touch/${id8}.json`, JSON.stringify({ session: id8 === ME8 ? ME : SID(id8), id8, lane, paths, updatedAt: NOW }))
const TALAB = ['tools/TALab/build_topic_stage.py', 'tools/TALab/stages/patterns.py', 'tools/TALab/stages/walker_wall.json', 'tools/TALab/stages/README.md']
const TALAB_CMD = `git -C ${S2} checkout 55693182ad46 -- ${TALAB.join(' ')} && git -C ${S2} commit -m "TALab: restore the stage generator" -- ${TALAB.join(' ')}`
const bashRan = (w: ReturnType<typeof world>) => w.seen.filter(e => e.tool === 'Bash').length
const asks = (w: ReturnType<typeof world>) => (w.calls.ask ?? []).length
const shared = (w: ReturnType<typeof world>) => w.put(`${S2}/.git/HEAD`, 'ref: refs/heads/HaiHuynh/20261005')

// ---------- A74: the TALab case, end to end ----------
test('A74: the TALab case runs: checkout <ref> -- 4 clean paths and the commit, in bypass-like ask mode, nothing asked', opts('ask'), async ($, on) => {
  const w = world(on, { git: { 'status --porcelain': { stdout: '' } } })
  shared(w)
  await $.session.start(START)
  expect(refused(await $.tool.call({ tool: 'Bash', command: TALAB_CMD }))).toBeUndefined()
  expect([bashRan(w), asks(w)]).toEqual([1, 0])
  // The fact check is path-scoped (the hook's time budget): only the four paths are read.
  expect(w.runs.find(r => r.includes('status --porcelain'))).toBe(`git -C ${S2} status --porcelain=v1 -z --untracked-files=all -- ${TALAB.join(' ')}`)
})

test('A74: the same checkout over another session\'s uncommitted change is refused, naming the path and its owner', opts(), async ($, on) => {
  const w = world(on, { git: { 'status --porcelain': { stdout: ' M tools/TALab/stages/patterns.py\0' } } })
  shared(w)
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc', { heartbeatAt: NOW }))
  touch(w, 'cccccccc', ['tools/TALab/stages/patterns.py'], 'talab-walker')
  await $.session.start(START)
  const why = refused(await $.tool.call({ tool: 'Bash', command: TALAB_CMD }))
  expect(why).toContain("tools/TALab/stages/patterns.py (talab-walker's, session cccccccc)")
  expect(why).toContain('commit or move those changes first (their owner does), or run it in a worktree of your own')
  expect([bashRan(w), asks(w)]).toEqual([0, 0])
})

test('A74: changed only in this session\'s own paths → it runs', opts(), async ($, on) => {
  const w = world(on, { git: { 'status --porcelain': { stdout: ' M tools/TALab/stages/patterns.py\0' } } })
  shared(w)
  touch(w, ME8, ['tools/TALab/stages/patterns.py'])
  await $.session.start(START)
  expect(refused(await $.tool.call({ tool: 'Bash', command: TALAB_CMD }))).toBeUndefined()
})

test('A74: reset --hard on a dirty tree is refused (whole tree read); switch and checkout <branch> say use a worktree', opts(), async ($, on) => {
  const w = world(on, { git: { 'status --porcelain': { stdout: '?? Saved/notes.txt\0 M Source/S2/Foo.cpp\0' } } })
  shared(w)
  await $.session.start(START)
  const why = refused(await $.tool.call({ tool: 'Bash', command: `git -C ${S2} reset --hard` }))
  expect(why).toContain('Saved/notes.txt (no session claims it); Source/S2/Foo.cpp (no session claims it)')
  expect(w.runs.find(r => r.includes('status --porcelain'))).toBe(`git -C ${S2} status --porcelain=v1 -z --untracked-files=all --`)
  for (const c of [`git -C ${S2} switch main`, `git -C ${S2} checkout main`]) expect([c, refused(await $.tool.call({ tool: 'Bash', command: c }))?.includes('work in a worktree of your own')]).toEqual([c, true])
  expect(bashRan(w)).toBe(0)
})

// ---------- A73 ----------
const PROBES: { tool: string; [k: string]: unknown }[] = [
  { tool: 'Bash', command: `git -C ${S2} reset --hard` },
  { tool: 'Bash', command: 'git push --force origin HaiHuynh/x' },
  { tool: 'Bash', command: 'git push origin HEAD:main' },
  { tool: 'Bash', command: 'git add -A' },
  { tool: 'Bash', command: 'rm -rf E:/Projects/s2/Saved/Logs' },
  { tool: 'Write', file_path: `${PROJ}/Config/DefaultGame.ini`, content: '[x]' },
  { tool: 'Write', file_path: `${PROJ}/S2.uproject`, content: '{}' },
]
const answers = async ($: any, w: ReturnType<typeof world>) => {
  const out: (string | undefined)[] = []
  for (const p of PROBES) out.push(refused(await $.tool.call(p as never))?.replace(/\s+/g, ' '))
  return { out, asked: asks(w) }
}
for (const mode of ['ask', 'deny'] as const)
  test(`A73: ${mode} mode (and an away window refusing every dialog) gives the same answers; no gate opens a dialog`, opts(mode), async ($, on) => {
    const w = world(on, { git: { 'status --porcelain': { stdout: ' M Source/S2/Foo.cpp\0' } } })
    on('tool.call', { tool: 'AskUserQuestion' }, async () => ({ deny: 'The user is away until 07:00 (Ather autonomy window).' }))
    shared(w)
    await $.session.start(START)
    const { out, asked } = await answers($, w)
    expect(asked).toBe(0)
    expect(out.map(o => (o === undefined ? 'runs' : o.includes('→') ? 'refused with an alternative' : 'refused bare'))).toEqual([
      'refused with an alternative', // reset --hard over an unclaimed change (a fact)
      'refused with an alternative', // force push
      'refused with an alternative', // push to main
      'refused with an alternative', // git add -A
      'runs', // recursive delete: recorded
      'runs', // shared config: recorded
      'runs', // .uproject: recorded
    ])
    expect(out.every(o => !o || !/approv|dialog|nobody could/i.test(o))).toBe(true)
  })

// ---------- A75 ----------
test('A75: kept refusals each name the alternative the agent can carry out', opts(), async ($, on) => {
  const w = world(on)
  shared(w)
  await $.session.start(START)
  const cases: [string, string][] = [
    ['git push --force origin HaiHuynh/x', 'push to a new branch and open a PR'],
    ['git push origin HEAD:main', 'push your branch and open a PR'],
    ['git add .', 'stage exact paths'],
    ['git commit --no-verify -m x', 'fix what the hook reports'],
    ['GIT_LFS_SKIP_SMUDGE=1 git pull', 'git lfs pull'],
    [`git -C ${S2} sparse-checkout set Source`, 'worktree of your own'],
  ]
  for (const [c, alt] of cases) expect([c, refused(await $.tool.call({ tool: 'Bash', command: c }))?.includes(alt)]).toEqual([c, true])
  expect(refused(await $.tool.call({ tool: 'Write', file_path: `${PROJ}/Source/S2/Key.cpp`, content: `k = 'ghp_${'a'.repeat(36)}'` }))).toContain('environment variable')
  expect(bashRan(w)).toBe(0)
})

test('A75: a removed test assertion runs, is recorded, and nghiệm thu asks for its reason; shared config is named in the PR body', opts(), async ($, on) => {
  const w = world(on)
  shared(w)
  w.put(`${PROJ}/Source/S2/Tests/GlowTest.cpp`, 'TestTrue(a); TestEqual(b, 1);\n')
  await $.session.start(START)
  expect(refused(await $.tool.call({ tool: 'Edit', file_path: `${PROJ}/Source/S2/Tests/GlowTest.cpp`, old_string: 'TestTrue(a); TestEqual(b, 1);', new_string: 'TestTrue(a);' }))).toBeUndefined()
  const rec = JSON.parse(w.read(`${HF}/recorded/${ME8}.json`)) as { entries: Rec[] }
  expect(rec.entries.map(e => [e.kind, e.path])).toEqual([['tests', 'Source/S2/Tests/GlowTest.cpp']])
  // At nghiệm thu: the recorded removal, without a reason, is a rule 5 issue; shared config not in the body, rule 3.
  const input: AcceptInput = { slug: 'tail', branch: 'b', files: ['Source/S2/Tests/GlowTest.cpp', 'Config/DefaultGame.ini'], added: new Map(), prompt: '# t\n- Status: active\nChange `Source/` and `Config/` only.\n## Acceptance\n- A1: x. Proof: y.', progress: '| A1 | met | tests: 3 pass 0 fail |', findings: '', promptDiff: '', proof: null, body: 'Glow test tidy-up.', othersTouch: [], otherIntents: [], untrackedLeft: [], strayWorktrees: [], runningAgents: [], cfg: CONFIG, kitDirs: [], recorded: [{ kind: 'tests', path: 'Source/S2/Tests/GlowTest.cpp', at: NOW, lane: 'tail' }] }
  const s = score(input)
  expect(s.find(x => x.rule === 5)?.issues.map(i => i.what)).toEqual(['test assertions were removed (recorded, tail)'])
  expect(s.find(x => x.rule === 3)?.issues.map(i => `${i.file}: ${i.what}`)).toEqual(['Config/DefaultGame.ini: shared repository config changed'])
  const ok = score({ ...input, findings: 'Source/S2/Tests/GlowTest.cpp: the b check moved to GlowSpec', body: 'Glow tidy-up; Config/DefaultGame.ini gains the glow cvar.' })
  expect([ok.find(x => x.rule === 5)?.state, ok.find(x => x.rule === 3)?.state]).toEqual(['pass', 'pass'])
})

// ---------- A76 ----------
const KIT = 'C:/Users/hai.huynh/.claude/mods/a5r'
const PLACES = { KIT, HOME: 'C:/Users/hai.huynh', USERPROFILE: 'C:/Users/hai.huynh', TEMP: 'C:/Users/HAI~1.HUY/AppData/Local/Temp', LOCALAPPDATA: 'C:/Users/hai.huynh/AppData/Local' }
const ENV = { TEMP: PLACES.TEMP, LOCALAPPDATA: PLACES.LOCALAPPDATA, USERPROFILE: PLACES.USERPROFILE }

test('A76: unit: the kit guard refuses writes into the live kit only (not a read after cd, not other worktrees, not temp paths named a5r)', () => {
  const a5r = new A5R(CONFIG, PLACES)
  const pre = (c: string) => a5r.preShell(c, PROJ, ENV)?.key ?? null
  expect(pre(`cd ${KIT} && grep -n "approval" hooks/register.ts`)).toBeNull()
  expect(pre(`cd ${KIT} && git status && git log -3`)).toBeNull()
  expect(pre(`cd ${KIT} && rm hooks/x.ts`)).toBe('kit')
  expect(pre(`cd ${KIT}; sed -i s/a/b/ rules/config.json`)).toBe('kit')
  expect(pre('rm -rf "$TEMP/a5r-red18"')).toBeNull()
  expect(pre('rm -rf C:/Users/HAI~1.HUY/AppData/Local/Temp/a5r-red21')).toBeNull()
  expect(a5r.preEdit('D:/Projects/ather-mods-wt/a5r-rev27/a5r/hooks/x.ts', '', 'x', { root: 'D:/Projects/ather-mods-wt/a5r-rev27', rel: 'a5r/hooks/x.ts' })?.key ?? null).toBeNull()
  expect(a5r.preEdit(`${KIT}/hooks/x.ts`, '', 'x', { root: null, rel: null })?.key).toBe('kit')
})

test('A76: unit: the notice guard refuses only a line that is a notice, never prose quoting the prefix', () => {
  const notice = 'A5R · Sync main — cutoff: sync-lane merges origin/main at 15:30 → commit your own paths now'
  expect([isNoticeLine(notice), isNoticeLine(`> ${notice}`), isNoticeLine(`- ${notice}`)]).toEqual([true, true, true])
  const prose = ['| A6 | met | intent files never take an `A5R ·` line (refused by edit and by shell) |', 'The refusal reads "A5R · Editor — granted …" in the session.', 'Each notice starts with the prefix A5R · and a gate name.']
  expect(prose.map(isNoticeLine)).toEqual([false, false, false])
  expect(addsNotice(prose)).toBe(false)
  expect(writesNoticeToIntent(`echo "${prose[1]}" >> docs/intent/x/log.md`)).toBe(false)
  expect(writesNoticeToIntent(`echo "${notice}" >> docs/intent/x/log.md`)).toBe(true)
})

// ---------- A77 ----------
test('A77: unit: a repository with no build step is proven by passing tests; a build gate adds the build; the Unreal pack is unchanged', () => {
  const core = (evidence: Record<string, string>, gates: string[] = []) => ({ intent: 'a5r', role: '', pack: 'core', gates, evidence: Object.fromEntries(Object.entries(evidence).map(([k, s]) => [k, { state: s }])) })
  expect(proofGap(core({ tests: 'pass' }))).toBeNull() // closing a5r: tests 202/202 pass
  expect(proofGap(core({}))).toBe('passing tests')
  expect(proofGap(core({ tests: 'pass' }, ['npm run build: build', 'npm test: tests']))).toBe('a build that succeeded')
  expect(proofGap({ intent: 'x', role: '', evidence: {} })).toBe('PIE, or build and tests') // Unreal, no build: still asked
})

test('A77: /a5r accept on a core-pack intent with tests passed reads rule 2 met (no "still needs PIE, or build and tests")', opts(), async ($, on) => {
  const status = JSON.stringify({ role: '', pack: 'core', gates: [], tracked: { slug: 'core-x', stage: 'Prove', checklist: '1/1' }, evidence: { tests: { state: 'pass', detail: '202/202' } } })
  const w = world(on, { out: { 'mcp__ather-automata__status': status }, git: { 'diff --name-only': { stdout: 'src/a.ts\n' }, 'diff -U0': { stdout: '+++ b/src/a.ts\n+const a = 1\n' }, 'worktree list': { stdout: '' } } })
  w.put(`${PROJ}/docs/intent/core-x/prompt.md`, '# core-x\n- Status: active\nChange `src/` only.\n## Acceptance\n- A1: a. Proof: tests.')
  w.put(`${PROJ}/docs/intent/core-x/progress.md`, '| A1 | met | tests: 202 pass 0 fail |')
  await $.session.start(START)
  const reply = String((await $.command.run({ command: 'a5r', args: 'accept' } as never)).text)
  expect(reply).toContain('✓ 2 Study well, work well')
  expect(reply).not.toContain('PIE, or build and tests')
})
