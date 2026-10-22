import { expect, test } from 'claude-code/testing'
import { DEFAULT_GATES, NO_MANUAL, blankSession, decide, gatesOf, heldLine, isYieldMoment, mayAskYield, parseLockLine, type GrantInput, type SessionFile, type Want } from '../hooks/coord.ts'
import { EDITOR_WORK, LEASES_MAX, appendCapped, endLease, isIdleHolder, isRetestExtension, keepableOf, leaseSummary, parseLeases, placeOf, queueView, releaseReason, returnOf, summaryLine, yieldTold, type LeaseRecord } from '../hooks/lease.ts'
import { A5RPANE, LOCK, ME, NOW, PROJ, find, opts, text, world, type Rec } from './world.ts'

// Rev 34 (L-38: the Editor passes from hand to hand and no task finishes): A100 a record per lease and its 24-hour summary,
// A101 busy is not idle, A102 a retest in the same slot, A103 no yield ask in the middle of Editor work, A104 a forced
// release keeps its place, A105 the queue on the panel and in status, A106 the PIE launch gate at 38 GB.
const HF = 'E:/s2/Saved/A5R'
const LEASES = `${HF}/leases.jsonl`
const ME8 = ME.slice(0, 8)
const EDITOR = 'mcp__a5r__editor'
const UNREAL = 'mcp__unreal-mcp__call_tool'
const START = { cwd: PROJ, surface: 'terminal', isInteractive: true } as never
const T = (h: number, m: number) => new Date(2026, 9, 6, h, m).getTime()
const MIN = 60_000
const SID = (id8: string) => `${id8}-1111-4000-8000-000000000000`
const EDITOR_PROC = { name: 'UnrealEditor', pid: 45392, gb: 26, parentAlive: true }
const want = (o: Partial<Want> = {}): Want => ({ minutes: 30, pie: false, build: false, what: 'their slot', mode: 'interactive', pausable: true, nextSafe: 'after save', requestedAt: NOW - 5 * MIN, ...o })
const peer = (id8: string, o: Partial<SessionFile> = {}): string => JSON.stringify({ ...blankSession(SID(id8), `lane-${id8}`, `title ${id8}`, NOW), ...o })
const held = (id8: string, since: number, end: number, o: { pid?: number | null; note?: string } = {}) =>
  `${heldLine({ lane: `lane-${id8}`, sessionName: `title-${id8}`, id8, since, pid: o.pid ?? null, end, mode: 'interactive', pausable: true, nextSafe: 'after save', note: o.note ?? 'their slot' })}\n`
const mine = (w: ReturnType<typeof world>): SessionFile => JSON.parse(w.read(`${HF}/editor/${ME8}.json`) || '{}') as SessionFile
const meHolding = (w: ReturnType<typeof world>, since: number, end: number, o: Partial<SessionFile> = {}) =>
  w.put(`${HF}/editor/${ME8}.json`, JSON.stringify({ ...blankSession(ME, 'tail-vfx', 'Tail', NOW), lastTurnAt: NOW, want: want({ requestedAt: since - 10 * MIN }), holding: { since, end, extended: 0 }, ...o }))
const prompts = (w: ReturnType<typeof world>): string[] => (w.calls['prompt.submit'] ?? []).map(e => String((e as Rec).text))
const out = (ran: { result?: unknown; text?: string; deny?: string }): string => String(ran.deny ?? ran.result ?? ran.text ?? '')
const idle = async ($: any) => $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
const rec = (o: Partial<LeaseRecord>): LeaseRecord => ({ v: 1, lane: 'loco', id8: 'bbbbbbbb', requestedAt: T(10, 0), grantedAt: T(10, 10), reusedPid: null, minutes: 30, firstEditorSeenAt: T(10, 13), pieAt: null, extensions: 0, endAt: T(10, 40), endReason: 'released', editorLeftOpen: false, queueAtGrant: 0, pie: false, build: false, pieAborted: false, ...o })

// ---------- A100 ----------
test('A100: unit: the 24-hour summary: leases, median wait, launch share, yields, returns, PIE aborts, sync hours; older than 24 h left out', () => {
  const now = T(16, 0)
  const recs = [
    rec({ requestedAt: T(10, 0), grantedAt: T(10, 10), firstEditorSeenAt: T(10, 13), endAt: T(10, 40), endReason: 'yielded' }), // waited 10, launched 3 of 30
    rec({ requestedAt: T(10, 0), grantedAt: T(10, 50), firstEditorSeenAt: T(10, 50), endAt: T(11, 20) }), // the same lane again: a return; waited 50, launch 0 of 30
    rec({ lane: 'tail', id8: 'cccccccc', requestedAt: T(11, 0), grantedAt: T(11, 20), firstEditorSeenAt: null, endAt: T(11, 50), pieAborted: true, endReason: 'overrun' }), // waited 20, never launched: 30 of 30
    rec({ lane: 'sync', id8: 'dddddddd', requestedAt: T(12, 0), grantedAt: T(12, 0), endAt: T(13, 30), endReason: 'sync' }), // 1.5 h of sync
    rec({ grantedAt: T(10, 0) - 25 * 3_600_000, endAt: T(10, 30) - 25 * 3_600_000 }), // 25 h ago: out
  ]
  const s = leaseSummary(recs, now)
  expect(s).toEqual({ leases: 4, medianWaitMin: 20, launchSharePct: 37, yields: 1, returns: 1, pieAborts: 1, syncHours: 1.5 })
  expect(summaryLine(s)).toBe('24 h: 4 leases · median wait 20 min · launch 37% · 1 yield · 1 return · 1 PIE abort · sync 1.5 h')
  expect(leaseSummary([], now)).toEqual({ leases: 0, medianWaitMin: null, launchSharePct: null, yields: 0, returns: 0, pieAborts: 0, syncHours: 0 })
})

test('A100: unit: the file keeps the last 2,000 lines; unreadable lines are skipped', () => {
  const full = Array.from({ length: LEASES_MAX + 4 }, (_, n) => JSON.stringify(rec({ endAt: n }))).join('\n')
  const lines = appendCapped(full, JSON.stringify(rec({ endAt: LEASES_MAX + 4 }))).trim().split('\n')
  expect(appendCapped('', JSON.stringify(rec({})))).toBe(`${JSON.stringify(rec({}))}\n`)
  expect([lines.length, (JSON.parse(lines[0] ?? '{}') as LeaseRecord).endAt, (JSON.parse(lines.at(-1) ?? '{}') as LeaseRecord).endAt]).toEqual([LEASES_MAX, 5, LEASES_MAX + 4])
  expect(parseLeases(`${JSON.stringify(rec({}))}\nnot json\n{"lane":"x"}\n`).length).toBe(1)
})

test('A100: a released lease leaves one record: requested and granted, the Editor reused, minutes, first Editor, first PIE, extensions, end, reason, Editor left open, queue at the grant', opts(), async ($, on) => {
  const w = world(on, { ram: '40', procs: [EDITOR_PROC] })
  w.put(LOCK, 'free since 14:20\n')
  await $.session.start(START)
  expect(out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 20, what: 'tail VFX' } as never))).toContain('granted to this session until 15:00')
  await w.clock.advance(MIN) // 14:41
  await $.tool.call({ tool: UNREAL, name: 'McpPieToolset.StartPIE' } as never)
  await $.tool.call({ tool: UNREAL, name: 'McpPieToolset.StopPIE' } as never)
  expect(out(await $.tool.call({ tool: EDITOR, action: 'extend', minutes: 10 } as never))).toContain('extended until 15:10')
  await w.clock.advance(MIN) // 14:42
  expect(out(await $.tool.call({ tool: EDITOR, action: 'release', note: 'done' } as never))).toContain('released:')
  expect(parseLeases(w.read(LEASES))).toEqual([
    { v: 1, lane: mine(w).lane, id8: ME8, requestedAt: NOW, grantedAt: NOW, reusedPid: 45392, minutes: 20, firstEditorSeenAt: NOW, pieAt: T(14, 41), extensions: 1, endAt: T(14, 42), endReason: 'released', editorLeftOpen: true, queueAtGrant: 0, pie: false, build: false, pieAborted: false },
  ])
  // status gives the 24-hour summary from it
  expect(out(await $.tool.call({ tool: EDITOR, action: 'status' } as never))).toContain('"leases24h": "24 h: 1 lease · median wait 0 min · launch 0% · 0 yields · 0 returns · 0 PIE aborts · sync 0 h"')
})

test('A100: a lapsed lease is recorded by the session that lapses it (reason lapsed, the holder\'s request time), and its released file carries that request time', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, held('bbbbbbbb', T(13, 30), T(14, 0)))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', { heartbeatAt: NOW - 10 * MIN, holding: { since: T(13, 30), end: T(14, 0), extended: 1, notes: { editorAt: T(13, 34) } }, want: want({ requestedAt: T(13, 20) }) }), NOW - 10 * MIN)
  await $.session.start(START)
  await $.tool.call({ tool: EDITOR, action: 'request', minutes: 30, what: 'tail VFX' } as never)
  expect(parseLockLine(w.read(LOCK)).id8).toBe(ME8)
  const [r] = parseLeases(w.read(LEASES))
  expect([r?.id8, r?.endReason, r?.requestedAt, r?.grantedAt, r?.firstEditorSeenAt, r?.extensions, r?.endAt, r?.editorLeftOpen]).toEqual(['bbbbbbbb', 'lapsed', T(13, 20), T(13, 30), T(13, 34), 1, NOW, false])
  const released = (JSON.parse(w.read(`${HF}/released/bbbbbbbb.json`)) as { releases: { requestedAt?: number }[] }).releases
  expect(released.map(x => x.requestedAt)).toEqual([T(13, 20)])
})

// ---------- A101 ----------
test('A101: unit: Editor use counts the S2 drivers; busy (a turn, Editor use, an agent) is not idle', () => {
  for (const c of ['powershell -File E:/s2/docs/handoff/pie-perf-tools/launch_s2.ps1', 'python tools/TALab/lab.py --min-free-gb 8', 'python docs/handoff/pie-perf-tools/mcp.py ping', 'powershell -File close_editor.ps1', 'Build.bat S2Editor Win64', 'RunUAT.bat BuildCookRun']) expect([c, EDITOR_WORK.test(c)]).toEqual([c, true])
  for (const c of ['git status', 'python tools/collab.py', 'cat mcp.pyc.txt']) expect([c, EDITOR_WORK.test(c)]).toEqual([c, false])
  const base = { now: T(15, 0), since: T(14, 0), end: T(16, 0), editorUseAt: T(14, 10), lastTurnAt: T(14, 20), agents: 0, isPie: false, isUnattended: false }
  expect(isIdleHolder(base)).toBe(true)
  expect(isIdleHolder({ ...base, lastTurnAt: T(14, 50) })).toBe(false) // a turn 10 min ago
  expect(isIdleHolder({ ...base, editorUseAt: T(14, 50) })).toBe(false)
  expect(isIdleHolder({ ...base, agents: 1 })).toBe(false)
  expect(isIdleHolder({ ...base, since: T(14, 50) })).toBe(false) // granted 10 min ago
  // D2: past its end a holder's turns no longer keep the notice back (Editor use, PIE and agents still do).
  expect(isIdleHolder({ ...base, end: T(14, 55), lastTurnAt: T(14, 58) })).toBe(true)
  expect(isIdleHolder({ ...base, end: T(14, 55), lastTurnAt: T(14, 58), editorUseAt: T(14, 58) })).toBe(false)
})

for (const busy of [true, false])
  test(`A101: a holder ${busy ? 'that runs turns (a tool call every few minutes) is never told to release for idleness' : 'with no turn and no Editor use for 15 min is told to release'}`, opts(), async ($, on) => {
    const w = world(on, { ram: '40' })
    on('turn.complete', async () => ({ text: '' }))
    w.put(LOCK, held(ME8, T(14, 40), T(16, 0)))
    meHolding(w, T(14, 40), T(16, 0))
    await $.session.start(START)
    await idle($)
    for (let n = 0; n < 20; n += 1) {
      if (busy && n % 4 === 0) {
        // Editing a Blueprint or code through file tools: turns, but no Editor use.
        await $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: `tu${n}` } as never)
        await idle($)
      }
      await w.clock.advance(MIN)
    }
    const told = prompts(w).filter(p => p.includes('has not used it for'))
    expect(told.length).toBe(busy ? 0 : 1)
  })

test('A101: a driver command (lab.py) is Editor use: the lease is not idle 10 min later', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, held(ME8, T(14, 40), T(16, 0)))
  meHolding(w, T(14, 40), T(16, 0), { lastTurnAt: T(14, 0) })
  await $.session.start(START)
  await w.clock.advance(10 * MIN) // 14:50
  await $.tool.call({ tool: 'Bash', command: 'python E:/s2/tools/TALab/lab.py --min-free-gb 8' } as never)
  await w.clock.advance(MIN) // the file is written at the minute
  expect(mine(w).editorUseAt).toBe(T(14, 50))
})

// ---------- A102 ----------
test('A102: unit: the retest extension: once more, ≤ 15 min, no build, an Editor running, ≤ 90 min in all, before the end', () => {
  const base = { extended: 1, add: 15, isBuild: false, editorRuns: true, since: T(14, 0), end: T(15, 0), newEnd: T(15, 15), now: T(14, 55) }
  expect(isRetestExtension(base)).toBe(true)
  expect(isRetestExtension({ ...base, extended: 0 })).toBe(false) // the first extension follows the old rule
  expect(isRetestExtension({ ...base, extended: 2 })).toBe(false)
  expect(isRetestExtension({ ...base, add: 16 })).toBe(false)
  expect(isRetestExtension({ ...base, isBuild: true })).toBe(false)
  expect(isRetestExtension({ ...base, editorRuns: false })).toBe(false)
  expect(isRetestExtension({ ...base, newEnd: T(15, 31) })).toBe(false)
  expect(isRetestExtension({ ...base, now: T(15, 0) })).toBe(false)
})

const RETEST: [string, { add?: number; note?: string; procs?: boolean; since?: number; extended?: number }, string][] = [
  ['the retest (15 min, Editor running, no build, 75 min in all)', {}, 'extended until 15:15'],
  ['more than 15 min', { add: 20 }, 'wait and this lease was extended once already'],
  ['a build lease (45 min in all, inside the build window)', { note: 'C++ fix (build)', since: T(14, 30) }, 'wait and this lease was extended once already'],
  ['no Editor running', { procs: false }, 'wait and this lease was extended once already'],
  ['past 90 min in all', { since: T(13, 40) }, 'wait and this lease was extended once already'],
  ['a third extension', { extended: 2 }, 'wait and this lease was extended 2 times already'],
]
for (const [name, o, says] of RETEST)
  test(`A102: with a session waiting, a second extension: ${name}`, opts(), async ($, on) => {
    const w = world(on, { ram: '40', procs: o.procs === false ? [] : [EDITOR_PROC] })
    const since = o.since ?? T(14, 0)
    w.put(LOCK, held(ME8, since, T(15, 0), { pid: o.procs === false ? null : 45392, note: o.note }))
    meHolding(w, since, T(15, 0), { holding: { since, end: T(15, 0), extended: o.extended ?? 1 } })
    w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc', { want: want() }))
    await $.session.start(START)
    const said = out(await $.tool.call({ tool: EDITOR, action: 'extend', minutes: o.add ?? 15 } as never))
    expect(said).toContain(says)
    expect(parseLockLine(w.read(LOCK)).end).toBe(says.startsWith('extended') ? '15:15' : '15:00')
  })

// ---------- A103 ----------
const yieldInput = (holder: Partial<SessionFile>, o: Partial<GrantInput> = {}): GrantInput => ({
  me8: 'aaaaaaaa',
  lock: parseLockLine(held('bbbbbbbb', T(14, 0), T(15, 30))),
  files: [JSON.parse(peer('aaaaaaaa', { want: want({ minutes: 15 }) })) as SessionFile, JSON.parse(peer('bbbbbbbb', { holding: { since: T(14, 0), end: T(15, 30), extended: 0 }, ...holder })) as SessionFile],
  lanes: [],
  now: NOW,
  sync: null,
  probe: null,
  gates: DEFAULT_GATES,
  manual: NO_MANUAL,
  ...o,
})
test('A103: unit: the asker asks only when its holder made no Editor use for 5 min and 20 min of its lease remain', () => {
  expect(mayAskYield(yieldInput({ editorUseAt: T(14, 30) }))).toEqual({ holder: 'bbbbbbbb' })
  expect(mayAskYield(yieldInput({ editorUseAt: T(14, 37) }))).toBeNull() // used 3 min ago
  expect(mayAskYield(yieldInput({ holding: { since: T(14, 0), end: T(14, 55), extended: 0 } }))).toBeNull() // 15 min left
  expect(mayAskYield(yieldInput({}))).toEqual({ holder: 'bbbbbbbb' }) // no published use (before 0.21.0): its grant counts
})

test('A103: the holder\'s A5R holds a yield ask while it uses the Editor and tells it 5 min after the last use', opts(), async ($, on) => {
  const w = world(on, { ram: '40', procs: [EDITOR_PROC] })
  on('turn.complete', async () => ({ text: '' }))
  w.put(LOCK, held(ME8, T(14, 0), T(15, 30), { pid: 45392 }))
  meHolding(w, T(14, 0), T(15, 30))
  await $.session.start(START)
  await $.tool.call({ tool: UNREAL, name: 'get_actor' } as never) // 14:40: Editor use
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc', { lane: 'loco', want: want({ minutes: 10 }), yieldAsks: [{ holder: ME8, at: NOW, via: 'file', minutes: 10, lane: 'loco' }] }))
  await idle($)
  const told = () => prompts(w).filter(p => p.includes('Editor yield')).length
  for (let n = 1; n <= 4; n += 1) {
    w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc', { lane: 'loco', heartbeatAt: NOW + n * MIN, want: want({ minutes: 10 }), yieldAsks: [{ holder: ME8, at: NOW, via: 'file', minutes: 10, lane: 'loco' }] }), NOW + n * MIN)
    await w.clock.advance(MIN)
  }
  expect(told()).toBe(0) // 14:44: used 4 min ago
  await w.clock.advance(MIN)
  expect(told()).toBe(1) // 14:45
})

test('A103: a yield ask is held while less than 20 min of the lease remain', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, held(ME8, T(14, 0), T(14, 55)))
  meHolding(w, T(14, 0), T(14, 55))
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc', { lane: 'loco', want: want({ minutes: 10 }), yieldAsks: [{ holder: ME8, at: NOW - 30_000, via: 'file', minutes: 10, lane: 'loco' }] }))
  await $.session.start(START)
  expect(prompts(w).filter(p => p.includes('Editor yield'))).toEqual([])
})

for (const [args, pausable] of [[{ pie: true }, false], [{ pie: true, pausable: true }, true], [{}, true]] as const)
  test(`A103: a request ${JSON.stringify(args)} is ${pausable ? '' : 'not '}pausable (with PIE: not, unless it says so)`, opts(), async ($, on) => {
    const w = world(on, { ram: '40' })
    w.put(LOCK, 'free since 14:20\n')
    await $.session.start(START)
    await $.tool.call({ tool: EDITOR, action: 'request', minutes: 20, what: 'check', ...args } as never)
    expect([parseLockLine(w.read(LOCK)).id8, parseLockLine(w.read(LOCK)).pausable]).toEqual([ME8, pausable])
  })

// ---------- A104 ----------
test('A104: unit: a forced release keeps the place 60 min (a yield right after its asker); a voluntary one none; a kept place is used once', () => {
  expect(returnOf('yielded', T(14, 10), T(14, 40))).toEqual({ requestedAt: T(14, 10), until: T(15, 40) })
  expect(returnOf('yielded', T(14, 10), T(14, 40), T(14, 38))).toEqual({ requestedAt: T(14, 38) + 1, until: T(15, 40) }) // D1: after the asker
  expect(returnOf('yielded', T(14, 39), T(14, 40), T(14, 38))?.requestedAt).toBe(T(14, 39)) // never earlier than its own
  for (const r of ['cutoff', 'lapsed', 'unseen'] as const) expect(returnOf(r, T(14, 10), T(14, 40))?.requestedAt).toBe(T(14, 10))
  for (const r of ['released', 'idle', 'overrun', 'sync'] as const) expect(returnOf(r, T(14, 10), T(14, 40))).toBeUndefined()
  const back = { requestedAt: T(14, 10), until: T(15, 40) }
  expect(placeOf({ want: null, return: back }, T(15, 0))).toEqual({ requestedAt: T(14, 10), isKept: true })
  expect(placeOf({ want: null, return: back }, T(15, 41))).toEqual({ requestedAt: T(15, 41) })
  expect(placeOf({ want: want({ requestedAt: T(14, 30) }), return: back }, T(15, 0))).toEqual({ requestedAt: T(14, 30) })
  expect(placeOf({ want: want({ requestedAt: T(14, 10), isKept: true }), return: undefined }, T(15, 0))).toEqual({ requestedAt: T(14, 10), isKept: true })
  // D1: a request whose time was a kept place keeps nothing again, for any reason; a lapse record names none for it.
  const kept = JSON.parse(peer(ME8, { want: want({ requestedAt: T(14, 10), isKept: true }), holding: { since: T(14, 20), end: T(15, 20), extended: 0 } })) as SessionFile
  for (const reason of ['yielded', 'cutoff', 'lapsed', 'unseen'] as const) expect([reason, endLease(kept, { at: T(14, 40), reason, isEditorOpen: false, after: T(14, 38) }).after.return]).toEqual([reason, undefined])
  expect([keepableOf(kept.want), keepableOf(want({ requestedAt: T(14, 10) })), keepableOf(null)]).toEqual([undefined, T(14, 10), undefined])
  expect(endLease({ ...kept, want: null }, { at: T(14, 40), reason: 'lapsed', isEditorOpen: false, requestedAt: T(13, 20) }).after.return).toEqual({ requestedAt: T(13, 20), until: T(15, 40) })
})

test('A104 / D3: unit: a release is a yield only within the notice\'s 10-min safe-point window; a yield wins over the overrun inside it', () => {
  const asker = JSON.parse(peer('cccccccc', { want: want({ requestedAt: T(14, 38) }) })) as SessionFile
  const asks = [{ asker, ask: { holder: ME8, at: T(14, 38), via: 'file' as const, minutes: 10, lane: 'b' } }]
  const told = new Map([[`editor:yield:cccccccc:${T(14, 38)}`, T(14, 40)]])
  expect(yieldTold(asks, told, T(14, 50))?.asker.id8).toBe('cccccccc')
  expect(yieldTold(asks, told, T(14, 51))).toBeUndefined()
  expect(yieldTold(asks, new Map(), T(14, 41))).toBeUndefined() // never told (held back by A103)
  expect(releaseReason({ isYieldTold: true, isSyncNeed: false, isOver: true, isIdleTold: false })).toBe('yielded')
  expect(releaseReason({ isYieldTold: false, isSyncNeed: false, isOver: true, isIdleTold: false })).toBe('overrun')
})

/** The race (D1): this session holds since 14:20 (asked 14:10); `cccccccc` asked 14:38 and asked it to yield; `dddddddd`
 * asked 14:39. The others' A5R are their files: what one would do is what `decide` answers for it. */
const raceWorld = (on: any, o: { isKept?: boolean; isAsked?: boolean } = {}) => {
  const w = world(on, { ram: '40' })
  on('turn.complete', async () => ({ text: '' }))
  w.put(LOCK, held(ME8, T(14, 20), T(15, 20)))
  meHolding(w, T(14, 20), T(15, 20), { want: want({ requestedAt: T(14, 10), ...(o.isKept ? { isKept: true } : {}) }) })
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc', { lane: 'borrower', want: want({ minutes: 10, requestedAt: T(14, 38) }), yieldAsks: o.isAsked === false ? [] : [{ holder: ME8, at: T(14, 38), via: 'file', minutes: 10, lane: 'borrower' }] }))
  w.put(`${HF}/editor/dddddddd.json`, peer('dddddddd', { lane: 'third', want: want({ minutes: 30, requestedAt: T(14, 39) }) }))
  return w
}
const filesOf = (w: ReturnType<typeof world>): SessionFile[] => ['editor/' + ME8, 'editor/cccccccc', 'editor/dddddddd'].map(f => JSON.parse(w.read(`${HF}/${f}.json`)) as SessionFile)
const decideFor = (w: ReturnType<typeof world>, id8: string) => decide({ me8: id8, lock: parseLockLine(w.read(LOCK)), files: filesOf(w), lanes: [], now: w.clock.now(), sync: null, probe: { freeGb: 40, diskGb: 40, procs: [] }, gates: DEFAULT_GATES, manual: NO_MANUAL })

test('A104 / D1: the real race: A yields and asks again at once; B, the session it yielded to, is granted first; A is next, before the session that asked during its lease', opts(), async ($, on) => {
  const w = raceWorld(on)
  await $.session.start(START)
  expect(prompts(w).some(p => p.includes('A5R · Editor yield — borrower asks'))).toBe(true)
  await idle($)
  expect(out(await $.tool.call({ tool: EDITOR, action: 'release', note: 'yielded to borrower' } as never))).toContain('released:')
  expect(parseLeases(w.read(LEASES)).map(r => r.endReason)).toEqual(['yielded'])
  // A90: it asks again at once. The lock is FREE and B is the head: A is not granted.
  const said = out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 20, what: 'retest after the borrower' } as never))
  expect(said).toContain('the Editor is free but borrower asked first')
  expect(said).toContain('you are 2nd in the queue')
  expect([parseLockLine(w.read(LOCK)).kind, mine(w).want?.requestedAt, mine(w).want?.isKept]).toEqual(['free', T(14, 38) + 1, true])
  await w.clock.advance(MIN) // A's minute: still not granted
  expect(parseLockLine(w.read(LOCK)).kind).toBe('free')
  // B's own A5R takes it at its minute (decide answers grant for B alone), and later gives it back.
  expect([decideFor(w, 'cccccccc').kind, decideFor(w, 'dddddddd').kind, decideFor(w, ME8).kind]).toEqual(['grant', 'wait', 'wait'])
  w.put(LOCK, held('cccccccc', T(14, 41), T(14, 51)))
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc', { lane: 'borrower', heartbeatAt: T(14, 41), want: want({ minutes: 10, requestedAt: T(14, 38) }), holding: { since: T(14, 41), end: T(14, 51), extended: 0 } }))
  await w.clock.advance(MIN)
  w.put(LOCK, 'FREE since=14:43 2026-10-06 by=borrower note=Editor closed background=none · free since 14:43\n')
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc', { lane: 'borrower', heartbeatAt: T(14, 43) }))
  w.put(`${HF}/editor/dddddddd.json`, peer('dddddddd', { lane: 'third', heartbeatAt: T(14, 43), want: want({ minutes: 30, requestedAt: T(14, 39) }) }))
  await w.clock.advance(MIN) // 14:43: A is next, before dddddddd (14:39)
  expect(parseLockLine(w.read(LOCK)).id8).toBe(ME8)
  expect(mine(w).return).toBeUndefined() // the kept place is spent by the grant
})

test('A104: a holder that releases on its own asks again behind everyone who asked during its lease', opts(), async ($, on) => {
  const w = raceWorld(on, { isAsked: false })
  await $.session.start(START)
  await idle($)
  await $.tool.call({ tool: EDITOR, action: 'release', note: 'done' } as never)
  expect(parseLeases(w.read(LEASES)).map(r => r.endReason)).toEqual(['released'])
  expect(out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 20, what: 'again' } as never))).toContain('you are 3rd in the queue')
  expect(mine(w).want?.requestedAt).toBe(NOW)
})

test('A104 / D1: a kept place is used once: a holder whose request was itself a kept place yields and goes to the back', opts(), async ($, on) => {
  const w = raceWorld(on, { isKept: true })
  await $.session.start(START)
  await idle($)
  await $.tool.call({ tool: EDITOR, action: 'release', note: 'yielded again' } as never)
  expect([parseLeases(w.read(LEASES)).map(r => r.endReason), mine(w).return]).toEqual([['yielded'], undefined])
  expect(out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 20, what: 'again' } as never))).toContain('you are 3rd in the queue')
})

test('A104 / D3: a release 11 min after the yield notice is no yield: recorded released, no kept place', opts(), async ($, on) => {
  const w = raceWorld(on)
  await $.session.start(START)
  expect(prompts(w).some(p => p.includes('A5R · Editor yield — borrower asks'))).toBe(true)
  await idle($)
  for (let n = 1; n <= 11; n += 1) {
    for (const id8 of ['cccccccc', 'dddddddd']) w.put(`${HF}/editor/${id8}.json`, JSON.stringify({ ...(JSON.parse(w.read(`${HF}/editor/${id8}.json`)) as SessionFile), heartbeatAt: NOW + n * MIN }))
    await w.clock.advance(MIN)
  }
  await $.tool.call({ tool: EDITOR, action: 'release', note: 'done' } as never)
  expect([parseLeases(w.read(LEASES)).map(r => r.endReason), mine(w).return]).toEqual([['released'], undefined])
})

test('A104: a lapsed holder\'s next request keeps the request time its released file names (written by the lapsing session)', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, 'FREE since=14:40 2026-10-06 by=lane-cccccccc note=lapsed lease background=none · free since 14:40\n')
  w.put(`${HF}/editor/${ME8}.json`, JSON.stringify({ ...blankSession(ME, 'tail-vfx', 'Tail', NOW), lastTurnAt: NOW, holding: { since: T(13, 30), end: T(14, 0), extended: 0 } }))
  w.put(`${HF}/released/${ME8}.json`, JSON.stringify({ v: 1, releases: [{ kind: 'lapsed', at: T(14, 40), by: 'lane-cccccccc', since: T(13, 30), end: T(14, 0), requestedAt: T(13, 20) }] }))
  w.put(`${HF}/editor/dddddddd.json`, peer('dddddddd', { want: want({ requestedAt: T(14, 0) }) }))
  w.put(`${HF}/editor/eeeeeeee.json`, peer('eeeeeeee', { holding: { since: T(14, 40), end: T(15, 10), extended: 0 } }))
  await $.session.start(START)
  expect(mine(w).return).toEqual({ requestedAt: T(13, 20), until: T(15, 40) })
  w.put(LOCK, held('eeeeeeee', T(14, 40), T(15, 10)))
  expect(out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 20, what: 'again' } as never))).toContain('you are next')
  expect(mine(w).want?.isKept).toBe(true) // used once: a release of this request keeps nothing
})

// ---------- D2: past its end a busy holder no longer hoards the Editor ----------
test('D2: unit: past the lease end the yield moment needs no 20-min room (5 min without Editor use still)', () => {
  expect(isYieldMoment({ now: T(14, 40), since: T(14, 0), end: T(14, 55), editorUseAt: undefined })).toBe(false) // 15 min left
  expect(isYieldMoment({ now: T(14, 40), since: T(14, 0), end: T(14, 35), editorUseAt: undefined })).toBe(true) // past its end
  expect(isYieldMoment({ now: T(14, 40), since: T(14, 0), end: T(14, 35), editorUseAt: T(14, 38) })).toBe(false) // used 2 min ago
})

test('D2: past its end, a holder that keeps running turns is told it is idle, and a yield ask reaches it', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, held(ME8, T(13, 40), T(14, 35)))
  meHolding(w, T(13, 40), T(14, 35), { lastTurnAt: NOW })
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc', { lane: 'loco', want: want({ minutes: 10 }), yieldAsks: [{ holder: ME8, at: NOW - 30_000, via: 'file', minutes: 10, lane: 'loco' }] }))
  await $.session.start(START)
  const all = prompts(w).join('\n')
  expect([all.includes('has not used it for'), all.includes('A5R · Editor yield — loco asks')]).toEqual([true, true])
})

// ---------- A105 ----------
test('A105: unit: the queue view: the holder from its file (granted, Editor seen, PIE, extensions, time left) and each queued session in order', () => {
  const files = [
    JSON.parse(peer('bbbbbbbb', { holding: { since: T(14, 0), end: T(14, 52), extended: 1, notes: { editorAt: T(14, 4), pieAt: T(14, 20) } } })) as SessionFile,
    JSON.parse(peer('cccccccc', { want: want({ minutes: 30, pie: true, requestedAt: T(14, 22) }) })) as SessionFile,
    JSON.parse(peer(ME8, { want: want({ minutes: 20, build: true, requestedAt: T(14, 36) }) })) as SessionFile,
  ]
  const v = queueView({ me8: ME8, lock: parseLockLine(held('bbbbbbbb', T(14, 0), T(14, 52))), files, lanes: [], now: NOW, sync: null, probe: null, gates: DEFAULT_GATES, manual: NO_MANUAL }) // rev 38 (A112): with the decide inputs
  // Rev 40: the holder's end and whether its lease is the sync's (A117); each row's asked minutes, placed mark (A117) and
  // reason in plain words (A116).
  expect(v.holder).toEqual({ lane: 'lane-bbbbbbbb', id8: 'bbbbbbbb', isMe: false, grantedAt: T(14, 0), editorAt: T(14, 4), pieAt: T(14, 20), extensions: 1, end: T(14, 52), leftMin: 12, isSyncSlot: false })
  expect(v.rows).toEqual([
    { place: 1, lane: 'lane-cccccccc', id8: 'cccccccc', isMe: false, waitedMin: 18, minutes: 30, asked: 30, isPlaced: false, pie: true, build: false, wait: 'held', reason: 'behind lane-bbbbbbbb' },
    { place: 2, lane: `lane-${ME8}`, id8: ME8, isMe: true, waitedMin: 4, minutes: 20, asked: 20, isPlaced: false, pie: false, build: true, wait: 'held', reason: '' },
  ])
})

for (const surface of ['terminal', 'desktop'] as const)
  test(`A105 (${surface}): the A5R pane shows the Editor queue (the holder, each waiting session, the 24-hour summary) and status gives the same`, opts(), async ($, on) => {
    const w = world(on, { ram: '40' })
    w.put(LOCK, held('bbbbbbbb', T(14, 0), T(14, 52)))
    w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', { holding: { since: T(14, 0), end: T(14, 52), extended: 1, notes: { editorAt: T(14, 4), pieAt: T(14, 20) } } }))
    w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc', { want: want({ minutes: 30, pie: true, requestedAt: T(14, 22) }) }))
    w.put(LEASES, `${JSON.stringify(rec({ endAt: T(13, 50), grantedAt: T(13, 20), requestedAt: T(13, 8), firstEditorSeenAt: T(13, 26), endReason: 'yielded' }))}\n`)
    await $.session.start({ ...(START as object), surface } as never)
    await $.tool.call({ tool: EDITOR, action: 'request', minutes: 20, what: 'tail VFX', build: true } as never)
    const P = { ...A5RPANE, surface } as never
    await $.ui.render(P)
    await w.clock.advance(50)
    const tree = await $.ui.render(P)
    // Rev 40 (A116): one Editor list in plain words (no codes): the head says who has it and the time left, the holder row its
    // grant, Editor and PIE, each queued row its wait, minutes, PIE / build and one reason; the day's line in plain words.
    expect(text(find(tree, 'hai-queue-head'))).toBe('EDITOR· lane-bbbbbbbb has it · 12 min left')
    expect(text(find(tree, 'hai-queue-holder'))).toBe('lane-bbbbbbbbgranted 14:00 · Editor 14:04 · PIE 14:20 · extended 1×')
    expect(text(find(tree, 'hai-queue-cccccccc'))).toBe('lane-ccccccccwaiting 18 min · 30 min · PIE · behind lane-bbbbbbbb')
    expect(text(find(tree, `hai-queue-${ME8}-line`))).toBe('waiting 0 min · 20 min · build')
    expect([find(tree, 'hai-queue-pick-bbbbbbbb')?.props?.label, find(tree, 'hai-queue-pick-cccccccc')?.props?.label, find(tree, `hai-queue-pick-${ME8}`)?.props?.label]).toEqual(['▶', '1', '★2'])
    expect(text(find(tree, 'hai-queue-summary'))).toBe('today: 1 turn · usually 12 min wait · 20% of turns spent opening the Editor')
    const status = JSON.parse(out(await $.tool.call({ tool: EDITOR, action: 'status' } as never)).split('\n').filter(l => !l.startsWith('A5R ·')).join('\n')) as Record<string, unknown>
    // Rev 40 (A116): the status reads the panel's words (one renderer, lease.ts) with A112's wait code for models and logs.
    expect(status.holder).toBe('lane-bbbbbbbb (session bbbbbbbb): granted 14:00 · Editor 14:04 · PIE 14:20 · extended 1× · 12 min left')
    expect(status.queue).toEqual(['1. lane-cccccccc (session cccccccc): waiting 18 min · 30 min · PIE · behind lane-bbbbbbbb · wait held: their slot', `2. ${mine(w).lane} (session ${ME8}): waiting 0 min · 20 min · build · wait held: tail VFX`])
    expect(status.leases24h).toBe('24 h: 1 lease · median wait 12 min · launch 20% · 1 yield · 0 returns · 0 PIE aborts · sync 0 h')
  })

test('A105: with nobody holding or waiting and no lease in the last 24 h the pane adds no Editor list', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, 'FREE since=14:00 2026-10-06 by=x note=none background=none · free since 14:00\n') // rev 40 (A116): a holder alone is listed now
  await $.session.start(START)
  await $.ui.render(A5RPANE as never)
  await w.clock.advance(50)
  expect(find(await $.ui.render(A5RPANE as never), 'hai-queue')).toBeUndefined()
})

// ---------- A106 ----------
test('A106: unit: the PIE launch gate defaults to 38 GB (the slot without PIE stays 28); /a5r gate still overrides', () => {
  expect(DEFAULT_GATES).toEqual({ pieGb: 38, nopieGb: 28 })
  expect(gatesOf(null, undefined, undefined)).toEqual({ pieGb: 38, nopieGb: 28, source: 'options' })
  expect(gatesOf({ pieGb: 33, nopieGb: 30 }, undefined, undefined)).toEqual({ pieGb: 33, nopieGb: 30, source: 'panel' })
})
