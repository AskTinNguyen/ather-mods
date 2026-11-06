import { expect, test } from 'claude-code/testing'
import { launchersOf, runsEditorDriver } from '../hooks/editor.ts'
import { LOCK, ME, refused, world } from './world.ts'

// 0.28.1, editorDrivers (Hai, 2026-11-06: "Chốt, sửa A5R"): a script that drives the shared Editor over Unreal MCP from outside the agent's
// own MCP tools (S2's tools/KimodoMotionPrompt/shot.py) ran with no lock, because only tool names with "unreal" were gated.
// The person names such scripts in the editorDrivers option; a run of one is gated like an Unreal MCP write.
const SHOT = 'scripts/py.sh tools/KimodoMotionPrompt/shot.py Saved/MotionPrompt/briefs/walk.json'
const withDrivers = (editorDrivers?: string) => ({ timeoutMs: 30_000, options: { a5rWhenPresent: 'deny', editorLock: LOCK, ...(editorDrivers === undefined ? {} : { editorDrivers }) } })

test('0.28.1: unit: a driver runs by its own name or under an interpreter; a read of it, or no option, is no run', () => {
  const drivers = launchersOf('Shot.py, locomotion_set.py')
  expect(drivers).toEqual(['shot.py', 'locomotion_set.py'])
  expect([
    SHOT,
    'python E:/s2/tools/KimodoMotionPrompt/shot.py brief.json',
    'cd E:/s2 && scripts/py.sh tools/KimodoMotionPrompt/locomotion_set.py --name Walk',
    'E:/s2/tools/KimodoMotionPrompt/shot.py brief.json',
    'cat tools/KimodoMotionPrompt/shot.py',
    'git diff -- tools/KimodoMotionPrompt/shot.py',
    'python tools/KimodoMotionPrompt/setup.py --check',
  ].map(c => runsEditorDriver(c, drivers))).toEqual([true, true, true, true, false, false, false])
  expect(runsEditorDriver(SHOT, [])).toBe(false)
})

test('0.28.1: a driver run needs the Editor lock to name this session, like an Unreal MCP write', withDrivers('shot.py'), async ($, on) => {
  const w = world(on)
  w.put(LOCK, '1106-other-s9 (worker) since 14:30, expected end 15:10. session ffffffff\n')
  expect(refused(await $.tool.call({ tool: 'Bash', command: SHOT }))).toContain('A5R · Editor lock')
  expect(refused(await $.tool.call({ tool: 'Bash', command: 'cat tools/KimodoMotionPrompt/shot.py' }))).toBeUndefined()
  w.put(LOCK, `1106-me-s1 (this lane) since 14:30, expected end 15:10. session ${ME.slice(0, 8)}\n`)
  expect(refused(await $.tool.call({ tool: 'Bash', command: SHOT }))).toBeUndefined()
})

test('0.28.1: without the option a driver script is an ordinary command (no project script is named in the plugin, A111)', withDrivers(), async ($, on) => {
  const w = world(on)
  w.put(LOCK, '1106-other-s9 (worker) since 14:30, expected end 15:10. session ffffffff\n')
  expect(refused(await $.tool.call({ tool: 'Bash', command: SHOT }))).toBeUndefined()
})
