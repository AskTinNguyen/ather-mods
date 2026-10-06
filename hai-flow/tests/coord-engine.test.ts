import { expect, test } from 'claude-code/testing'
import { blankSession, heldLine, parseLockLine, type SessionFile, type Want } from '../hooks/coord.ts'
import { parseEditorLock } from '../hooks/editor.ts'
import { LOCK, ME, NOW, PENDING, PROJ, opts, refused, world, type Rec } from './world.ts'

// The Editor holder, RAM and notices through the engine: other sessions are only files under Saved/HaiFlow
// (and Ather's lane heartbeats), exactly what this session reads in a real checkout.
const HF = 'E:/s2/Saved/HaiFlow'
const LANES = 'E:/s2/Saved/AtherAutomata/lanes'
const ME8 = ME.slice(0, 8)
const EDITOR = 'mcp__hai-flow__editor'
const START = { cwd: PROJ, surface: 'terminal', isInteractive: true } as never
const T = (h: number, m: number) => new Date(2026, 9, 6, h, m).getTime()
const MIN = 60_000

const out = (ran: { result?: unknown; text?: string; deny?: string }): string => String(ran.deny ?? ran.result ?? ran.text ?? '')
const want = (o: Partial<Want> = {}): Want => ({ minutes: 30, pie: false, build: false, what: 'their slot', mode: 'interactive', pausable: true, nextSafe: 'after save', requestedAt: NOW - 5 * MIN, ...o })
const peer = (id8: string, o: Partial<SessionFile> = {}): string => JSON.stringify({ ...blankSession(`${id8}-1111-4000-8000-000000000000`, `lane-${id8}`, `title ${id8}`, NOW), ...o })
const heldBy = (id8: string, end: number, o: { pausable?: boolean; mode?: 'interactive' | 'unattended' } = {}) =>
  `${heldLine({ lane: `lane-${id8}`, sessionName: `title-${id8}`, id8, since: T(14, 0), pid: null, end, mode: o.mode ?? 'interactive', pausable: o.pausable ?? true, nextSafe: 'after save', note: 'their slot' })}\n`
const prompts = (w: ReturnType<typeof world>): string[] => (w.calls['prompt.submit'] ?? []).map(e => String((e as Rec).text))
const mine = (w: ReturnType<typeof world>): SessionFile => JSON.parse(w.read(`${HF}/editor/${ME8}.json`) || '{}') as SessionFile
const idle = async ($: any) => $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })

test('editor request: the head takes a free lock in the S2 standard\'s line, which Ather still reads', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, 'free since 14:20\n')
  await $.session.start(START)
  expect((w.calls['tool.register'] ?? []).map(e => (e as Rec).name)).toEqual(['editor', 'sync'])
  const ran = out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 20, what: 'tail VFX check' } as never))
  expect(ran).toContain('hai-flow · Editor — granted to this session until 15:00')
  const line = w.read(LOCK).trim()
  expect(line.startsWith('HELD lane=3️⃣-Loco-fix session=3️⃣-Loco-fix since=14:40 2026-10-06 pid=none end=15:00 mode=interactive pausable=yes next_safe=after save note=tail VFX check')).toBe(true)
  expect(line.endsWith(`· held by 3️⃣-Loco-fix, session ${ME8}, until 15:00`)).toBe(true)
  expect(parseEditorLock(line, 14 * 60 + 40)).toEqual({ state: 'held', holder: '3️⃣-Loco-fix', until: '15:00', isStale: false, session: ME8 })
  expect(mine(w).holding).toEqual({ since: NOW, end: T(15, 0), extended: 0 })
  // Holding it, the session drives the Editor; the next request says so instead of queueing again.
  expect(refused(await $.tool.call({ tool: 'mcp__unreal-mcp__call_tool', name: 'save_assets' } as never))).toBeUndefined()
  expect(out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 10 } as never))).toContain('already holds the Editor until 15:00')
})

test('the queue: first asked, first served; the next session is granted at a minute tick, by one idle prompt', opts(), async ($, on) => {
  const w = world(on)
  on('turn.complete', async () => ({ text: '' }))
  w.put(LOCK, 'free since 14:20\n')
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', { want: want() }))
  await $.session.start(START)
  const asked = out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 20, what: 'PIE proof', pie: true } as never))
  expect(asked).toContain('2nd in the queue')
  expect(w.read(LOCK)).toBe('free since 14:20\n')
  await idle($)
  // The other session takes it, then gives it back; its own hai-flow keeps its file fresh.
  w.put(LOCK, heldBy('bbbbbbbb', T(15, 10)))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', { heartbeatAt: NOW + MIN, holding: { since: NOW, end: T(15, 10), extended: 0 } }))
  await w.clock.advance(MIN)
  expect(prompts(w)).toEqual([])
  w.put(LOCK, 'FREE since=14:42 2026-10-06 by=lane-bbbbbbbb note=Editor closed background=none · free since 14:42\n')
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', { heartbeatAt: NOW + 2 * MIN }))
  w.machine.ram = '40'
  await w.clock.advance(MIN)
  expect(w.read(LOCK)).toContain(`session ${ME8}, until 15:02`)
  expect(prompts(w).length).toBe(1)
  expect(prompts(w)[0]).toContain('hai-flow · Editor — granted to this session until 15:02')
  await w.clock.advance(2 * MIN)
  expect(prompts(w).length).toBe(1) // one prompt per event
})

test('yield: a ≤ 20 min request without a build asks the holder once an hour; the holder\'s hai-flow tells it', opts(), async ($, on) => {
  const w = world(on)
  w.put(LOCK, heldBy('bbbbbbbb', T(15, 30)))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', { holding: { since: T(14, 0), end: T(15, 30), extended: 0 } }))
  await $.session.start(START)
  expect(out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 15, what: 'one PIE check' } as never))).toContain('was asked to yield')
  for (let n = 1; n <= 3; n += 1) {
    w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', { heartbeatAt: NOW + n * MIN, holding: { since: T(14, 0), end: T(15, 30), extended: 0 } }), NOW + n * MIN)
    await w.clock.advance(MIN)
  }
  expect(mine(w).yieldAsks.map(a => [a.holder, a.via, a.minutes])).toEqual([['bbbbbbbb', 'file', 15]])
  expect(w.sent).toEqual([]) // the holder runs hai-flow: no cross-session send (D6)
})

test('yield, the holder\'s side: one notice for the ask, as one prompt while idle', opts(), async ($, on) => {
  const w = world(on)
  w.put(LOCK, heldBy(ME8, T(15, 30)))
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc', { lane: 'loco', want: want({ minutes: 10 }), yieldAsks: [{ holder: ME8, at: NOW - 30_000, via: 'file', minutes: 10, lane: 'loco' }] }))
  await $.session.start(START)
  // One prompt carries every notice queued for this event: the yield ask, and the lease idle since 14:00.
  expect(prompts(w).length).toBe(1)
  expect(prompts(w)[0]).toContain('hai-flow · Editor yield — loco asks for the Editor for ~10 min, no build → at your next safe point (≤ 10 min): stop PIE, save only your own assets, release with the editor tool; if you cannot pause, keep it and finish by your end time')
  await w.clock.advance(MIN)
  expect(prompts(w).length).toBe(1)
})

test('a holder without hai-flow gets the standard UE request line, at most once an hour', opts(), async ($, on) => {
  const w = world(on)
  w.put(LOCK, '1006-walker-s9 (worker) since 14:00, until 15:30. session dddddddd\n')
  w.put(`${LANES}/dddddddd-2222-4000-8000-000000000000.json`, JSON.stringify({ sessionId: 'dddddddd-2222-4000-8000-000000000000', hasEnded: false }))
  await $.session.start(START)
  await $.tool.call({ tool: EDITOR, action: 'request', minutes: 15, what: 'one PIE check' } as never)
  for (let n = 1; n <= 3; n += 1) {
    w.put(`${LANES}/dddddddd-2222-4000-8000-000000000000.json`, JSON.stringify({ sessionId: 'dddddddd-2222-4000-8000-000000000000', hasEnded: false }), NOW + n * MIN)
    await w.clock.advance(MIN)
  }
  expect(w.sent.length).toBe(1)
  expect(JSON.stringify(w.sent[0])).toContain('dddddddd-2222')
  expect(String(w.sent[0]?.text)).toBe('UE request: 3️⃣-Loco-fix cần Editor ~15 phút để one PIE check, build=no, chờ được tới 15:30.')
})

test('lease end and overrun: the holder is told before the end and at the end, each once', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  on('turn.complete', async () => ({ text: '' }))
  w.put(LOCK, 'free since 14:20\n')
  await $.session.start(START)
  await $.tool.call({ tool: EDITOR, action: 'request', minutes: 20, what: 'tail VFX' } as never)
  await idle($)
  await w.clock.advance(10 * MIN) // 14:50: the Editor is used, so the lease is not idle
  await $.tool.call({ tool: 'mcp__unreal-mcp__call_tool', name: 'get_actor' } as never)
  await idle($)
  await w.clock.advance(5 * MIN) // 14:55
  expect(prompts(w)).toEqual(['hai-flow · Editor lease — your lease ends at 15:00 → finish to a checkpoint (PIE stopped, your own assets saved), then release with the editor tool, or extend it if it still fits'])
  await idle($)
  await w.clock.advance(5 * MIN) // 15:00
  expect(prompts(w).length).toBe(2)
  expect(prompts(w)[1]).toContain('hai-flow · Editor lease — your lease ended at 15:00 → stop at the nearest checkpoint and release now')
  await idle($)
  await w.clock.advance(2 * MIN)
  expect(prompts(w).length).toBe(2)
})

test('a stale lease is freed only when its holder is gone and no Editor runs', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, heldBy('bbbbbbbb', T(14, 30)))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', { heartbeatAt: NOW - 10 * MIN, holding: { since: T(14, 0), end: T(14, 30), extended: 0 } }))
  await $.session.start(START)
  const ran = out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 20, what: 'tail VFX' } as never))
  expect(ran).toContain('the lease of session bbbbbbbb was stale')
  expect(ran).toContain('granted to this session until 15:00')
  expect(parseLockLine(w.read(LOCK)).id8).toBe(ME8)
})

test('a gone holder whose Editor still runs is reported, never killed and never replaced', opts(), async ($, on) => {
  const w = world(on, { ram: '40', procs: [{ name: 'UnrealEditor', pid: 91, gb: 26, parentAlive: false }] })
  w.put(LOCK, heldBy('bbbbbbbb', T(14, 30)))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', { heartbeatAt: NOW - 10 * MIN }))
  await $.session.start(START)
  const ran = out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 20, what: 'tail VFX' } as never))
  expect(ran).toContain('is gone but UnrealEditor PID 91 still runs → never kill it or drive it')
  expect(parseLockLine(w.read(LOCK)).id8).toBe('bbbbbbbb')
  expect(w.runs.some(r => /Stop-Process|taskkill|kill\b/i.test(r))).toBe(false)
})

test('under A5 the lock is the editor tool\'s: Edit, Write and redirects are refused with the tool named; reads pass', opts(), async ($, on) => {
  const w = world(on)
  w.put(LOCK, 'free since 14:20\n')
  expect(refused(await $.tool.call({ tool: 'Write', file_path: LOCK, content: `slot · session ${ME8} until 15:00` }))).toContain(EDITOR)
  expect(refused(await $.tool.call({ tool: 'Edit', file_path: 'E:\\s2\\Saved\\EDITOR_OWNER.txt', old_string: 'free', new_string: 'held' }))).toContain(EDITOR)
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'echo "free since 15:00" > E:/s2/Saved/EDITOR_OWNER.txt' }))).toContain(EDITOR)
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'cat E:/s2/Saved/EDITOR_OWNER.txt' }))).toBeUndefined()
  expect(w.read(LOCK)).toBe('free since 14:20\n')
})

test('extend fits before the end, once while others wait; release writes the FREE line with background=none', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, 'free since 14:20\n')
  await $.session.start(START)
  await $.tool.call({ tool: EDITOR, action: 'request', minutes: 20, what: 'tail VFX' } as never)
  expect(out(await $.tool.call({ tool: EDITOR, action: 'extend', minutes: 10 } as never))).toContain('extended until 15:10')
  expect(parseLockLine(w.read(LOCK)).end).toBe('15:10')
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', { want: want() }))
  expect(out(await $.tool.call({ tool: EDITOR, action: 'extend', minutes: 10 } as never))).toContain('extended once already')
  w.machine.procs = [{ name: 'UnrealEditor', pid: 91, gb: 26, parentAlive: true }]
  const rel = out(await $.tool.call({ tool: EDITOR, action: 'release', dont_save: ['/Game/S2/BP_Probe'] } as never))
  expect(rel).toContain('released')
  expect(w.read(LOCK)).toBe("FREE since=14:40 2026-10-06 by=3️⃣-Loco-fix note=Editor open PID 91, reusable; Don't-Save: /Game/S2/BP_Probe background=none · free since 14:40\n")
  expect(mine(w).want).toBe(null)
  expect(refused(await $.tool.call({ tool: 'mcp__unreal-mcp__call_tool', name: 'save_assets' } as never))).toContain(EDITOR)
})

test('notices: mid-turn they ride the main loop\'s next tool result, never a worker\'s; intent files never take one', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, 'free since 14:20\n')
  await $.session.start(START)
  // The model's calls carry a tool_use_id (a plugin's own `$.tool.call` does not): a turn runs, so the session is busy.
  await $.tool.call({ tool: EDITOR, action: 'request', minutes: 30, what: 'tail VFX', tool_use_id: 'tu1' } as never)
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc', { lane: 'loco', want: want({ minutes: 10 }), heartbeatAt: NOW + MIN, yieldAsks: [{ holder: ME8, at: NOW + 30_000, via: 'file', minutes: 10, lane: 'loco' }] }))
  await w.clock.advance(MIN)
  expect(prompts(w)).toEqual([]) // mid-turn: no prompt
  const worker = await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'w1', tool_use_id: 'tu2' } as never)
  expect((worker as { context?: string[] }).context ?? []).toEqual([])
  const main = await $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: 'tu3' } as never)
  expect(((main as { context?: string[] }).context ?? []).join('\n')).toContain('hai-flow · Editor yield — loco asks')
  const again = await $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: 'tu4' } as never)
  expect((again as { context?: string[] }).context ?? []).toEqual([])
  expect(prompts(w)).toEqual([])
  const note = 'hai-flow · Editor yield — loco asks for the Editor for ~10 min'
  w.put(`${PROJ}/docs/intent/tail-vfx/progress.md`, '# Progress\n')
  expect(refused(await $.tool.call({ tool: 'Write', file_path: `${PROJ}/docs/intent/tail-vfx/progress.md`, content: `# Progress\n- ${note}\n` }))).toContain('not logged in docs/intent')
  expect(refused(await $.tool.call({ tool: 'Edit', file_path: `${PROJ}/docs/intent/tail-vfx/findings.md`, old_string: 'x', new_string: `x\n${note}` }))).toContain('not logged in docs/intent')
  expect(refused(await $.tool.call({ tool: 'Write', file_path: `${PROJ}/docs/intent/tail-vfx/progress.md`, content: '# Progress\n- S3 done\n' }))).toBeUndefined()
})

test('RAM: before a grant the safe cleanup runs; under the launch gate the slot waits and names what holds memory', opts(), async ($, on) => {
  const w = world(on, { ram: '12', procs: [{ name: 'git', pid: 5, gb: 0.1, parentAlive: false }, { name: 'LiveCodingConsole', pid: 6, gb: 4.7, parentAlive: true }, { name: 'python', pid: 7, gb: 0.4, parentAlive: true }, { name: 'UnrealEditor-Cmd', pid: 8, gb: 3.1, parentAlive: true }] })
  w.put(LOCK, 'free since 14:20\n')
  await $.session.start(START)
  const ran = out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 20, what: 'tail VFX' } as never))
  expect(w.runs.some(r => r.includes('reap-orphan-git.ps1'))).toBe(true)
  expect(w.runs.some(r => r.includes('Stop-Process -Id 6'))).toBe(true)
  expect(w.runs.some(r => /Stop-Process -Id[^|]*\b(5|7|8)\b/.test(r))).toBe(false)
  expect(ran).toContain('free RAM is 12 GB after cleanup, under the launch gate of 28 GB for a slot without PIE')
  expect(ran).toContain('memory is held by LiveCodingConsole 4.7 GB, UnrealEditor-Cmd 3.1 GB')
  expect(w.read(LOCK)).toBe('free since 14:20\n')
})

test('RAM: LiveCodingConsole stays while an Editor runs, and an open Editor is reused without the launch gate', opts(), async ($, on) => {
  const w = world(on, { ram: '9', procs: [{ name: 'UnrealEditor', pid: 91, gb: 26, parentAlive: true }, { name: 'LiveCodingConsole', pid: 6, gb: 4.7, parentAlive: true }] })
  w.put(LOCK, 'FREE since=14:30 2026-10-06 by=walker note=Editor open PID 91, reusable background=none · free since 14:30\n')
  await $.session.start(START)
  const ran = out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 20, what: 'tail VFX', pie: true } as never))
  expect(w.runs.some(r => r.includes('Stop-Process'))).toBe(false)
  expect(ran).toContain('granted to this session until 15:00 (UnrealEditor PID 91 is open: reuse it)')
  expect(parseLockLine(w.read(LOCK)).pid).toBe(91)
})

const GATE_OPTS = { options: { a5WhenPresent: 'deny', editorLock: LOCK, pendingFile: PENDING, launchGatePieGb: 24 } }
test('RAM: the launch gate comes from the plugin options', GATE_OPTS, async ($, on) => {
  const w = world(on, { ram: '25' })
  w.put(LOCK, 'free since 14:20\n')
  await $.session.start(START)
  expect(out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 20, what: 'PIE proof', pie: true } as never))).toContain('granted')
})

test('RAM: the panel\'s shared launch gate wins over the options', GATE_OPTS, async ($, on) => {
  const w = world(on, { ram: '25', store: { gates: { pieGb: 30, nopieGb: 27 } } })
  w.put(LOCK, 'free since 14:20\n')
  await $.session.start(START)
  expect(out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 20, what: 'PIE proof', pie: true } as never))).toContain('under the launch gate of 30 GB')
})

test('RAM: one abort notice under 3 GB while this session\'s PIE runs; the disk under 20 GB is reported', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  on('turn.complete', async () => ({ text: '' }))
  w.put(LOCK, 'free since 14:20\n')
  await $.session.start(START)
  await $.tool.call({ tool: EDITOR, action: 'request', minutes: 30, what: 'PIE proof', pie: true } as never)
  expect(refused(await $.tool.call({ tool: 'mcp__unreal-mcp__call_tool', name: 'McpPieToolset.StartPIE' } as never))).toBeUndefined()
  await idle($)
  w.machine.ram = '2.5'
  w.machine.disk = 15
  await w.clock.advance(MIN)
  expect(prompts(w).length).toBe(1)
  expect(prompts(w)[0]).toContain('hai-flow · RAM — free RAM is 2.5 GB, under the 3 GB abort line, while this session\'s PIE runs → stop PIE now')
  expect(prompts(w)[0]).toContain('hai-flow · Disk — E: has 15 GB free, under 20 GB')
  await idle($)
  await w.clock.advance(2 * MIN)
  expect(prompts(w).length).toBe(1)
})

test('notices: one waiting for the next turn rides Hai\'s next prompt as context, once', opts(), async ($, on) => {
  const w = world(on, { disk: 15 })
  await $.session.start(START)
  expect(prompts(w)).toEqual([]) // the disk notice needs no prompt of its own
  await $.prompt.submit({ text: 'tiếp tục' } as never)
  await $.prompt.submit({ text: 'và tiếp' } as never)
  const ctx = (w.calls['prompt.submit'] ?? []).map(e => ((e as { context?: string[] }).context ?? []).join('\n'))
  expect(ctx[0]).toContain('hai-flow · Disk — E: has 15 GB free, under 20 GB')
  expect(ctx[1]).toBe('')
})

test('notices: Ather\'s intent log and findings never take a hai-flow line, by edit or by shell', opts(), async ($, on) => {
  const w = world(on)
  const log = `${PROJ}/docs/intent/tail-vfx/log.md`
  w.put(log, '# Log\n')
  const line = 'hai-flow · Sync main — cutoff: sync-lane merges origin/main at 15:30 → commit your own paths now'
  expect(refused(await $.tool.call({ tool: 'MultiEdit', file_path: log, edits: [{ old_string: '# Log', new_string: `# Log\n> ${line}` }] } as never))).toContain('not logged in docs/intent')
  expect(refused(await $.tool.call({ tool: 'Bash', command: `echo "${line}" >> ${PROJ}/docs/intent/tail-vfx/findings.md` }))).toContain('not logged in docs/intent')
  expect(refused(await $.tool.call({ tool: 'PowerShell', command: `Add-Content -Path ${PROJ.replace(/\//g, '\\')}\\docs\\intent\\tail-vfx\\log.md -Value '${line}'` }))).toContain('not logged in docs/intent')
  expect(refused(await $.tool.call({ tool: 'Bash', command: `echo "S5 done" >> ${PROJ}/docs/intent/tail-vfx/progress.md` }))).toBeUndefined()
  expect(w.read(log)).toBe('# Log\n')
})

// ---------- A9: one machine probe shared by every A5 session ----------
const PROBE = `${HF}/probe.json`
const sharedBy = (by: string, at: number, freeGb: number) => JSON.stringify({ at, by, probe: { freeGb, diskGb: 50, procs: [] } })
const probes = (w: ReturnType<typeof world>) => w.runs.filter(r => r.includes('ConvertTo-Json')).length

test('A9: while another session keeps the shared reading fresh, this one never probes; once it is stale, it probes once per period and shares it', opts(), async ($, on) => {
  const w = world(on, { ram: '33' })
  w.put(PROBE, sharedBy('bbbbbbbb', NOW - 10_000, 40))
  await $.session.start(START)
  for (let n = 1; n <= 3; n += 1) {
    w.put(PROBE, sharedBy('bbbbbbbb', NOW + n * MIN - 5_000, 40), NOW + n * MIN - 5_000)
    await w.clock.advance(MIN)
  }
  expect(probes(w)).toBe(0)
  expect(out(await $.tool.call({ tool: EDITOR, action: 'status' } as never))).toContain('"freeGb": 40')
  await w.clock.advance(MIN) // the other session stopped: the file is 65 s old
  expect(probes(w)).toBe(1)
  expect(JSON.parse(w.read(PROBE))).toEqual({ at: NOW + 4 * MIN, by: ME8, probe: { freeGb: 33, diskGb: 40, procs: [] } })
  await w.clock.advance(MIN)
  expect(probes(w)).toBe(2) // alone, one probe per tick (each ≥ 50 s apart)
})

test('A9: a grant reads the machine itself, even when the shared reading is fresh', opts(), async ($, on) => {
  const w = world(on, { ram: '20' })
  w.put(PROBE, sharedBy('bbbbbbbb', NOW - 5_000, 40)) // says 40 GB free
  w.put(LOCK, 'free since 14:20\n')
  await $.session.start(START)
  expect(probes(w)).toBe(0)
  const ran = out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 20, what: 'tail VFX' } as never))
  expect(probes(w)).toBe(1)
  expect(ran).toContain('free RAM is 20 GB after cleanup, under the launch gate of 28 GB')
  expect(w.read(LOCK)).toBe('free since 14:20\n')
  expect(JSON.parse(w.read(PROBE)).probe.freeGb).toBe(20) // the fresh reading is shared
})
