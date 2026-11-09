import { expect, test } from 'claude-code/testing'
import { blankSession } from '../hooks/coord.ts'
import { parseHandoff, type Handoff } from '../hooks/handoff.ts'
import { A5RPANE, ME, NOW, PROJ, find, keys, opts, refused, still, text, world, type Rec } from './world.ts'

// a5r-hosts S-a (L0) through the engine: /a5r handoff and the host tool write the hand-off file (D7 base check, D13
// secret refusal); an edit inside another hand-off's exclusive claim is refused, inside a shared one recorded; acceptance
// (A9) fails then passes with a reason line; with no hand-off nothing changes (A1).
const HF = 'E:/s2/Saved/A5R'
const S2 = 'E:/s2'
const ME8 = ME.slice(0, 8)
const MIN = 60_000
const HOST = 'mcp__a5r__host'
const START = { cwd: PROJ, surface: 'terminal', isInteractive: true } as never
const TIP = 'abc1234def5678900000000000000000000000000'
const LS = { 'ls-remote': { stdout: `${TIP}\trefs/heads/intent/tail-vfx\n` } }
const OTHER = '0a1b2c3d-2610061400-1'
const shared = (w: ReturnType<typeof world>) => w.put(`${S2}/.git/HEAD`, 'ref: refs/heads/HaiHuynh/20261005')
const handoff = (o: Partial<Handoff> = {}): Handoff => ({
  v: 1, id: OTHER, createdAt: NOW - 30 * MIN, from: '0a1b2c3d', by: { id8: 'cccccccc', lane: 'rig-lane' }, intent: { slug: 'other', branch: 'intent/other' }, task: 'bake the tail', wants: [],
  base: { remote: 'origin', ref: 'main', sha: TIP }, claims: [{ path: 'Content/S2/Tail/', exclusive: true }, { path: 'Source/S2/Tail/', exclusive: false }], needs: {}, proof: '', result: { kind: 'pr' }, host: 'rig', state: 'proposed', updatedAt: NOW - 30 * MIN, ...o,
})
const put = (w: ReturnType<typeof world>, h: Handoff) => w.put(`${HF}/handoffs/${h.id}.json`, JSON.stringify(h))
const out = (ran: { result?: unknown; text?: string; deny?: string }): string => String(ran.deny ?? ran.result ?? ran.text ?? '')
const files = (w: ReturnType<typeof world>) => [...w.files.keys()].filter(p => p.startsWith(`${HF.toLowerCase()}/handoffs/`))
const edit = (path: string) => ({ tool: 'Edit', file_path: `${S2}/${path}`, old_string: 'a', new_string: 'b' })
const cmd = async ($: any, args: string) => String((await $.command.run({ command: 'a5r', args } as never)).text)

test('S-a: /a5r handoff record writes one file (one writer, origin id once, D7 base read from the remote); list, result and cancel change it', opts(), async ($, on) => {
  const w = world(on, { git: LS })
  await $.session.start(START)
  const said = await cmd($, 'handoff record label="night rig" branch=intent/tail-vfx claims="Content/S2/Tail/,!Source/S2/Tail/Glow.cpp,Content/S2/Maps/L_Tail.umap" task="bake the tail, prove PIE"')
  const origin = JSON.parse(w.read(`${HF}/origin.json`)).originId as string
  expect(origin).toMatch(/^[0-9a-f]{8}$/)
  const id = `${origin}-2610061440-1`
  expect(said).toBe(`A5R · hand-off recorded: ${id} · proposed · on night rig · intent/tail-vfx · claims Content/S2/Tail/, !Source/S2/Tail/Glow.cpp, !Content/S2/Maps/L_Tail.umap · bake the tail, prove PIE. Its claims hold for every session here until it is cancelled or merged.`)
  expect(w.runs).toContain(`git -C ${S2} ls-remote origin intent/tail-vfx`)
  const h = parseHandoff(w.read(`${HF}/handoffs/${id}.json`)) as Handoff
  expect(h).toMatchObject({ v: 1, id, from: origin, by: { id8: ME8 }, intent: { slug: 'tail-vfx', branch: 'intent/tail-vfx' }, base: { remote: 'origin', ref: 'intent/tail-vfx', sha: TIP }, host: 'night rig', state: 'proposed', result: { kind: 'pr', target: 'intent/tail-vfx' } })
  expect(h.claims).toEqual([{ path: 'Content/S2/Tail/', exclusive: false }, { path: 'Source/S2/Tail/Glow.cpp', exclusive: true }, { path: 'Content/S2/Maps/L_Tail.umap', exclusive: true }])
  // A second record the same minute takes the next number; the origin id stays.
  await cmd($, 'handoff record label=pc2 branch=intent/tail-vfx task="second"')
  expect(JSON.parse(w.read(`${HF}/origin.json`)).originId).toBe(origin)
  expect(files(w).map(p => p.split('/').pop())).toEqual([`${id}.json`, `${origin}-2610061440-2.json`])
  expect(await cmd($, 'handoff list')).toContain(`${id} · proposed · on night rig`)
  expect(await cmd($, `handoff result ${id} #4242`)).toBe(`A5R · hand-off ${id}: result #4242 recorded (pr); its claims hold until it is merged or cancelled.`)
  expect(await cmd($, `handoff cancel ${id}`)).toBe(`A5R · hand-off ${id} cancelled: its claims are released.`)
  expect(parseHandoff(w.read(`${HF}/handoffs/${id}.json`))).toMatchObject({ state: 'cancelled', result: { kind: 'pr', ref: '#4242' } })
  expect(await cmd($, `handoff cancel ${id}`)).toBe(`A5R · handoff — hand-off ${id} is cancelled; it cannot become cancelled → record a new hand-off`)
  expect(await cmd($, 'handoff cancel nope')).toBe('A5R · handoff — no hand-off nope here → list them (handoff list) and name one by its id')
  expect(await cmd($, 'handoff park x')).toContain('A5R · handoff — "park x" is not a handoff command → /a5r handoff record')
})

test('S-a (D7): a base the remote does not have is refused with the standard line; nothing is written', opts(), async ($, on) => {
  const w = world(on, { git: { 'ls-remote': { stdout: '', exitCode: 2 } } })
  await $.session.start(START)
  expect(await cmd($, 'handoff record label=rig branch=intent/local-only task="x"')).toBe('A5R · handoff — base intent/local-only is not on origin → push the branch, then create the hand-off')
  expect(files(w)).toEqual([])
})

test('S-a (D7, D13): a base sha that is not on the remote, or a secret in the task, is refused; nothing is written', opts(), async ($, on) => {
  const w = world(on, { git: { 'ls-remote': { stdout: `${TIP}\trefs/heads/main\n` }, 'merge-base': { stdout: '', exitCode: 1 } } })
  await $.session.start(START)
  expect(await cmd($, 'handoff record label=rig base=main@abc9999 task="x"')).toBe('A5R · handoff — base abc9999 is not on origin → push the branch, then create the hand-off')
  expect(await cmd($, `handoff record label=rig base=main task="push with ghp_${'a'.repeat(36)}"`)).toBe('A5R · handoff — the hand-off holds a secret (D13: hand-offs carry none) → take the credential out; each host keeps its own')
  expect(files(w)).toEqual([])
})

test('S-a: the host tool: handoff create/update/result/list/cancel; any other action answers that a later slice adds it (no throw)', opts(), async ($, on) => {
  const w = world(on, { git: LS })
  await $.session.start(START)
  expect(out(await $.tool.call({ tool: HOST, action: 'status' } as never))).toBe('A5R · host — not in this version → slice S-b adds hosts')
  expect(out(await $.tool.call({ tool: HOST, action: 'add' } as never))).toBe('A5R · host — not in this version → slice S-b adds hosts')
  expect(out(await $.tool.call({ tool: HOST, action: 'handoff', op: 'packet' } as never))).toBe('A5R · host — not in this version → slice S-d adds the hand-off packet')
  expect(out(await $.tool.call({ tool: HOST, action: 'handoff', op: 'creat' } as never))).toBe('A5R · handoff — "creat" is not a handoff op → use create, update, cancel, result or list')
  expect(out(await $.tool.call({ tool: HOST, action: 'handoff', op: 'list' } as never))).toContain('No hand-offs here.')
  const made = out(await $.tool.call({ tool: HOST, action: 'handoff', op: 'create', label: 'rig', branch: 'intent/tail-vfx', claims: ['Content/S2/Tail/M_Glow.uasset', { path: 'Source/S2/Tail/', exclusive: true }], task: 'bake' } as never))
  const id = /recorded: (\S+)/.exec(made)?.[1] ?? ''
  expect(parseHandoff(w.read(`${HF}/handoffs/${id}.json`))?.claims).toEqual([{ path: 'Content/S2/Tail/M_Glow.uasset', exclusive: true }, { path: 'Source/S2/Tail/', exclusive: true }])
  expect(out(await $.tool.call({ tool: HOST, action: 'handoff', op: 'update', id, state: 'merged' } as never))).toBe(`A5R · handoff — hand-off ${id} has no result yet → record it first (result ${id} <ref>)`)
  expect(out(await $.tool.call({ tool: HOST, action: 'handoff', op: 'update', id, task: 'bake and prove', claims: ['~Content/S2/Tail/M_Glow.uasset'] } as never))).toContain('claims Content/S2/Tail/M_Glow.uasset · bake and prove')
  expect(out(await $.tool.call({ tool: HOST, action: 'handoff', op: 'result', id, ref: 'intent/tail-vfx' } as never))).toContain('result intent/tail-vfx recorded (branch)')
  expect(out(await $.tool.call({ tool: HOST, action: 'handoff', op: 'update', id, state: 'merged' } as never))).toContain(`${id} · merged`)
  expect(w.seen.some(e => e.tool === HOST)).toBe(false) // answered by a5r, never passed on
})

test('S-a (D9): an edit inside another hand-off\'s exclusive claim is refused; inside a shared one it runs and is recorded; its own hand-off never blocks it; hand-off files are a5r\'s', opts(), async ($, on) => {
  const w = world(on)
  shared(w)
  put(w, handoff())
  for (const p of ['Content/S2/Tail/M_Glow.uasset', 'Source/S2/Tail/Glow.cpp', 'Source/S2/Other.cpp']) w.put(`${S2}/${p}`, 'a')
  await $.session.start(START)
  expect(refused(await $.tool.call(edit('Content/S2/Tail/M_Glow.uasset') as never))).toBe(`A5R · claim — Content/S2/Tail/M_Glow.uasset is claimed by hand-off ${OTHER} on rig → ask them to return it, or choose other paths`)
  expect(refused(await $.tool.call(edit('Source/S2/Tail/Glow.cpp') as never))).toBeUndefined()
  expect(refused(await $.tool.call(edit('Source/S2/Other.cpp') as never))).toBeUndefined()
  const rec = (JSON.parse(w.read(`${HF}/recorded/${ME8}.json`)) as { entries: Rec[] }).entries
  expect(rec.map(e => [e.kind, e.rule, e.path, e.why])).toEqual([['claim-touch', 'claim-touch', 'Source/S2/Tail/Glow.cpp', `shared claim Source/S2/Tail/ of hand-off ${OTHER} on rig`]])
  expect(w.seen.filter(e => e.tool === 'Edit').map(e => String(e.file_path).replace(`${S2}/`, ''))).toEqual(['Source/S2/Tail/Glow.cpp', 'Source/S2/Other.cpp'])
  // Hand edits of the hand-off files are refused (one writer).
  expect(refused(await $.tool.call({ tool: 'Write', file_path: `${HF}/handoffs/${OTHER}.json`, content: '{}' } as never))).toBe('A5R · handoff — Saved/A5R/handoffs is written by a5r alone (one writer) → use /a5r handoff or the host tool (action handoff)')
  // Cancelled: the claim is gone. Recorded by this session: its own claim never blocks it.
  put(w, handoff({ state: 'cancelled' }))
  expect(refused(await $.tool.call(edit('Content/S2/Tail/M_Glow.uasset') as never))).toBeUndefined()
  put(w, handoff({ by: { id8: ME8, lane: 'me' } }))
  expect(refused(await $.tool.call(edit('Content/S2/Tail/M_Glow.uasset') as never))).toBeUndefined()
})

// A9 in the accept harness (as accept-engine.test.ts): the PR call is scored over the branch.
const STATUS_TOOL = 'mcp__ather-automata__status'
const INTENT = `${PROJ}/docs/intent/tail-vfx`
const PROMPT = ['# Tail VFX', '- Rev: 2', '- Status: active', 'Change `Source/S2/Tail/` and `Content/S2/Tail/` only.', '## Acceptance', '- A1: the tail glows. Proof: PIE.'].join('\n')
const MET = ['| Item | Verdict | Evidence |', '| --- | --- | --- |', '| A1 | met | PIE: glow visible |'].join('\n')
const PROVEN = JSON.stringify({ me: 'hai', role: 'techart', tracked: { slug: 'tail-vfx', directorCalls: [] }, evidence: { pie: { state: 'pass' }, editor: { state: 'pass' } } })
const PR = 'gh pr create --title "Tail glow" --body "## Verified\\nPIE ✓, Editor check ✓"'
const BRANCH = {
  'diff --name-only': { stdout: 'Source/S2/Tail/Glow.cpp\nContent/S2/Tail/M_Glow.uasset\n' },
  'diff -U0': { stdout: '+++ b/Source/S2/Tail/Glow.cpp\n+float Glow = 1.f;\n' },
  'worktree list': { stdout: `worktree ${PROJ}\nbranch refs/heads/intent/tail-vfx\n` },
  'rev-parse --abbrev-ref HEAD': { stdout: 'intent/tail-vfx\n' },
}

test('S-a (A9): a PR whose diff holds a path in another open hand-off\'s exclusive claim is refused under rule 1; a reason line in findings.md lets it pass', opts(), async ($, on) => {
  const w = world(on, { out: { [STATUS_TOOL]: PROVEN }, git: BRANCH })
  put(w, handoff())
  w.put(`${INTENT}/prompt.md`, PROMPT)
  w.put(`${INTENT}/progress.md`, MET)
  w.put(`${INTENT}/findings.md`, '# Findings\n')
  await $.session.start(START) // a session in the checkout reads its hand-offs
  const why = refused(await $.tool.call({ tool: 'Bash', command: PR }))
  expect(why?.split('\n')).toEqual([
    'A5R · Acceptance — 1 of 5 rules not met before this PR → fix these and call again (nothing waits on an answer; Hai lets one through with /a5r pass):',
    `- 1 Love the project, love your fellow sessions: Content/S2/Tail/M_Glow.uasset: claimed by hand-off ${OTHER} on rig (exclusive) → leave it to that lane, or say why in progress.md or findings.md`,
  ])
  w.put(`${INTENT}/findings.md`, '# Findings\n- Content/S2/Tail/M_Glow.uasset: the rig lane returned it on 2026-10-06; this PR carries the merged version.\n')
  expect(refused(await $.tool.call({ tool: 'Bash', command: PR }))).toBeUndefined()
  expect(w.seen.filter(e => e.tool === 'Bash' && String(e.command).startsWith('gh pr create')).length).toBe(1)
})

test('S-a (A1): with no hand-off (none, or only closed ones) the pane and status.json are as before; an open one adds one row group and status.json\'s handoffs', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  shared(w)
  // This session is first in the queue: the one writer of status.json (rev 44, Fable 11).
  w.put(`${HF}/editor/${ME8}.json`, JSON.stringify({ ...blankSession(ME, 'lane-me', '', NOW), heartbeatAt: NOW + 600 * MIN, want: { what: 'PIE retest', minutes: 30, pie: true, build: false, launch: true, mode: 'interactive', pausable: true, nextSafe: '', requestedAt: NOW - 10 * MIN, since: NOW - 10 * MIN } }))
  await $.session.start(START)
  await w.clock.advance(MIN)
  // The pane's blocks (their keys, in order) and status.json's keys: the snapshot that must not move without a hand-off.
  const look = async () => {
    const tree = still(await $.ui.render(A5RPANE as never))
    const status = JSON.parse(w.read(`${HF}/status.json`)) as Rec
    return { blocks: keys(tree), handoffs: find(tree, 'hai-handoffs'), status }
  }
  const none = await look()
  expect(none.handoffs).toBeUndefined()
  expect(none.blocks).not.toContain('hai-handoffs')
  expect(Object.keys(none.status)).not.toContain('handoffs')
  expect(none.status.v).toBe(1)
  expect(files(w)).toEqual([])
  put(w, handoff({ state: 'cancelled' }))
  put(w, handoff({ id: '0a1b2c3d-2610061400-2', state: 'merged', result: { kind: 'pr', ref: '#7' } }))
  await w.clock.advance(MIN)
  const closed = await look()
  expect([closed.blocks, Object.keys(closed.status), closed.handoffs]).toEqual([none.blocks, Object.keys(none.status), undefined])
  expect({ ...closed.status, at: 0 }).toEqual({ ...JSON.parse(JSON.stringify(none.status)), at: 0, editor: closed.status.editor }) // only the queue's times move with the clock
  put(w, handoff({ id: '0a1b2c3d-2610061400-3' }))
  await w.clock.advance(MIN)
  const open = await look()
  expect(text(open.handoffs)).toMatch(/^HAND-OFFS · 1 OPEN●rig · intent\/other · !Content\/S2\/Tail\/, Source\/S2\/Tail\/3\dm$/)
  expect(open.status.handoffs).toEqual([{ id: '0a1b2c3d-2610061400-3', state: 'proposed', host: 'rig', claims: handoff().claims, updatedAt: NOW - 30 * MIN }])
  expect(Object.keys(open.status)).toEqual([...Object.keys(none.status), 'handoffs'])
  expect(open.status.v).toBe(1)
})
