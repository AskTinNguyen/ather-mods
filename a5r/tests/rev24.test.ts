import { expect, test } from 'claude-code/testing'
import { blankSession, heldLine, parseLockLine, type SessionFile, type Want } from '../hooks/coord.ts'
import { JUDGE_SYSTEM, hintOf, parseTail, parseVerdict, type JudgeFacts } from '../hooks/judge.ts'
import { A5RPANE, LOCK, ME, NOW, PROJ, find, opts, text, world, type Rec } from './world.ts'

// Rev 24: A66 the lock line names the Editor that runs (the holder writes its pid); A67 a holder working through a
// background agent is not idle (A55 and the judge's trigger); A68 a lease past its end may be extended while nobody waits.
const HF = 'E:/s2/Saved/A5R'
const ME8 = ME.slice(0, 8)
const EDITOR = 'mcp__a5r__editor'
const START = { cwd: PROJ, surface: 'terminal', isInteractive: true } as never
const T = (h: number, m: number) => new Date(2026, 9, 6, h, m).getTime()
const MIN = 60_000
const SID = (id8: string) => `${id8}-1111-4000-8000-000000000000`
const held = (id8: string, since: number, end: number, pid: number | null = null) => `${heldLine({ lane: `lane-${id8}`, sessionName: `title-${id8}`, id8, since, pid, end, mode: 'interactive', pausable: true, nextSafe: 'after save', note: 'their slot' })}\n`
const peer = (id8: string, o: Partial<SessionFile> = {}): string => JSON.stringify({ ...blankSession(SID(id8), `lane-${id8}`, `title ${id8}`, NOW), ...o })
const mineHolding = (w: ReturnType<typeof world>, since: number, end: number) =>
  w.put(`${HF}/editor/${ME8}.json`, JSON.stringify({ ...blankSession(ME, 'tail-vfx', 'Tail', NOW), lastTurnAt: NOW, holding: { since, end, extended: 0 } }))
const EDITOR_PROC = { name: 'UnrealEditor', pid: 45392, gb: 26, parentAlive: true }
const want = (o: Partial<Want> = {}): Want => ({ minutes: 30, pie: false, build: false, what: 'their slot', mode: 'interactive', pausable: true, nextSafe: 'after save', requestedAt: NOW - 5 * MIN, ...o })
const judges = (w: ReturnType<typeof world>): Rec[] => ((w.calls['agent.spawn'] ?? []) as Rec[]).filter(s => (s.subagent_type ?? s.subagentType) === 'a5r:judge')
const out = (ran: { result?: unknown; text?: string; deny?: string }): string => String(ran.deny ?? ran.result ?? ran.text ?? '')

// ---------- A66 ----------
test('A66: the holder writes the Editor that runs into its HELD line at its next minute (pid=none → pid=45392)', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  mineHolding(w, T(14, 30), T(15, 30))
  w.put(LOCK, held(ME8, T(14, 30), T(15, 30)))
  await $.session.start(START)
  expect(parseLockLine(w.read(LOCK)).pid).toBeNull()
  w.machine.procs = [EDITOR_PROC]
  await w.clock.advance(MIN)
  const lock = parseLockLine(w.read(LOCK))
  expect([lock.id8, lock.pid, lock.end]).toEqual([ME8, 45392, '15:30'])
})

test('A66: launching the Editor writes its pid at once (the holder only); another session never writes it', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  mineHolding(w, T(14, 30), T(15, 30))
  w.put(LOCK, held(ME8, T(14, 30), T(15, 30)))
  await $.session.start(START)
  w.machine.procs = [EDITOR_PROC]
  await $.tool.call({ tool: 'Bash', command: 'Start-Process "D:/GameEditors/5.8/Engine/Binaries/Win64/UnrealEditor.exe" -ArgumentList "E:/s2/S2.uproject"' })
  expect(parseLockLine(w.read(LOCK)).pid).toBe(45392)
})

test('A66: a lock held by another session is never rewritten with a pid by this one', opts(), async ($, on) => {
  const w = world(on, { ram: '40', procs: [EDITOR_PROC] })
  const line = held('bbbbbbbb', T(14, 30), T(15, 30))
  w.put(LOCK, line)
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', { heartbeatAt: NOW, holding: { since: T(14, 30), end: T(15, 30), extended: 0 }, lastTurnAt: NOW }))
  await $.session.start(START)
  await w.clock.advance(MIN)
  expect(w.read(LOCK)).toBe(line)
})

test('A66: the judge is told the holder\'s Editor died (the lock names pid 45392, which no longer runs)', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, held('bbbbbbbb', T(13, 30), T(14, 0), 45392))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', { heartbeatAt: NOW, holding: { since: T(13, 30), end: T(14, 0), extended: 0 }, lastTurnAt: T(14, 35), agents: 0 }))
  await $.session.start(START)
  expect(judges(w).length).toBe(1)
  expect(String(judges(w)[0]?.prompt)).toContain("Editor pid in the lock line: 45392 (no longer running: the holder's Editor died or was closed)")
})

test('A66: with no pid yet the judge is told none was recorded', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, held('bbbbbbbb', T(13, 30), T(14, 0)))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', { heartbeatAt: NOW, holding: { since: T(13, 30), end: T(14, 0), extended: 0 }, lastTurnAt: T(14, 35), agents: 0 }))
  await $.session.start(START)
  expect(String(judges(w)[0]?.prompt)).toContain('Editor pid in the lock line: none (no Editor recorded for this lease yet)')
})

// ---------- A67 ----------
test('A67: each session records its running agents (count and kinds) every minute', opts(), async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.agent.spawn({ subagentType: 'a5r:sync', description: 'a worker', prompt: 'merge' } as never)
  await w.clock.advance(MIN)
  const mine = JSON.parse(w.read(`${HF}/editor/${ME8}.json`)) as SessionFile
  expect([mine.agents, mine.agentKinds]).toEqual([1, ['a5r:sync']])
})

for (const agents of [1, 0])
  test(`A67 (A55): an unseen grant whose holder ${agents ? 'has a background agent running is kept' : 'has no agent running passes on'}`, opts(), async ($, on) => {
    const w = world(on, { ram: '40' })
    w.put(LOCK, held('bbbbbbbb', T(14, 25), T(15, 25)))
    w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', { heartbeatAt: NOW, holding: { since: T(14, 25), end: T(15, 25), extended: 0 }, lastTurnAt: T(14, 20), agents, agentKinds: agents ? ['general-purpose'] : [] }))
    w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc', { heartbeatAt: NOW, want: want() }))
    await $.session.start(START)
    expect(parseLockLine(w.read(LOCK)).id8 === 'bbbbbbbb').toBe(agents === 1)
  })

for (const agents of [1, 0])
  test(`A67 (A65): a holder silent 20 min (lease running, nobody waiting) ${agents ? 'with a background agent running is not judged idle' : 'with no agent running is judged'}`, opts(), async ($, on) => {
    const w = world(on, { ram: '40' })
    w.put(LOCK, held('bbbbbbbb', T(14, 25), T(15, 25)))
    w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', { heartbeatAt: NOW, holding: { since: T(14, 25), end: T(15, 25), extended: 0 }, lastTurnAt: T(14, 20), agents, agentKinds: agents ? ['general-purpose'] : [] }))
    await $.session.start(START)
    expect([judges(w).length, parseLockLine(w.read(LOCK)).id8]).toEqual([agents ? 0 : 1, 'bbbbbbbb'])
    if (!agents) expect(String(judges(w)[0]?.prompt)).toContain('the Editor holder has run no turn for 15 min while holding (granted 14:25)')
  })

// ---------- A68 ----------
test('A68: past its end, a lease is extended while nobody waits', opts(), async ($, on) => {
  const w = world(on, { ram: '40', procs: [EDITOR_PROC] })
  mineHolding(w, T(14, 0), T(14, 30))
  w.put(LOCK, held(ME8, T(14, 0), T(14, 30), 45392))
  await $.session.start(START)
  expect(out(await $.tool.call({ tool: EDITOR, action: 'extend', minutes: 15 } as never))).toContain('extended until 14:55')
  expect(parseLockLine(w.read(LOCK)).end).toBe('14:55')
})

test('A68: past its end, with someone waiting, the extension is refused as before', opts(), async ($, on) => {
  const w = world(on, { ram: '40', procs: [EDITOR_PROC] })
  mineHolding(w, T(14, 0), T(14, 30))
  w.put(LOCK, held(ME8, T(14, 0), T(14, 30), 45392))
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc', { heartbeatAt: NOW, want: want() }))
  await $.session.start(START)
  expect(out(await $.tool.call({ tool: EDITOR, action: 'extend', minutes: 15 } as never))).toContain('the lease ended at 14:30 and 1 session waits')
  expect(parseLockLine(w.read(LOCK)).end).toBe('14:30')
})

// ---------- A69 (after the replay): the verdict `done` ----------
const iso = (ms: number) => new Date(ms).toISOString()
const line = (o: Rec) => JSON.stringify(o)
// mc-dash-like: built and proved, then closed the Editor and wrote FREE itself; idle since.
const DONE_T = [
  line({ type: 'assistant', timestamp: iso(T(13, 50)), message: { role: 'assistant', content: [{ type: 'tool_use', id: 'f1', name: 'Bash', input: { command: "printf 'FREE since=13:50 2026-10-06 by=lane-bbbbbbbb note=Editor closed by its holder background=none' > Saved/EDITOR_OWNER.txt" } }] } }),
  line({ type: 'user', timestamp: iso(T(13, 50)), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'f1', content: 'ok' }] } }),
  line({ type: 'assistant', timestamp: iso(T(13, 51)), message: { role: 'assistant', content: [{ type: 'text', text: 'The fix works in PIE. The Editor is closed and the lock was released at 13:50.' }] } }),
].join('\n')
const JFACTS = (o: Partial<JudgeFacts> = {}): JudgeFacts => ({ now: NOW, kind: 'editor', lane: 'lane-bbbbbbbb', id8: 'bbbbbbbb', session: SID('bbbbbbbb'), since: T(13, 0), end: T(14, 0), why: 'past its end', liveness: 'alive', lastTurnAt: T(13, 51), agents: 0, procs: [], hasEditor: false, hasBuild: false, transcript: '', ...o })

test('A69: unit: a holder that closed the Editor and wrote FREE reads done (a stale lease), not stuck; the judge may answer done', () => {
  const h = hintOf(JFACTS(), parseTail(DONE_T))
  expect([h.verdict, h.evidence[0]]).toEqual(['done', 'it said: "The Editor is closed and the lock was released at 13:50"'])
  expect(hintOf(JFACTS(), parseTail(DONE_T.split('\n').slice(0, 2).join('\n'))).verdict).toBe('done') // the FREE line alone
  expect(hintOf(JFACTS({ hasBuild: true }), parseTail(DONE_T)).verdict).toBe('working') // something still runs
  expect(parseVerdict('VERDICT: done\nEVIDENCE:\n- closed the Editor at 16:15\nRECOMMENDATION: free the stale lease')?.verdict).toBe('done')
  expect(JUDGE_SYSTEM).toContain('VERDICT: <working | done | waiting-on-Hai | stuck-or-crashed | unsure>')
})

test('A69: a judge answering done shows on the Orchestrate card as done (calm colour), nothing released', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  on('turn.complete', async () => ({ text: '' }))
  w.put(LOCK, held('bbbbbbbb', T(13, 30), T(14, 0)))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', { heartbeatAt: NOW, holding: { since: T(13, 30), end: T(14, 0), extended: 0 }, lastTurnAt: T(13, 51), agents: 0 }))
  w.put(`C:/Users/hai.huynh/.claude/projects/E--s2/${SID('bbbbbbbb')}.jsonl`, DONE_T)
  await $.session.start(START)
  expect(String(judges(w)[0]?.prompt)).toContain("A rule's first reading: done")
  await $.turn.complete({ agentId: 'w-judge-1', answer: 'VERDICT: done\nEVIDENCE:\n- it closed the Editor and wrote FREE at 13:50\nRECOMMENDATION: nothing from Hai; free the stale lease', durationMs: 1, isAborted: false, turnId: 'tj', reason: 'answer' } as never)
  const tree = await $.ui.render(A5RPANE as never)
  expect(text(find(tree, 'hai-orchestrate-0'))).toContain('lane-bbbbbbbb (bbbbbbbb) · done')
  expect(parseLockLine(w.read(LOCK)).id8).toBe('bbbbbbbb')
})
