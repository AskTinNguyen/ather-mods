import { expect, test } from 'claude-code/testing'
import { NOTICES, newSync } from '../hooks/coord.ts'
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
    NOTICES.mergeLeft(T(14, 20), s),
    NOTICES.mergeLeft(T(14, 20), null),
  ]
  for (const t of texts) {
    expect(t.startsWith('A5R · ')).toBe(true)
    expect([t, decisionNamesIn(t)]).toEqual([t, []])
    expect([t, /Hai is asked|for Hai|tell Hai/.test(t)]).toEqual([t, false])
  }
  expect(texts[0]).toBe('A5R · Acceptance — PR #812 (intent tail-vfx) was opened without A5R acceptance and fails 1 of 5 (4 Keep it clean) → fix it on its branch before it merges (the A5R card lists what fails), or record in progress.md why it merges as it is')
})
