import { expect, test } from 'claude-code/testing'
import { blankSession, heldLine, parseLockLine, type SessionFile } from '../hooks/coord.ts'
import { hintOf, parseTail, parseVerdict, type JudgeFacts } from '../hooks/judge.ts'
import { A5RPANE, LOCK, ME, NOW, PENDING, PROJ, find, opts, text, world, type Rec } from './world.ts'

// Rev 23: A63 a title mark comes off when Hai types, after a reload too (the bare current title, nothing in memory);
// A64 no rule reads a title mark or PENDING.md; A65 an advisory judge, one per incident, reads the holder's facts and
// transcript tail and gives a verdict that is logged, shown on the Orchestrate card and toasted; it changes nothing.
const HF = 'E:/s2/Saved/A5R'
const RECORDS = 'C:/Users/hai.huynh/.claude/projects/E--s2'
const ME8 = ME.slice(0, 8)
const START = { cwd: PROJ, surface: 'terminal', isInteractive: true } as never
const T = (h: number, m: number) => new Date(2026, 9, 6, h, m).getTime()
const MIN = 60_000
const SID = (id8: string) => `${id8}-1111-4000-8000-000000000000`
const GET = 'mcp__ccd_session_mgmt__get_session'
const titled = (w: ReturnType<typeof world>) => w.seen.filter(e => e.tool === 'mcp__ccd_session_mgmt__set_session_title').map(e => String(e.title))
const held = (id8: string, since: number, end: number) => `${heldLine({ lane: `lane-${id8}`, sessionName: `title-${id8}`, id8, since, pid: null, end, mode: 'unattended', pausable: true, nextSafe: 'after save', note: 'their slot' })}\n`
const peer = (id8: string, o: Partial<SessionFile> = {}): string => JSON.stringify({ ...blankSession(SID(id8), `lane-${id8}`, `title ${id8}`, NOW), ...o })
const judges = (w: ReturnType<typeof world>): Rec[] => ((w.calls['agent.spawn'] ?? []) as Rec[]).filter(s => (s.subagent_type ?? s.subagentType) === 'a5r:judge')
const logLines = (w: ReturnType<typeof world>): string[] => w.read(`${HF}/orchestrate.log`).split('\n').filter(Boolean)
const iso = (ms: number) => new Date(ms).toISOString()
const line = (o: Rec) => JSON.stringify(o)
// Fixture transcripts (Claude Code's record lines).
const WORKING = [
  line({ type: 'user', timestamp: iso(T(14, 10)), message: { role: 'user', content: 'Build the editor target.' } }),
  line({ type: 'assistant', timestamp: iso(T(14, 12)), message: { role: 'assistant', content: [{ type: 'text', text: 'Starting the build.' }, { type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'Build.bat S2Editor' } }] } }),
].join('\n')
const WAITING = [
  line({ type: 'assistant', timestamp: iso(T(14, 5)), message: { role: 'assistant', content: [{ type: 'tool_use', id: 'r1', name: 'Read', input: {} }] } }),
  line({ type: 'user', timestamp: iso(T(14, 5)), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'r1', content: 'ok' }] } }),
  line({ type: 'assistant', timestamp: iso(T(14, 6)), message: { role: 'assistant', content: [{ type: 'text', text: 'The stagger montage has two candidates. Should I keep the 0.3 s blend or the 0.5 s one?' }] } }),
].join('\n')
const GONE_T = [line({ type: 'assistant', timestamp: iso(T(12, 0)), message: { role: 'assistant', content: [{ type: 'text', text: 'Launching the Editor now.' }] } })].join('\n')
const facts = (o: Partial<JudgeFacts>): JudgeFacts => ({ now: NOW, kind: 'editor', lane: 'lane-bbbbbbbb', id8: 'bbbbbbbb', session: SID('bbbbbbbb'), since: T(13, 30), end: T(14, 0), why: 'past its end', liveness: 'alive', lastTurnAt: T(14, 10), agents: 0, procs: [], hasEditor: false, hasBuild: false, transcript: '', ...o })

// ---------- A63 ----------
test('A63: a mark set before a reload comes off when Hai types: the title is the current one without its mark', opts(), async ($, on) => {
  const w = world(on, { out: { [GET]: '{"title":"🟥 3️⃣ Loco fix"}' } }) // marked by an earlier load of the module: nothing in memory now
  await $.session.start(START)
  await $.prompt.submit({ text: 'go on', wait: false, origin: { kind: 'composer' } } as never)
  expect(titled(w)).toEqual(['3️⃣ Loco fix'])
})

test('A63: a prompt a plugin queues leaves the mark', opts(), async ($, on) => {
  const w = world(on, { out: { [GET]: '{"title":"🟥 3️⃣ Loco fix"}' } })
  await $.session.start(START)
  await $.prompt.submit({ text: 'a notice', wait: false, origin: { kind: 'plugin', name: 'ather-automata' } } as never)
  expect(titled(w)).toEqual([])
})

test('A63: an unmarked title is never retitled when Hai types', opts(), async ($, on) => {
  const w = world(on, { out: { [GET]: '{"title":"3️⃣ Loco fix"}' } })
  await $.session.start(START)
  await $.prompt.submit({ text: 'go on', wait: false, origin: { kind: 'composer' } } as never)
  expect(titled(w)).toEqual([])
})

test('A63: marked in this session, then typed: the mark comes off', opts(), async ($, on) => {
  const out: Record<string, string> = { [GET]: '{"title":"3️⃣ Loco fix"}' }
  const w = world(on, { out })
  on('turn.complete', async () => ({ text: '' }))
  await $.session.start(START)
  await $.turn.complete({ answer: '🟥 NEEDS DECISION — which preset? Default if no answer: keep the old one.', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never)
  expect(titled(w)[0]?.startsWith('🟥')).toBe(true)
  out[GET] = JSON.stringify({ title: titled(w)[0] })
  await $.prompt.submit({ text: 'keep it', wait: false, origin: { kind: 'composer' } } as never)
  expect(titled(w).at(-1)).toBe('3️⃣ Loco fix')
})

// ---------- A64 ----------
test('A64: a red title and an open PENDING line alone trigger nothing: no log line, no judge', opts(), async ($, on) => {
  const w = world(on, { ram: '40', out: { [GET]: '{"title":"🟥 3️⃣ Loco fix"}' } })
  w.put(LOCK, held('bbbbbbbb', T(14, 30), T(15, 30)))
  const beat = () => w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', { heartbeatAt: w.clock.now(), title: '🟥 Walker', holding: { since: T(14, 30), end: T(15, 30), extended: 0 }, lastTurnAt: w.clock.now() }), w.clock.now())
  beat()
  w.put(PENDING, '- [ ] 2026-10-06 14:31 · Walker · Which preset? · default: keep\n- [ ] 2026-10-06 14:32 · bbbbbbbb · Merge now? · default: wait\n')
  await $.session.start(START)
  for (let m = 0; m < 3; m += 1) {
    beat()
    await w.clock.advance(MIN)
  }
  expect(logLines(w).filter(l => !l.includes('rule=no-editor'))).toEqual([])
  expect(judges(w)).toEqual([])
})

// ---------- A65 ----------
test('A65: unit: fixture transcripts read as working (a build tool running), waiting on Hai (its last message asks), stuck (gone, long silent)', () => {
  expect(hintOf(facts({ hasBuild: true }), parseTail(WORKING)).verdict).toBe('working')
  expect(hintOf(facts({}), parseTail(WORKING)).evidence[0]).toContain('a tool is still running: Bash')
  const waiting = hintOf(facts({}), parseTail(WAITING))
  expect([waiting.verdict, waiting.evidence[0]]).toEqual(['waiting-on-Hai', 'its last message asks: "The stagger montage has two candidates. Should I keep the 0.3 s blend or the 0.5 s one?"'])
  const ask = parseTail(line({ type: 'assistant', timestamp: iso(T(14, 30)), message: { role: 'assistant', content: [{ type: 'tool_use', id: 'q1', name: 'AskUserQuestion', input: {} }] } }))
  expect(hintOf(facts({}), ask).verdict).toBe('waiting-on-Hai')
  expect(hintOf(facts({ liveness: 'gone' }), parseTail(GONE_T)).verdict).toBe('stuck-or-crashed')
  expect(hintOf(facts({}), parseTail(GONE_T)).verdict).toBe('stuck-or-crashed') // alive but silent 2 h 40 with nothing running
  expect(hintOf(facts({}), []).verdict).toBe('unsure')
  expect(parseVerdict('VERDICT: waiting-on-Hai\nEVIDENCE:\n- asks about the blend\nRECOMMENDATION: answer it')).toEqual({ verdict: 'waiting-on-Hai', evidence: ['asks about the blend'], recommendation: 'answer it' })
  expect(parseVerdict('I think it is fine')).toBeNull()
})

const incident = (w: ReturnType<typeof world>, transcript: string, o: Partial<SessionFile> = {}) => {
  w.put(LOCK, held('bbbbbbbb', T(13, 30), T(14, 0))) // ended 14:00; it is 14:40
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', { heartbeatAt: NOW, holding: { since: T(13, 30), end: T(14, 0), extended: 0 }, lastTurnAt: T(14, 35), agents: 1, ...o }))
  w.put(`${RECORDS}/${SID('bbbbbbbb')}.jsonl`, transcript)
}

test('A65: a lease past its end spawns one read-only judge per incident with the facts and the transcript tail; nothing is released', opts(), async ($, on) => {
  const w = world(on, { ram: '40', procs: [{ name: 'link', pid: 77, gb: 1, parentAlive: true }] })
  incident(w, WORKING)
  await $.session.start(START)
  for (let m = 0; m < 3; m += 1) {
    w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', { heartbeatAt: w.clock.now(), holding: { since: T(13, 30), end: T(14, 0), extended: 0 }, lastTurnAt: T(14, 35), agents: 1 }))
    await w.clock.advance(MIN)
  }
  expect(judges(w).length).toBe(1) // once per incident
  const p = String(judges(w)[0]?.prompt)
  for (const want of ['the Editor lease ended 14:00 and is still held', `${RECORDS}/${SID('bbbbbbbb')}.jsonl`.toLowerCase(), 'link', 'background agents running: 1', 'Starting the build. [calls: Bash]', "A rule's first reading: working"]) expect([want, p.toLowerCase().includes(want.toLowerCase())]).toEqual([want, true])
  const type = ((w.calls['agent.register'] ?? []) as Rec[]).find(a => a.name === 'judge')
  expect([type?.tools, type?.model, type?.omitClaudeMd]).toEqual([['Read', 'Grep'], 'haiku', true])
  expect(parseLockLine(w.read(LOCK)).id8).toBe('bbbbbbbb') // nothing released
  expect(w.read(`${HF}/released/bbbbbbbb.json`)).toBe('')
  expect(w.sent).toEqual([]) // no message to the holder
})

test('A65: the judge\'s verdict is logged, kept for the Orchestrate card and toasted; a new lease is a new incident', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  on('turn.complete', async () => ({ text: '' }))
  incident(w, WAITING)
  await $.session.start(START)
  expect(judges(w).length).toBe(1)
  await $.turn.complete({ agentId: 'w-judge-1', answer: 'VERDICT: waiting-on-Hai\nEVIDENCE:\n- its last message asks which blend to keep\nRECOMMENDATION: answer it in that session', durationMs: 1, isAborted: false, turnId: 'tj', reason: 'answer' } as never)
  const log = logLines(w).filter(l => l.includes('rule=A65-judge'))
  expect(log.length).toBe(1)
  expect(log[0]).toContain('verdict waiting-on-Hai (judge): its last message asks which blend to keep; recommend: answer it in that session')
  const toasts = ((w.calls['ui.toast'] ?? []) as Rec[]).map(t => String(t.text ?? t.message ?? JSON.stringify(t)))
  expect(toasts.some(t => t.includes('Orchestrate · lane-bbbbbbbb: waiting-on-Hai — answer it in that session'))).toBe(true)
  const tree = await $.ui.render(A5RPANE as never)
  expect(text(find(tree, 'hai-orchestrate-0'))).toContain('lane-bbbbbbbb (bbbbbbbb) · waiting-on-Hai')
  expect(text(find(tree, 'hai-orchestrate-0'))).toContain('its last message asks which blend to keep → answer it in that session')
  // A new lease of the same holder, past its end too: a new incident, a new judge.
  w.put(LOCK, held('bbbbbbbb', T(14, 10), T(14, 20)))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', { heartbeatAt: w.clock.now(), holding: { since: T(14, 10), end: T(14, 20), extended: 0 }, lastTurnAt: T(14, 35) }))
  await w.clock.advance(MIN)
  expect(judges(w).length).toBe(2)
})

test('A65: a gone holder whose judge gives no readable answer gets the rule\'s reading, marked as such', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  on('turn.complete', async () => ({ text: '' }))
  incident(w, GONE_T, { heartbeatAt: NOW - 10 * MIN })
  w.put(LOCK, held('bbbbbbbb', T(14, 0), T(14, 35))) // 5 min past its end: judged, not yet lapsed (A54 waits 10 min)
  await $.session.start(START)
  expect(judges(w).length).toBe(1)
  await $.turn.complete({ agentId: 'w-judge-1', answer: 'I could not tell.', durationMs: 1, isAborted: false, turnId: 'tj', reason: 'answer' } as never)
  expect(logLines(w).find(l => l.includes('rule=A65-judge'))).toContain('verdict stuck-or-crashed (rule): the session is gone')
})
