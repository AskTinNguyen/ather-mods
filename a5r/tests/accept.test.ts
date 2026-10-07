import { expect, test } from 'claude-code/testing'
import { acceptText, acceptanceIds, closesIntent, inScope, isPrCommand, namedPaths, progressRows, score, type AcceptInput } from '../hooks/accept.ts'
import { CONFIG } from './config.fixture.ts'

// A18: the five rules scored over a branch (pure), one input that passes and one change per rule that fails it.
const PROMPT = [
  '# Tail VFX',
  '- Rev: 2',
  '## Goal',
  'Change `Source/S2/Tail/` and `Content/S2/VFX/NS_Tail*.uasset`, see `docs/standards/x.md`; machine path `E:/Projects/s2/Saved/x` is not a repo path.',
  '## Acceptance',
  '- A1: the tail glows. Proof: PIE.',
  '- A2 (rev 2): the trail fades. Proof: PIE.',
].join('\n')
const PROGRESS = ['| Item | Verdict | Evidence |', '| --- | --- | --- |', '| A1 | met | PIE 2026-10-07: glow visible (capture 1a2b) |', '| A2 | met | PIE: fade measured 0.4 s |'].join('\n')
const base = (o: Partial<AcceptInput> = {}): AcceptInput => ({
  slug: 'tail-vfx',
  branch: 'HaiHuynh/tail-vfx',
  files: ['Source/S2/Tail/Glow.cpp', 'Content/S2/VFX/NS_TailTrail.uasset', 'docs/intent/tail-vfx/progress.md'],
  added: new Map([['Source/S2/Tail/Glow.cpp', ['float Glow = 1.f;']]]),
  prompt: PROMPT,
  progress: PROGRESS,
  findings: '',
  promptDiff: '',
  proof: { intent: 'tail-vfx', role: 'techart', evidence: { pie: { state: 'pass' }, editor: { state: 'pass' } } },
  body: '## Summary\nTail glow.\n## Verified\nPIE ✓, Editor check ✓',
  othersTouch: [],
  otherIntents: [],
  untrackedLeft: [],
  strayWorktrees: [],
  runningAgents: [],
  cfg: CONFIG,
  ...o,
})
const states = (x: AcceptInput) => score(x).map(s => s.state)

test('A18: a clean branch passes all five rules; the intent\'s named paths are its backticked repo paths plus its folder', () => {
  expect(states(base())).toEqual(['pass', 'pass', 'pass', 'pass', 'pass'])
  expect(namedPaths(PROMPT, 'tail-vfx')).toEqual(['docs/intent/tail-vfx/', 'Source/S2/Tail/', 'Content/S2/VFX/NS_Tail*.uasset', 'docs/standards/x.md'])
  expect(inScope('Content/S2/VFX/NS_TailTrail.uasset', namedPaths(PROMPT, 'tail-vfx'))).toBe(true)
  expect(inScope('Content/S2/VFX/NS_Other.uasset', namedPaths(PROMPT, 'tail-vfx'))).toBe(false)
  expect(acceptanceIds(PROMPT)).toEqual(['A1', 'A2'])
  expect(progressRows(PROGRESS).get('A2')).toEqual({ verdict: 'met', evidence: 'PIE: fade measured 0.4 s' })
})

test('A18 rule 1: another live session\'s file, another intent\'s path, or a PR from main fails it', () => {
  expect(score(base({ othersTouch: [{ lane: 'loco', paths: ['Source/S2/Tail/Glow.cpp'] }] }))[0]?.line).toBe('Source/S2/Tail/Glow.cpp: loco is editing it too (its touch file)')
  expect(states(base({ files: ['Source/S2/Loco/Gait.cpp'], findings: 'Source/S2/Loco/Gait.cpp touched for the trail', otherIntents: [{ slug: 'loco', names: ['Source/S2/Loco/'] }] }))[0]).toBe('fail')
  expect(score(base({ branch: 'main' }))[0]?.state).toBe('fail')
})

test('A18 rule 2: an open row, a met row without evidence, an incomplete proof, an unlisted TODO each fail it', () => {
  expect(score(base({ progress: PROGRESS.replace('| A2 | met |', '| A2 | open |') }))[1]?.line).toBe('docs/intent/tail-vfx/progress.md: A2 is open')
  expect(score(base({ progress: PROGRESS.replace('| PIE: fade measured 0.4 s |', '| |') }))[1]?.line).toContain('A2 is met without evidence')
  expect(score(base({ proof: { intent: 'tail-vfx', role: 'techart', evidence: { pie: { state: 'pass' } } } }))[1]?.line).toContain('still needs Editor check')
  expect(score(base({ added: new Map([['Source/S2/Tail/Glow.cpp', ['// TODO fade curve']]]) }))[1]?.state).toBe('fail')
  expect(score(base({ added: new Map([['Source/S2/Tail/Glow.cpp', ['// TODO fade curve']]]), findings: '## F-2 Glow.cpp fade curve TODO' }))[1]?.state).toBe('pass')
  expect(score(base({ slug: null }))[1]?.state).toBe('na')
})

test('A18 rule 3: a file outside the named paths fails it unless progress or findings explain it; without an intent, shared config needs a word', () => {
  expect(score(base({ files: ['Source/S2/Combat/Hit.cpp'] }))[2]?.line).toBe('Source/S2/Combat/Hit.cpp: outside the paths the intent names')
  expect(score(base({ files: ['Source/S2/Combat/Hit.cpp'], progress: `${PROGRESS}\n- S3: Hit.cpp needed the glow hook` }))[2]?.state).toBe('pass')
  expect(score(base({ slug: null, files: ['Config/DefaultGame.ini'] }))[2]?.state).toBe('fail')
  expect(score(base({ slug: null, files: ['Config/DefaultGame.ini'], body: 'Config/DefaultGame.ini: the glow cvar' }))[2]?.state).toBe('pass')
})

test('A18 rule 4: debug leftovers, secrets, untracked files, a stray worktree or a running agent fail it', () => {
  expect(score(base({ added: new Map([['Source/S2/Tail/Glow.cpp', ['int x = 2; // A5RTMP']]]) }))[3]?.line).toContain('a debug leftover')
  expect(score(base({ added: new Map([['Source/S2/Tail/Glow.cpp', ['int x = 2; // A5TMP']]]) }))[3]?.line).toContain('a debug leftover') // A48: the old tag stays forbidden
  expect(score(base({ added: new Map([['docs/notes.md', ['use console.log( to trace']]]) }))[3]?.state).toBe('pass') // docs may name it
  expect(score(base({ added: new Map([['Source/S2/Tail/Key.cpp', [`k = 'ghp_${'a'.repeat(36)}'`]]]) }))[3]?.line).toContain('a secret')
  expect(score(base({ untrackedLeft: ['Source/S2/Tail/New.cpp'] }))[3]?.state).toBe('fail')
  expect(score(base({ strayWorktrees: ['E:/wt/tail-2'] }))[3]?.state).toBe('fail')
  expect(score(base({ runningAgents: ['Explore: tail search'] }))[3]?.state).toBe('fail')
})

test('A18 rule 5: a PR body claiming what Ather has not read, a met row whose evidence says not done, acceptance rewritten without a rev', () => {
  expect(score(base({ body: '## Verified\nPIE ✓, build ✓, Editor check ✓' }))[4]?.line).toContain("claims build")
  expect(score(base({ progress: PROGRESS.replace('PIE: fade measured 0.4 s', 'chưa: PIE not run') }))[4]?.line).toContain('A2 is met but its evidence says it is not done')
  const rewrite = '--- a/docs/intent/tail-vfx/prompt.md\n+++ b/docs/intent/tail-vfx/prompt.md\n-- A2 (rev 2): the trail fades. Proof: PIE.\n+- A2 (rev 2): the trail exists.'
  expect(score(base({ promptDiff: rewrite }))[4]?.state).toBe('fail')
  expect(score(base({ promptDiff: `${rewrite}\n-- Rev: 2\n+- Rev: 3` }))[4]?.state).toBe('pass')
})

test('A18: the refusal lists rule, file and what to do; PR commands and intent closes are recognised', () => {
  const text = acceptText(score(base({ files: ['Source/S2/Combat/Hit.cpp'], untrackedLeft: ['x.cpp'] })), 'this PR')
  expect(text.split('\n')[0]).toBe('A5R · Acceptance — 2 of 5 rules not met before this PR → fix these, or ask Hai to let this one through:')
  expect(text).toContain('- 3 Unity and discipline: Source/S2/Combat/Hit.cpp: outside the paths the intent names → explain it in progress.md or findings.md, or move it to its own PR')
  expect(text).toContain('- 4 Keep it clean: x.cpp: left untracked in the shared checkout')
  for (const c of ['gh pr create --title x --body y', 'cd E:/wt/x && gh pr create -B main -F body.md', 'gh api repos/sipherxyz/s2/pulls -f title=x -f head=b -f base=main', 'gh api -X POST repos/o/r/pulls --input pr.json'])
    expect([c, isPrCommand(c)]).toEqual([c, true])
  for (const c of ['gh pr view 12', 'gh api repos/o/r/pulls/12', 'gh api repos/o/r/pulls', 'gh api -X GET repos/o/r/pulls -f state=open', 'gh pr list'])
    expect([c, isPrCommand(c)]).toEqual([c, false])
  expect(closesIntent('D:/r/docs/intent/tail-vfx/prompt.md', ['- Status: closed'])).toBe('tail-vfx')
  expect(closesIntent('D:/r/docs/intent/tail-vfx/prompt.md', ['- Status: active'])).toBe(null)
})
