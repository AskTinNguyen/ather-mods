import { expect, test } from 'claude-code/testing'
import { BUILD_NAMES, ORCHESTRATE_MAX_BYTES, blankSession, heldLine, lapseOf, orchestrateLine, parseLockLine, ramProbe, type SessionFile } from '../hooks/coord.ts'
import { LOCK, ME, NOW, PENDING, PROJ, opts, world, type Rec } from './world.ts'

// Rev 22 (adversary review 2026-10-09, CONFIRMED in 0.13.0): A58 a lapsed lease is freed only as the S2 standard
// allows (holder gone, no Editor) and never while a build runs; A59 a refused or turnless wake never mutes a session;
// A60 a release reaches its holder through a file only the releaser writes; A61 no grant over .git/MERGE_HEAD;
// A62 every would-act event is one line in Saved/A5R/orchestrate.log (A54/A55 act, the candidates only log).
const HF = 'E:/s2/Saved/A5R'
const ME8 = ME.slice(0, 8)
const EDITOR = 'mcp__a5r__editor'
const START = { cwd: PROJ, surface: 'terminal', isInteractive: true } as never
const T = (h: number, m: number) => new Date(2026, 9, 6, h, m).getTime()
const MIN = 60_000
const SID = (id8: string) => `${id8}-1111-4000-8000-000000000000`
const held = (id8: string, since: number, end: number, note = 'their slot') =>
  `${heldLine({ lane: `lane-${id8}`, sessionName: `title-${id8}`, id8, since, pid: null, end, mode: 'unattended', pausable: true, nextSafe: 'after save', note })}\n`
const peer = (id8: string, o: Partial<SessionFile> = {}): string => JSON.stringify({ ...blankSession(SID(id8), `lane-${id8}`, `title ${id8}`, NOW), ...o })
const prompts = (w: ReturnType<typeof world>): string[] => (w.calls['prompt.submit'] ?? []).map(e => String((e as Rec).text))
const request = async ($: any) => $.tool.call({ tool: EDITOR, action: 'request', minutes: 30, what: 'tail VFX' } as never)
const proc = (name: string, pid: number) => ({ name, pid, gb: 1, parentAlive: true })
const LOG = `${HF}/orchestrate.log`
const logLines = (w: ReturnType<typeof world>): string[] => w.read(LOG).split('\n').filter(Boolean)
const GONE = (w: ReturnType<typeof world>, id8: string, o: Partial<SessionFile> = {}) => w.put(`${HF}/editor/${id8}.json`, peer(id8, { heartbeatAt: NOW - 10 * MIN, ...o }), NOW - 10 * MIN)

// ---------- A58 ----------
test('A58: unit: the probe lists build and game processes; a build process or a build lease is never lapsed; a gone holder with nothing running is', () => {
  const argv = ramProbe('E').join(' ')
  for (const n of ['dotnet.exe', 'UnrealBuildTool.exe', 'cl.exe', 'link.exe', 'MSBuild.exe', 'UnrealGame.exe', 'S2.exe']) expect([n, argv.includes(`'${n}'`)]).toEqual([n, true])
  const lock = parseLockLine(held('bbbbbbbb', T(13, 30), T(14, 0)))
  const files = [JSON.parse(peer('bbbbbbbb', { heartbeatAt: NOW - 10 * MIN })) as SessionFile]
  const x = { lock, files, lanes: [], now: NOW, waiting: [] }
  expect(lapseOf({ ...x, probe: { freeGb: 40, diskGb: 50, procs: [] } })?.kind).toBe('lapsed')
  for (const name of BUILD_NAMES) expect([name, lapseOf({ ...x, probe: { freeGb: 40, diskGb: 50, procs: [proc(name, 50)] } })]).toEqual([name, null])
  const buildWant = [JSON.parse(peer('bbbbbbbb', { heartbeatAt: NOW - 10 * MIN, want: { minutes: 60, pie: false, build: true, what: 'build', mode: 'unattended', pausable: false, nextSafe: 'after save', requestedAt: T(13, 0) } })) as SessionFile]
  expect(lapseOf({ ...x, files: buildWant, probe: { freeGb: 40, diskGb: 50, procs: [] } })).toBeNull()
  expect(lapseOf({ ...x, lock: parseLockLine(held('bbbbbbbb', T(13, 30), T(14, 0), 'cook (build)')), probe: { freeGb: 40, diskGb: 50, procs: [] } })).toBeNull()
})

test('A58: a link.exe running keeps a gone holder\'s lapsed lease (and the waiter does not recover it)', opts(), async ($, on) => {
  const w = world(on, { ram: '40', procs: [proc('link', 77)] })
  w.put(LOCK, held('bbbbbbbb', T(13, 30), T(14, 0)))
  GONE(w, 'bbbbbbbb', { holding: { since: T(13, 30), end: T(14, 0), extended: 0 } })
  await $.session.start(START)
  await request($)
  await w.clock.advance(MIN)
  expect(parseLockLine(w.read(LOCK)).id8).toBe('bbbbbbbb')
})

// ---------- A59 ----------
const yieldAsk = (w: ReturnType<typeof world>, id8: string, at: number) =>
  w.put(`${HF}/editor/${id8}.json`, peer(id8, { heartbeatAt: at, lane: `loco-${id8}`, want: { minutes: 10, pie: false, build: false, what: 'one check', mode: 'interactive', pausable: true, nextSafe: 'after save', requestedAt: at }, yieldAsks: [{ holder: ME8, at, via: 'file', minutes: 10, lane: `loco-${id8}` }] }), at)

test('A59: a refused wake frees the busy flag and keeps its notice: the next minute wakes the session with it', opts(), async ($, on) => {
  const w = world(on)
  w.put(LOCK, held(ME8, T(14, 0), T(15, 30)))
  yieldAsk(w, 'cccccccc', NOW - 30_000)
  w.failSubmit(1)
  await $.session.start(START)
  expect(prompts(w)).toEqual([]) // the wake was refused
  yieldAsk(w, 'cccccccc', NOW - 30_000)
  await w.clock.advance(MIN)
  expect(prompts(w).length).toBe(1)
  expect(prompts(w)[0]).toContain('loco-cccccccc asks for the Editor for ~10 min')
})

test('A59: a wake that starts no turn frees the busy flag after 30 s: a later notice wakes the session again', opts(), async ($, on) => {
  const w = world(on)
  w.put(LOCK, held(ME8, T(14, 0), T(15, 30)))
  yieldAsk(w, 'cccccccc', NOW - 30_000)
  await $.session.start(START)
  expect(prompts(w).length).toBe(1) // queued, but no turn ever starts (no tool call, no turn end)
  await w.clock.advance(2 * MIN)
  yieldAsk(w, 'dddddddd', w.clock.now())
  await w.clock.advance(MIN)
  expect(prompts(w).length).toBe(2)
  expect(prompts(w)[1]).toContain('loco-dddddddd asks for the Editor')
})

// ---------- A60 ----------
test('A60: a release survives the holder saving its own file after it: the notice arrives, the release file is untouched', opts(), async ($, on) => {
  const w = world(on)
  w.put(`${HF}/editor/${ME8}.json`, JSON.stringify({ ...blankSession(ME, 'tail-vfx', 'Tail', NOW), lastTurnAt: T(14, 20), holding: { since: T(14, 25), end: T(15, 25), extended: 0 } }))
  w.put(LOCK, held(ME8, T(14, 25), T(15, 25)))
  await $.session.start(START)
  // Another session passes the unseen grant on: the FREE line and its release file.
  w.put(LOCK, 'FREE since=14:40 2026-10-06 by=lane-cccccccc note=unseen grant background=none · free since 14:40\n')
  const rel = JSON.stringify({ v: 1, releases: [{ kind: 'unseen', at: T(14, 40), by: 'lane-cccccccc', since: T(14, 25), end: T(15, 25) }] })
  w.put(`${HF}/released/${ME8}.json`, rel)
  await $.command.run({ command: 'a5r', args: 'pass tail-vfx' } as never) // the holder saves its own file now
  expect(w.read(`${HF}/released/${ME8}.json`)).toBe(rel)
  await w.clock.advance(MIN)
  expect(prompts(w).some(p => p.includes('passed it to the next in the queue at 14:40'))).toBe(true)
  const mine = JSON.parse(w.read(`${HF}/editor/${ME8}.json`)) as SessionFile
  expect([mine.holding, mine.want, mine.delivered.includes(`editor:released:unseen:${T(14, 25)}`)]).toEqual([null, null, true])
})

// ---------- A61 ----------
test('A61: while .git/MERGE_HEAD exists in the shared checkout no Editor grant is made, whatever sync.json says; once it is gone the head is granted', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, 'FREE since=14:20 2026-10-06 by=lane-x note=done background=none · free since 14:20\n')
  w.put('E:/s2/.git/MERGE_HEAD', 'abc123\n')
  await $.session.start(START)
  const ran = String((await request($)).result ?? '')
  expect(ran).toContain('a merge is in progress in the shared checkout (.git/MERGE_HEAD)')
  expect(parseLockLine(w.read(LOCK)).kind).toBe('free')
  w.files.delete('e:/s2/.git/merge_head')
  await w.clock.advance(MIN)
  expect(parseLockLine(w.read(LOCK)).id8).toBe(ME8)
})

// ---------- A62 ----------
test('A62: unit: one line carries the time, rule, lane, every process, liveness, last turn, agents, build and acted', () => {
  expect(orchestrateLine({ at: T(14, 40), rule: 'A54-lapsed', lane: 'lane-bbbbbbbb', id8: 'bbbbbbbb', procs: ['python', 'git'], liveness: 'gone', lastTurnAt: T(13, 20), agents: 0, build: false, acted: true, note: 'lapsed lease' })).toBe(
    '14:40 2026-10-06 | rule=A54-lapsed | lane=lane-bbbbbbbb | session=bbbbbbbb | procs=git,python | holder=gone | lastTurn=13:20 2026-10-06 | agents=0 | build=no | acted | note=lapsed lease',
  )
  expect(orchestrateLine({ at: T(14, 40), rule: 'no-editor', lane: '', id8: 'cccccccc', procs: [], liveness: 'alive', lastTurnAt: null, agents: null, build: true, acted: false })).toBe(
    '14:40 2026-10-06 | rule=no-editor | lane=unknown | session=cccccccc | procs=none | holder=alive | lastTurn=unknown | agents=unknown | build=yes | logged-only',
  )
})

test('A62: A54 acting is logged as acted; a lease held by a live holder with no Editor or build running is logged once, logged-only', opts(), async ($, on) => {
  const w = world(on, { ram: '40', procs: [proc('git', 5)] })
  w.put(LOCK, held('bbbbbbbb', T(13, 30), T(14, 0)))
  GONE(w, 'bbbbbbbb', { holding: { since: T(13, 30), end: T(14, 0), extended: 0 }, lastTurnAt: T(13, 20), agents: 2 })
  await $.session.start(START)
  const acted = logLines(w).filter(l => l.includes('rule=A54-lapsed'))
  expect(acted.length).toBe(1)
  expect(acted[0]).toContain('| lane=lane-bbbbbbbb | session=bbbbbbbb | procs=git | holder=gone | lastTurn=13:20 2026-10-06 | agents=2 | build=no | acted')
  expect(logLines(w).filter(l => l.includes('rule=holder-gone') && l.includes('logged-only')).length).toBe(1)
})

// Rev 23 (A64), by design: the "holder idle with a red mark or a PENDING line" candidate is gone; a holder silent 10 min
// is judged from its own transcript instead (A65: one judge spawned; its verdict line comes with the judge's answer).
test('A62: candidates only log, once per lease: no Editor running (live holder); a silent holder is judged, not logged by its mark', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, held('bbbbbbbb', T(14, 0), T(15, 0)))
  const beat = () => w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', { heartbeatAt: w.clock.now(), title: 'Walker', holding: { since: T(14, 0), end: T(15, 0), extended: 0 }, lastTurnAt: T(14, 5) }), w.clock.now())
  beat()
  w.put(PENDING, '- [ ] 2026-10-06 14:06 · Walker · Which preset? · default: keep\n')
  await $.session.start(START)
  for (let m = 0; m < 3; m += 1) {
    beat()
    await w.clock.advance(MIN)
  }
  expect(parseLockLine(w.read(LOCK)).id8).toBe('bbbbbbbb') // nothing acted
  expect(logLines(w).map(l => /rule=([\w-]+)/.exec(l)?.[1]).sort()).toEqual(['no-editor'])
  expect(((w.calls['agent.spawn'] ?? []) as Rec[]).filter(s => (s.subagent_type ?? s.subagentType) === 'a5r:judge').length).toBe(1)
  expect(logLines(w).every(l => l.includes('logged-only') && l.includes('holder=alive'))).toBe(true)
})

test('A62: the log rotates past about 1 MB into orchestrate.log.1', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  const big = `${'x'.repeat(200)}\n`.repeat(Math.ceil(ORCHESTRATE_MAX_BYTES / 201))
  w.put(LOG, big)
  w.put(LOCK, held('bbbbbbbb', T(14, 0), T(15, 0)))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', { heartbeatAt: NOW, holding: { since: T(14, 0), end: T(15, 0), extended: 0 } }))
  await $.session.start(START)
  expect(w.read(`${LOG}.1`)).toBe(big)
  expect(logLines(w).length).toBe(1)
})
