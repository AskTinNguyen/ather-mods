import { expect, test } from 'claude-code/testing'
import type { SessionFile } from '../hooks/coord.ts'
import { parseTail } from '../hooks/judge.ts'
import type { LeaseRecord } from '../hooks/lease.ts'
import { conductor } from '../hooks/wakehost.ts'
import { NO_WAKE, afterMiss, answered, budgetHold, editorSignAt, isFinished, isResting, leaseSince, oldLine, parseDeskRow } from '../hooks/wake.ts'
import { LOCK, ME, NOW, opts, world } from './world.ts'
import { HF, ME8, MIN, H, START, SID, FREE, held, want, file, stoppedFile, put, desk, stopped, fileOf, sends, LOG, SENT, REFUSED, PAUSED, said, QUEUED_WORDS, grant, fakeIo, worker, app, hostOf, long, logged } from './rev45.fixture.ts'

// Rev 45, Fable's adversary review (S148, findings 1-10): each test fails without its fix.
test('Fable 1: unit: a refused send after a real miss is a real miss; two refused retries, then a rest of 24 h; never faster than hourly', () => {
  const w = want()
  expect(afterMiss({ ...w, misses: 1 }, 'refused', NOW)).toBeNull()
  const one = afterMiss(w, 'refused', NOW)
  const two = one && afterMiss(one, 'refused', NOW)
  const three = two && afterMiss(two, 'refused', NOW)
  expect([one?.routeMisses, one?.parkedUntil, two?.routeMisses, two?.parkedUntil]).toEqual([1, undefined, 2, undefined])
  expect(three?.parkedUntil).toBe(NOW + 24 * H)
  expect(answered(three ?? null)).toEqual(w)
  expect(isResting(three ?? w, NOW - 2 * H, NOW + 23 * H)).toBe(true)
  expect(isResting(three ?? w, 0, NOW + 24 * H)).toBe(false)
  expect(isResting(one ?? w, NOW - 59 * MIN, NOW)).toBe(true)
  expect(isResting(one ?? w, NOW - H, NOW)).toBe(false)
})

test('Fable 1: a send with no answer, then a refused one: withdrawn at the second, two sends, not one every 10 min for 48 h', opts(), async ($, on) => {
  const out = { SendMessage: SENT }
  const w = world(on, { ram: '40', out })
  w.put(LOCK, FREE)
  stopped(w, 'cccccccc')
  await $.session.start(START)
  for (let n = 0; n < 8 && fileOf(w, 'cccccccc').want?.misses !== 1; n += 1) await w.clock.advance(MIN)
  out.SendMessage = REFUSED
  await w.clock.advance(H)
  expect(sends(w).length).toBe(2)
  expect(fileOf(w, 'cccccccc').want).toBeNull()
  expect(logged(w, 'rule=withdrawn').length).toBe(1)
})

test('Fable 1: refused only: three sends over two hours, then it rests 24 h, logged', long, async ($, on) => {
  const w = world(on, { ram: '40', out: { SendMessage: REFUSED } })
  w.put(LOCK, FREE)
  stopped(w, 'cccccccc')
  await $.session.start(START)
  await w.clock.advance(5 * H)
  expect(sends(w).length).toBe(3)
  expect(fileOf(w, 'cccccccc').want?.parkedUntil).toBeGreaterThan(w.clock.now())
  expect(logged(w, 'parked till').length).toBe(1) // orchestrate.log's wording rule
  expect(fileOf(w, 'cccccccc').want).not.toBeNull()
})

test('Fable 2: after loop-paused: no send for an hour, one probe an hour, one alarm for the episode; a pause hands nothing on; the rest of the job goes on', long, async ($, on) => {
  const w = world(on, { ram: '40', out: { SendMessage: PAUSED } })
  w.put(LOCK, FREE)
  stopped(w, 'cccccccc')
  put(w, file('aaaaaaaa', { heartbeatAt: NOW + 100 * H, sends: true })) // an heir with a fresh count, alive
  put(w, { ...file(ME8, { session: ME, sends: true }), heartbeatAt: NOW })
  w.put(`${HF}/conductor.json`, JSON.stringify({ id8: ME8, at: NOW }))
  await $.session.start(START)
  await w.clock.advance(MIN)
  const first = sends(w).length
  await w.clock.advance(50 * MIN)
  expect(sends(w).length).toBe(first)
  expect((JSON.parse(w.read(`${HF}/conductor.json`)) as { id8: string }).id8).toBe(ME8)
  await w.clock.advance(3 * H)
  expect(sends(w).length).toBeLessThanOrEqual(first + 3)
  expect(logged(w, 'paused till you type in').filter(l => l.includes('work is waiting')).length).toBe(1)
  expect((JSON.parse(w.read(`${HF}/idle-with-work.json`)) as { run: number }).run).toBeGreaterThan(30)
  expect((JSON.parse(w.read(`${HF}/conductor.json`)) as { id8: string }).id8).toBe(ME8)
})

test('Fable 2: its person typing in the conductor lifts the pause at once', opts(), async ($, on) => {
  const out = { SendMessage: PAUSED }
  const w = world(on, { ram: '40', out })
  w.put(LOCK, FREE)
  stopped(w, 'cccccccc')
  await $.session.start(START)
  await w.clock.advance(2 * MIN)
  expect(sends(w).length).toBe(1)
  await w.clock.advance(5 * MIN)
  expect(sends(w).length).toBe(1)
  out.SendMessage = SENT
  w.put(`${HF}/editor/${ME8}.json`, w.read(`${HF}/editor/${ME8}.json`))
  await $.prompt.submit({ text: 'go on', wait: false, origin: { kind: 'composer' } } as never)
  expect((JSON.parse(w.read(`${HF}/wake.json`)) as { pausedUntil: number }).pausedUntil).toBe(0)
})

test('Fable 3: a target at the app\'s cap gets nothing, logged, and each woke line carries its count', opts(), async ($, on) => {
  expect(parseDeskRow(JSON.stringify({ sessionId: 'l', cliSessionId: 'c', sideSessionWakesSinceUserMessage: 9 }))?.isHeldForPerson).toBe(false)
  expect(parseDeskRow(JSON.stringify({ sessionId: 'l', cliSessionId: 'c', sideSessionWakesSinceUserMessage: 10 }))?.isHeldForPerson).toBe(true)
  expect(parseDeskRow(JSON.stringify({ sessionId: 'l', cliSessionId: 'c', stoppedUntilPersonSends: true }))?.isHeldForPerson).toBe(true)
  const w = world(on, { ram: '40', out: { SendMessage: SENT } })
  w.put(LOCK, FREE)
  stopped(w, 'c1c1c1c1', { want: want({ requestedAt: NOW - 6 * H }) })
  desk(w, 'c1c1c1c1', 'local_c1c1c1c1', { sideSessionWakesSinceUserMessage: 10 })
  stopped(w, 'c2c2c2c2', { want: want({ requestedAt: NOW - 5 * H }) })
  desk(w, 'c2c2c2c2', 'local_c2c2c2c2', { sideSessionWakesSinceUserMessage: 3 })
  await $.session.start(START)
  await w.clock.advance(3 * MIN)
  expect(sends(w).map(s => s.to)).toEqual(['local_c2c2c2c2'])
  expect(logged(w, 'the app holds this session for its person (10 wakes').length).toBe(1)
  expect(w.read(LOG)).toContain('3 wakes since its person typed')
  expect(fileOf(w, 'c1c1c1c1').want?.misses).toBeUndefined()
})

test('Fable 4: a conductor that cannot send spends no miss: it holds and logs, past 2 h too', long, async ($, on) => {
  const w = world(on, { ram: '40', out: { SendMessage: SENT } })
  w.put(LOCK, FREE)
  put(w, stoppedFile('cccccccc', { want: want(), heartbeatAt: NOW - 5 * H })) // and this session has no record in the app
  await $.session.start(START)
  await w.clock.advance(3 * H)
  expect(sends(w)).toEqual([])
  const f = fileOf(w, 'cccccccc')
  expect([f.want?.misses, f.want?.movedBack]).toEqual([undefined, true])
  expect(logged(w, 'cannot start from here').length).toBeLessThan(5)
  expect(logged(w, 'cannot start from here').length).toBeGreaterThan(0)
  expect(w.read(LOG)).not.toContain('rule=withdrawn')
})

test('Fable 5: the panel names live sessions on an older A5R; 0.28.0 withdrawals name their writer', opts(), async ($, on) => {
  expect(oldLine([file('aaaaaaaa', { conducts: undefined }), file('bbbbbbbb'), stoppedFile('cccccccc')], NOW)).toBe('older A5R in lane-aaaaaaaa: reload them (they withdraw stopped requests at 2 h)')
  expect(oldLine([file('bbbbbbbb')], NOW)).toBe('')
  const w = world(on, { ram: '40' })
  w.put(LOCK, held('dddddddd', NOW, NOW + 10 * H))
  put(w, file('dddddddd', { heartbeatAt: NOW + 10 * H, holding: { since: NOW, end: NOW + 10 * H, extended: 0 } }))
  stopped(w, 'cccccccc', { want: want({ requestedAt: NOW - 49 * H }) })
  await $.session.start(START)
  await w.clock.advance(2 * MIN)
  expect(logged(w, 'rule=withdrawn')[0]).toContain('(A5R 0.28.0)')
})

test('Fable 6: old refusals are pruned once a day and never read', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, FREE)
  w.put(`${HF}/refused/oldoldol.json`, 'null', NOW - 49 * H)
  w.put(`${HF}/refused/freshfre.json`, 'null', NOW - H)
  await $.session.start(START)
  await w.clock.advance(2 * MIN)
  const removal = w.runs.find(r => r.includes('Remove-Item') && r.includes('refused')) ?? ''
  expect(removal).toContain('oldoldol.json')
  expect(removal).not.toContain('freshfre.json')
  const me = file(ME8, { heartbeatAt: NOW, session: ME })
  const read: string[] = []
  const disk = new Map<string, string>()
  await hostOf(() => [me], me).tick(fakeIo(disk, { list: async (dir: string) => (dir.endsWith('refused') ? [{ name: 'old.json', mtimeMs: NOW - 49 * H }, { name: 'new.json', mtimeMs: NOW }] : []), read: async (p: string) => (read.push(p), disk.get(p) ?? null), deskPlace: async () => ({ appData: 'app', account: 'a', org: 'o' }) }))
  expect(read.some(p => p.endsWith('refused/old.json'))).toBe(false)
})

test('Fable 7: Vietnamese sign-offs, with or without marks, read as finished; a lease released normally renews nothing', () => {
  for (const words of ['Em đã hoàn tất phần này.', 'Xong rồi anh.', 'Không còn việc gì với Editor.', 'Em chờ anh duyệt clip này.', 'Cần anh quyết định trước khi chạy Editor.', 'cho hai xem lai', 'hoan tat', 'Đã hoàn thành.']) expect([words, isFinished(parseTail(said(words)))]).toEqual([words, true])
  for (const words of ['Em đang chờ Editor rảnh để chạy PIE.', 'Bước tiếp theo là chạy PIE trên Editor.']) expect([words, isFinished(parseTail(said(words)))]).toEqual([words, false])
  const f = file('cccccccc', { askedAt: NOW - 30 * H })
  const lease = (o: Partial<LeaseRecord>) => ({ id8: 'cccccccc', grantedAt: NOW - 29 * H, endAt: NOW - H, endReason: 'released', firstEditorSeenAt: 1, ...o }) as LeaseRecord
  expect(editorSignAt(f, [lease({})])).toBe(NOW - 29 * H)
  expect(editorSignAt(f, [lease({ endReason: 'yielded' })])).toBe(NOW - H)
})

test('Fable 8: a conductor that lost its claim leaves the start in flight alone', async () => {
  const me = file(ME8, { heartbeatAt: NOW, session: ME })
  const start = { id8: 'cccccccc', lane: 'c', why: 'turn', at: NOW - 6 * MIN, requestedAt: 1 }
  const before = JSON.stringify({ ...NO_WAKE, current: start })
  const disk = new Map<string, string>([['d/wake.json', before], ['d/conductor.json', JSON.stringify({ id8: ME8, at: NOW - MIN })]])
  let reads = 0
  await hostOf(() => [me, stoppedFile('cccccccc', { want: want() })], me).tick(fakeIo(disk, {
    read: async (p: string) => (p === 'd/conductor.json' && (reads += 1) > 1 ? JSON.stringify({ id8: 'bbbbbbbb', at: NOW }) : (disk.get(p) ?? null)),
  }))
  expect(disk.get('d/wake.json')).toBe(before)
})

test('Fable 9: a session started for its turn whose lease went idle with no Editor use: a real miss on its next request, the second withdraws it', async () => {
  expect(leaseSince([{ id8: 'c', grantedAt: 5, endReason: 'idle', firstEditorSeenAt: null } as LeaseRecord], 'c', 4)).toBe('idle')
  expect(leaseSince([{ id8: 'c', grantedAt: 5, endReason: 'idle', firstEditorSeenAt: 6 } as LeaseRecord], 'c', 4)).toBe('used')
  expect(leaseSince([{ id8: 'c', grantedAt: 3, endReason: 'idle', firstEditorSeenAt: null } as LeaseRecord], 'c', 4)).toBeNull()
  const me = file(ME8, { heartbeatAt: NOW, session: ME })
  const a = app([{ name: 'local_me.json', row: { sessionId: 'local_me', cliSessionId: ME } }, { name: 'local_c.json', row: { sessionId: 'local_c', cliSessionId: SID('cccccccc') } }])
  const leases = [{ id8: 'cccccccc', grantedAt: NOW - 50 * MIN, endReason: 'idle', firstEditorSeenAt: null } as LeaseRecord]
  const f = stoppedFile('cccccccc', { want: want() })
  a.disk.set('d/editor/cccccccc.json', JSON.stringify(f))
  a.disk.set('d/wake.json', JSON.stringify({ ...NO_WAKE, turnAt: { cccccccc: NOW - H } }))
  let calls = 0
  const c = conductor({ me8: () => ME8, me: () => me, grantInput: now => grant([me, JSON.parse(a.disk.get('d/editor/cccccccc.json') ?? '') as SessionFile], { now }), leases: () => leases, dir: () => 'd', freeWindow: () => 'w', freeGb: () => 40, titleOf: () => '' })
  await c.tick(fakeIo(a.disk, { ...a.o, call: async () => ((calls += 1), { text: SENT }) }))
  expect(calls).toBe(0)
  expect((JSON.parse(a.disk.get('d/editor/cccccccc.json') ?? '') as SessionFile).want?.misses).toBe(1)
  const again = { ...(JSON.parse(a.disk.get('d/editor/cccccccc.json') ?? '') as SessionFile), want: want() }
  a.disk.set('d/editor/cccccccc.json', JSON.stringify(again))
  a.disk.set('d/wake.json', JSON.stringify({ ...JSON.parse(a.disk.get('d/wake.json') ?? ''), turnAt: { cccccccc: NOW - H } }))
  await c.tick(fakeIo(a.disk, { ...a.o, call: async () => ((calls += 1), { text: SENT }) }))
  expect((JSON.parse(a.disk.get('d/editor/cccccccc.json') ?? '') as SessionFile).want).toBeNull()
  expect(calls).toBe(0)
})

test('Fable 10: two targets across hours under refused sends: each three, then rests', long, async ($, on) => {
  const w = world(on, { ram: '40', out: { SendMessage: REFUSED } })
  w.put(LOCK, FREE)
  stopped(w, 'c1c1c1c1', { want: want({ requestedAt: NOW - 6 * H }) })
  stopped(w, 'c2c2c2c2', { want: want({ requestedAt: NOW - 5 * H }) })
  await $.session.start(START)
  await w.clock.advance(6 * H)
  const to = sends(w).map(s => s.to)
  expect([to.filter(a => a === 'local_c1c1c1c1').length, to.filter(a => a === 'local_c2c2c2c2').length]).toEqual([3, 3])
  expect(w.read(LOG)).not.toContain('rule=withdrawn')
})

test('Fable 10: two targets across hours under the guard: one probe an hour, whoever is first', long, async ($, on) => {
  const w = world(on, { ram: '40', out: { SendMessage: PAUSED } })
  w.put(LOCK, FREE)
  stopped(w, 'c1c1c1c1', { want: want({ requestedAt: NOW - 6 * H }) })
  stopped(w, 'c2c2c2c2', { want: want({ requestedAt: NOW - 5 * H }) })
  await $.session.start(START)
  await w.clock.advance(4 * H)
  expect(sends(w).length).toBeLessThanOrEqual(5)
  expect(['c1c1c1c1', 'c2c2c2c2'].map(id8 => fileOf(w, id8).want !== null)).toEqual([true, true])
})

test('Fable 10: a whole night with every send refused: no more than 8 sends for one conductor, however many have work', long, async ($, on) => {
  const w = world(on, { ram: '40', out: { SendMessage: REFUSED } })
  w.put(LOCK, FREE)
  for (const [i, id8] of ['c1c1c1c1', 'c2c2c2c2', 'c3c3c3c3', 'c4c4c4c4', 'c5c5c5c5'].entries()) stopped(w, id8, { want: want({ requestedAt: NOW - (9 - i) * H }) })
  for (const id8 of ['d1d1d1d1', 'd2d2d2d2']) worker(w, id8, QUEUED_WORDS)
  await $.session.start(START)
  await w.clock.advance(12 * H - 5 * MIN) // the budget is a rolling 12 h
  expect(sends(w).length).toBeLessThanOrEqual(8)
  expect(sends(w).length).toBeGreaterThan(3)
})

test('A138: unit: the budget: refused sends stop all; attempts leave the rest to turns; an answer clears the count', () => {
  const at = (n: number, refused = false) => Array.from({ length: n }, () => ({ at: NOW - H, ...(refused ? { refused: true as const } : {}) }))
  expect(budgetHold({ ...NO_WAKE, spent: at(7, true) }, 'turn', NOW)).toBeNull()
  expect(budgetHold({ ...NO_WAKE, spent: at(8, true) }, 'turn', NOW)).toContain('8 sends refused')
  expect(budgetHold({ ...NO_WAKE, spent: at(6) }, 'turn', NOW)).toBeNull()
  expect(budgetHold({ ...NO_WAKE, spent: at(6) }, 'work', NOW)).toContain('kept for Editor turns')
  expect(budgetHold({ ...NO_WAKE, spent: [{ at: NOW - 13 * H, refused: true }, ...at(5)] }, 'work', NOW)).toBeNull()
})

test('A138: an answer clears the count of refused sends: the route works', async () => {
  const me = file(ME8, { heartbeatAt: NOW, session: ME })
  const up = stoppedFile('cccccccc', { heartbeatAt: NOW })
  const spent = Array.from({ length: 8 }, () => ({ at: NOW - H, refused: true }))
  const disk = new Map<string, string>([['d/wake.json', JSON.stringify({ ...NO_WAKE, spent, current: { id8: 'cccccccc', lane: 'c', why: 'git', at: NOW - MIN, requestedAt: null } })], ['d/conductor.json', JSON.stringify({ id8: ME8, at: NOW - MIN })]])
  await hostOf(() => [me, up], me).tick(fakeIo(disk))
  expect((JSON.parse(disk.get('d/wake.json') ?? '') as { spent: { refused?: true }[] }).spent.filter(s => s.refused)).toEqual([])
})

test('Fable 5: the panel line carries the older sessions', async () => {
  const me = file(ME8, { heartbeatAt: NOW, session: ME })
  const c = hostOf(() => [me, file('aaaaaaaa', { heartbeatAt: NOW, conducts: undefined })], me)
  expect(c.line(NOW)).toContain('older A5R in lane-aaaaaaaa')
})
