import { expect, test } from 'claude-code/testing'
import { parseLockLine, resolveLock, blankSession } from '../hooks/coord.ts'
import { LOCK, ME, PROJ, opts, world, type Proc } from './world.ts'

// Hotfix 0.18.2 (A84 note): MEASURED 2026-10-16 15:00:43 in S2 session b4f33d56 (main loop, 0.18.0): `mcp__a5r__editor
// {"action":"status"}` answered "a5r registered the tool editor but no tool.call hook answered this call" (the hook threw
// or outran its budget) under this lock line, whose `session=` is a lane and whose note carries "held by …, session …".
const LINE = 'HELD lane=enhance-form session=enhance-form since=14:49 2026-10-16 pid=42904 end=15:49 mode=unattended pausable=yes next_safe=after save note=enhance-form S1: split SKM_S2_char_MC_fullform_Original_FX per part/side into new asset SKM_S2_char_MC_fullform_EF (Geom · held by enhance-form, session 3e87ef27, until 15:49\n'
const START = { cwd: PROJ, surface: 'terminal', isInteractive: true } as never
const D = (h: number, m: number) => new Date(2026, 9, 16, h, m).getTime()
const EDITOR = 'mcp__a5r__editor'
const GET = 'mcp__ccd_session_mgmt__get_session'
const UE: Proc = { name: 'UnrealEditor', pid: 42904, gb: 20, parentAlive: true }
const ME8 = ME.slice(0, 8)
const out = (ran: { result?: unknown; text?: string; deny?: string }): string => String(ran.deny ?? ran.result ?? ran.text ?? '')
const call = async ($: any, action: string) => (await $.tool.call({ tool: EDITOR, action, minutes: 10, what: 'probe' } as never)) as { result?: unknown; isError?: boolean; text?: string }

test('hotfix: unit: that exact line reads holder 3e87ef27 (lane enhance-form) until 15:49 with PID 42904; a standard line without an id resolves by its lane', () => {
  const lock = parseLockLine(LINE)
  expect([lock.kind, lock.isStandard, lock.id8, lock.lane, lock.sessionName, lock.end, lock.pid, lock.heldLane]).toEqual(['held', true, '3e87ef27', 'enhance-form', 'enhance-form', '15:49', 42904, ''])
  const bare = parseLockLine('HELD lane=enhance-form session=enhance-form since=14:49 2026-10-16 pid=42904 end=15:49 mode=unattended pausable=yes next_safe=after save note=split\n')
  expect([bare.id8, bare.heldLane]).toEqual(['', 'enhance-form'])
  const f = blankSession('5a5a5a5a-1', 'enhance-form', 'enhance-form', D(15, 0))
  expect(resolveLock(bare, [f], [], D(15, 0)).id8).toBe('5a5a5a5a')
})

test('hotfix: status, request and release from another session under that exact line all answer (no throw)', opts(), async ($, on) => {
  const w = world(on, { ram: '40', now: D(15, 0), procs: [UE] })
  w.put(LOCK, LINE, D(14, 49))
  await $.session.start(START)
  const status = await call($, 'status')
  expect([status.isError === true, out(status)]).toEqual([false, expect.stringContaining('"lock": "HELD lane=enhance-form')])
  expect(out(await call($, 'request'))).toContain('enhance-form (session 3e87ef27) holds the Editor until 15:49')
  expect(out(await call($, 'release'))).toContain('the lock does not name this session')
})

test('hotfix: a session whose lane is enhance-form but whose id is not 3e87ef27 is not the holder; the 3e87ef27 session is', opts(), async ($, on) => {
  const w = world(on, { ram: '40', now: D(15, 0), procs: [UE], out: { [GET]: '{"title":"enhance-form"}' } })
  w.put(LOCK, LINE, D(14, 49))
  await $.session.start(START)
  expect(out(await call($, 'status'))).toContain('"lock": "HELD lane=enhance-form')
  expect(out(await call($, 'request'))).toContain('holds the Editor until 15:49') // the id decides, not the lane
  w.ids.current = '3e87ef27-0000-4000-8000-000000000000'
  expect(out(await call($, 'request'))).toContain('this session already holds the Editor until 15:49')
  expect(out(await call($, 'release'))).toContain('released: FREE since=15:00 2026-10-16')
})

test('hotfix: a standard line naming no session id is held by the live session of its lane, who may release it', opts(), async ($, on) => {
  const w = world(on, { ram: '40', now: D(15, 0), procs: [UE], out: { [GET]: '{"title":"enhance-form"}' } })
  w.put(LOCK, 'HELD lane=enhance-form session=enhance-form since=14:49 2026-10-16 pid=42904 end=15:49 mode=unattended pausable=yes next_safe=after save note=split\n', D(14, 49))
  await $.session.start(START)
  await w.clock.advance(60_000) // this session's file (lane enhance-form) is written
  expect(out(await call($, 'request'))).toContain('this session already holds the Editor until 15:49')
  expect(out(await call($, 'release'))).toContain('released: FREE')
  expect(parseLockLine(w.read(LOCK)).kind).toBe('free')
  expect(ME8.length).toBe(8)
})

test('hotfix: an error inside the editor or sync tool is the call\'s result, naming it and a step; never a throw', opts(), async ($, on) => {
  const w = world(on, { ram: '40', now: D(15, 0) })
  w.put(LOCK, LINE, D(14, 49))
  await $.session.start(START)
  w.ids.current = undefined as never // the session id cannot be read: the tool's own code throws
  const ran = await call($, 'status')
  expect(ran.isError === true).toBe(false)
  expect(out(ran)).toMatch(/^A5R · Editor — A5R hit an error reading the lock or the queue: .+ → retry the call; if it fails again, \/a5r off and take Saved\/EDITOR_OWNER\.txt by hand \(AGENTS\.md\)$/)
  const sync = (await $.tool.call({ tool: 'mcp__a5r__sync', action: 'status' } as never)) as { result?: unknown; isError?: boolean }
  expect(sync.isError === true).toBe(false)
  expect(String(sync.result)).toContain('A5R · Sync main — A5R hit an error in the sync tool:')
})
