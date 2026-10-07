import { expect, test } from 'claude-code/testing'
import { isPrTool } from '../hooks/accept.ts'
import { PROJ, opts, refused, world, type Rec } from './world.ts'

// A22: a PR opened through an MCP tool is gated like `gh pr create`: the score over the head the input names, the
// refusal with the list, Hai's pass-once, a worker refused.
const STATUS_TOOL = 'mcp__ather-automata__status'
const GITHUB = 'mcp__github__create_pull_request'
const PLUGIN_GITHUB = 'mcp__plugin_engineering_github__create_pull_request'
const INTENT = `${PROJ}/docs/intent/tail-vfx`
const PROMPT = ['# Tail VFX', '- Rev: 2', '- Status: active', 'Change `Source/S2/Tail/` only.', '## Acceptance', '- A1: the tail glows. Proof: PIE.'].join('\n')
const MET = ['| Item | Verdict | Evidence |', '| --- | --- | --- |', '| A1 | met | PIE: glow visible |'].join('\n')
const status = JSON.stringify({ me: 'hai', role: 'techart', tracked: { slug: 'tail-vfx', directorCalls: [] }, evidence: { pie: { state: 'pass' }, editor: { state: 'pass' } } })
const git = (files: string, diff: string) => ({
  'remote -v': { stdout: 'origin\thttps://github.com/sipherxyz/s2.git (fetch)\norigin\thttps://github.com/sipherxyz/s2.git (push)\n' }, // A47 (b): remotes from git remote -v
  'diff --name-only': { stdout: files },
  'diff -U0': { stdout: diff },
  'worktree list': { stdout: '' },
})
const CLEAN = git('Source/S2/Tail/Glow.cpp\n', '+++ b/Source/S2/Tail/Glow.cpp\n+float Glow = 1.f;\n')
const DIRTY = git('Source/S2/Tail/Glow.cpp\nSource/S2/Combat/Hit.cpp\n', '+++ b/Source/S2/Combat/Hit.cpp\n+int x = 2; // A5TMP\n')
const input = (over: Rec = {}) => ({ owner: 'sipherxyz', repo: 's2', title: 'Tail glow', body: '## Verified\nPIE ✓, Editor check ✓', head: 'HaiHuynh/tail-vfx', base: 'main', ...over })
const setup = (w: ReturnType<typeof world>) => {
  w.put(`${INTENT}/prompt.md`, PROMPT)
  w.put(`${INTENT}/progress.md`, MET)
  w.put(`${INTENT}/findings.md`, '# Findings\n')
}
const ran = (w: ReturnType<typeof world>, tool: string) => w.seen.filter(e => e.tool === tool).length

test('A22: unit: tool names that create a PR, in any server; reading, listing, merging or reviewing one is not', () => {
  for (const t of [GITHUB, PLUGIN_GITHUB, 'mcp__gitlab__pull_request_create', 'mcp__gh__createPullRequest', 'mcp__forge__pulls_create']) expect([t, isPrTool(t)]).toEqual([t, true])
  for (const t of ['mcp__github__get_pull_request', 'mcp__github__list_pull_requests', 'mcp__github__merge_pull_request', 'mcp__github__create_pull_request_review', 'mcp__github__update_pull_request', 'Bash']) expect([t, isPrTool(t)]).toEqual([t, false])
})

test(`A22: ${GITHUB} on a failing branch is refused with the list; the score reads the head and base the input names`, opts(), async ($, on) => {
  const w = world(on, { out: { [STATUS_TOOL]: status }, git: DIRTY })
  setup(w)
  const why = refused(await $.tool.call({ tool: GITHUB, ...input() } as never))
  expect(why?.split('\n')[0]).toBe('A5R · Acceptance — 2 of 5 rules not met before this PR → fix these, or ask Hai to let this one through:')
  expect(why).toContain('- 3 Unity and discipline: Source/S2/Combat/Hit.cpp: outside the paths the intent names')
  expect(why).toContain('- 4 Keep it clean: Source/S2/Combat/Hit.cpp: a debug leftover')
  expect(w.runs.find(r => r.includes('diff --name-only'))?.endsWith('origin/main...origin/HaiHuynh/tail-vfx')).toBe(true) // A41: a head no worktree holds is read from origin
  expect(ran(w, GITHUB)).toBe(0)
})

test(`A22: ${PLUGIN_GITHUB} on a clean branch passes and runs`, opts(), async ($, on) => {
  const w = world(on, { out: { [STATUS_TOOL]: status, [PLUGIN_GITHUB]: '{"number": 812}' }, git: CLEAN })
  setup(w)
  expect(refused(await $.tool.call({ tool: PLUGIN_GITHUB, ...input() } as never))).toBeUndefined()
  expect(ran(w, PLUGIN_GITHUB)).toBe(1)
})

test('A22: a worker is refused at once; Hai can let one PR through in the dialog', opts('ask'), async ($, on) => {
  const w = world(on, { out: { [STATUS_TOOL]: status }, git: DIRTY, ask: 'Let this PR through' })
  setup(w)
  expect(refused(await $.tool.call({ tool: PLUGIN_GITHUB, ...input(), agentId: 'worker-1' } as never))).toContain('a worker does not ask Hai')
  expect([(w.calls.ask ?? []).length, ran(w, PLUGIN_GITHUB)]).toEqual([0, 0])
  expect(refused(await $.tool.call({ tool: PLUGIN_GITHUB, ...input() } as never))).toBeUndefined()
  expect([(w.calls.ask ?? []).length, ran(w, PLUGIN_GITHUB)]).toEqual([1, 1])
})

test('A22: a PR for another repository, or a head this checkout does not have, is not scored and never passes', opts(), async ($, on) => {
  const w = world(on, { out: { [STATUS_TOOL]: status }, git: { ...CLEAN, 'origin/HaiHuynh/gone^{commit}': { stdout: '', exitCode: 1 }, 'HaiHuynh/gone^{commit}': { stdout: '', exitCode: 1 } } })
  setup(w)
  expect(refused(await $.tool.call({ tool: GITHUB, ...input({ owner: 'someone', repo: 'other' }) } as never))).toBe(
    "A5R · Acceptance — could not read the whole branch diff (the PR is for someone/other, which is not a remote of the repository at E:/proj (https://github.com/sipherxyz/s2.git)) → open the PR from a slice branch cut from origin/main, or Hai lets this one through",
  )
  expect(refused(await $.tool.call({ tool: GITHUB, ...input({ head: 'HaiHuynh/gone' }) } as never))).toContain('head HaiHuynh/gone is neither checked out in a worktree of this repository nor at origin/HaiHuynh/gone')
  expect(ran(w, GITHUB)).toBe(0)
})
