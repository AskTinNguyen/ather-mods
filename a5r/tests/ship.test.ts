import { expect, test } from 'claude-code/testing'
import { shipSlugOf } from '../hooks/accept.ts'
import { PROJ, opts, world, type Rec } from './world.ts'

// A21: Ather's Ship hand-off ($.prompt.submit from ather-automata) is scored at once and the score rides the prompt;
// never a refusal. The prompts below are Ather's own strings (packs/unreal.mjs, core.mjs, web.mjs shipPrompt).
const SHIP = {
  unreal: 'Prepare intent tail-vfx for landing: extract the change onto a clean branch in its own worktree, audit the diff and every binary asset for lost edits, open the PR from .github/pull_request_template.md, then wait for my go before merging.',
  designer: 'Summarise intent tail-vfx for an owner to land: what changed, the evidence for each checklist item, and what is still owed.',
  core: 'Prepare intent tail-vfx for landing: open the PR from a clean branch, list the evidence for each checklist item, then wait for my go before merging.',
  webProduct: 'Summarise intent tail-vfx for landing: what changed, the gate that proved each checklist item, and what is still owed.',
  webLand: 'Land intent tail-vfx: open the PR from its branch, confirm build and tests passed on its head in this session, then merge it (merge policy with-proof). If any gate has not passed, stop and tell me.',
}
const ATHER = { kind: 'plugin', name: 'ather-automata' }
const STATUS_TOOL = 'mcp__ather-automata__status'
const INTENT = `${PROJ}/docs/intent/tail-vfx`
const PROMPT = ['# Tail VFX', '- Rev: 2', '- Status: active', 'Change `Source/S2/Tail/` only.', '## Acceptance', '- A1: the tail glows. Proof: PIE.', '- A2 (rev 2): the trail fades. Proof: PIE.'].join('\n')
const OPEN = ['| Item | Verdict | Evidence |', '| --- | --- | --- |', '| A1 | met | PIE: glow visible |', '| A2 | open | |'].join('\n')
const status = JSON.stringify({ me: 'hai', role: 'techart', tracked: { slug: 'tail-vfx', stage: 'Ship', directorCalls: [] }, evidence: { pie: { state: 'pass' }, editor: { state: 'pass' } } })
const git = {
  'diff --name-only': { stdout: 'Source/S2/Tail/Glow.cpp\n' },
  'diff -U0': { stdout: '+++ b/Source/S2/Tail/Glow.cpp\n+float Glow = 1.f;\n' },
  'worktree list': { stdout: '' },
  'rev-parse --abbrev-ref HEAD': { stdout: 'HaiHuynh/tail-vfx\n' },
}
const entered = (w: ReturnType<typeof world>) => (w.calls['prompt.submit'] ?? []).map(e => String((e as Rec).text))

test('A21: unit: every Ather ship wording names its intent; other prompts do not', () => {
  for (const text of Object.values(SHIP)) expect(shipSlugOf(text)).toBe('tail-vfx')
  expect(shipSlugOf('Prove intent tail-vfx: record a PIE proof with the map and capture path.')).toBeNull()
  expect(shipSlugOf('Dispatch a background Opus worker for intent tail-vfx using .agents/skills/intent/assets/worker-brief.md')).toBeNull()
})

test("A21: Ather's Ship prompt enters with the score added (rows and what to fix); it is never refused", opts(), async ($, on) => {
  const w = world(on, { out: { [STATUS_TOOL]: status }, git })
  w.put(`${INTENT}/prompt.md`, PROMPT)
  w.put(`${INTENT}/progress.md`, OPEN)
  w.put(`${INTENT}/findings.md`, '# Findings\n')
  const res = await $.prompt.submit({ text: SHIP.unreal, wait: false, origin: ATHER } as never)
  expect((res as Rec).drop).toBeUndefined()
  const [text] = entered(w)
  expect(text?.startsWith(`${SHIP.unreal}\n\nA5R · Acceptance at Ship (intent tail-vfx, branch HaiHuynh/tail-vfx): 1 of 5 rules not met → fix these before you open the PR`)).toBe(true)
  expect(text).toContain('✗ 2 Study well, work well: docs/intent/tail-vfx/progress.md: A2 is open')
  expect(text).toContain('✓ 3 Unity and discipline: within the intent\'s paths')
  expect(text).toContain('To fix:\n- 2: docs/intent/tail-vfx/progress.md: A2 is open → prove it, or record in findings.md why this PR ships without it')
  // The card shows the Ship score too (on demand reads the same state).
  expect(String((await $.command.run({ command: 'a5r', args: 'accept' } as never)).text)).toContain('A5R acceptance (1 of 5 not met)')
})

test('A21: a clean intent at Ship gets "5 of 5 met"; the web Land wording is scored the same way', opts(), async ($, on) => {
  const w = world(on, { out: { [STATUS_TOOL]: status }, git })
  w.put(`${INTENT}/prompt.md`, PROMPT)
  w.put(`${INTENT}/progress.md`, OPEN.replace('| A2 | open | |', '| A2 | met | PIE: fade 0.4 s |'))
  await $.prompt.submit({ text: SHIP.webLand, wait: false, origin: ATHER } as never)
  expect(entered(w)[0]?.split('\n\n')[1]?.split('\n')[0]).toBe('A5R · Acceptance at Ship (intent tail-vfx, branch HaiHuynh/tail-vfx): 5 of 5 met; the PR call is scored again.')
})

test('A21: the same words typed by Hai, or with A5R off, enter unchanged and nothing is scored', opts(), async ($, on) => {
  const w = world(on, { out: { [STATUS_TOOL]: status }, git })
  w.put(`${INTENT}/prompt.md`, PROMPT)
  w.put(`${INTENT}/progress.md`, OPEN)
  await $.prompt.submit({ text: SHIP.core, wait: false, origin: { kind: 'composer' } } as never)
  await $.prompt.submit({ text: SHIP.core, wait: false, origin: { kind: 'plugin', name: 'someone-else' } } as never)
  await $.command.run({ command: 'a5r', args: 'off' } as never)
  await $.prompt.submit({ text: SHIP.core, wait: false, origin: ATHER } as never)
  expect(entered(w)).toEqual([SHIP.core, SHIP.core, SHIP.core])
  expect(w.runs.some(r => r.includes('diff --name-only'))).toBe(false)
})
