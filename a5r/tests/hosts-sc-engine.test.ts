import { expect, test } from 'claude-code/testing'
import type { RunOut } from '../hooks/adapters/types.ts'
import { blankSession } from '../hooks/coord.ts'
import type { HostCard, LocalTruth } from '../hooks/hostcard.ts'
import { STDOUT_SEQ } from '../hooks/hostchecks.ts'
import { hostsDesk, type HostIo } from '../hooks/hostdesk.ts'
import { A5RPANE, ME, NOW, PROJ, find, keys, opts, still, text, world, type Rec } from './world.ts'

// a5r-hosts S-c (L1) through the desk and through the engine: an A5R host writes its own card once per change (and a
// heartbeat), only with asHost.enabled, from local truth (A5, A16's card part); the origin stores the host's A5R card
// (`source: "a5r"`, skew from C4) through the adapter and falls back to the probe card when it is absent or stale (A5);
// the Editor request's reply, status and the Editor list's queued row carry the hint only with a suggestion, terminal and
// desktop alike; status.json's keys stay additive with v 1 (A12).
const MIN = 60_000
const HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4'
const out = (stdout: string, exitCode = 0): RunOut => ({ exitCode, stdout, stderr: '' })
const SKEW = 90_000 // the A5R host's clock behind this one (C4 measures it)
/** The tick's cards run in the background; in-memory files settle within a few hundred microtasks. */
const flush = async () => {
  for (let i = 0; i < 500; i++) await Promise.resolve()
}

/** In-memory files; `runs` answers local commands (git worktree list) by a needle of the argv. */
const memIo = (files: Map<string, string>, clock: { now: number }, proc: HostIo['proc'], runs: Record<string, string> = {}): HostIo & { writes: string[] } => {
  const writes: string[] = []
  return {
    writes,
    now: async () => clock.now,
    read: async p => files.get(p) ?? null,
    write: async (p, t) => void (writes.push(p), files.set(p, t)),
    stat: async p => (files.has(p) ? { mtimeMs: clock.now } : null),
    list: async () => [],
    run: async argv => {
      const hit = Object.entries(runs).find(([needle]) => argv.join(' ').includes(needle))
      return hit ? { exitCode: 0, stdout: hit[1] } : null
    },
    secrets: async () => [],
    proc,
    hostOpts: {},
    log: () => undefined,
  }
}
const truth = (over: Partial<LocalTruth> = {}): LocalTruth => ({ os: 'windows', freeGb: 30, diskGb: 100, running: false, holder: null, queue: 0, gates: { pieGb: 38, nopieGb: 28 }, sync: null, ...over })
const AS_HOST = { enabled: true, roles: ['ue'], trust: ['hai-1a2b3c4d'], availability: { state: 'yes' }, coordinationRoot: 'E:/s2', laneRoot: 'D:/lanes' }
const WORKTREES = 'worktree E:/s2\nHEAD 1\nbranch refs/heads/main\n\nworktree D:/lanes/l1\nHEAD 2\nbranch refs/heads/intent/loco\n'

test('S-c (A5, A16): engine: an A5R host writes Saved/A5R/card.json from local truth once per change, a heartbeat past half of staleCardMin, only with asHost.enabled and as the status writer', async () => {
  const files = new Map<string, string>()
  const clock = { now: NOW }
  const io = memIo(files, clock, async () => null, { 'worktree list --porcelain': WORKTREES })
  const local = { t: truth(), writer: true }
  const d = hostsDesk({ dir: () => 'E:/s2/Saved/A5R', root: () => 'E:/s2', me8: () => 'ab12cd34', lane: () => 'lane', home: () => 'C:/Users/u', isWriter: () => local.writer, local: () => local.t })
  const CARD = 'E:/s2/Saved/A5R/card.json'
  const cardWrites = () => io.writes.filter(p => p === CARD).length
  // No asHost, or asHost off: no card.
  await d.tick(io, clock.now)
  await d.tool(io, { action: 'set', asHost: { ...AS_HOST, enabled: false } })
  await d.tick(io, clock.now)
  expect(files.has(CARD)).toBe(false)
  await d.tool(io, { action: 'set', asHost: AS_HOST })
  local.t = truth({ holder: { id8: 'ef56ab78', lane: 'loco', end: NOW + 20 * MIN }, queue: 2, running: true })
  await d.tick(io, clock.now)
  const first = JSON.parse(files.get(CARD) ?? '{}') as HostCard
  expect(first).toEqual({ v: 1, at: NOW, source: 'a5r', machine: { os: 'windows', freeRamGb: 30, totalRamGb: null, freeDiskGb: 100 }, editor: { holder: { lane: 'loco', end: NOW + 20 * MIN }, queue: 2, running: true }, availability: { state: 'yes' }, freeze: null, lanes: [{ id: 'l1', slug: 'l1', state: 'busy', branch: 'intent/loco' }], jobs: { running: 0, queued: 0 }, account: { shared: 'unknown' }, skew: { ms: null }, roles: ['ue'], acceptsFrom: ['hai-1a2b3c4d'] })
  expect(cardWrites()).toBe(1)
  // Unchanged: no write for 4 minutes; a change writes at once; half of staleCardMin with none writes a heartbeat.
  for (let i = 0; i < 4; i++) {
    clock.now += MIN
    await d.tick(io, clock.now)
  }
  expect(cardWrites()).toBe(1)
  local.t = { ...local.t, queue: 3 }
  await d.tick(io, clock.now)
  expect([cardWrites(), (JSON.parse(files.get(CARD) ?? '{}') as HostCard).editor.queue]).toEqual([2, 3])
  clock.now += 5 * MIN
  await d.tick(io, clock.now)
  expect([cardWrites(), (JSON.parse(files.get(CARD) ?? '{}') as HostCard).at]).toEqual([3, clock.now])
  // A sync in its cutoff or freeze is the card's freeze; another session writes nothing.
  local.t = { ...local.t, sync: { at: clock.now + 10 * MIN, hardEnd: clock.now + 55 * MIN, isFrozen: true } }
  local.writer = false
  await d.tick(io, clock.now)
  expect(cardWrites()).toBe(3)
  local.writer = true
  await d.tick(io, clock.now)
  expect((JSON.parse(files.get(CARD) ?? '{}') as HostCard).freeze).toEqual({ kind: 'sync', until: clock.now + 55 * MIN })
})

/** An ssh client to a Windows host that runs A5R: the checks answer clean; `card` is what Saved/A5R/card.json holds there. */
const a5rRemote = (remote: { card: string | null; down?: boolean }) => async (argv: readonly string[], init: { stdin?: string }): Promise<RunOut | null> => {
  const line = argv[argv.length - 1] ?? ''
  if (argv[0] === 'git') return out(`${HASH}\n`)
  if (remote.down) return { exitCode: 255, stdout: '', stderr: 'ssh: connect to host rig port 22: Connection refused' }
  if (line === 'echo a5r %OS%') return out('a5r Windows_NT\r\n')
  if (line.includes('card.json')) return remote.card === null ? out('', 1) : out(line.includes('do @echo') ? `${remote.card.length}\r\n` : remote.card)
  if (line === 'sort') return out(init.stdin?.includes('\r') ? 'a\r\nb\r\nc\r\n' : '???\r\n')
  if (line.includes('hash-object')) return out(`${HASH}\r\n`)
  if (line.startsWith('echo A5R-BYTES')) return out(`${STDOUT_SEQ}\r\n`)
  if (line.includes('ToUnixTimeMilliseconds')) return out(`${NOW - SKEW}\r\n`) // the host's clock: 90 s behind
  if (line.includes('USERNAME eq')) return out('"sshd-session.exe","4"\r\n')
  if (line.includes('IMAGENAME eq UnrealEditor.exe')) return out('INFO: No tasks are running which match the specified criteria.\r\n')
  if (line.includes('Win32_OperatingSystem')) return out('66270000 31000000\r\n')
  return out('')
}
const hostsCard = (at: number, over: Partial<HostCard> = {}): string => JSON.stringify({ v: 1, at, source: 'a5r', machine: { os: 'windows', freeRamGb: 41, totalRamGb: null, freeDiskGb: 300 }, editor: { holder: null, queue: 0, running: false }, availability: { state: 'yes' }, freeze: null, lanes: [{ id: 'l1', slug: 'l1', state: 'busy', branch: 'intent/secret' }], jobs: { running: 0, queued: 0 }, account: { shared: 'yes' }, skew: { ms: null }, roles: ['ue'], acceptsFrom: ['hai-1a2b3c4d'], ...over })

test('S-c (A5): engine: the origin stores the host\'s own A5R card through the adapter (skew from C4), falls back to the probe card when it is absent or stale; suggest reads it', async () => {
  const files = new Map<string, string>()
  const clock = { now: NOW }
  // The host's clock runs 90 s behind (C4 passes): its card written now says NOW - 90 s.
  const remote: { card: string | null; down?: boolean } = { card: hostsCard(NOW - SKEW) }
  const io = memIo(files, clock, a5rRemote(remote))
  io.originId = 'hai-1a2b3c4d'
  const local = { t: truth({ freeGb: 12 }) } // under the 28 GB gate here
  const d = hostsDesk({ dir: () => 'E:/proj/Saved/A5R', root: () => 'E:/proj', me8: () => 'ab12cd34', lane: () => 'lane', home: () => 'C:/Users/u', isWriter: () => true, local: () => local.t })
  expect(await d.tool(io, { action: 'add', id: 'rig', reach: 'ssh:rig', label: 'night rig', options: { a5rRoot: 'E:/s2' } })).toContain('level L1.')
  const STORED = 'E:/proj/Saved/A5R/hosts/rig/card.json'
  expect((JSON.parse(files.get(STORED) ?? '{}') as HostCard).source).toBe('probe') // the add's own card
  clock.now += MIN
  await d.tick(io, clock.now)
  await flush()
  const stored = JSON.parse(files.get(STORED) ?? '{}') as HostCard
  expect([stored.source, stored.hostId, stored.skew, stored.machine.freeRamGb, stored.acceptsFrom]).toEqual(['a5r', 'rig', { ms: -SKEW }, 41, ['hai-1a2b3c4d']])
  // status.json gets the card without its lanes' branches (F6); suggest reads it (RAM: here 12, there 41, idle there).
  expect(d.status()?.[0]?.card?.lanes).toEqual([{ id: 'l1', slug: 'l1', state: 'busy' }])
  expect(JSON.parse(await d.tool(io, { action: 'suggest', minutes: 30 }))).toEqual({ suggestion: { host: 'rig', label: 'night rig', reasons: ['RAM', 'IDLE'] }, whyNot: [] })
  expect(JSON.parse(await d.command(io, 'host suggest --minutes 30 --wants ue,mocap'))).toEqual({ suggestion: 'none', whyNot: [{ host: 'rig', codes: ['NO_ROLE'] }] })
  // Its A5R card gone: the stored one holds while fresh, then a probe card replaces it.
  remote.card = null
  clock.now += MIN
  await d.tick(io, clock.now)
  await flush()
  expect((JSON.parse(files.get(STORED) ?? '{}') as HostCard).source).toBe('a5r')
  clock.now += 11 * MIN
  await d.tick(io, clock.now)
  await flush()
  const probed = JSON.parse(files.get(STORED) ?? '{}') as HostCard
  expect([probed.source, probed.machine.freeRamGb, probed.acceptsFrom, probed.at]).toEqual(['probe', 29.6, undefined, clock.now])
  expect(JSON.parse(await d.tool(io, { action: 'suggest' }))).toEqual({ suggestion: { host: 'rig', label: 'night rig', reasons: ['RAM', 'IDLE'], notes: ['trust unknown'] }, whyNot: [] })
  // A stale A5R card there (its tick stopped 30 min ago, corrected by the skew) is not taken: the probe card stays.
  remote.card = hostsCard(clock.now - SKEW - 30 * MIN, { machine: { os: 'windows', freeRamGb: 50, totalRamGb: null, freeDiskGb: null } })
  clock.now += 11 * MIN
  await d.tick(io, clock.now)
  await flush()
  expect((JSON.parse(files.get(STORED) ?? '{}') as HostCard).source).toBe('probe')
  // The desk's hints: a queued request that fits; none for the holder's own or with suggest turned off by the option.
  const want = { minutes: 30, pie: false, build: false, what: 'x', mode: 'interactive' as const, pausable: true, nextSafe: '', requestedAt: clock.now - 5 * MIN }
  const files2 = [{ ...blankSession(ME, 'queued', '', clock.now), want }, { ...blankSession(ME.replace('ab12', 'ee12'), 'holder', '', clock.now), want, holding: { since: clock.now, end: clock.now + MIN, extended: 0 } }]
  expect(d.hint(files2[0] ?? null, clock.now)).toBe('fits night rig (RAM, IDLE) → /a5r handoff record label="night rig" branch=<branch> task="<one line>" to run it there, or hand it off later')
  expect(d.hint(files2[1] ?? null, clock.now)).toBe('') // a session that holds the Editor gets none
  expect([...d.hinted(new Map([['ab12cd34', 'wait RAM']]), files2, clock.now)]).toEqual([['ab12cd34', 'wait RAM · fits night rig (RAM, IDLE)']])
  local.t = truth({ freeGb: 60 })
  expect(d.hint(files2[0] ?? null, clock.now)).toBe('')
})

// Through the plugin engine (world.ts): ssh calls answered by their remote line, as the S-b engine tests do.
const HF = 'E:/s2/Saved/A5R'
const ME8 = ME.slice(0, 8)
const START = { cwd: PROJ, surface: 'terminal', isInteractive: true } as never
const cmd = async ($: any, args: string) => String((await $.command.run({ command: 'a5r', args } as never)).text)
const call = async ($: any, input: Rec) => String((await $.tool.call(input as never)).result)
const sshAnswers = () => ({
  'f20 echo a5r %OS%': { stdout: 'a5r Windows_NT\r\n' },
  'f20 sort': { stdout: 'a\r\nb\r\nc\r\n' },
  'hash-object': { stdout: `${HASH}\n` },
  'f20 echo A5R-BYTES': { stdout: `${STDOUT_SEQ}\r\n` },
  UtcNow: { stdout: `${NOW}\r\n` }, // C4; not ToUnixTimeMilliseconds, which the local probe names too
  'USERNAME eq': { stdout: '"sshd-session.exe","4"\r\n' },
  'IMAGENAME eq UnrealEditor.exe': { stdout: '"UnrealEditor.exe","77","Console","1","9,000,000 K"\r\n' },
  TotalVisibleMemorySize: { stdout: '66270000 31000000\r\n' }, // not Win32_OperatingSystem: the local RAM probe names it too
})
/** This session the status writer (its file first in the queue order), as the S-b engine test makes it. */
const asWriter = (w: ReturnType<typeof world>) =>
  w.put(`${HF}/editor/${ME8}.json`, JSON.stringify({ ...blankSession(ME, 'lane-me', '', NOW), heartbeatAt: NOW + 600 * MIN }))

test('S-c (A12, A16): engine: the Editor request\'s reply, status and the queued row carry "fits <label> (RAM)" only with a suggestion; terminal and desktop; status.json additive, v 1; an A5R host\'s card lists the live queue', opts(), async ($, on) => {
  const answers: Record<string, { stdout: string }> = sshAnswers()
  const w = world(on, { git: answers, ram: '8' }) // 8 GB free here: under the 28 GB launch gate
  w.put('E:/s2/.git/HEAD', 'ref: refs/heads/HaiHuynh/20261005')
  asWriter(w)
  await $.session.start(START)
  await w.clock.advance(MIN)
  const look = async (surface: 'terminal' | 'desktop') => {
    const tree = still(await $.ui.render({ ...A5RPANE, surface } as never))
    return { tree, blocks: keys(tree), status: JSON.parse(w.read(`${HF}/status.json`)) as Rec }
  }
  const request = { tool: 'mcp__a5r__editor', action: 'request', minutes: 30, what: 'retest the stop', needGb: 20, readOnly: true }
  // No host declared: no hint anywhere.
  const before = await call($, { ...request, wants: ['ue'] })
  expect(before).not.toContain('fits ')
  expect(await call($, { tool: 'mcp__a5r__editor', action: 'status' })).not.toContain('fits ')
  await w.clock.advance(MIN)
  const none = await look('terminal')
  expect(text(none.tree)).not.toContain('fits ')
  // The request's suggest inputs are stored in the request file (additive).
  expect((JSON.parse(w.read(`${HF}/editor/${ME8}.json`)) as { want: Rec }).want).toMatchObject({ minutes: 30, needGb: 20, readOnly: true, wants: ['ue'] })
  // A host declared and checked (its probe card from the add: 29.6 GB free, its Editor unknown, no roles): the request
  // that wants a role it lacks gets no hint; without it, the hint.
  answers.UtcNow = { stdout: `${NOW + 2 * MIN}\r\n` } // the host's clock agrees (C4)
  expect(await cmd($, 'host add f20 --reach ssh:f20 --label "second pc"')).toContain('5 checks run; level L1.')
  expect(await call($, { ...request, wants: ['ue'] })).not.toContain('fits ')
  const hint = 'fits second pc (RAM) → /a5r handoff record label="second pc" branch=<branch> task="<one line>" to run it there, or hand it off later'
  const reply = await call($, request)
  expect(reply.split('\n')).toContain(hint)
  expect((JSON.parse(await call($, { tool: 'mcp__a5r__editor', action: 'status' })) as Rec).fits).toBe(hint) // a field of status's JSON
  await w.clock.advance(MIN)
  for (const surface of ['terminal', 'desktop'] as const) {
    const now = await look(surface)
    expect([surface, text(now.tree)]).toEqual([surface, expect.stringContaining('fits second pc (RAM)')])
    expect([surface, text(now.tree).split('fits second pc').length - 1]).toEqual([surface, 1]) // the queued row only
  }
  const status = (await look('terminal')).status
  expect(Object.keys(status)).toEqual([...Object.keys(none.status), 'hosts'])
  expect([status.v, JSON.stringify(status).includes('fits ')]).toEqual([1, false])
  // Without a suggestion (the host assumed unavailable), the hint goes from the reply and the row.
  await call($, { tool: 'mcp__a5r__host', action: 'set', id: 'f20', assumed: { availability: { state: 'no', reason: 'nights only' } } })
  await w.clock.advance(11 * MIN) // the probe card is refreshed (stale past 10 min) with the assumption
  expect(await call($, request)).not.toContain('fits ')
  await w.clock.advance(MIN)
  expect(text((await look('desktop')).tree)).not.toContain('fits ')
  expect(JSON.parse(await call($, { tool: 'mcp__a5r__host', action: 'suggest', needGb: 20 }))).toEqual({ suggestion: 'none', whyNot: [{ host: 'f20', codes: ['UNAVAILABLE'], notes: ['trust unknown'] }] }) // F-c4: an assumption changes without dropping the level
  // A16 (the card part): this machine as an A5R host lists its live queue (this session waits) in its own card.
  await call($, { tool: 'mcp__a5r__host', action: 'set', asHost: { enabled: true, roles: ['ue'], trust: ['*'], availability: { state: 'yes' }, coordinationRoot: 'E:/s2' } })
  await w.clock.advance(MIN)
  const own = JSON.parse(w.read(`${HF}/card.json`)) as HostCard
  expect([own.source, own.editor.queue, own.editor.holder, own.machine.freeRamGb, own.acceptsFrom, own.lanes]).toEqual(['a5r', 1, null, 8, ['*'], []])
  expect(find((await look('terminal')).tree, 'hai-hosts')).toBeDefined()
})

test('S-c (F-c4): engine: set label, owner or assumed keeps the level; a reach changed by hand drops it until the checks run again', async () => {
  const files = new Map<string, string>()
  const clock = { now: NOW }
  const io = memIo(files, clock, a5rRemote({ card: null }))
  const d = hostsDesk({ dir: () => 'E:/proj/Saved/A5R', root: () => 'E:/proj', me8: () => 'ab12cd34', lane: () => 'lane', home: () => 'C:/Users/u', isWriter: () => true, local: () => truth() })
  expect(await d.command(io, 'host add rig --reach ssh:rig --label "night rig"')).toContain('level L1.')
  for (const set of [{ label: 'the rig' }, { owner: 'team' }, { assumed: { roles: ['ue'], availability: { state: 'no', reason: 'days' } } }]) {
    expect(await d.tool(io, { action: 'set', id: 'rig', ...set })).toBe('A5R · host rig changed (no check needed).')
    expect([set, await d.command(io, 'host list')]).toEqual([set, 'Hosts declared here:\n- rig · the rig · L1 · ssh:rig · checked 0m ago'])
  }
  // A hand edit of the reach (what the checks depend on) drops the level and asks for a check.
  const path = 'C:/Users/u/.claude/a5r/hosts.json'
  const file = JSON.parse(files.get(path) ?? '{}') as { hosts: Record<string, Rec> }
  files.set(path, JSON.stringify({ ...file, hosts: { rig: { ...file.hosts.rig, reach: { kind: 'ssh', target: 'rig', options: { reverse: true } } } } }))
  expect(await d.command(io, 'host list')).toBe('Hosts declared here:\n- rig · the rig · L0 · ssh:rig · checked 0m ago · edited-by-hand · declaration changed since the checks: /a5r host check rig')
})
