import { expect, test } from 'claude-code/testing'
import { PROJ, LOCK, PENDING, ME, ENV, opts, BAT, NOW, LIME, type Rec, type Tree, k, refused, keys, find, firstText, text, type Proc, world, atherTree, A5RPANE, PANE } from './world.ts'


// ---------- A5R ----------
test('A5R on: a refused command never reaches the tool', opts(), async ($, on) => {
  const w = world(on)
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git commit --no-verify -m x' }))).toContain('A5R · D1/D5')
  expect(w.seen.length).toBe(0)
})

test('A5R off: the rules, nghiệm thu and the Editor gate all rest (D1)', opts(), async ($, on) => {
  const w = world(on, { a5r: false })
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git commit --no-verify -m x' }))).toBeUndefined()
  w.put(`${PROJ}/Source/S2/Foo.cpp`, 'int x = 2; // A5RTMP\n')
  await $.tool.call({ tool: 'Edit', file_path: `${PROJ}/Source/S2/Foo.cpp`, old_string: 'int x = 1;', new_string: 'int x = 2; // A5RTMP' })
  expect((await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Xong.' })).block).toBeUndefined()
  w.put(LOCK, '1006-other-s9 (worker) since 14:30, expected end 15:10. session ffffffff\n')
  expect(refused(await $.tool.call({ tool: 'mcp__unreal-mcp__call_tool', name: 'save_assets' } as never))).toBeUndefined()
  expect(refused(await $.tool.call({ tool: 'mcp__unreal-mcp__call_tool', name: 'SaveAll' } as never))).toBeUndefined()
  expect(refused(await $.tool.call({ tool: 'Write', file_path: LOCK, content: 'free since 15:00' }))).toBeUndefined()
})

test('A5R off: Ather\'s pane tree, status line and toasts are exactly Ather\'s; 🟥 still marks the title', opts(), async ($, on) => {
  const w = world(on, { a5r: false, ram: '2.1' })
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

test('/a5r on and /a5r off flip the switch every session reads', opts(), async ($, on) => {
  world(on, { a5r: false })
  expect((await $.command.run({ command: 'a5r', args: 'on' } as never)).text).toContain('A5R on')
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git commit --no-verify -m x' }))).toContain('A5R · D1/D5')
  expect((await $.command.run({ command: 'a5r', args: 'off' } as never)).text).toContain('A5R off')
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git commit --no-verify -m x' }))).toBeUndefined()
})

// Rev 27 (A73, A75), by design: these ran into a dialog or "nobody could approve it"; now they run and are recorded.
const RECORDED = 'E:/s2/Saved/A5R/recorded'
const recorded = (w: ReturnType<typeof world>) => w.read(`${RECORDED}/${ME.slice(0, 8)}.json`)

test('A75: a recursive delete runs (in TEMP silently; elsewhere recorded for nghiệm thu)', opts(), async ($, on) => {
  const w = world(on)
  expect(refused(await $.tool.call({ tool: 'PowerShell', command: 'Remove-Item -Recurse -Force $env:TEMP\\probe' }))).toBeUndefined()
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'rm -rf E:/Projects/s2/Saved/Logs' }))).toBeUndefined()
  expect(recorded(w)).toContain('rm -rf E:/Projects/s2/Saved/Logs')
  expect(w.seen.filter(e => e.tool === 'Bash' || e.tool === 'PowerShell').length).toBe(2)
})

test('A73: ask mode in an away window gives the same answer as any mode: a clean reset --hard runs, nothing is asked', opts('ask'), async ($, on) => {
  const w = world(on)
  const asked: Rec[] = []
  on('tool.call', { tool: 'AskUserQuestion' }, async (_$: unknown, e: Rec) => {
    asked.push(e)
    return { deny: 'The user is away until 07:00 (Ather autonomy window).' }
  })
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git reset --hard' }))).toBeUndefined()
  expect([asked.length, w.seen.filter(e => e.tool === 'Bash').length]).toEqual([0, 1])
})

test('A75: a shared config edit in a git project runs and is recorded', opts(), async ($, on) => {
  const w = world(on)
  expect(refused(await $.tool.call({ tool: 'Write', file_path: `${PROJ}/Config/DefaultGame.ini`, content: '[x]' }))).toBeUndefined()
  expect(recorded(w)).toContain('Config/DefaultGame.ini')
})

test('A17: no per-turn report: a turn with edits, a failed build and no report ends; the action gates still hold', opts(), async ($, on) => {
  const w = world(on, { out: { [BAT]: 'Building...\nResult: Failed (OtherCompilationError)' }, git: { 'status --porcelain': { stdout: ' M Source/S2/Other.cpp\0' } } })
  w.put(`${PROJ}/Source/S2/Foo.cpp`, 'int x = 1;\n')
  await $.tool.call({ tool: 'Edit', file_path: `${PROJ}/Source/S2/Foo.cpp`, old_string: 'int x = 1;', new_string: 'int x = 2; // A5RTMP' })
  await $.tool.call({ tool: 'Bash', command: BAT })
  expect((await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Xong.' })).block).toBeUndefined()
  // What cannot be undone is still checked at the action (D10).
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git commit --no-verify -m x' }))).toContain('A5R · D1/D5')
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git reset --hard' }))).toContain('Source/S2/Other.cpp (no session claims it)') // A74: a fact, not a dialog
  expect(refused(await $.tool.call({ tool: 'Write', file_path: `${PROJ}/Source/S2/Key.cpp`, content: `k = 'ghp_${'a'.repeat(36)}'` }))).toContain('secret')
  expect(refused(await $.tool.call({ tool: 'Write', file_path: LOCK, content: 'free since 15:00' }))).toContain('mcp__a5r__editor')
})


// ---------- A5R inside Ather's intent flow ----------
const STATUS_TOOL = 'mcp__ather-automata__status'
const status = (o: Rec) => JSON.stringify({ me: 'hai', role: 'techart', area: 'VFX', ...o })

test('a worker\'s own worktree: git and repository config there are its own (the shared checkout is checked on facts)', opts(), async ($, on) => {
  const w = world(on, { git: { 'status --porcelain': { stdout: ' M Config/DefaultGame.ini\0' } } })
  w.put('E:/wt/x/.git', 'gitdir: E:/proj/.git/worktrees/x')
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git -C E:/wt/x checkout -b HaiHuynh/tail-vfx origin/main' }))).toBeUndefined()
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git -C E:/wt/x reset --hard' }))).toBeUndefined()
  expect(refused(await $.tool.call({ tool: 'Write', file_path: 'E:/wt/x/Config/DefaultGame.ini', content: '[x]' }))).toBeUndefined()
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git reset --hard' }))).toContain('Config/DefaultGame.ini (no session claims it)')
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git -C E:/wt/x add .' }))).toContain('stage exact paths')
})

test('A73: a worker (subagent) gets the main loop\'s answer: refused with the alternative, no dialog', opts('ask'), async ($, on) => {
  const w = world(on)
  const asked: Rec[] = []
  on('tool.call', { tool: 'AskUserQuestion' }, async (_$: unknown, e: Rec) => {
    asked.push(e)
    return { result: {}, text: 'Allow once' }
  })
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'git push --force origin HaiHuynh/x', agentId: 'worker-1' } as never))).toContain('push to a new branch and open a PR')
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
  expect(refused(await $.tool.call(save as never))).toContain('A5R · Editor lock')
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
const GOLD = '#F2C14E' // A33: the approved gold
/** The brand label's color: the first Text of the masthead, or of the brand row once A5R adds its seal. */
const brandColor = (t: unknown): unknown => firstText(t, 'hai-brand') ?? firstText(t, 'head-words')

test('pane, A5R on: Ather\'s pane gains one compact A5R line under its strip; the tools are in the A5R pane (A28, A29)', opts(), async ($, on) => {
  const w = world(on, { a5r: true })
  w.put(LOCK, '1006-walkerext-s9 (artifact-any-legs-worker) since 14:30, expected end 15:10. Build S2Editor, headless tests. Waiting: 1006-loco-s3\n')
  on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true } as never)
  await $.ui.render(PANE as never)
  await w.clock.advance(50) // the sync read runs off the render
  expect(keys(await $.ui.render(PANE as never))).toEqual(['head-words', 'strip', 'hai-a5r-line', 'foot'])
  const tree = await $.ui.render(A5RPANE as never)
  expect(keys(tree)).toEqual(['hai-a5r-band', 'hai-tiles', 'hai-overview', 'hai-a5r-rules']) // A33: the band first
  expect(text(find(tree, 'hai-tile-editor'))).toContain('1006-walkerext-s9')
  expect(text(find(tree, 'hai-tile-editor'))).toContain('until 15:10 · 30 min left')
  expect(text(find(tree, 'hai-tile-memory'))).toContain('20.5 GB free')
  expect(text(find(tree, 'hai-tile-main'))).toContain('12 behind')
})

test('pane on the desktop: the tiles are cards in Ather\'s strip language', opts(), async ($, on) => {
  world(on, { a5r: true })
  on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
  await $.session.start({ cwd: PROJ, surface: 'desktop', isInteractive: true } as never)
  const tree = await $.ui.render({ ...A5RPANE, surface: 'desktop' } as never)
  expect(find(tree, 'hai-tiles')?.props?.borderStyle).toBe('round') // A35: one list in one box, not three cards
  expect(find(tree, 'hai-tile-editor')?.props?.borderStyle).toBeUndefined()
  expect(find(tree, 'hai-tile-main-action')).toBeDefined() // A25: one action per tool
})

test('pane, A5R on: the accent turns lacquer gold, a red seal joins the brand; the five rules sit at the foot of the A5R pane', opts(), async ($, on) => {
  world(on, { a5r: true })
  on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true } as never)
  const tree = await $.ui.render(PANE as never)
  expect(keys(tree)).toEqual(['head-words', 'strip', 'hai-a5r-line', 'foot'])
  expect(text(find(tree, 'hai-brand'))).toContain('★ A5R')
  expect(brandColor(tree)).toBe(GOLD)
  expect(find(tree, 'strip')?.props?.borderColor).toBe('#3a3c36')
  const a5r = await $.ui.render(A5RPANE as never)
  expect(text(find(a5r, 'hai-a5r-rules-head')).startsWith('THE FIVE RULES')).toBe(true) // A32: seals under a heading; rule 1's word is its own element (A20)
  expect(find(a5r, 'hai-rule1')?.type).toBe('Client')
  expect(find(a5r, 'hai-a5r-chip-5')).toBeDefined()
})

test('pane: views other than home get no A5R line (A5R still seals and recolors them)', opts(), async ($, on) => {
  world(on, { a5r: true })
  on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(false))
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true } as never)
  const tree = await $.ui.render(PANE as never)
  expect(keys(tree)).toEqual(['head-words', 'foot'])
  expect(brandColor(tree)).toBe(GOLD)
})

// ---------- one inbox, Ather's proof, icons, motion ----------

test('pane on the desktop: each tile carries a pixel icon; still unless its state just turned over', opts(), async ($, on) => {
  const w = world(on, { a5r: true })
  on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
  await $.session.start({ cwd: PROJ, surface: 'desktop', isInteractive: true } as never)
  const first = await $.ui.render({ ...A5RPANE, surface: 'desktop' } as never)
  const svg = (find(first, 'hai-tile-editor-icon')?.children ?? [])[0] as Tree
  expect(svg?.type).toBe('Svg')
  expect(svg?.props?.isInteractive).toBeUndefined()
  w.put(LOCK, `1006-other-s9 (worker) since 14:30, expected end 15:10. session ffffffff\n`)
  await w.clock.advance(60_000) // the minute refresh reads the new holder
  const changed = await $.ui.render({ ...A5RPANE, surface: 'desktop' } as never)
  const moving = (find(changed, 'hai-tile-editor-icon')?.children ?? [])[0] as Tree
  expect(moving?.props?.isInteractive).toBe(true)
  expect(String(moving?.props?.source)).toContain('<set attributeName="fill"')
})

test('A5R seal on the desktop: stamps in once when A5R comes on, still afterwards', opts(), async ($, on) => {
  const w = world(on, { a5r: false })
  on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
  await $.session.start({ cwd: PROJ, surface: 'desktop', isInteractive: true } as never)
  await $.command.run({ command: 'a5r', args: 'on' } as never)
  const stamp = await $.ui.render({ ...PANE, surface: 'desktop' } as never)
  const seal = (find(stamp, 'hai-brand')?.children ?? [])[1] as Tree
  expect(seal?.type).toBe('Svg')
  expect(seal?.props?.isInteractive).toBe(true)
  await w.clock.advance(3_000)
  const still = await $.ui.render({ ...PANE, surface: 'desktop' } as never)
  expect(((find(still, 'hai-brand')?.children ?? [])[1] as Tree)?.props?.isInteractive).toBeUndefined()
})

test('motion off: every icon stays still', { options: { a5rWhenPresent: 'deny', editorLock: LOCK, pendingFile: PENDING, motion: 'off' } }, async ($, on) => {
  world(on, { a5r: false })
  on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
  await $.session.start({ cwd: PROJ, surface: 'desktop', isInteractive: true } as never)
  await $.command.run({ command: 'a5r', args: 'on' } as never)
  const tree = await $.ui.render({ ...PANE, surface: 'desktop' } as never)
  expect(((find(tree, 'hai-brand')?.children ?? [])[1] as Tree)?.props?.isInteractive).toBeUndefined()
})
