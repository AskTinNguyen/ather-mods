import { expect, test } from 'claude-code/testing'
import { blankSession, heldLine, parseLockLine, type SessionFile } from '../hooks/coord.ts'
import { saysWaitingForEditor } from '../hooks/nudge.ts'
import { REQUIRED_RULES_TEXT } from './rules-text.ts'
import { LOCK, ME, NOW, PROJ, opts, world, type Rec } from './world.ts'

// Rev 32 (L-35): A90 a session that cannot go on for the Editor or memory queues before it stops; A91 when the Editor
// comes free and nobody is queued, idle sessions whose last message says they wait for it get one nudge; A92 a request
// held back only by memory is granted and woken when memory allows. Hai, 2026-10-19: tasks that could have run overnight
// while the Editor was free stopped for lack of a nudge.
const HF = 'E:/s2/Saved/A5R'
const RECORDS = 'C:/Users/hai.huynh/.claude/projects/E--s2'
const ME8 = ME.slice(0, 8)
const START = { cwd: PROJ, surface: 'terminal', isInteractive: true } as never
const T = (h: number, m: number) => new Date(2026, 9, 6, h, m).getTime()
const MIN = 60_000
const SID = (id8: string) => `${id8}-1111-4000-8000-000000000000`
const EDITOR = 'mcp__a5r__editor'
const FREE = 'FREE since=14:30 2026-10-06 by=lane-bbbbbbbb note=done background=none · free since 14:30\n'
const held = (id8: string, since: number, end: number) => `${heldLine({ lane: `lane-${id8}`, sessionName: `title-${id8}`, id8, since, pid: null, end, mode: 'interactive', pausable: true, nextSafe: 'after save', note: 'their slot' })}\n`
// A peer kept alive for the whole test (its a5r's heartbeat), idle since `turn`.
const peer = (id8: string, o: Partial<SessionFile> = {}): string => JSON.stringify({ ...blankSession(SID(id8), `lane-${id8}`, `title ${id8}`, NOW), heartbeatAt: NOW + 120 * MIN, ...o })
const said = (text: string) => JSON.stringify({ type: 'assistant', timestamp: new Date(NOW - 20 * MIN).toISOString(), message: { role: 'assistant', content: [{ type: 'text', text }] } })
const WAITING = 'Build is green. The Editor is held by lane-bbbbbbbb, so I will wait until the Editor is free, then run PIE.'
const DONE = 'All tests pass and the PR is open. Nothing else to do.'
const prompts = (w: ReturnType<typeof world>): string[] => (w.calls['prompt.submit'] ?? []).map(e => String((e as Rec).text))
const idle = async ($: any) => $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
const nudgedTo = (w: ReturnType<typeof world>, id8: string): string[] => ((JSON.parse(w.read(`${HF}/nudges/${id8}.json`) || '{"nudges":[]}') as { nudges: { window: string }[] }).nudges).map(n => n.window)
const idlePeer = (w: ReturnType<typeof world>, id8: string, text: string) => {
  w.put(`${HF}/editor/${id8}.json`, peer(id8, { lastTurnAt: NOW - 20 * MIN, agents: 0 }))
  w.put(`${RECORDS}/${SID(id8)}.jsonl`, said(text))
}

// ---------- A90 ----------
// The sentence is checked in the real rules-a5r.md under node (tests/scan-old-names.mjs, REQUIRED_RULES_TEXT); here, that
// the injected section carries what the file says while A5R is on, and nothing while it is off.
const A90_TEXT = REQUIRED_RULES_TEXT.find(r => r.row === 'A90')?.text ?? ''
for (const isOn of [true, false])
  test(`A90 (A5R ${isOn ? 'on' : 'off'}): the rules A5R injects say to request the Editor before stopping, never "I will wait" alone${isOn ? '' : ' (nothing while off)'}`, opts(), async ($, on) => {
    expect(A90_TEXT).toContain('request the Editor with the editor tool (minutes, pie, build, what) before you stop: never end your turn with "I will wait" alone.')
    world(on, { a5r: isOn, rules: `While you wait, do the work that needs no Editor. ${A90_TEXT}` })
    on('prompt.compose', async () => ({ sections: [] }))
    await $.session.start(START)
    const sections = (await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: ['Bash'], outputStyle: null, traits: [] } as never)).sections as unknown as { id: string; text: string }[]
    const text = sections.filter(s => s.id.startsWith('a5r')).map(s => s.text).join('\n')
    expect(text).toBe(isOn ? `While you wait, do the work that needs no Editor. ${A90_TEXT}` : '')
  })

test('A90: a queued session that went idle is woken by one prompt when its slot is granted', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  on('turn.complete', async () => ({ text: '' }))
  w.put(LOCK, held('bbbbbbbb', T(14, 0), T(15, 0)))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', { holding: { since: T(14, 0), end: T(15, 0), extended: 0 } }))
  await $.session.start(START)
  expect(String((await $.tool.call({ tool: EDITOR, action: 'request', minutes: 30, what: 'PIE check' } as never)).result)).toContain('holds the Editor')
  await idle($) // the turn ends: "queued, waiting for the grant"
  w.put(LOCK, FREE) // the holder releases
  await w.clock.advance(MIN)
  const woke = prompts(w)
  expect(woke.length).toBe(1)
  expect(woke[0]).toContain('A5R · Editor — granted to this session until')
  expect(parseLockLine(w.read(LOCK)).id8).toBe(ME8)
})

// ---------- A91 ----------
test('A91: unit: a last message waiting for the Editor, PIE, a slot, the lock or memory (EN, VI) reads as waiting; others do not', () => {
  for (const t of [WAITING, 'Queued for the Editor slot; I will resume when it is granted.', 'Waiting on RAM: only 12 GB free, PIE needs more.', 'Đang chờ Editor rảnh để chạy PIE.', 'Sẽ tiếp tục khi Editor được giải phóng.', 'The lock is held; waiting for it.'])
    expect([t, saysWaitingForEditor(t)]).toEqual([t, true])
  for (const t of [DONE, 'I fixed the editor tool tests.', 'Waiting for your review of the PR.', 'Fixed the memory leak; the suite passes once again.', 'The queue is empty and the Editor is free.', 'The lock file reader is done.', ''])
    expect([t, saysWaitingForEditor(t)]).toEqual([t, false])
})

test('A91: the Editor free and nobody queued: an idle session whose last message waits for it is nudged once (its own a5r delivers it); one that says nothing about it is not', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  on('turn.complete', async () => ({ text: '' }))
  w.put(LOCK, FREE)
  idlePeer(w, 'cccccccc', WAITING)
  idlePeer(w, 'dddddddd', DONE)
  w.put(`${RECORDS}/${ME}.jsonl`, said(WAITING))
  await $.session.start(START)
  await idle($) // this session ran a turn at 14:40 and waits too
  expect(nudgedTo(w, 'cccccccc')).toEqual(['14:30 2026-10-06'])
  expect(nudgedTo(w, 'dddddddd')).toEqual([])
  expect(w.read(`${HF}/orchestrate.log`)).toContain('rule=A91-nudge | lane=lane-cccccccc')
  for (let n = 0; n < 12; n += 1) await w.clock.advance(MIN) // this session idle 10 min: its own nudge, delivered as one prompt
  const woke = prompts(w).filter(p => p.includes('the Editor is free now'))
  expect(woke).toEqual(['A5R · Editor — the Editor is free now (free memory 40 GB) → if your task was waiting for it, request it with the editor tool; otherwise ignore this'])
  for (let n = 0; n < 10; n += 1) await w.clock.advance(MIN)
  expect(prompts(w).filter(p => p.includes('the Editor is free now')).length).toBe(1) // not again in the same free window
  expect(nudgedTo(w, 'cccccccc')).toEqual(['14:30 2026-10-06'])
})

test('A91: at most 3 nudges in a free window, the most recently active first; none while anyone is queued', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, FREE)
  const ids = ['c1c1c1c1', 'c2c2c2c2', 'c3c3c3c3', 'c4c4c4c4', 'c5c5c5c5']
  ids.forEach((id8, n) => {
    w.put(`${HF}/editor/${id8}.json`, peer(id8, { lastTurnAt: NOW - (15 + n) * MIN, agents: 0 }))
    w.put(`${RECORDS}/${SID(id8)}.jsonl`, said(WAITING))
  })
  await $.session.start(START)
  for (let n = 0; n < 3; n += 1) await w.clock.advance(MIN)
  expect(ids.map(id8 => nudgedTo(w, id8).length)).toEqual([1, 1, 1, 0, 0])
})

test('A91: nobody is nudged while a live session is queued for the Editor', opts(), async ($, on) => {
  const w = world(on, { ram: '20' }) // under the launch gate: the queued request waits on RAM
  w.put(LOCK, FREE)
  idlePeer(w, 'cccccccc', WAITING)
  w.put(`${HF}/editor/eeeeeeee.json`, peer('eeeeeeee', { want: { minutes: 30, pie: false, build: false, what: 'their slot', mode: 'interactive', pausable: true, nextSafe: 'after save', requestedAt: NOW - MIN } }))
  await $.session.start(START)
  await w.clock.advance(MIN)
  expect(nudgedTo(w, 'cccccccc')).toEqual([])
})

// ---------- A92 ----------
test('A92: a queued request held back only by the launch gate is granted and woken as soon as a probe meets the gate', opts(), async ($, on) => {
  const w = world(on, { ram: '20' })
  on('turn.complete', async () => ({ text: '' }))
  w.put(LOCK, FREE)
  await $.session.start(START)
  expect(String((await $.tool.call({ tool: EDITOR, action: 'request', minutes: 30, what: 'PIE check' } as never)).result)).toContain('under the launch gate of 28 GB')
  await idle($)
  await w.clock.advance(2 * MIN)
  expect(parseLockLine(w.read(LOCK)).kind).toBe('free') // still 20 GB
  w.machine.ram = '36'
  await w.clock.advance(MIN) // the next shared probe reads 36 GB
  await w.clock.advance(MIN)
  expect(parseLockLine(w.read(LOCK)).id8).toBe(ME8)
  expect(prompts(w).filter(p => p.includes('granted to this session')).length).toBe(1)
})

// ---------- review of rev 32 (A91) ----------
test('A91 (review): a long record is read by its last 64 KB only (never whole), and the waiting session is still nudged', opts(), async ($, on) => {
  const w = world(on, { ram: '40', git: { '[IO.File]::Open': { stdout: said(WAITING) } } })
  w.put(LOCK, FREE)
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc', { lastTurnAt: NOW - 20 * MIN, agents: 0 }))
  w.put(`${RECORDS}/${SID('cccccccc')}.jsonl`, `${'x'.repeat(70 * 1024)}\n${said(DONE)}`) // read whole it would say DONE: the tail answers
  await $.session.start(START)
  await w.clock.advance(MIN)
  expect(w.runs.some(r => r.includes('[IO.File]::Open') && r.includes('Seek(-65536'))).toBe(true)
  expect(nudgedTo(w, 'cccccccc')).toEqual(['14:30 2026-10-06'])
})

test('A91 (review): a session nudged less than an hour ago is not nudged again, whatever the window', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, FREE)
  idlePeer(w, 'cccccccc', WAITING)
  w.put(`${HF}/nudges/cccccccc.json`, JSON.stringify({ v: 1, nudges: [{ window: '13:40 2026-10-06', at: NOW - 30 * MIN, by: 'dddddddd', freeGb: 40 }] }))
  await $.session.start(START)
  await w.clock.advance(MIN)
  expect(nudgedTo(w, 'cccccccc')).toEqual(['13:40 2026-10-06'])
})
