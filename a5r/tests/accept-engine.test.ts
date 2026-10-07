import { expect, test } from 'claude-code/testing'
import { PROJ, opts, refused, world, type Rec } from './world.ts'

// A18 through the engine: the PR-opening call is scored over the branch; a failing score refuses it with the
// list, Hai may let one PR through, a worker is refused; an intent's close is scored the same way.
const STATUS_TOOL = 'mcp__ather-automata__status'
const INTENT = `${PROJ}/docs/intent/tail-vfx`
const PROMPT = ['# Tail VFX', '- Rev: 2', '- Status: active', 'Change `Source/S2/Tail/` only.', '## Acceptance', '- A1: the tail glows. Proof: PIE.', '- A2 (rev 2): the trail fades. Proof: PIE.'].join('\n')
const MET = ['| Item | Verdict | Evidence |', '| --- | --- | --- |', '| A1 | met | PIE: glow visible |', '| A2 | met | PIE: fade 0.4 s |'].join('\n')
const status = (evidence: Rec) => JSON.stringify({ me: 'hai', role: 'techart', tracked: { slug: 'tail-vfx', directorCalls: [] }, evidence })
const PROVEN = { pie: { state: 'pass' }, editor: { state: 'pass' } }
const DIFF = '+++ b/Source/S2/Tail/Glow.cpp\n+float Glow = 1.f;\n'
const branch = (files: string, diff = DIFF) => ({
  'diff --name-only': { stdout: files },
  'diff -U0': { stdout: diff },
  'worktree list': { stdout: `worktree ${PROJ}\nbranch refs/heads/HaiHuynh/tail-vfx\n` },
  'rev-parse --abbrev-ref HEAD': { stdout: 'HaiHuynh/tail-vfx\n' },
})
const PR = 'gh pr create --title "Tail glow" --body "## Verified\\nPIE ✓, Editor check ✓"'
const setup = (w: ReturnType<typeof world>, progress = MET) => {
  w.put(`${INTENT}/prompt.md`, PROMPT)
  w.put(`${INTENT}/progress.md`, progress)
  w.put(`${INTENT}/findings.md`, '# Findings\n')
}
const ran = (w: ReturnType<typeof world>) => w.seen.filter(e => e.tool === 'Bash' && String(e.command).startsWith('gh pr create')).length

test('A18: a PR whose branch fails the score is refused with the list (rule, file, what to do); the gh call never runs', opts(), async ($, on) => {
  const w = world(on, { out: { [STATUS_TOOL]: status({ pie: { state: 'pass' }, editor: { state: 'none' } }) }, git: branch('Source/S2/Tail/Glow.cpp\nSource/S2/Combat/Hit.cpp\n', `${DIFF}+++ b/Source/S2/Combat/Hit.cpp\n+int x = 2; // A5TMP\n`) })
  setup(w, MET.replace('| A2 | met | PIE: fade 0.4 s |', '| A2 | open | |'))
  const why = refused(await $.tool.call({ tool: 'Bash', command: PR }))
  expect(why?.split('\n')[0]).toBe('A5R · Acceptance — 4 of 5 rules not met before this PR → fix these, or ask Hai to let this one through:')
  expect(why).toContain('- 2 Study well, work well: docs/intent/tail-vfx/progress.md: A2 is open → prove it, or record in findings.md why this PR ships without it')
  expect(why).toContain("- 2 Study well, work well: Ather's proof is incomplete for the role techart: still needs Editor check")
  expect(why).toContain('- 3 Unity and discipline: Source/S2/Combat/Hit.cpp: outside the paths the intent names')
  expect(why).toContain('- 4 Keep it clean: Source/S2/Combat/Hit.cpp: a debug leftover')
  expect(why).toContain('- 5 Modest, honest, brave: PR body: \'Verified\' claims Editor check')
  expect(ran(w)).toBe(0)
})

test('A18: a clean branch passes and the PR opens; the score is never a per-turn check', opts(), async ($, on) => {
  const w = world(on, { out: { [STATUS_TOOL]: status(PROVEN) }, git: branch('Source/S2/Tail/Glow.cpp\ndocs/intent/tail-vfx/progress.md\n') })
  setup(w)
  expect(refused(await $.tool.call({ tool: 'Bash', command: PR }))).toBeUndefined()
  expect(ran(w)).toBe(1)
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'gh pr view 12' }))).toBeUndefined()
  expect(w.runs.filter(r => r.includes('diff --name-only')).length).toBe(1) // only the PR call was scored
  expect(w.runs.some(r => /\bstatus\b(?! --porcelain --untracked-files=all --)/.test(r) && r.startsWith('git'))).toBe(false) // never a whole-tree status
})

test('A18: Hai can let one PR through in the dialog; the next PR is scored and asked again', opts('ask'), async ($, on) => {
  const w = world(on, { out: { [STATUS_TOOL]: status(PROVEN) }, git: branch('Source/S2/Combat/Hit.cpp\n'), ask: 'Let this PR through' })
  setup(w)
  expect(refused(await $.tool.call({ tool: 'Bash', command: PR }))).toBeUndefined()
  expect(refused(await $.tool.call({ tool: 'Bash', command: PR }))).toBeUndefined()
  expect([(w.calls.ask ?? []).length, ran(w)]).toEqual([2, 2])
})

test('A18: a worker opening a failing PR is refused at once, never asked', opts('ask'), async ($, on) => {
  const w = world(on, { out: { [STATUS_TOOL]: status(PROVEN) }, git: branch('Source/S2/Combat/Hit.cpp\n'), ask: 'Let this PR through' })
  setup(w)
  expect(refused(await $.tool.call({ tool: 'Bash', command: PR, agentId: 'worker-1' } as never))).toContain('a worker does not ask Hai')
  expect([(w.calls.ask ?? []).length, ran(w)]).toEqual([0, 0])
})

test('A18: closing an intent is scored the same way; /a5r accept shows the score on demand', opts(), async ($, on) => {
  const w = world(on, { out: { [STATUS_TOOL]: status(PROVEN) }, git: branch('Source/S2/Tail/Glow.cpp\n') })
  setup(w, MET.replace('| A2 | met | PIE: fade 0.4 s |', '| A2 | open | |'))
  expect(refused(await $.tool.call({ tool: 'Edit', file_path: `${INTENT}/prompt.md`, old_string: '- Status: active', new_string: '- Status: closed' }))).toContain('A5R · Acceptance — 1 of 5 rules not met before closing intent tail-vfx')
  const shown = String((await $.command.run({ command: 'a5r', args: 'accept' } as never)).text)
  expect(shown.split('\n')).toEqual([
    'A5R acceptance (1 of 5 not met):',
    '✓ 1 Love the project, love your fellow sessions: no other session\'s or intent\'s paths; not on main',
    '✗ 2 Study well, work well: docs/intent/tail-vfx/progress.md: A2 is open',
    '✓ 3 Unity and discipline: within the intent\'s paths',
    '✓ 4 Keep it clean: no leftovers, secrets, stray files or background work',
    '✓ 5 Modest, honest, brave: claims match the evidence',
  ])
})

// Orchestrator review of rev 5: the base is origin/main (a stale local main is not), and an unread diff never passes.
const OWN = 'Source/S2/Tail/Glow.cpp\ndocs/intent/tail-vfx/progress.md\n'
const STALE = `${OWN}Source/S2/Combat/Hit.cpp\nContent/S2/Maps/L_TALab.umap\nConfig/DefaultGame.ini\n` // what main merged since local main
const UNREAD = 'could not read the whole branch diff'
const NEXT = '→ open the PR from a slice branch cut from origin/main, or Hai lets this one through'

test('review: the branch is diffed against origin/main, not a stale local main; main only when origin/main is missing', opts(), async ($, on) => {
  const git = { 'diff --name-only origin/main...HEAD': { stdout: OWN }, 'diff --name-only main...HEAD': { stdout: STALE }, 'diff -U0': { stdout: DIFF }, 'worktree list': { stdout: '' }, 'rev-parse --abbrev-ref HEAD': { stdout: 'HaiHuynh/tail-vfx\n' } }
  const w = world(on, { out: { [STATUS_TOOL]: status(PROVEN) }, git })
  setup(w)
  expect(refused(await $.tool.call({ tool: 'Bash', command: PR }))).toBeUndefined()
  expect(w.runs.filter(r => r.includes('diff --name-only')).map(r => r.split(' -- ')[0]?.split(' ').pop())).toEqual(['origin/main...HEAD'])
  const u0 = w.runs.find(r => r.includes('diff -U0')) ?? ''
  expect([u0.includes('origin/main...HEAD'), u0.includes(':(exclude,icase)*.uasset'), u0.includes(':(exclude,icase)*.umap')]).toEqual([true, true, true])
})

test('review: without origin/main the local main is the base', opts(), async ($, on) => {
  const git = { 'origin/main^{commit}': { stdout: '', exitCode: 1 }, 'diff --name-only main...HEAD': { stdout: OWN }, 'diff -U0': { stdout: DIFF }, 'worktree list': { stdout: '' }, 'rev-parse --abbrev-ref HEAD': { stdout: 'HaiHuynh/tail-vfx\n' } }
  const w = world(on, { out: { [STATUS_TOOL]: status(PROVEN) }, git })
  setup(w)
  expect(refused(await $.tool.call({ tool: 'Bash', command: PR }))).toBeUndefined()
  expect(w.runs.some(r => r.includes('diff --name-only main...HEAD'))).toBe(true)
})

test('review: a name-only diff that times out is no pass: refused with why, nothing scored, the gh call never runs; /a5r accept shows – rows', opts(), async ($, on) => {
  const w = world(on, { out: { [STATUS_TOOL]: status(PROVEN) }, git: { ...branch(OWN), 'diff --name-only': { stdout: '', deny: 'timed out after 30000 ms' } } })
  setup(w)
  expect(refused(await $.tool.call({ tool: 'Bash', command: PR }))).toBe(`A5R · Acceptance — ${UNREAD} (git diff --name-only timed out or did not start) ${NEXT}`)
  expect(ran(w)).toBe(0)
  const shown = String((await $.command.run({ command: 'a5r', args: 'accept' } as never)).text).split('\n')
  expect(shown[0]).toBe('A5R acceptance (not scored):')
  expect(shown.slice(1).every(l => l.startsWith('– ') && l.endsWith(`${UNREAD} (git diff --name-only timed out or did not start)`))).toBe(true)
})

test('review: a -U0 diff cut at 4 MiB is no pass (a worker is refused at once); Hai can still let it through', opts('ask'), async ($, on) => {
  const w = world(on, { out: { [STATUS_TOOL]: status(PROVEN) }, git: { ...branch(OWN), 'diff -U0': { stdout: DIFF, truncated: true } }, ask: 'Let this PR through' })
  setup(w)
  const why = refused(await $.tool.call({ tool: 'Bash', command: PR, agentId: 'worker-1' } as never))
  expect(why?.split('\n')[0]).toBe(`A5R · Acceptance — ${UNREAD} (git diff -U0 output passed 4 MiB) ${NEXT}`)
  expect([(w.calls.ask ?? []).length, ran(w)]).toEqual([0, 0])
  expect(refused(await $.tool.call({ tool: 'Bash', command: PR }))).toBeUndefined()
  expect([(w.calls.ask ?? []).length, ran(w)]).toEqual([1, 1])
})
