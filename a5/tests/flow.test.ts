import { expect, test } from 'claude-code/testing'
import { PROJ, LOCK, PENDING, ME, ENV, opts, BAT, NOW, LIME, type Rec, type Tree, k, refused, keys, find, firstText, text, type Proc, world, atherTree, PANE } from './world.ts'


// ---------- A5 ----------
test('A5 on: a refused command never reaches the tool', opts(), async ($, on) => {
  const w = world(on)
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git commit --no-verify -m x' }))).toContain('A5 · D1/D5')
  expect(w.seen.length).toBe(0)
})

test('A5 off: the rules, nghiệm thu and the Editor gate all rest (D1)', opts(), async ($, on) => {
  const w = world(on, { a5: false })
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git commit --no-verify -m x' }))).toBeUndefined()
  w.put(`${PROJ}/Source/S2/Foo.cpp`, 'int x = 2; // A5TMP\n')
  await $.tool.call({ tool: 'Edit', file_path: `${PROJ}/Source/S2/Foo.cpp`, old_string: 'int x = 1;', new_string: 'int x = 2; // A5TMP' })
  expect((await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Xong.' })).block).toBeUndefined()
  w.put(LOCK, '1006-other-s9 (worker) since 14:30, expected end 15:10. session ffffffff\n')
  expect(refused(await $.tool.call({ tool: 'mcp__unreal-mcp__call_tool', name: 'save_assets' } as never))).toBeUndefined()
  expect(refused(await $.tool.call({ tool: 'mcp__unreal-mcp__call_tool', name: 'SaveAll' } as never))).toBeUndefined()
  expect(refused(await $.tool.call({ tool: 'Write', file_path: LOCK, content: 'free since 15:00' }))).toBeUndefined()
})

test('A5 off: Ather\'s pane tree, status line and toasts are exactly Ather\'s; 🟥 still marks the title', opts(), async ($, on) => {
  const w = world(on, { a5: false, ram: '2.1' })
  w.put(LOCK, '1006-other-s9 (worker) since 13:30, expected end 14:00. session ffffffff\n') // over its lease, RAM under the PIE gate
  w.put(PENDING, '')
  on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
  on('turn.complete', async () => ({ text: '' }))
  for (const surface of ['terminal', 'desktop'] as const) {
    await $.session.start({ cwd: PROJ, surface, isInteractive: true } as never)
    await w.clock.advance(120_000)
    expect(await $.ui.render({ ...PANE, surface } as never)).toEqual(atherTree(true))
    expect(await $.ui.render({ ...PANE, surface } as never)).toEqual(atherTree(true))
  }
  await $.turn.complete({ answer: '> 🟥 **NEEDS DECISION** — Merge now? / Default if no answer: later', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
  expect((w.calls['ui.status'] ?? []).filter(e => (e as Rec).text !== undefined)).toEqual([])
  expect(w.calls['ui.toast'] ?? []).toEqual([])
  expect(w.calls['tool.register'] ?? []).toEqual([])
  expect(w.seen.some(e => e.tool === 'mcp__ccd_session_mgmt__set_session_title' && e.title === '🟥 3️⃣ Loco fix')).toBe(true)
})

test('/a5 on and /a5 off flip the switch every session reads', opts(), async ($, on) => {
  world(on, { a5: false })
  expect((await $.command.run({ command: 'a5', args: 'on' } as never)).text).toContain('A5 on')
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git commit --no-verify -m x' }))).toContain('A5 · D1/D5')
  expect((await $.command.run({ command: 'a5', args: 'off' } as never)).text).toContain('A5 off')
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git commit --no-verify -m x' }))).toBeUndefined()
})

test('recursive delete: free in TEMP, needs Hai elsewhere', opts(), async ($, on) => {
  world(on)
  expect(refused(await $.tool.call({ tool: 'PowerShell', command: 'Remove-Item -Recurse -Force $env:TEMP\\probe' }))).toBeUndefined()
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'rm -rf E:/Projects/s2/Saved/Logs' }))).toContain("needs Hai's approval")
})

test('ask mode with nobody to answer (Ather away window) refuses and says why', opts('ask'), async ($, on) => {
  world(on)
  on('tool.call', { tool: 'AskUserQuestion' }, async () => ({ deny: 'The user is away until 07:00 (Ather autonomy window).' }))
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git reset --hard' }))).toContain('nobody could approve it')
})

test('shared config edit in a git project needs Hai', opts(), async ($, on) => {
  world(on)
  expect(refused(await $.tool.call({ tool: 'Write', file_path: `${PROJ}/Config/DefaultGame.ini`, content: '[x]' }))).toContain('Config/*.ini')
})

test('A17: no per-turn report: a turn with edits, a failed build and no report ends; the action gates still hold', opts(), async ($, on) => {
  const w = world(on, { out: { [BAT]: 'Building...\nResult: Failed (OtherCompilationError)' } })
  w.put(`${PROJ}/Source/S2/Foo.cpp`, 'int x = 1;\n')
  await $.tool.call({ tool: 'Edit', file_path: `${PROJ}/Source/S2/Foo.cpp`, old_string: 'int x = 1;', new_string: 'int x = 2; // A5TMP' })
  await $.tool.call({ tool: 'Bash', command: BAT })
  expect((await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Xong.' })).block).toBeUndefined()
  // What cannot be undone is still checked at the action (D10).
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git commit --no-verify -m x' }))).toContain('A5 · D1/D5')
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git reset --hard' }))).toContain("needs Hai's approval")
  expect(refused(await $.tool.call({ tool: 'Write', file_path: `${PROJ}/Source/S2/Key.cpp`, content: `k = 'ghp_${'a'.repeat(36)}'` }))).toContain('secret')
  expect(refused(await $.tool.call({ tool: 'Write', file_path: LOCK, content: 'free since 15:00' }))).toContain('mcp__a5__editor')
})


// ---------- A5 inside Ather's intent flow ----------
const STATUS_TOOL = 'mcp__ather-automata__status'
const status = (o: Rec) => JSON.stringify({ me: 'hai', role: 'techart', area: 'VFX', ...o })

test('a worker\'s own worktree: git and repository config there are its own (the shared checkout still asks)', opts(), async ($, on) => {
  const w = world(on)
  w.put('E:/wt/x/.git', 'gitdir: E:/proj/.git/worktrees/x')
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git -C E:/wt/x checkout -b HaiHuynh/tail-vfx origin/main' }))).toBeUndefined()
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git -C E:/wt/x reset --hard' }))).toBeUndefined()
  expect(refused(await $.tool.call({ tool: 'Write', file_path: 'E:/wt/x/Config/DefaultGame.ini', content: '[x]' }))).toBeUndefined()
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git reset --hard' }))).toContain("needs Hai's approval")
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git -C E:/wt/x add .' }))).toContain("needs Hai's approval")
})

test('a worker (subagent) is never put to Hai: refused at once with stop-and-report, no dialog', opts('ask'), async ($, on) => {
  const w = world(on)
  const asked: Rec[] = []
  on('tool.call', { tool: 'AskUserQuestion' }, async (_$: unknown, e: Rec) => {
    asked.push(e)
    return { result: {}, text: 'Cho chạy lần này' }
  })
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git reset --hard', agentId: 'worker-1' } as never))).toContain('a worker does not ask Hai')
  expect(asked.length).toBe(0)
  expect(w.seen.length).toBe(0)
})

test('🟥 that relays an intent\'s director call: Ather lists it, so no PENDING.md line; title and unread still mark it', opts(), async ($, on) => {
  const w = world(on, { out: { [STATUS_TOOL]: status({ tracked: { slug: 'tail-vfx', directorCalls: ['F-3: Tail VFX colour: gold or red'] }, evidence: {} }) } })
  w.put(PENDING, '')
  on('turn.complete', async () => ({ text: '' }))
  const answer = 'Worker dừng ở F-3.\n\n> 🟥 **NEEDS DECISION** — F-3: tail VFX gold or red? / Default if no answer: gold'
  await $.turn.complete({ answer, durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(w.files.get(k(PENDING)) ?? '').not.toContain('tail VFX')
  expect(w.seen.some(e => e.tool === 'mcp__ccd_session_mgmt__set_session_title' && e.title === '🟥 3️⃣ Loco fix')).toBe(true)
  expect(w.seen.some(e => e.tool === 'mcp__ccd_sidebar__set_unread' && e.unread === true)).toBe(true)
})

test('🟥 after a worker added a director call this turn: no PENDING.md line', opts(), async ($, on) => {
  const w = world(on)
  on('turn.complete', async () => ({ text: '' }))
  const findings = `${PROJ}/docs/intent/tail-vfx/findings.md`
  w.put(findings, '# Findings\n')
  await $.tool.call({ tool: 'Write', file_path: findings, content: '# Findings\n\n## F-4 (2026-10-06) | blocking: yes | status: open (director)\nGold or red?\n', agentId: 'worker-1' } as never)
  const answer = '> 🟥 **NEEDS DECISION** — Tail colour? / Default if no answer: gold'
  await $.turn.complete({ answer, durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(w.files.get(k(PENDING)) ?? '').not.toContain('Tail colour')
})

// ---------- the Editor ----------
test('Editor: writes need the lock to name this session; reads pass; never save-all', opts(), async ($, on) => {
  const w = world(on)
  const save = { tool: 'mcp__unreal-mcp__call_tool', name: 'save_assets', arguments: { paths: ['/Game/X'] } }
  w.put(LOCK, '1006-other-s9 (worker) since 14:30, expected end 15:10. session ffffffff\n')
  expect(refused(await $.tool.call(save as never))).toContain('A5 · Editor lock')
  expect(refused(await $.tool.call({ tool: 'mcp__unreal-mcp__call_tool', name: 'get_actor' } as never))).toBeUndefined()
  w.put(LOCK, `1006-me-s1 (this lane) since 14:30, expected end 15:10. session ${ME.slice(0, 8)}\n`)
  expect(refused(await $.tool.call(save as never))).toBeUndefined()
  expect(refused(await $.tool.call({ tool: 'mcp__unreal-mcp__call_tool', name: 'SaveAll' } as never))).toContain('save each one by exact path')
  w.put(LOCK, 'free since 15:20\n')
  expect(refused(await $.tool.call(save as never))).toContain('free')
})

test('Editor: PIE needs 5 GB free RAM', opts(), async ($, on) => {
  const w = world(on, { ram: '3.2' })
  w.put(LOCK, `slot since 14:30. session ${ME.slice(0, 8)}\n`)
  expect(refused(await $.tool.call({ tool: 'mcp__unreal-mcp__call_tool', name: 'McpPieToolset.StartPIE' } as never))).toContain('5 GB')
})

// ---------- 🟥 ----------
test('🟥 at the end of a turn: PENDING.md once, title marked, unread', opts(), async ($, on) => {
  const w = world(on)
  w.put(PENDING, '- [x] old line\n')
  const answer = 'Phần A xong.\n\n> 🟥 **NEEDS DECISION** — Merge PR #1 now or after the train? / Default if no answer: after the train'
  on('turn.complete', async () => ({ text: answer }))
  await $.turn.complete({ answer, durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
  await $.turn.complete({ answer, durationMs: 10, isAborted: false, turnId: 't2', reason: 'answer' })
  const pending = w.files.get(k(PENDING)) ?? ''
  expect(pending.split('\n').filter(l => l.includes('Merge PR #1')).length).toBe(1)
  expect(pending).toContain('· 3️⃣ Loco fix · Merge PR #1 now or after the train? · default: after the train')
  expect(w.seen.some(e => e.tool === 'mcp__ccd_session_mgmt__set_session_title' && e.title === '🟥 3️⃣ Loco fix')).toBe(true)
  expect(w.seen.some(e => e.tool === 'mcp__ccd_sidebar__set_unread' && e.unread === true)).toBe(true)
})

// ---------- Ather's pane ----------
const GOLD = '#E8B84A'
/** The brand label's color: the first Text of the masthead, or of the brand row once A5 adds its seal. */
const brandColor = (t: unknown): unknown => firstText(t, 'hai-brand') ?? firstText(t, 'head-words')

test('pane, A5 on: one row of Editor · Memory · Main tiles right under Ather\'s strip', opts(), async ($, on) => {
  const w = world(on, { a5: true })
  w.put(LOCK, '1006-walkerext-s9 (artifact-any-legs-worker) since 14:30, expected end 15:10. Build S2Editor, headless tests. Waiting: 1006-loco-s3\n')
  on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true } as never)
  await $.ui.render(PANE as never)
  await w.clock.advance(50) // the sync read runs off the render
  const tree = await $.ui.render(PANE as never)
  expect(keys(tree)).toEqual(['head-words', 'strip', 'hai-tiles', 'hai-overview', 'hai-a5-rules', 'foot'])
  expect(text(find(tree, 'hai-tile-editor'))).toContain('1006-walkerext-s9')
  expect(text(find(tree, 'hai-tile-editor'))).toContain('until 15:10 · 30 min left')
  expect(text(find(tree, 'hai-tile-memory'))).toContain('20.5 GB free')
  expect(text(find(tree, 'hai-tile-main'))).toContain('12 behind')
})

test('pane on the desktop: the tiles are cards in Ather\'s strip language', opts(), async ($, on) => {
  world(on, { a5: true })
  on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
  await $.session.start({ cwd: PROJ, surface: 'desktop', isInteractive: true } as never)
  const tree = await $.ui.render({ ...PANE, surface: 'desktop' } as never)
  expect(find(tree, 'hai-tile-editor')?.props?.borderStyle).toBe('round')
  expect(find(tree, 'hai-tile-main-action')).toBeDefined() // A25: one action per tool
})

test('pane, A5 on: the accent turns lacquer gold, a red seal joins the brand, the five rules sit at the foot', opts(), async ($, on) => {
  world(on, { a5: true })
  on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true } as never)
  const tree = await $.ui.render(PANE as never)
  expect(keys(tree)).toEqual(['head-words', 'strip', 'hai-tiles', 'hai-overview', 'hai-a5-rules', 'foot'])
  expect(text(find(tree, 'hai-brand'))).toContain('★ A5')
  expect(brandColor(tree)).toBe(GOLD)
  expect(find(tree, 'strip')?.props?.borderColor).toBe('#3a3c36')
  expect(text(find(tree, 'hai-a5-rules'))).toContain(', yêu đồng bào') // D9: rule 1's word is its own element (A20)
  expect(find(tree, 'hai-rule1')?.type).toBe('Client')
  expect(text(find(tree, 'hai-a5-rules'))).toContain('5 Khiêm tốn, thật thà, dũng cảm')
})

test('pane: views other than home get no tiles (A5 still seals and recolors them)', opts(), async ($, on) => {
  world(on, { a5: true })
  on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(false))
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true } as never)
  const tree = await $.ui.render(PANE as never)
  expect(keys(tree)).toEqual(['head-words', 'hai-a5-rules', 'foot'])
  expect(brandColor(tree)).toBe(GOLD)
})

// ---------- one inbox, Ather's proof, icons, motion ----------

test('pane on the desktop: each tile carries a pixel icon; still unless its state just turned over', opts(), async ($, on) => {
  const w = world(on, { a5: true })
  on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
  await $.session.start({ cwd: PROJ, surface: 'desktop', isInteractive: true } as never)
  const first = await $.ui.render({ ...PANE, surface: 'desktop' } as never)
  const svg = (find(first, 'hai-tile-editor-main')?.children ?? [])[0] as Tree
  expect(svg?.type).toBe('Svg')
  expect(svg?.props?.isInteractive).toBeUndefined()
  w.put(LOCK, `1006-other-s9 (worker) since 14:30, expected end 15:10. session ffffffff\n`)
  await w.clock.advance(60_000) // the minute refresh reads the new holder
  const changed = await $.ui.render({ ...PANE, surface: 'desktop' } as never)
  const moving = (find(changed, 'hai-tile-editor-main')?.children ?? [])[0] as Tree
  expect(moving?.props?.isInteractive).toBe(true)
  expect(String(moving?.props?.source)).toContain('<set attributeName="fill"')
})

test('A5 seal on the desktop: stamps in once when A5 comes on, still afterwards', opts(), async ($, on) => {
  const w = world(on, { a5: false })
  on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
  await $.session.start({ cwd: PROJ, surface: 'desktop', isInteractive: true } as never)
  await $.command.run({ command: 'a5', args: 'on' } as never)
  const stamp = await $.ui.render({ ...PANE, surface: 'desktop' } as never)
  const seal = (find(stamp, 'hai-brand')?.children ?? [])[1] as Tree
  expect(seal?.type).toBe('Svg')
  expect(seal?.props?.isInteractive).toBe(true)
  await w.clock.advance(3_000)
  const still = await $.ui.render({ ...PANE, surface: 'desktop' } as never)
  expect(((find(still, 'hai-brand')?.children ?? [])[1] as Tree)?.props?.isInteractive).toBeUndefined()
})

test('motion off: every icon stays still', { options: { a5WhenPresent: 'deny', editorLock: LOCK, pendingFile: PENDING, motion: 'off' } }, async ($, on) => {
  world(on, { a5: false })
  on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
  await $.session.start({ cwd: PROJ, surface: 'desktop', isInteractive: true } as never)
  await $.command.run({ command: 'a5', args: 'on' } as never)
  const tree = await $.ui.render({ ...PANE, surface: 'desktop' } as never)
  expect(((find(tree, 'hai-brand')?.children ?? [])[1] as Tree)?.props?.isInteractive).toBeUndefined()
})
