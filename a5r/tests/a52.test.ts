import { expect, test } from 'claude-code/testing'
import { prLinksOf } from '../hooks/accept.ts'
import { blankSession } from '../hooks/coord.ts'
import { A5RPANE, ME, NOW, PENDING, PROJ, find, opts, text, world } from './world.ts'

// A52 (MEASURED 2026-10-07 17:02): after the fact, filler-enemies-tech-support's PRs #32806, #32788 and #32791 were
// scored together as the shared checkout's own branch (661 commits ahead of origin/main), so rules 1 and 3 listed
// other lanes' paths and three false 🟥 were raised. Each PR is now scored on its own diff: repository from its URL,
// head/base/state from `gh pr view`, the diff from origin/<head> against origin/<base> (or a worktree holding the
// head), else `gh pr diff` (a merged PR); one section per PR on the card; a 🟥 only for a PR whose own score fails.
// A PR an old scorer raised an alert for is scored once more and that alert is withdrawn.
const HF = 'E:/s2/Saved/A5R'
const STATUS_TOOL = 'mcp__ather-automata__status'
const SLUG = 'filler'
const INTENT = `${PROJ}/docs/intent/${SLUG}`
const MIN = 60_000
const START = { cwd: PROJ, surface: 'terminal', isInteractive: true } as never
const URL = (n: number) => `https://github.com/sipherxyz/s2/pull/${n}`
const PROMPT = ['# Filler enemies', '- Rev: 1', '- Status: active', 'Change `Source/S2/Filler/` and `Content/S2/Filler/` only.', '## Acceptance', '- A1: the fillers stagger. Proof: PIE.'].join('\n')
const progress = (prs: string) => [`# ${SLUG}: Progress`, '', `- PR: ${prs}`, '', '## Acceptance', '| Item | Verdict | Evidence |', '| --- | --- | --- |', '| A1 | met | PIE: stagger plays |'].join('\n')
const OTHER = ['# MC loco stop triage', '- Rev: 1', '- Status: active', 'Change `tools/TALab/scenarios/` only.', '## Acceptance', '- A1: x. Proof: y.'].join('\n')
const status = (prs: string[] = []) => JSON.stringify({ me: 'hai', role: 'techart', tracked: { slug: SLUG, stage: 'Build', prs, directorCalls: [] }, evidence: { pie: { state: 'pass' }, editor: { state: 'pass' } } })
const view = (head: string, state: string) => ({ stdout: JSON.stringify({ headRefName: head, baseRefName: 'main', state }) })
const patch = (file: string, line: string) => `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -0,0 +1 @@\n+${line}\n`
// The session's checkout: a branch far ahead of main, with other lanes' paths. Scored as before, it fails rules 1 and 3.
const CHECKOUT = ['tools/TALab/scenarios/stop.json', '.agents/skills/explicit-commit-pr/SKILL.md', 'Config/Tags/Loco.ini', 'Source/S2/Filler/A.cpp'].join('\n')
const GIT = {
  'pr view 32806 -R sipherxyz/s2': view('feature/artifact-rig-filler-sections-3-4-5-7', 'OPEN'),
  'pr view 32788 -R sipherxyz/s2': view('feature/enemy-modules-mask-swap-breakable-parts-8e93291', 'OPEN'),
  'pr view 32791 -R sipherxyz/s2': view('feature/artifact-rig-poses-stagger-883d0b0', 'MERGED'),
  'remote -v': { stdout: 'origin\thttps://github.com/sipherxyz/s2.git (fetch)\norigin\thttps://github.com/sipherxyz/s2.git (push)\n' },
  'diff --name-only origin/main...origin/feature/artifact-rig-filler-sections-3-4-5-7': { stdout: 'Source/S2/Filler/Sections.cpp\nContent/S2/Filler/BP_Filler.uasset\n' },
  'diff -U0 --no-color origin/main...origin/feature/artifact-rig-filler-sections-3-4-5-7': { stdout: '+++ b/Source/S2/Filler/Sections.cpp\n+int Sections = 4;\n' },
  'diff --name-only origin/main...origin/feature/enemy-modules-mask-swap-breakable-parts-8e93291': { stdout: 'Source/S2/Filler/Mask.cpp\n' },
  'diff -U0 --no-color origin/main...origin/feature/enemy-modules-mask-swap-breakable-parts-8e93291': { stdout: '+++ b/Source/S2/Filler/Mask.cpp\n+int Mask = 1; // A5RTMP\n' },
  'pr diff 32791 -R sipherxyz/s2 --name-only': { stdout: 'Source/S2/Filler/Stagger.cpp\n' },
  'pr diff 32791 -R sipherxyz/s2 --color never': { stdout: patch('Source/S2/Filler/Stagger.cpp', 'int Stagger = 2;') },
  'diff --name-only': { stdout: `${CHECKOUT}\n` }, // origin/main...HEAD: the checkout, never read after the fact any more
  'diff -U0': { stdout: '+++ b/tools/TALab/scenarios/stop.json\n+{}\n' },
  'worktree list': { stdout: '' },
}
const PRS = `${URL(32806)}, ${URL(32788)}, ${URL(32791)}`
const minutes = async (w: ReturnType<typeof world>, n: number) => {
  for (let i = 0; i < n; i += 1) await w.clock.advance(MIN)
}
const pendingPr = (w: ReturnType<typeof world>) => w.read(PENDING).split('\n').filter(l => l.includes('PR #'))
const setup = (w: ReturnType<typeof world>, prs: string) => {
  w.put(PENDING, '')
  w.put(`${INTENT}/prompt.md`, PROMPT)
  w.put(`${INTENT}/progress.md`, progress(prs))
  w.put(`${PROJ}/docs/intent/mc-loco-stop-triage/prompt.md`, OTHER)
}

test('A52: unit: each PR link keeps its repository; a bare #n has none', () => {
  expect(prLinksOf(`- PR: ${URL(32806)}, sipherxyz/s2#32788, #812\n## Steps\n- PR: #999`, '')).toEqual([
    { n: 32806, repo: 'sipherxyz/s2' },
    { n: 32788, repo: 'sipherxyz/s2' },
    { n: 812, repo: null },
  ])
})

test('A52: three PRs on the line, the session far ahead of main: each PR scored on its own files, a merged one from gh pr diff, one 🟥 for the one that fails', opts(), async ($, on) => {
  const w = world(on, { out: { [STATUS_TOOL]: status() }, git: GIT })
  setup(w, 'none yet')
  await $.session.start(START)
  await minutes(w, 6) // the first read records the line as it is
  w.put(`${INTENT}/progress.md`, progress(PRS))
  await minutes(w, 5)
  const tree = await $.ui.render(A5RPANE as never)
  expect(text(find(tree, 'hai-accept-head'))).toContain(`${SLUG} · PR #32806, #32788, #32791 · scored after the fact`)
  // One section per PR, each with its own verdict, head, state and file count.
  expect(text(find(tree, 'hai-accept-pr-32806-head'))).toBe('PR #32806● 5 of 5 metfeature/artifact-rig-filler-sections-3-4-5-7 → main · open · 2 files, read from local branches')
  expect(text(find(tree, 'hai-accept-pr-32788-head'))).toBe('PR #32788● 1 of 5 not metfeature/enemy-modules-mask-swap-breakable-parts-8e93291 → main · open · 1 files, read from local branches')
  expect(text(find(tree, 'hai-accept-pr-32788-4'))).toContain('Source/S2/Filler/Mask.cpp: a debug leftover')
  expect(text(find(tree, 'hai-accept-pr-32791-head'))).toBe('PR #32791● 5 of 5 metfeature/artifact-rig-poses-stagger-883d0b0 → main · merged · 1 files, read from its diff on GitHub')
  // Nothing of the session's checkout: no other lane's path anywhere on the card, and its range was never diffed after the fact.
  for (const p of ['tools/TALab/scenarios/', '.agents/skills/', 'Config/Tags/']) expect(text(find(tree, 'hai-accept'))).not.toContain(p)
  expect(w.runs.filter(r => / diff --name-only origin\/main\.\.\.HEAD$/.test(r))).toEqual([])
  // A 🟥 only for #32788, the one whose own score fails.
  expect(pendingPr(w).length).toBe(1)
  expect(pendingPr(w)[0]).toContain('PR #32788 (intent filler) was opened without A5R acceptance and fails 1 of 5 (4 Keep it clean)')
  expect(w.read(`${HF}/alerts/pr2-32788.json`)).toContain('"scorer":2')
  for (const n of [32806, 32791]) expect(w.read(`${HF}/alerts/pr2-${n}.json`)).toBe('')
  // Scored once: later ticks do not ask GitHub again.
  const views = () => w.runs.filter(r => r.includes('pr view')).length
  const before = views()
  await minutes(w, 11)
  expect([views(), pendingPr(w).length]).toEqual([before, 1])
})

test('A52: a PR the old scorer raised a 🟥 for is scored once more on its own diff and that alert is withdrawn', opts(), async ($, on) => {
  const w = world(on, { out: { [STATUS_TOOL]: status() }, git: GIT })
  setup(w, URL(32806))
  // Before 0.12.3: this session had scored #32806 as its checkout (no scorer in its file) and claimed the alert.
  const id8 = ME.slice(0, 8)
  w.put(`${HF}/editor/${id8}.json`, JSON.stringify({ ...blankSession(ME, 'filler', 'Filler', NOW), prsKnown: [32806], prBaseline: [SLUG] }))
  w.put(`${HF}/alerts/pr-32806.json`, JSON.stringify({ by: id8, at: 1 }))
  w.put(PENDING, `- [ ] 2026-10-07 17:02 · Filler · PR #32806 (intent filler) was opened without A5R acceptance and fails 2 of 5 (1 Love the project, love your fellow sessions; 3 Unity and discipline): fix it on its branch before it merges, or let it merge as it is? · default: hold the merge until the branch scores 5 of 5\n`)
  await $.session.start(START)
  await minutes(w, 6)
  const tree = await $.ui.render(A5RPANE as never)
  expect(text(find(tree, 'hai-accept-pr-32806-head'))).toContain('PR #32806● 5 of 5 met')
  // The old alert is withdrawn: its file says so, its PENDING line is ticked with why; no new 🟥 (the PR passes).
  expect(JSON.parse(w.read(`${HF}/alerts/pr-32806.json`))).toMatchObject({ withdrawn: true, scorer: 2 })
  const line = pendingPr(w)
  expect(line.length).toBe(1)
  expect(line[0]?.startsWith('- [x]')).toBe(true)
  expect(line[0]).toContain('withdrawn')
  expect(w.read(`${HF}/alerts/pr2-32806.json`)).toBe('')
  // This session's file records the scorer; the PR is not scored a third time.
  expect(JSON.parse(w.read(`${HF}/editor/${id8}.json`)).prScorer).toBe(2)
  const views = () => w.runs.filter(r => r.includes('pr view 32806')).length
  expect(views()).toBe(1)
  await minutes(w, 11)
  expect(views()).toBe(1)
})

test('A52: GitHub cannot be asked: the PR reads "not scored" with why, no 🟥, and it is tried again later', opts(), async ($, on) => {
  const git = { ...GIT, 'pr view 32806 -R sipherxyz/s2': { stdout: '', exitCode: 1 } }
  const w = world(on, { out: { [STATUS_TOOL]: status() }, git })
  setup(w, 'none yet')
  await $.session.start(START)
  await minutes(w, 6)
  w.put(`${INTENT}/progress.md`, progress(URL(32806)))
  await minutes(w, 5)
  const tree = await $.ui.render(A5RPANE as never)
  expect(text(find(tree, 'hai-accept-pr-32806-head'))).toContain('PR #32806● not scorednot scored: gh pr view exited 1')
  expect(pendingPr(w)).toEqual([])
  const views = () => w.runs.filter(r => r.includes('pr view 32806')).length
  const before = views()
  await minutes(w, 6)
  expect(views()).toBeGreaterThan(before)
})
