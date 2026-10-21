import { expect, test } from 'claude-code/testing'
import { DEFAULT_GATES, PASS_MAX_MIN, blankSession, decide, heavyList, heldLine, mayAskYield, newSync, parseLockLine, parseProbe, passEndOk, queueOf, type Decision, type GrantInput, type Probe, type SessionFile, type Want } from '../hooks/coord.ts'
import { launchesEditor } from '../hooks/editor.ts'
import { queueRowText, queueView } from '../hooks/lease.ts'
import { NUDGE_IDLE_MS, idleMsOf, isIdle } from '../hooks/nudge.ts'
import { isMemoryNoteDue, isWaitLogDue, lastMemoryNote, waitNote } from '../hooks/waits.ts'
import { LOCK, ME, NOW, PROJ, opts, refused, world, type Rec } from './world.ts'

// Rev 38 (L-42: the Editor sat free from 20:06 to 09:27 while session-daa8b2d4 (no PIE, gate 28 GB) and autovault-triage
// (PIE, gate 38 GB) were queued, and nothing recorded why): A112 each session's wait decision on record and on the panel,
// A113 a head held back by memory does not block a request that fits, A114 a grant (and a memory note) reaches an idle
// session.
const HF = 'E:/s2/Saved/A5R'
const LOG = `${HF}/orchestrate.log`
const ME8 = ME.slice(0, 8)
const EDITOR = 'mcp__a5r__editor'
const START = { cwd: PROJ, surface: 'terminal', isInteractive: true } as never
const MIN = 60_000
const SID = (id8: string) => `${id8}-1111-4000-8000-000000000000`
const FREE = 'FREE since=14:30 2026-10-06 by=lane-bbbbbbbb note=done background=none · free since 14:30\n'
const TOP = [{ name: 'claude', n: 32, gb: 8.5 }, { name: 'chrome', n: 20, gb: 2.7 }, { name: 'git', n: 12, gb: 1.2 }]
const want = (o: Partial<Want> = {}): Want => ({ minutes: 30, pie: false, build: false, what: 'their slot', mode: 'unattended', pausable: true, nextSafe: 'after save', requestedAt: NOW - 30 * MIN, ...o })
const file = (id8: string, o: Partial<SessionFile> = {}): SessionFile => ({ ...blankSession(SID(id8), `lane-${id8}`, `title ${id8}`, NOW), lastTurnAt: NOW - 2 * MIN, ...o })
// A peer kept alive for the whole test (its a5r's heartbeat).
const peer = (id8: string, o: Partial<SessionFile> = {}): string => JSON.stringify({ ...file(id8, o), heartbeatAt: NOW + 300 * MIN })
const held = (id8: string, since: number, end: number) => `${heldLine({ lane: `lane-${id8}`, sessionName: `title-${id8}`, id8, since, pid: null, end, mode: 'interactive', pausable: true, nextSafe: 'after save', note: 'their slot' })}\n`
const probe = (freeGb: number, o: Partial<Probe> = {}): Probe => ({ freeGb, diskGb: 40, procs: [], ...o })
const input = (me8: string, files: SessionFile[], freeGb: number, o: Partial<GrantInput> = {}): GrantInput => ({ me8, lock: parseLockLine(FREE), files, lanes: [], now: NOW, sync: null, probe: probe(freeGb), gates: DEFAULT_GATES, ...o })
const grants = (files: SessionFile[], freeGb: number, o: Partial<GrantInput> = {}): string[] => files.filter(f => decide(input(f.id8, files, freeGb, o)).kind === 'grant').map(f => f.id8)
const prompts = (w: ReturnType<typeof world>): string[] => (w.calls['prompt.submit'] ?? []).map(e => String((e as Rec).text))
const out = (ran: { result?: unknown; text?: string; deny?: string }): string => String(ran.deny ?? ran.result ?? ran.text ?? '')
const idle = async ($: any) => $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
const waitLines = (w: ReturnType<typeof world>): string[] => w.read(LOG).split('\n').filter(l => l.includes('| rule=wait |'))
const lockId = (w: ReturnType<typeof world>): string => parseLockLine(w.read(LOCK)).id8
const asWait = (d: Decision) => (d.kind === 'wait' ? d : null)

// The two sessions of the night (L-42) and later requests.
const HEAD = file('daa8b2d4', { lane: 'session-daa8b2d4', want: want({ minutes: 25, requestedAt: NOW - 30 * MIN }) }) // no PIE: gate 28
const PIE_HEAD = file('df9d2d62', { lane: 'autovault-triage', want: want({ minutes: 40, pie: true, pausable: false, requestedAt: NOW - 20 * MIN }) }) // gate 38
const BUILD = file('b1b1b1b1', { want: want({ minutes: 45, build: true, launch: false, requestedAt: NOW - 10 * MIN }) })
const NOPIE = file('c1c1c1c1', { want: want({ minutes: 45, requestedAt: NOW - 10 * MIN }) })

// ---------- A113: unit ----------
test('A113: unit: a 28 GB head with 27 GB free lets a launch:false build through, capped at 30 min; the head keeps waiting on memory', () => {
  const files = [HEAD, BUILD]
  const d = decide(input(BUILD.id8, files, 27))
  expect(d).toEqual({ kind: 'grant', end: NOW + PASS_MAX_MIN * MIN, reuse: null, pass: HEAD.id8 })
  expect(asWait(decide(input(HEAD.id8, files, 27)))?.code).toBe('ram')
  expect(queueOf(files, [], NOW, null).map(f => f.id8)).toEqual([HEAD.id8, BUILD.id8]) // the head keeps its place
})

test('A113: unit: a PIE head at 38 GB with 30 GB free lets a no-PIE 28 GB request through; with 27 GB nobody fits and both wait on memory', () => {
  const files = [PIE_HEAD, NOPIE]
  expect(decide(input(NOPIE.id8, files, 30))).toEqual({ kind: 'grant', end: NOW + PASS_MAX_MIN * MIN, reuse: null, pass: PIE_HEAD.id8 })
  const d = asWait(decide(input(NOPIE.id8, files, 27)))
  expect([d?.code, d?.place, d?.why]).toEqual(['ram', 2, 'free RAM is 27 GB after cleanup, under the launch gate of 28 GB for a slot without PIE'])
  expect(d?.next).toContain('autovault-triage (first in the queue) waits for memory too')
})

test('A113: unit: the head is next when memory allows (no pass then), and an Editor already open means no memory wait at all', () => {
  expect(grants([HEAD, BUILD], 28)).toEqual([HEAD.id8])
  expect(asWait(decide(input(BUILD.id8, [HEAD, BUILD], 28)))?.code).toBe('queue')
  const open = probe(20, { procs: [{ name: 'UnrealEditor', pid: 4242, gb: 26, parentAlive: true }] })
  expect(grants([HEAD, BUILD], 20, { probe: open })).toEqual([HEAD.id8]) // reuses the open Editor
})

test('A113: unit: a head that has waited 2 h or more is never passed (aging); at 1 h 59 min it still is', () => {
  const old = file('daa8b2d4', { want: want({ requestedAt: NOW - 120 * MIN }) })
  const d = asWait(decide(input(BUILD.id8, [old, BUILD], 27)))
  expect([d?.code, d?.why]).toEqual(['queue', 'the Editor is free but lane-daa8b2d4 asked first (it has waited 2 h or more for memory: nobody goes before it now)'])
  expect(grants([old, BUILD], 27)).toEqual([])
  expect(grants([file('daa8b2d4', { want: want({ requestedAt: NOW - 119 * MIN }) }), BUILD], 27)).toEqual([BUILD.id8])
})

test('A113: unit: every session computes the same single passer from the same files (the first that fits, in queue order)', () => {
  const nopie = file(NOPIE.id8, { want: want({ minutes: 45, requestedAt: NOW - 12 * MIN }) })
  const late = file('e1e1e1e1', { want: want({ minutes: 20, build: true, launch: false, requestedAt: NOW - 5 * MIN }) })
  const files = [PIE_HEAD, nopie, BUILD, late]
  expect(queueOf(files, [], NOW, null).map(f => f.id8)).toEqual([PIE_HEAD.id8, nopie.id8, BUILD.id8, late.id8])
  expect(grants(files, 30)).toEqual([nopie.id8]) // both no-PIE and the builds fit: only the first in order passes
  expect(grants(files, 25)).toEqual([BUILD.id8]) // under 28 only the launch:false ones fit: the first of them
  for (const f of files) expect(queueView(input(f.id8, files, 30)).rows.map(r => r.wait)).toEqual(['ram', 'pass', 'queue', 'queue']) // the same in every session
  for (const f of files) expect(queueView(input(f.id8, files, 25)).rows.map(r => r.wait)).toEqual(['ram', 'ram', 'pass', 'queue'])
})

test('A113: unit: a sync block stays a block: in another holder\'s freeze nobody passes; a capped slot crossing a planned cutoff does not pass', () => {
  const frozen = newSync(NOW - 5 * MIN, { session: SID('5e5e5e5e'), id8: '5e5e5e5e', lane: 'sync-main' }, 'sync-main', NOW - 60 * MIN)
  const holder = file('5e5e5e5e', { lane: 'sync-main' })
  expect(grants([HEAD, BUILD, holder], 27, { sync: frozen })).toEqual([])
  expect(asWait(decide(input(HEAD.id8, [HEAD, BUILD, holder], 27, { sync: frozen })))?.code).toBe('sync') // the head's reason is the sync, not memory
  expect(asWait(decide(input(BUILD.id8, [HEAD, BUILD, holder], 27, { sync: frozen })))?.code).toBe('queue')
  // Cutoff in 25 min: the head's 25-min slot fits before it (it waits on memory), the build's 30-min pass would cross it.
  const planned = newSync(NOW + 55 * MIN, { session: SID('5e5e5e5e'), id8: '5e5e5e5e', lane: 'sync-main' }, 'sync-main', NOW - 60 * MIN)
  expect(asWait(decide(input(HEAD.id8, [HEAD, BUILD, holder], 27, { sync: planned })))?.code).toBe('ram')
  expect(grants([HEAD, BUILD, holder], 27, { sync: planned })).toEqual([])
  expect(asWait(decide(input(BUILD.id8, [HEAD, BUILD, holder], 27, { sync: planned })))?.code).toBe('sync')
  expect(grants([HEAD, BUILD, holder], 27, { mergeHead: true })).toEqual([]) // A61: a merge in progress too
})

test('A113: unit: the pass slot stays within 30 min in all while its head is queued; the head never asks it to yield', () => {
  expect(passEndOk(HEAD.id8, NOW, NOW + 30 * MIN, [HEAD])).toBe(true)
  expect(passEndOk(HEAD.id8, NOW, NOW + 31 * MIN, [HEAD])).toBe(false)
  expect(passEndOk(HEAD.id8, NOW, NOW + 45 * MIN, [])).toBe(true) // the head withdrew or was granted: an ordinary lease
  // The passer is between Editor work (10 min into its slot, 20 left): only the pass keeps the head's yield ask back.
  const slot = { since: NOW - 10 * MIN, end: NOW + 20 * MIN, extended: 0 }
  const head = file(HEAD.id8, { want: want({ minutes: 15 }) })
  const lock = parseLockLine(held(BUILD.id8, slot.since, slot.end))
  expect(mayAskYield(input(HEAD.id8, [head, file(BUILD.id8, { holding: { ...slot, pass: HEAD.id8 } })], 27, { lock }))).toBe(null)
  expect(mayAskYield(input(HEAD.id8, [head, file(BUILD.id8, { holding: slot })], 27, { lock }))).toEqual({ holder: BUILD.id8 })
})

test('A113: unit: a command that launches an Unreal Editor (headless runs and the S2 launcher included); stopping or building is not one', () => {
  for (const c of ['"D:/UE/Engine/Binaries/Win64/UnrealEditor.exe" "E:/s2/S2.uproject" -unattended', 'Start-Process -FilePath UnrealEditor.exe -ArgumentList "E:/s2/S2.uproject"', '& "D:/UE/Engine/Binaries/Win64/UnrealEditor-Cmd.exe" "E:/s2/S2.uproject" -run=pythonscript', 'powershell -File docs/handoff/pie-perf-tools/launch_s2.ps1'])
    expect([c, launchesEditor(c)]).toEqual([c, true])
  for (const c of ['Stop-Process -Name UnrealEditor', '"D:/UE/Engine/Build/BatchFiles/Build.bat" S2Editor Win64 Development -Project="E:/s2/S2.uproject"', 'git status'])
    expect([c, launchesEditor(c)]).toEqual([c, false])
})

// ---------- A112: unit ----------
test('A112: unit: a wait line is due on a change of code or place, else every 15 min; its note carries code, free RAM, gate, place and the heaviest processes', () => {
  const d = { kind: 'wait' as const, code: 'ram' as const, why: '', next: '', place: 1 }
  expect(isWaitLogDue(null, d, NOW)).toBe(true)
  expect(isWaitLogDue({ key: 'ram:1', at: NOW }, d, NOW + 14 * MIN)).toBe(false)
  expect(isWaitLogDue({ key: 'ram:1', at: NOW }, d, NOW + 15 * MIN)).toBe(true)
  expect(isWaitLogDue({ key: 'queue:1', at: NOW }, d, NOW + MIN)).toBe(true)
  expect(isWaitLogDue({ key: 'ram:2', at: NOW }, d, NOW + MIN)).toBe(true)
  expect(waitNote(d, want(), probe(27.4, { top: TOP }), DEFAULT_GATES)).toBe('wait ram · freeGb 27.4 · gateGb 28 · place 1 · heavy claude ×32 8.5 GB, chrome ×20 2.7 GB, git ×12 1.2 GB')
  expect(waitNote({ ...d, code: 'queue', place: 2 }, want({ pie: true }), null, DEFAULT_GATES)).toBe('wait queue · freeGb unknown · gateGb 38 (PIE) · place 2 · heavy unknown')
  expect(waitNote(d, want({ launch: false }), probe(20), DEFAULT_GATES)).toContain('gateGb none (launch false)')
})

test('A112: unit: the probe reads every process by name (claude and Chrome, which the named list never shows) and heavyList names them first', () => {
  const p = parseProbe(JSON.stringify({ freeGb: 27.4, diskGb: 120, procs: [{ name: 'git', pid: 1, gb: 0.1, parentAlive: true }], top: TOP }))
  expect(p?.top).toEqual(TOP)
  expect(heavyList(p as Probe)).toBe('claude ×32 8.5 GB, chrome ×20 2.7 GB, git ×12 1.2 GB')
  expect(heavyList(parseProbe(JSON.stringify({ freeGb: 27.4, diskGb: 120, procs: [{ name: 'git', pid: 1, gb: 0.1, parentAlive: true }] })) as Probe)).toBe('git 0.1 GB') // an older probe file
})

test('A112: unit: the queue view and status line give each queued session its wait code', () => {
  const files = [HEAD, BUILD, NOPIE]
  const rows = queueView(input(ME8, files, 27)).rows
  expect(rows.map(r => [r.id8, r.wait])).toEqual([[HEAD.id8, 'ram'], [BUILD.id8, 'pass'], [NOPIE.id8, 'ram']])
  expect(rows.map(queueRowText)).toEqual(['waited 30 min · asks 25 min · wait ram', `waited 10 min · asks 45 min · build · passes the head (≤ ${PASS_MAX_MIN} min)`, 'waited 10 min · asks 45 min · wait ram'])
  expect(queueView(input(ME8, files, 30)).rows.map(r => r.wait)).toEqual(['grant', 'queue', 'queue'])
})

// ---------- A114: unit ----------
test('A114: unit: idle by the session\'s own facts; the memory note once an hour, only for a memory wait after an hour idle', () => {
  expect(idleMsOf({ now: NOW, lastTurnAt: NOW - 12 * MIN, turnSignalAt: NOW - 11 * MIN, mainCalls: 0, agents: 0 })).toBe(11 * MIN)
  expect(idleMsOf({ now: NOW, lastTurnAt: NOW - 12 * MIN, turnSignalAt: 0, mainCalls: 1, agents: 0 })).toBe(0) // a long foreground call
  expect(idleMsOf({ now: NOW, lastTurnAt: NOW - 12 * MIN, turnSignalAt: 0, mainCalls: 0, agents: 1 })).toBe(0)
  expect([NUDGE_IDLE_MS, isIdle(10 * MIN), isIdle(10 * MIN - 1)]).toEqual([10 * MIN, true, false]) // A91's idle, one definition
  const ram: Decision = { kind: 'wait', code: 'ram', why: '', next: '', place: 1 }
  expect(isMemoryNoteDue({ d: ram, idleMs: 60 * MIN, lastAt: 0, now: NOW })).toBe(true)
  expect(isMemoryNoteDue({ d: ram, idleMs: 59 * MIN, lastAt: 0, now: NOW })).toBe(false)
  expect(isMemoryNoteDue({ d: ram, idleMs: 90 * MIN, lastAt: NOW - 59 * MIN, now: NOW })).toBe(false)
  expect(isMemoryNoteDue({ d: { ...ram, code: 'queue' }, idleMs: 90 * MIN, lastAt: 0, now: NOW })).toBe(false)
  expect(lastMemoryNote(['editor:granted:1', `editor:memory:${NOW - 70 * MIN}`, `editor:memory:${NOW - 5 * MIN}`])).toBe(NOW - 5 * MIN)
})

// ---------- A112: engine ----------
test('A112: a queued session logs its wait (rule wait) once, again after 15 min, and at once when its code changes', opts(), async ($, on) => {
  const w = world(on, { ram: '20.5', top: TOP })
  w.put(LOCK, FREE)
  await $.session.start(START)
  expect(out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 30, what: 'PIE check' } as never))).toContain('under the launch gate of 28 GB')
  expect(waitLines(w)).toHaveLength(1)
  expect(waitLines(w)[0]).toContain(`| rule=wait | lane=`)
  expect(waitLines(w)[0]).toContain(`| session=${ME8} |`)
  expect(waitLines(w)[0]).toContain('note=wait ram; freeGb 20.5; gateGb 28; place 1; heavy claude ×32 8.5 GB, chrome ×20 2.7 GB, git ×12 1.2 GB')
  for (let n = 0; n < 13; n += 1) await w.clock.advance(MIN)
  expect(waitLines(w)).toHaveLength(1) // 13 min, the same code and place
  await w.clock.advance(2 * MIN)
  expect(waitLines(w)).toHaveLength(2) // 15 min
  w.put(LOCK, held('bbbbbbbb', NOW, NOW + 60 * MIN))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', { holding: { since: NOW, end: NOW + 60 * MIN, extended: 0 }, agents: 1 }))
  await w.clock.advance(MIN)
  expect(waitLines(w)).toHaveLength(3)
  expect(waitLines(w)[2]).toContain('note=wait held;')
})

test('A112: a request withdrawn and asked again within 15 min is logged again (the throttle ends with the wait)', opts(), async ($, on) => {
  const w = world(on, { ram: '20.5' })
  w.put(LOCK, FREE)
  await $.session.start(START)
  await $.tool.call({ tool: EDITOR, action: 'request', minutes: 30, what: 'PIE check' } as never)
  await $.tool.call({ tool: EDITOR, action: 'release' } as never) // not holding: the request is withdrawn
  await w.clock.advance(MIN)
  await $.tool.call({ tool: EDITOR, action: 'request', minutes: 30, what: 'PIE check again' } as never)
  expect(waitLines(w)).toHaveLength(2)
})

// ---------- A113: engine ----------
test('A113: a launch:false build goes before a 28 GB head with 27 GB free: granted for 30 min, no extension past them, no Editor launch in it', opts(), async ($, on) => {
  const w = world(on, { ram: '27' })
  on('turn.complete', async () => ({ text: '' }))
  w.put(LOCK, FREE)
  w.put(`${HF}/editor/daa8b2d4.json`, peer('daa8b2d4', { lane: 'session-daa8b2d4', want: want({ minutes: 25 }) }))
  await $.session.start(START)
  const r = out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 45, build: true, launch: false, what: 'S2Editor build' } as never))
  expect(lockId(w)).toBe(ME8)
  expect(r).toContain('A5R · Editor — granted to this session until 15:10 (a slot of at most 30 min before session-daa8b2d4, first in the queue, which waits for memory)')
  expect(r).toContain('do the work that launches no Editor (asked with launch: false; an Editor launch is refused in this slot)')
  expect(parseLockLine(w.read(LOCK)).end).toBe('15:10')
  const ext = out(await $.tool.call({ tool: EDITOR, action: 'extend', minutes: 15 } as never))
  expect(ext).toContain('this slot went before session-daa8b2d4, which waits for memory, so it is at most 30 min in all; extended to 15:25 it would be 45 min')
  expect(parseLockLine(w.read(LOCK)).end).toBe('15:10')
  const launch = refused(await $.tool.call({ tool: 'Bash', command: '"D:/UE/Engine/Binaries/Win64/UnrealEditor.exe" "E:/s2/S2.uproject"' } as never))
  expect(launch).toContain('A5R · Editor — this slot went before session-daa8b2d4 (first in the queue, waiting for memory) because it was asked with launch: false')
  expect(launch).toContain('to launch one, release and request again without launch: false')
  expect(refused(await $.tool.call({ tool: 'Bash', command: '"D:/UE/Engine/Build/BatchFiles/Build.bat" S2Editor Win64 Development' } as never))).toBe(undefined) // the build runs
  // An Editor started another way (a driver, MCP) is seen at the minute: the holder is told to close it.
  await idle($)
  w.machine.procs = [{ name: 'UnrealEditor', pid: 4242, gb: 22, parentAlive: true }]
  await w.clock.advance(MIN)
  expect(prompts(w).some(p => p.includes('an Unreal Editor (PID 4242) runs in this session\'s slot, which went before session-daa8b2d4'))).toBe(true)
})

test('A113: a no-PIE request goes before a PIE head (38 GB) with 30 GB free; after it the head is granted first when memory allows', opts(), async ($, on) => {
  const w = world(on, { ram: '30' })
  w.put(LOCK, FREE)
  w.put(`${HF}/editor/df9d2d62.json`, peer('df9d2d62', { lane: 'autovault-triage', want: want({ minutes: 40, pie: true }) }))
  await $.session.start(START)
  expect(out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 60, what: 'headless bake' } as never))).toContain('granted to this session until 15:10 (a slot of at most 30 min before autovault-triage')
  expect(JSON.parse(w.read(`${HF}/editor/${ME8}.json`)).holding.pass).toBe('df9d2d62')
  // Its own launch gate is met: it launches its Editor (only a launch:false pass slot may not).
  expect(refused(await $.tool.call({ tool: 'Bash', command: '"D:/UE/Engine/Binaries/Win64/UnrealEditor.exe" "E:/s2/S2.uproject"' } as never))).toBe(undefined)
  await $.tool.call({ tool: EDITOR, action: 'release', note: 'done' } as never)
  w.machine.ram = '40'
  // This session asks again: the head (asked first) is next and memory now allows it: this session waits behind it.
  const again = out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 20, what: 'second bake' } as never))
  expect(again).toContain('the Editor is free but autovault-triage asked first')
  expect(lockId(w)).toBe('')
})

test('A113: past 2 h of waiting nobody passes the head: the launch:false request waits in the queue', opts(), async ($, on) => {
  const w = world(on, { ram: '27' })
  w.put(LOCK, FREE)
  w.put(`${HF}/editor/daa8b2d4.json`, peer('daa8b2d4', { lane: 'session-daa8b2d4', want: want({ minutes: 25, requestedAt: NOW - 130 * MIN }) }))
  await $.session.start(START)
  expect(out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 30, build: true, launch: false, what: 'build' } as never))).toContain('(it has waited 2 h or more for memory: nobody goes before it now)')
  expect(parseLockLine(w.read(LOCK)).kind).toBe('free')
})

// ---------- A114: engine ----------
test('A114: an idle queued session is woken by its grant whatever held it back: here the head ahead of it withdrew', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  on('turn.complete', async () => ({ text: '' }))
  w.put(LOCK, FREE)
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc', { want: want({ minutes: 30, requestedAt: NOW - 60 * MIN }) }))
  await $.session.start(START)
  expect(out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 30, what: 'PIE check' } as never))).toContain('asked first')
  await idle($)
  for (let n = 0; n < 11; n += 1) await w.clock.advance(MIN)
  expect(prompts(w)).toEqual([])
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc')) // the head withdrew its request
  await w.clock.advance(MIN)
  expect(lockId(w)).toBe(ME8)
  expect(prompts(w).filter(p => p.includes('granted to this session'))).toHaveLength(1)
})

test('A114: a busy flag left by a prompt whose turn never ran does not keep the grant from an idle session; a busy session gets it on its next tool result', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  on('turn.complete', async () => ({ text: '' }))
  w.put(LOCK, held('bbbbbbbb', NOW, NOW + 60 * MIN))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', { holding: { since: NOW, end: NOW + 60 * MIN, extended: 0 }, agents: 1 }))
  await $.session.start(START)
  await $.tool.call({ tool: EDITOR, action: 'request', minutes: 30, what: 'PIE check' } as never)
  await idle($)
  await $.prompt.submit({ text: 'an Ather notice', wait: false, origin: { kind: 'plugin', name: 'ather-automata' } } as never) // busy: its turn never runs
  for (let n = 0; n < 11; n += 1) await w.clock.advance(MIN)
  w.put(LOCK, FREE)
  await w.clock.advance(MIN)
  expect(lockId(w)).toBe(ME8)
  expect(prompts(w).filter(p => p.includes('granted to this session'))).toHaveLength(1)
})

test('A114: a session busy in a turn is not prompted at its grant; the grant rides its next tool result', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, held('bbbbbbbb', NOW, NOW + 60 * MIN))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', { holding: { since: NOW, end: NOW + 60 * MIN, extended: 0 }, agents: 1 }))
  await $.session.start(START)
  await $.tool.call({ tool: EDITOR, action: 'request', minutes: 30, what: 'PIE check' } as never)
  await $.tool.call({ tool: 'Bash', command: 'git status' } as never) // the turn goes on
  w.put(LOCK, FREE)
  await w.clock.advance(MIN)
  expect(lockId(w)).toBe(ME8)
  expect(prompts(w)).toEqual([])
  const next = await $.tool.call({ tool: 'Bash', command: 'git log -1' } as never)
  expect(((next as { context?: string[] }).context ?? []).join('\n')).toContain('granted to this session')
})

test('A114: a queued session idle an hour while the Editor is free and only memory holds it back is told what holds the memory, at most once an hour', opts(), async ($, on) => {
  const w = world(on, { ram: '20.5', top: TOP })
  on('turn.complete', async () => ({ text: '' }))
  w.put(LOCK, FREE)
  await $.session.start(START)
  await $.tool.call({ tool: EDITOR, action: 'request', minutes: 30, what: 'PIE check' } as never)
  await idle($)
  for (let n = 0; n < 59; n += 1) await w.clock.advance(MIN)
  expect(prompts(w)).toEqual([])
  await w.clock.advance(MIN)
  const told = prompts(w).filter(p => p.includes('held back only by memory'))
  expect(told).toHaveLength(1)
  expect(told[0]).toContain('A5R · Editor — the Editor is free and you are queued, idle for 60 min, held back only by memory: free RAM is 20.5 GB after cleanup, under the launch gate of 28 GB for a slot without PIE; memory is held by claude ×32 8.5 GB, chrome ×20 2.7 GB, git ×12 1.2 GB')
  for (let n = 0; n < 50; n += 1) await w.clock.advance(MIN) // the wake started no turn: still idle, but told less than an hour ago
  expect(prompts(w).filter(p => p.includes('held back only by memory'))).toHaveLength(1)
  for (let n = 0; n < 10; n += 1) await w.clock.advance(MIN)
  expect(prompts(w).filter(p => p.includes('held back only by memory'))).toHaveLength(2)
})

test('A114: a queued session that worked within the hour is not told about memory', opts(), async ($, on) => {
  const w = world(on, { ram: '20.5', top: TOP })
  on('turn.complete', async () => ({ text: '' }))
  w.put(LOCK, FREE)
  await $.session.start(START)
  await $.tool.call({ tool: EDITOR, action: 'request', minutes: 30, what: 'PIE check' } as never)
  await idle($)
  for (let n = 0; n < 40; n += 1) await w.clock.advance(MIN)
  await $.tool.call({ tool: 'Bash', command: 'git status' } as never)
  await idle($)
  for (let n = 0; n < 40; n += 1) await w.clock.advance(MIN)
  expect(prompts(w).filter(p => p.includes('held back only by memory'))).toEqual([])
})
