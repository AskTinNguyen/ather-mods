import { expect, test } from 'claude-code/testing'
import { blankSession, heldLine, type SessionFile } from '../hooks/coord.ts'
import type { VerdictRow } from '../hooks/judge.ts'
import { A5RPANE, LOCK, NOW, PROJ, find, opts, text, world } from './world.ts'

// Rev 31 (L-34), A89: the Orchestrate card shows the present: a verdict is listed only while its incident is current
// (that holder still holds that lease or sync) or ended less than 30 min ago, dated when not today. MEASURED 2026-10-16:
// three verdicts from 2026-10-09 listed with no date. Rev 40 (A116): the card is NEEDS A LOOK: it lists only a current
// verdict that needs the person (stuck, or waiting for his answer) and is left out otherwise (no "No stalled holder" line).
const HF = 'E:/s2/Saved/A5R'
const START = { cwd: PROJ, surface: 'terminal', isInteractive: true } as never
const T = (d: number, h: number, m: number) => new Date(2026, 9, d, h, m).getTime()
const MIN = 60_000
const SID = (id8: string) => `${id8}-1111-4000-8000-000000000000`
const held = (id8: string, since: number, end: number) => `${heldLine({ lane: `lane-${id8}`, sessionName: `title-${id8}`, id8, since, pid: null, end, mode: 'unattended', pausable: true, nextSafe: 'after save', note: 'their slot' })}\n`
const peer = (id8: string, o: Partial<SessionFile> = {}): string => JSON.stringify({ ...blankSession(SID(id8), `lane-${id8}`, `title ${id8}`, NOW), ...o })
const row = (o: Partial<VerdictRow>): VerdictRow => ({ at: NOW, id8: 'bbbbbbbb', lane: 'lane-bbbbbbbb', kind: 'editor', verdict: 'working', evidence: 'it is building', recommendation: 'wait for it', by: 'cccccccc', source: 'judge', ...o })
const FREE = 'FREE since=14:00 2026-10-06 by=x note=none background=none · free since 14:00\n'
const card = async ($: any) => {
  const tree = await $.ui.render(A5RPANE as never)
  return { tree, rows: [0, 1, 2].map(i => text(find(tree, `hai-look-${i}`))).filter(Boolean), block: find(tree, 'hai-look') }
}

test('A89: the three 2026-10-09 verdicts (talab-upgrade 19:38, 1009-loco-ab2 17:25, mc-jump 16:37) are not listed today; rev 40: NEEDS A LOOK is left out', opts(), async ($, on) => {
  const w = world(on)
  w.put(LOCK, FREE)
  const old = [row({ at: T(9, 19, 38), id8: 'aaaaaaaa', lane: 'talab-upgrade', since: T(9, 18, 30) }), row({ at: T(9, 17, 25), id8: 'dddddddd', lane: '1009-loco-ab2' }), row({ at: T(9, 16, 37), id8: 'eeeeeeee', lane: 'mc-jump-fall-triage' })]
  w.put(`${HF}/verdicts.json`, JSON.stringify({ v: 1, verdicts: old }))
  await $.session.start(START)
  const c = await card($)
  expect(c.rows).toEqual([])
  expect(c.block).toBeUndefined()
})

test('A89: a verdict whose incident is current is listed (today: time only); a row written before 0.18.1 (no lease start) never is; rev 40 (A116): a current verdict that needs no look is not', opts(), async ($, on) => {
  const w = world(on)
  w.put(LOCK, held('bbbbbbbb', T(6, 13, 30), T(6, 15, 0)))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', { holding: { since: T(6, 13, 30), end: T(6, 15, 0), extended: 0 } }))
  w.put(`${HF}/verdicts.json`, JSON.stringify({ v: 1, verdicts: [row({ at: T(6, 14, 30), since: T(6, 13, 30), verdict: 'stuck-or-crashed', evidence: 'no turn for 25 min' }), row({ at: T(6, 14, 20), since: T(6, 13, 30) }), row({ at: T(6, 14, 10), verdict: 'stuck-or-crashed' })] }))
  await $.session.start(START)
  const c = await card($)
  expect(c.rows).toEqual(['⚠14:30 lane-bbbbbbbb: no turn for 25 min, likely stuck→ wait for it']) // the current `working` one needs no look
})

test('A89: a verdict of another day is dated; once its lease ends it stays 30 min, then leaves the card', opts(), async ($, on) => {
  const w = world(on)
  w.put(LOCK, held('bbbbbbbb', T(5, 23, 50), T(6, 15, 0))) // a lease across midnight, judged yesterday
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb'))
  w.put(`${HF}/verdicts.json`, JSON.stringify({ v: 1, verdicts: [row({ at: T(5, 23, 59), since: T(5, 23, 50), verdict: 'stuck-or-crashed' })] }))
  await $.session.start(START)
  expect((await card($)).rows[0]).toContain('2026-10-05 23:59 lane-bbbbbbbb: it is building, likely stuck')
  w.put(LOCK, FREE) // the lease ended
  await w.clock.advance(20 * MIN)
  expect((await card($)).rows.length).toBe(1) // ended 20 min ago
  await w.clock.advance(15 * MIN)
  const c = await card($)
  expect(c.rows).toEqual([])
  expect(c.block).toBeUndefined()
})
