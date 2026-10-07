import { expect, test } from 'claude-code/testing'
import { openedPrs, prNumbersOf } from '../hooks/accept.ts'
import { A5PANE, PENDING, PROJ, atherTree, find, opts, refused, text, world } from './world.ts'

// A23: a PR a5 never scored (opened on GitHub, or by the app's own button) is scored once its number shows up on
// the tracked intent's `- PR:` line or in Ather's `tracked.prs`: the card names it, and a failing one is one 🟥.
const STATUS_TOOL = 'mcp__ather-automata__status'
const INTENT = `${PROJ}/docs/intent/tail-vfx`
const PROMPT = ['# Tail VFX', '- Rev: 2', '- Status: active', 'Change `Source/S2/Tail/` only.', '## Acceptance', '- A1: the tail glows. Proof: PIE.'].join('\n')
const progress = (pr: string) => [`# tail-vfx: Progress`, '', `- PR: ${pr}`, '', '## Acceptance', '| Item | Verdict | Evidence |', '| --- | --- | --- |', '| A1 | met | PIE: glow visible |'].join('\n')
const status = (prs: string[] = []) => JSON.stringify({ me: 'hai', role: 'techart', tracked: { slug: 'tail-vfx', stage: 'Build', prs, directorCalls: [] }, evidence: { pie: { state: 'pass' }, editor: { state: 'pass' } } })
const git = (diff: string) => ({ 'diff --name-only': { stdout: 'Source/S2/Tail/Glow.cpp\n' }, 'diff -U0': { stdout: diff }, 'worktree list': { stdout: '' } })
const DIRTY = git('+++ b/Source/S2/Tail/Glow.cpp\n+float Glow = 1.f; // A5TMP\n')
const CLEAN = git('+++ b/Source/S2/Tail/Glow.cpp\n+float Glow = 1.f;\n')
const MIN = 60_000
const START = { cwd: PROJ, surface: 'terminal', isInteractive: true } as never
const minutes = async (w: ReturnType<typeof world>, n: number) => {
  for (let i = 0; i < n; i += 1) await w.clock.advance(MIN)
}
const titled = (w: ReturnType<typeof world>) => w.seen.filter(e => e.tool === 'mcp__ccd_session_mgmt__set_session_title').map(e => String(e.title))
const head = async ($: any) => text(find(await $.ui.render(A5PANE as never), 'hai-accept-head'))
const prLines = (w: ReturnType<typeof world>) => w.read(PENDING).split('\n').filter(l => l.includes('PR #'))

test('A23: unit: PR numbers read as Ather reads them; the number a PR call reports', () => {
  expect(prNumbersOf('- PR: #812, sipherxyz/s2#813, https://github.com/sipherxyz/s2/pull/814\n## Steps\n- PR: #999', '- PR: #700')).toEqual([812, 813, 814, 700])
  expect(prNumbersOf('- PR: none yet', '')).toEqual([])
  expect(openedPrs('https://github.com/sipherxyz/s2/pull/815\n')).toEqual([815])
  expect(openedPrs('{"result":"{\\"number\\": 816, \\"state\\": \\"open\\"}"}')).toEqual([816])
})

test('A23: a PR line added by hand is scored after the fact: the card names the PR, one 🟥 for Hai when it fails', opts(), async ($, on) => {
  const w = world(on, { out: { [STATUS_TOOL]: status() }, git: DIRTY })
  on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
  w.put(PENDING, '')
  w.put(`${INTENT}/prompt.md`, PROMPT)
  w.put(`${INTENT}/progress.md`, progress('none yet'))
  await $.session.start(START)
  await minutes(w, 6)
  expect(prLines(w)).toEqual([])
  // Hai opened the PR on GitHub and wrote its number by hand.
  w.put(`${INTENT}/progress.md`, progress('#812'))
  await minutes(w, 5)
  expect(prLines(w).length).toBe(1)
  expect(prLines(w)[0]).toContain('PR #812 (intent tail-vfx) was opened without A5 acceptance and fails 1 of 5 (4 Keep it clean)')
  expect(titled(w).some(t => t.startsWith('🟥'))).toBe(true)
  expect(await head($)).toContain('● 1 of 5 not mettail-vfx · PR #812 · scored after the fact')
  await minutes(w, 11)
  expect(prLines(w).length).toBe(1) // one 🟥 per PR
})

test("A23: numbers already listed at the first read, and a PR a5 scored at its own call, are not scored again; a new one in Ather's tracked.prs is", opts(), async ($, on) => {
  const out: Record<string, string> = { [STATUS_TOOL]: status(), 'gh pr create --title "Tail glow" --body "PIE ✓"': 'https://github.com/sipherxyz/s2/pull/813\n' }
  const w = world(on, { out, git: CLEAN })
  on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
  w.put(PENDING, '')
  w.put(`${INTENT}/prompt.md`, PROMPT)
  w.put(`${INTENT}/progress.md`, progress('#700'))
  await $.session.start(START)
  await minutes(w, 1)
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'gh pr create --title "Tail glow" --body "PIE ✓"' }))).toBeUndefined()
  w.put(`${INTENT}/progress.md`, progress('#700, #813'))
  await minutes(w, 6)
  expect(await head($)).toContain('tail-vfx · this PR · ')
  expect(await head($)).not.toContain('after the fact')
  out[STATUS_TOOL] = status(['#700 MERGED', '#813 OPEN', '#901 OPEN'])
  await minutes(w, 5)
  expect(await head($)).toContain('5 of 5 mettail-vfx · PR #901 · scored after the fact')
  expect(prLines(w)).toEqual([]) // it passed: no 🟥
})
