import { expect, test } from 'claude-code/testing'
import { checklistComplete, checklistFull, passKey } from '../hooks/accept.ts'
import { A5RPANE, PENDING, PROJ, find, opts, world } from './world.ts'

// A56 (Hai, 2026-10-09: tasks stopped overnight waiting on A5R's questions): A5R acceptance steps in only at the end of
// the checklist (every row met or waived), at Ather's Ship prompt and at an intent's close; scoring after the fact
// follows the same rule. A57: it never waits on an answer; Hai passes one with `/a5r pass <PR or slug>`.
const STATUS_TOOL = 'mcp__ather-automata__status'
const INTENT = `${PROJ}/docs/intent/tail-vfx`
const PROMPT = ['# Tail VFX', '- Rev: 2', '- Status: active', 'Change `Source/S2/Tail/` only.', '## Acceptance', '- A1: the tail glows. Proof: PIE.', '- A2: the trail fades. Proof: PIE.'].join('\n')
const rows = (a2: string, pr: string) => [`# tail-vfx: Progress`, '', `- PR: ${pr}`, '', '## Acceptance', '| Item | Verdict | Evidence |', '| --- | --- | --- |', '| A1 | met | PIE: glow visible |', `| A2 | ${a2} |`].join('\n')
const status = JSON.stringify({ me: 'hai', role: 'techart', tracked: { slug: 'tail-vfx', stage: 'Build', prs: [], directorCalls: [] }, evidence: { pie: { state: 'pass' }, editor: { state: 'pass' } } })
const view = (head: string) => ({ stdout: JSON.stringify({ headRefName: head, baseRefName: 'main', state: 'OPEN' }) })
const DIRTY = { 'pr view 812': view('tail-glow'), 'pr view 813': view('tail-fade'), 'diff --name-only': { stdout: 'Source/S2/Tail/Glow.cpp\n' }, 'diff -U0': { stdout: `+++ b/Source/S2/Tail/Glow.cpp\n+float Glow = 1.f; // ${['A5R', 'TMP'].join('')}\n` }, 'worktree list': { stdout: '' } }
const MIN = 60_000
const START = { cwd: PROJ, surface: 'terminal', isInteractive: true } as never
const minutes = async (w: ReturnType<typeof world>, n: number) => {
  for (let i = 0; i < n; i += 1) await w.clock.advance(MIN)
}
const views = (w: ReturnType<typeof world>) => w.runs.filter(r => r.includes('pr view')).map(r => /pr view (\d+)/.exec(r)?.[1])
const prLines = (w: ReturnType<typeof world>) => w.read(PENDING).split('\n').filter(l => l.includes('PR #'))

test('A56/A57: unit: a checklist is complete when every row is met or waived; Ather\'s count; what /a5r pass names', () => {
  expect([checklistComplete(PROMPT, rows('met | PIE: fade', '')), checklistComplete(PROMPT, rows('waived | Hai', '')), checklistComplete(PROMPT, rows('open |', '')), checklistComplete(PROMPT, rows('gate met, review open | x', '')), checklistComplete('# no rows', '')]).toEqual([true, true, false, false, false])
  expect([checklistFull('2/2'), checklistFull('1/2'), checklistFull('0/0'), checklistFull(undefined)]).toEqual([true, false, false, false])
  expect([passKey('tail-vfx'), passKey('#812'), passKey('812'), passKey('https://github.com/sipherxyz/s2/pull/812'), passKey('two words')]).toEqual(['tail-vfx', '#812', '#812', '#812', null])
})

test('A56: after the fact, a PR listed while a row is still open is never scored (no gh call, no card, no 🟥); one listed at the checklist end is', opts(), async ($, on) => {
  const w = world(on, { out: { [STATUS_TOOL]: status }, git: DIRTY })
  w.put(PENDING, '')
  w.put(`${INTENT}/prompt.md`, PROMPT)
  w.put(`${INTENT}/progress.md`, rows('open |', 'none yet'))
  await $.session.start(START)
  await minutes(w, 6)
  w.put(`${INTENT}/progress.md`, rows('open |', '#812')) // a draft PR during Build
  await minutes(w, 6)
  expect([views(w), prLines(w), find(await $.ui.render(A5RPANE as never), 'hai-accept')]).toEqual([[], [], undefined])
  // The checklist ends (A2 waived); a new PR is scored after the fact, the draft from Build still is not.
  w.put(`${INTENT}/progress.md`, rows('waived | Hai 2026-10-09', '#812, #813'))
  await minutes(w, 6)
  expect(views(w)).toEqual(['813'])
  expect(prLines(w).length).toBe(1)
  expect(prLines(w)[0]).toContain('PR #813 (intent tail-vfx) was opened without A5R acceptance and fails 1 of 5 (4 Keep it clean)')
})

test('A57: /a5r pass <PR> lets that PR\'s after-the-fact score through once: scored and shown, no 🟥', opts(), async ($, on) => {
  const w = world(on, { out: { [STATUS_TOOL]: status }, git: DIRTY })
  w.put(PENDING, '')
  w.put(`${INTENT}/prompt.md`, PROMPT)
  w.put(`${INTENT}/progress.md`, rows('met | PIE: fade', 'none yet'))
  await $.session.start(START)
  await minutes(w, 6)
  expect(String((await $.command.run({ command: 'a5r', args: 'pass #812' } as never)).text)).toContain('after-the-fact score of PR #812 goes through once')
  w.put(`${INTENT}/progress.md`, rows('met | PIE: fade', '#812'))
  await minutes(w, 6)
  expect(views(w)).toEqual(['812'])
  expect(prLines(w)).toEqual([])
  expect(find(await $.ui.render(A5RPANE as never), 'hai-accept-pr-812-head')).toBeDefined()
})

test('A57: /a5r help names /a5r pass and says acceptance never asks; the dialog option is gone from everything a5r registers', opts(), async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  const help = String((await $.command.run({ command: 'a5r', args: 'help' } as never)).text)
  expect(help).toContain('/a5r pass <intent slug | PR number>')
  expect(help).toContain('acceptance never asks')
  expect(help).toContain('only at the end of the tracked intent\'s checklist')
  expect(JSON.stringify(w.calls['command.register'] ?? [])).toContain('/a5r pass')
  expect(JSON.stringify(w.calls)).not.toContain('Let this PR through')
})
