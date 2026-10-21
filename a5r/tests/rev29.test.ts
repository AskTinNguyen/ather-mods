import { expect, test } from 'claude-code/testing'
import { NOTICES, blankSession, newSync } from '../hooks/coord.ts'
import { decisionNamesIn } from './decision-names.ts'
import { NOW, PENDING, PROJ, opts, world, type Rec } from './world.ts'

// Rev 29 (L-32), A83: A5R has no decision convention of its own; decisions are Ather's. Nothing A5R injects, sends,
// shows or writes carries the convention; an answer with a decision line marks nothing; the A63 clean-up stays.
const START = { cwd: PROJ, surface: 'terminal', isInteractive: true } as never
const T = (h: number, m: number) => new Date(2026, 9, 6, h, m).getTime()
const compose = async ($: any) =>
  (await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: ['Bash'], outputStyle: null, traits: [] } as never)).sections as { id: string; text: string }[]
const DECISION = 'Phần A xong.\n\n> 🟥 **NEEDS DECISION** — Merge PR #1 now or after the train? / Default if no answer: after the train'

for (const isOn of [true, false])
  test(`A83 (A5R ${isOn ? 'on' : 'off'}): the injected prompt has no decision section; a decision line in an answer marks nothing`, opts(), async ($, on) => {
    const w = world(on, { a5r: isOn })
    w.put(PENDING, '')
    on('prompt.compose', async () => ({ sections: [] }))
    on('turn.complete', async () => ({ text: '' }))
    await $.session.start(START)
    const mine = (await compose($)).filter(s => s.id.startsWith('a5r'))
    expect(mine.map(s => s.text)).toEqual(isOn ? ['A5R RULES ab12cd34'] : []) // only A5R's own rules while it is on
    expect(mine.some(s => /Decisions that are Hai/.test(s.text) || decisionNamesIn(s.text).length > 0)).toBe(false)
    await $.turn.complete({ answer: DECISION, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await $.turn.complete({ answer: '⏯️ Bước 2 xong, chờ Hai xem clip.', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
    await w.clock.advance(3 * 60_000)
    expect(w.seen.filter(e => e.tool === 'mcp__ccd_session_mgmt__set_session_title' || e.tool === 'mcp__ccd_sidebar__set_unread')).toEqual([])
    expect(w.read(PENDING)).toBe('')
    const said = ['ui.toast', 'prompt.submit', 'ui.status'].flatMap(ev => (w.calls[ev] ?? []).map(e => JSON.stringify(e as Rec)))
    expect(said.filter(t => decisionNamesIn(t).length > 0)).toEqual([])
  })

test('A83: unit: what A5R raised as a decision mark before is a plain coordination notice, without the convention', () => {
  const s = { ...newSync(T(14, 0), { session: 'bbbbbbbb-1', id8: 'bbbbbbbb', lane: 'walker' }, 'walker', NOW), state: 'expired' as const, endedAt: T(14, 45), note: 'its hard end 14:45 passed' }
  const texts = [
    NOTICES.prAfter(812, 'tail-vfx', 'fails 1 of 5 (4 Keep it clean)', false),
    NOTICES.prAfter(813, 'tail-vfx', 'fails 1 of 5 (4 Keep it clean)', true),
    NOTICES.expired(s),
    NOTICES.hardEndSoon(s),
    NOTICES.mergeLeft({ head: 'MERGE_HEAD', mtimeMs: T(14, 20) }, s.holder, s, null, 'E:/s2'), // rev 39 (A115): the head file and its owner given
    NOTICES.mergeLeft({ head: 'MERGE_HEAD', mtimeMs: T(14, 20) }, s.holder, s, { lane: 'walker', isMe: true }, 'E:/s2'),
    NOTICES.mergeLeft({ head: 'MERGE_HEAD', mtimeMs: T(14, 20) }, null, null, { lane: 'lane-cccccccc', isMe: false }, 'E:/s2'),
  ]
  for (const t of texts) {
    expect(t.startsWith('A5R · ')).toBe(true)
    expect([t, decisionNamesIn(t)]).toEqual([t, []])
    expect([t, /Hai is asked|for Hai|tell Hai/.test(t)]).toEqual([t, false])
  }
  expect(texts[0]).toBe('A5R · Acceptance — PR #812 (intent tail-vfx) was opened without A5R acceptance and fails 1 of 5 (4 Keep it clean) → fix it on its branch before it merges (the A5R card lists what fails), or record in progress.md why it merges as it is')
})

// ---------- 0.17.1: a merge left behind by a gone holder never waits on it ----------
const HF = 'E:/s2/Saved/A5R'
const SYNC = `${HF}/sync.json`
const B = { session: 'bbbbbbbb-1111-4000-8000-000000000000', id8: 'bbbbbbbb', lane: 'sync-lane' }
const peer = (id8: string, o: Rec = {}): string => JSON.stringify({ ...blankSession(`${id8}-1111-4000-8000-000000000000`, id8 === 'bbbbbbbb' ? 'sync-lane' : `lane-${id8}`, '', NOW), ...o })
const prompts = (w: ReturnType<typeof world>): string[] => (w.calls['prompt.submit'] ?? []).map(e => String((e as { text?: string }).text))
const ABORT = 'git -C E:/s2 merge --abort'
const leftBehind = (w: ReturnType<typeof world>, withSync = true) => {
  w.put('E:/s2/.git/HEAD', 'ref: refs/heads/HaiHuynh/20261005')
  w.put('E:/s2/.git/MERGE_HEAD', '1a2b3c\n', T(14, 20))
  if (withSync) w.put(SYNC, JSON.stringify({ ...newSync(T(14, 0), B, 'sync-lane (session bbbbbbbb)', NOW - 60 * 60_000), state: 'expired', endedAt: T(14, 30), note: 'its holder sync-lane (session bbbbbbbb) is gone' }))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', { heartbeatAt: NOW - 30 * 60_000 })) // gone
}

test('A83 / A79 (0.17.1): holder gone + MERGE_HEAD: one live session is woken to take it over, and then may abort the merge', opts(), async ($, on) => {
  const w = world(on)
  on('turn.complete', async () => ({ text: '' }))
  leftBehind(w)
  await $.session.start(START)
  const told = prompts(w).filter(p => p.includes('A5R · Merge guard — a merge is in progress'))
  expect(told.length).toBe(1)
  expect(told[0]).toContain('its holder is gone, so this session takes it over: /a5r sync takeover (or the sync tool, action takeover), then git -C E:/s2 merge --abort')
  expect(told[0]).not.toMatch(/Hai/)
  expect(String((await $.tool.call({ tool: 'Bash', command: ABORT } as never)).deny)).toContain('Merge guard') // not yet its own
  expect(String((await $.tool.call({ tool: 'mcp__a5r__sync', action: 'takeover' } as never)).result)).toContain('taken over the merge left in the shared checkout (.git/MERGE_HEAD): run git -C E:/s2 merge --abort')
  expect((await $.tool.call({ tool: 'Bash', command: ABORT } as never)).deny).toBeUndefined()
})

test('A83 (0.17.1): with another live session first in the queue, that one takes it over; this one is told once at its next turn', opts(), async ($, on) => {
  const w = world(on)
  on('turn.complete', async () => ({ text: '' }))
  leftBehind(w)
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc', { want: { minutes: 20, pie: false, build: false, what: 'PIE proof', mode: 'interactive', pausable: true, nextSafe: 'after save', requestedAt: NOW - 60_000 } }))
  await $.session.start(START)
  expect(prompts(w).filter(p => p.includes('Merge guard'))).toEqual([]) // not woken
  const ran = (await $.tool.call({ tool: 'Bash', command: 'echo hi' } as never)) as { context?: string[] }
  expect((ran.context ?? []).filter(c => c.includes('Merge guard'))).toEqual([expect.stringContaining('lane-cccccccc is asked to take it over and end it; make no git write there until .git/MERGE_HEAD is gone')])
})

test('A83 (0.17.1): a merge left with no sync file at all: the live session takes it over through /a5r sync takeover and may abort it', opts(), async ($, on) => {
  const w = world(on)
  on('turn.complete', async () => ({ text: '' }))
  leftBehind(w, false)
  await $.session.start(START)
  expect(prompts(w).some(p => p.includes('the session that started it') || p.includes('this session takes it over'))).toBe(true)
  expect(String((await $.command.run({ command: 'a5r', args: 'sync takeover' } as never)).text)).toContain('taken over the merge left')
  expect((await $.tool.call({ tool: 'Bash', command: ABORT } as never)).deny).toBeUndefined()
})
