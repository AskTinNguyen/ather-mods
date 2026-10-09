import { expect, test } from 'claude-code/testing'
import { blankSession, heldLine, lapseOf, lockTimes, parseLockLine, type SessionFile } from '../hooks/coord.ts'
import { LOCK, ME, NOW, PROJ, opts, world, type Rec } from './world.ts'

// A54 (MEASURED 2026-10-08/09: lane fluidninja-live2-upgrade's lease 20:44–21:14, `pid=none`, no Unreal process,
// blocked three queued lanes until 09:54 the next morning): a lease 10 min past its end, whose lock line names no
// running Editor and with no UnrealEditor / UnrealEditor-Cmd running, is released by any session's A5R: the standard
// FREE line naming the lapsed lane and why, the holder's lease cleared in its file, a coordination notice to it, and the
// queue goes on in request order. A live Editor keeps it; inside the 10 min it stays; racing sessions write one FREE.
// A55: a grant whose session ran no turn in the 10 min after it and launched no Editor passes to the next in the
// queue, and the skipped session is told to request again; a grant the session has seen stays to its end.
// Rev 22 (A58, A60), by design: a lapsed lease is released only when its holder's session is gone (S2 standard section 2)
// and no build runs; the release goes to Saved/A5R/released/<id8>.json, which only the releasing session writes.
const HF = 'E:/s2/Saved/A5R'
const ME8 = ME.slice(0, 8)
const EDITOR = 'mcp__a5r__editor'
const START = { cwd: PROJ, surface: 'terminal', isInteractive: true } as never
const T = (h: number, m: number) => new Date(2026, 9, 6, h, m).getTime()
const MIN = 60_000
const SID = (id8: string) => `${id8}-1111-4000-8000-000000000000`
const held = (id8: string, since: number, end: number, pid: number | null = null, mode: 'interactive' | 'unattended' = 'unattended') =>
  `${heldLine({ lane: `lane-${id8}`, sessionName: `title-${id8}`, id8, since, pid, end, mode, pausable: true, nextSafe: 'after save', note: 'their slot' })}\n`
const peer = (id8: string, o: Partial<SessionFile> = {}): string => JSON.stringify({ ...blankSession(SID(id8), `lane-${id8}`, `title ${id8}`, NOW), ...o })
const fileOf = (w: ReturnType<typeof world>, id8: string): SessionFile => JSON.parse(w.read(`${HF}/editor/${id8}.json`) || '{}') as SessionFile
const prompts = (w: ReturnType<typeof world>): string[] => (w.calls['prompt.submit'] ?? []).map(e => String((e as Rec).text))
const request = async ($: any, minutes = 30) => $.tool.call({ tool: EDITOR, action: 'request', minutes, what: 'tail VFX' } as never)
const idle = async ($: any) => $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
/** Keeps a peer alive (fresh heartbeat), as its own a5r would every minute. */
const beat = (w: ReturnType<typeof world>, id8: string, o: Partial<SessionFile>) => w.put(`${HF}/editor/${id8}.json`, peer(id8, { ...o, heartbeatAt: w.clock.now() }), w.clock.now())
/** A58: a holder whose session is gone (its a5r file 10 min old, no Ather lane). */
const gone = (w: ReturnType<typeof world>, id8: string, o: Partial<SessionFile>) => w.put(`${HF}/editor/${id8}.json`, peer(id8, { ...o, heartbeatAt: w.clock.now() - 10 * MIN }), w.clock.now() - 10 * MIN)
const releasesOf = (w: ReturnType<typeof world>, id8: string): { kind: string; by: string }[] => (JSON.parse(w.read(`${HF}/released/${id8}.json`) || '{"releases":[]}') as { releases: { kind: string; by: string }[] }).releases

test('A54: unit: the lease times from the HELD line, past midnight too (the 20:44–21:14 lease read at 09:54 the next day)', () => {
  const since = new Date(2026, 9, 8, 20, 44).getTime()
  const lock = parseLockLine(held('10ab1488', since, new Date(2026, 9, 8, 21, 14).getTime()))
  const now = new Date(2026, 9, 9, 9, 54).getTime()
  expect(lockTimes(lock, now)).toEqual({ since, end: new Date(2026, 9, 8, 21, 14).getTime() })
  const night = parseLockLine(held('10ab1488', new Date(2026, 9, 8, 23, 50).getTime(), new Date(2026, 9, 9, 0, 20).getTime()))
  expect(lockTimes(night, now)?.end).toBe(new Date(2026, 9, 9, 0, 20).getTime())
  const probe = (procs: { name: string; pid: number }[]) => ({ freeGb: 40, diskGb: 50, procs: procs.map(p => ({ ...p, gb: 1, parentAlive: true })) })
  const x = { lock, files: [], lanes: [{ sessionId: '10ab1488-0000', hasEnded: true, mtimeMs: since }], now, waiting: [] }
  expect(lapseOf({ ...x, probe: probe([]) })?.kind).toBe('lapsed')
  expect(lapseOf({ ...x, probe: probe([{ name: 'UnrealEditor', pid: 7 }]) })).toBeNull()
  expect(lapseOf({ ...x, probe: probe([{ name: 'UnrealEditor-Cmd', pid: 8 }]) })).toBeNull()
  expect(lapseOf({ ...x, probe: null })).toBeNull() // no reading, no release
  expect(lapseOf({ ...x, now: new Date(2026, 9, 8, 21, 23).getTime(), probe: probe([]) })).toBeNull() // 9 min past its end
})

test('A54: a lease 10 min past its end whose holder is gone, with no Editor running, is released: the FREE line names the lane and why, the release is filed for the holder, the head is granted', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, held('bbbbbbbb', T(13, 30), T(14, 0)))
  gone(w, 'bbbbbbbb', { holding: { since: T(13, 30), end: T(14, 0), extended: 0 }, want: null })
  await $.session.start(START)
  // This session asked before: at 14:40 the lease is 40 min past its end; the next minute releases it and grants.
  await request($)
  expect(parseLockLine(w.read(LOCK)).id8).toBe(ME8)
  expect(releasesOf(w, 'bbbbbbbb').map(r => [r.kind, r.by])).toEqual([['lapsed', fileOf(w, ME8).lane]])
  expect(fileOf(w, 'bbbbbbbb').holding).not.toBeNull() // A60: the holder's own file is the holder's alone
  expect(w.files.get(`${HF}/alerts/lease-lapsed-bbbbbbbb-${T(13, 30)}.json`.toLowerCase())).toContain(ME8)
  expect(w.runs.some(r => /Stop-Process|taskkill|kill\b/i.test(r))).toBe(false) // nothing closed or killed
})

test('A54: the FREE line is the S2 standard one, naming the lapsed lane, its end and why; the queue goes on in request order', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, held('bbbbbbbb', T(13, 30), T(14, 0)))
  gone(w, 'bbbbbbbb', { holding: { since: T(13, 30), end: T(14, 0), extended: 0 } })
  // cccccccc asked first: it is the head, so this session waits and the lock stays FREE for cccccccc's own a5r.
  beat(w, 'cccccccc', { want: { minutes: 30, pie: false, build: false, what: 'their slot', mode: 'interactive', pausable: true, nextSafe: 'after save', requestedAt: NOW - 30 * MIN } })
  await $.session.start(START)
  const ran = String((await request($)).result ?? '')
  const lock = parseLockLine(w.read(LOCK))
  expect([lock.kind, lock.isStandard, lock.by]).toEqual(['free', true, fileOf(w, ME8).lane])
  expect(lock.note).toContain('lapsed lease of lane-bbbbbbbb (session-bbbbbbbb): ended 14:00, 40 min ago; session gone, pid none, no Editor or build running')
  expect(ran).toContain('lane-cccccccc asked first')
})

for (const [name, pid] of [['UnrealEditor', 91], ['UnrealEditor-Cmd', 92]] as const)
  test(`A54: a lapsed lease is kept while ${name} runs (pid ${name === 'UnrealEditor' ? 'in the lock line' : 'none in the lock line'})`, opts(), async ($, on) => {
    const w = world(on, { ram: '40', procs: [{ name, pid, gb: 3, parentAlive: true }] })
    w.put(LOCK, held('bbbbbbbb', T(13, 30), T(14, 0), name === 'UnrealEditor' ? pid : null))
    gone(w, 'bbbbbbbb', { holding: { since: T(13, 30), end: T(14, 0), extended: 0 } })
    await $.session.start(START)
    await request($)
    await w.clock.advance(MIN)
    expect(parseLockLine(w.read(LOCK)).id8).toBe('bbbbbbbb')
    expect(releasesOf(w, 'bbbbbbbb')).toEqual([])
  })

test('A54: the holder of a lapsed lease whose Editor still runs keeps its lease and its overrun notice', opts(), async ($, on) => {
  const w = world(on, { ram: '40', procs: [{ name: 'UnrealEditor', pid: 91, gb: 26, parentAlive: true }] })
  w.put(LOCK, held(ME8, T(13, 30), T(14, 0), 91, 'interactive'))
  await $.session.start(START)
  expect(parseLockLine(w.read(LOCK)).id8).toBe(ME8)
  expect(prompts(w).join('\n')).toContain('your lease ended at 14:00')
})

test('A54: inside the 10 minutes after its end the lease is kept; at 10 minutes it is released (holder gone, nobody waiting)', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, held('bbbbbbbb', T(14, 0), T(14, 35)))
  gone(w, 'bbbbbbbb', { holding: { since: T(14, 0), end: T(14, 35), extended: 0 } })
  await $.session.start(START)
  for (let m = 41; m <= 44; m += 1) {
    await w.clock.advance(MIN)
    expect([m, parseLockLine(w.read(LOCK)).id8]).toEqual([m, 'bbbbbbbb'])
  }
  await w.clock.advance(MIN) // 14:45
  expect(parseLockLine(w.read(LOCK)).kind).toBe('free')
})

test('A58: a live holder past its end keeps its lease (only the overrun notice), even with no Editor running', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, held('bbbbbbbb', T(13, 30), T(14, 0)))
  beat(w, 'bbbbbbbb', { holding: { since: T(13, 30), end: T(14, 0), extended: 0 }, lastTurnAt: T(14, 39) })
  await $.session.start(START)
  await request($)
  for (let m = 0; m < 3; m += 1) {
    beat(w, 'bbbbbbbb', { holding: { since: T(13, 30), end: T(14, 0), extended: 0 }, lastTurnAt: T(14, 39) })
    await w.clock.advance(MIN)
  }
  expect([parseLockLine(w.read(LOCK)).id8, releasesOf(w, 'bbbbbbbb')]).toEqual(['bbbbbbbb', []])
})

test('A58: an ended or stale Ather lane never makes a session with a fresh a5r heartbeat gone', () => {
  const now = NOW
  const lock = parseLockLine(held('bbbbbbbb', T(13, 30), T(14, 0)))
  const files = [JSON.parse(peer('bbbbbbbb', { heartbeatAt: now - 30_000 })) as SessionFile]
  const lanes = [{ sessionId: SID('bbbbbbbb'), hasEnded: true, mtimeMs: now - 60 * MIN }]
  expect(lapseOf({ lock, files, lanes, now, waiting: [], probe: { freeGb: 40, diskGb: 50, procs: [] } })).toBeNull()
})

test('A54: two sessions racing: the one whose claim lands first writes the FREE line, the other writes nothing', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  const line = held('bbbbbbbb', T(13, 30), T(14, 0))
  w.put(LOCK, line)
  gone(w, 'bbbbbbbb', { holding: { since: T(13, 30), end: T(14, 0), extended: 0 } })
  // Another session's a5r claimed this release a moment ago and has not written its FREE line yet.
  w.put(`${HF}/alerts/lease-lapsed-bbbbbbbb-${T(13, 30)}.json`, JSON.stringify({ by: 'dddddddd', at: NOW }))
  await $.session.start(START)
  await w.clock.advance(MIN) // this session asks nothing: the gone holder's recovery is not in play
  expect(w.read(LOCK)).toBe(line) // this session wrote nothing
  expect(releasesOf(w, 'bbbbbbbb')).toEqual([])
})

test('A54: the old holder is told by its own a5r at its next minute, once; its lease and request are dropped', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  on('turn.complete', async () => ({ text: '' }))
  w.put(LOCK, `FREE since=14:40 2026-10-06 by=lane-cccccccc note=lapsed lease background=none · free since 14:40\n`)
  const released = { kind: 'lapsed', at: T(14, 40), by: 'lane-cccccccc', since: T(13, 30), end: T(14, 0) }
  w.put(`${HF}/editor/${ME8}.json`, JSON.stringify({ ...blankSession(ME, 'tail-vfx', 'Tail', NOW), lastTurnAt: NOW, holding: { since: T(13, 30), end: T(14, 0), extended: 0 } }))
  w.put(`${HF}/released/${ME8}.json`, JSON.stringify({ v: 1, releases: [released] }))
  await $.session.start(START)
  expect(prompts(w)).toEqual(['A5R · Editor lease — your lease (13:30–14:00) lapsed: 40 min past its end with no Editor running, so lane-cccccccc released it at 14:40 and the queue went on → nothing of yours was closed; request the Editor again with the editor tool if you still need it'])
  expect([fileOf(w, ME8).holding, fileOf(w, ME8).delivered.includes(`editor:released:lapsed:${T(13, 30)}`)]).toEqual([null, true])
  await idle($)
  await w.clock.advance(2 * MIN)
  expect(prompts(w).length).toBe(1)
})

test('A55: a grant its session never saw (no turn since, no Editor) passes to the next in the queue after 10 min, and the skipped session is told', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, held('bbbbbbbb', T(14, 25), T(15, 25)))
  const bbb = { holding: { since: T(14, 25), end: T(15, 25), extended: 0 }, lastTurnAt: T(14, 20), want: { minutes: 60, pie: false, build: false, what: 'their slot', mode: 'unattended' as const, pausable: true, nextSafe: 'after save', requestedAt: T(14, 20) } }
  beat(w, 'bbbbbbbb', bbb)
  await $.session.start(START)
  await request($) // 14:40: granted 15 min ago, no turn of bbbbbbbb since
  expect(parseLockLine(w.read(LOCK)).id8).toBe(ME8)
  const free = w.read(`${HF}/alerts/lease-unseen-bbbbbbbb-${T(14, 25)}.json`)
  expect(free).toContain(ME8)
  expect(releasesOf(w, 'bbbbbbbb').map(r => r.kind)).toEqual(['unseen'])
})

test('A55: the skipped session is told to request again (a coordination notice), once', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, 'FREE since=14:40 2026-10-06 by=lane-cccccccc note=unseen grant background=none · free since 14:40\n')
  const released = { kind: 'unseen', at: T(14, 40), by: 'lane-cccccccc', since: T(14, 25), end: T(15, 25) }
  w.put(`${HF}/editor/${ME8}.json`, JSON.stringify({ ...blankSession(ME, 'tail-vfx', 'Tail', NOW), lastTurnAt: T(14, 20), holding: { since: T(14, 25), end: T(15, 25), extended: 0 } }))
  w.put(`${HF}/released/${ME8}.json`, JSON.stringify({ v: 1, releases: [released] }))
  await $.session.start(START)
  expect(prompts(w)).toEqual(['A5R · Editor — the Editor was granted to this session at 14:25, but this session ran no turn in the next 15 min and launched no Editor, so lane-cccccccc passed it to the next in the queue at 14:40 → request it again with the editor tool when you are ready to use it'])
  expect(fileOf(w, ME8).want).toBeNull()
})

const BASE = { holding: { since: T(14, 25), end: T(15, 25), extended: 0 } }
const KEPT: [string, number, Partial<SessionFile>, boolean][] = [
  ['seen (a turn after the grant)', T(14, 25), { ...BASE, lastTurnAt: T(14, 26) }, true],
  ['inside 10 min', T(14, 32), { holding: { since: T(14, 32), end: T(15, 32), extended: 0 }, lastTurnAt: T(14, 20) }, true],
  ['nobody waiting', T(14, 25), { ...BASE, lastTurnAt: T(14, 20) }, false],
  ['from an a5r that records no turns', T(14, 25), BASE, true],
]
for (const [name, since, o, waits] of KEPT)
  test(`A55: a grant stays to its end: ${name}`, opts(), async ($, on) => {
    const w = world(on, { ram: '40' })
    w.put(LOCK, held('bbbbbbbb', since, since + 60 * MIN))
    beat(w, 'bbbbbbbb', o)
    await $.session.start(START)
    if (waits) await request($)
    await w.clock.advance(MIN)
    expect(parseLockLine(w.read(LOCK)).id8).toBe('bbbbbbbb')
  })
