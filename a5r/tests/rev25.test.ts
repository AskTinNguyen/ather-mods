import { expect, test } from 'claude-code/testing'
import { blankSession, heldLine, parseLockLine, type SessionFile, type Want } from '../hooks/coord.ts'
import { digestOf, hintOf, judgePrompt, localTime, parseTail, type JudgeFacts } from '../hooks/judge.ts'
import { LOCK, NOW, PROJ, opts, world, type Rec } from './world.ts'

// Rev 25 (MEASURED on Hai's pane, orchestrate.log 17:25): A70 a holder's silence counts from the later of its grant and
// its last turn (lane 1009-loco-ab2 was judged the minute it was granted, its last turn 43 min before); A71 the judge's
// input is in machine-local time only (verdicts mixed UTC and local: "10:25 granting the Editor until 19:55").
const HF = 'E:/s2/Saved/A5R'
const START = { cwd: PROJ, surface: 'terminal', isInteractive: true } as never
const T = (h: number, m: number) => new Date(2026, 9, 6, h, m).getTime()
const MIN = 60_000
const SID = (id8: string) => `${id8}-1111-4000-8000-000000000000`
const held = (id8: string, since: number, end: number) => `${heldLine({ lane: `lane-${id8}`, sessionName: `title-${id8}`, id8, since, pid: null, end, mode: 'interactive', pausable: true, nextSafe: 'after save', note: 'their slot' })}\n`
const peer = (id8: string, o: Partial<SessionFile> = {}): string => JSON.stringify({ ...blankSession(SID(id8), `lane-${id8}`, `title ${id8}`, NOW), ...o })
const want = (o: Partial<Want> = {}): Want => ({ minutes: 30, pie: false, build: false, what: 'their slot', mode: 'interactive', pausable: true, nextSafe: 'after save', requestedAt: NOW - 5 * MIN, ...o })
const judges = (w: ReturnType<typeof world>): Rec[] => ((w.calls['agent.spawn'] ?? []) as Rec[]).filter(s => (s.subagent_type ?? s.subagentType) === 'a5r:judge')

// ---------- A70 ----------
const grantedNow = (w: ReturnType<typeof world>) => {
  w.put(LOCK, held('bbbbbbbb', NOW, NOW + 60 * MIN)) // granted at 14:40
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', { heartbeatAt: w.clock.now(), holding: { since: NOW, end: NOW + 60 * MIN, extended: 0 }, lastTurnAt: T(14, 0), agents: 0 }), w.clock.now())
}

test('A70: granted now, last turn 40 min ago: no judge until 10 min after the grant, then one', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  grantedNow(w)
  await $.session.start(START)
  for (let m = 1; m <= 9; m += 1) {
    grantedNow(w)
    await w.clock.advance(MIN)
    expect([m, judges(w).length]).toEqual([m, 0])
  }
  grantedNow(w)
  await w.clock.advance(MIN) // 14:50
  expect(judges(w).length).toBe(1)
  expect(String(judges(w)[0]?.prompt)).toContain('has run no turn for 10 min while holding (granted 14:40)')
})

test('A70 (A55): granted now, last turn 40 min ago, someone waiting: not passed on until 10 min after the grant', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  grantedNow(w)
  const waiter = () => w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc', { heartbeatAt: w.clock.now(), want: want() }), w.clock.now())
  waiter()
  await $.session.start(START)
  for (let m = 1; m <= 9; m += 1) {
    grantedNow(w)
    waiter()
    await w.clock.advance(MIN)
    expect([m, parseLockLine(w.read(LOCK)).id8]).toEqual([m, 'bbbbbbbb'])
  }
  grantedNow(w)
  waiter()
  await w.clock.advance(MIN) // 14:50
  expect(parseLockLine(w.read(LOCK)).kind).toBe('free')
})

// ---------- A71 ----------
test('A71: the judge\'s input is machine-local only: no ISO time, no Z, no UTC hour, and it says so', () => {
  const at = Date.UTC(2026, 9, 9, 10, 25) // 10:25Z
  const events = parseTail(JSON.stringify({ type: 'user', timestamp: new Date(at).toISOString(), message: { role: 'user', content: 'A5R granted the Editor until 19:55.' } }))
  const facts: JudgeFacts = { now: at + 5 * MIN, kind: 'editor', lane: '1009-loco-ab2', id8: '58c825ad', session: '58c825ad-0000', since: at, end: at + 210 * MIN, why: 'test', liveness: 'alive', lastTurnAt: at - 43 * MIN, agents: 0, procs: [], hasEditor: false, hasBuild: false, transcript: 'x.jsonl' }
  const prompt = judgePrompt(facts, hintOf(facts, events), digestOf(events, 40, facts.now))
  expect(prompt).not.toMatch(/\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z|T\d{2}:\d{2}/)
  expect(prompt).toContain('All times are local (machine time')
  expect(prompt).toContain(`holding the Editor since ${localTime(at)}`)
  expect(prompt).toContain(`${localTime(at)} user: A5R granted the Editor until 19:55.`)
  if (new Date(at).getTimezoneOffset() !== 0) expect(prompt.includes('10:25')).toBe(false) // the UTC hour never appears
  expect(localTime(at - 86_400_000, at)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/) // another day carries its date
})
