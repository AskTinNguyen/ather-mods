# crew-tree-and-groups: Log

## 2026-10-08 · worker

- Base: worktree `C:\Users\Admin\src\ather-mods-team-truth`, branch `intent/crew-tree-and-groups` at origin/main 1fe1476 (0.1.8). Baseline test-all: unit 140/140, e2e 275/275.
- Types read (2.1.287 claude-code.d.ts): `tool.call` carries `agentId` (absent on the main loop) and `tool_use_id`; `agent.spawn` carries `tool_use_id` (the Agent call), `parentAgentId` and `background`; `AgentInfo.parentId`; `SubagentStop.background_tasks` is session-wide ("registered in this session") with no owner field → `⏸ paused` not built (progress F-1).
- New pure modules: `hooks/inflight.mjs` (calls in flight per loop, `during`, `linkChild`, `isSilent`, `waitWords`), `hooks/crew-rows.mjs` (the worker tree drawn; moved out of console.mjs). `crew.mjs` gains `parentId`/`wait`/`stuck` on each row, `crewTree` and `crewHeading`; `workers.mjs` gains `recordHeard`; `squad.mjs`: SendMessage no longer sets a prop, idle reads "quiet", pending reads "queued".
- watch.mjs: generic `tool.call` hook records the call in flight around `next(e)` (cleared on run, deny or throw; then heard from); `agent.spawn` links a foreground child; the tick's stuck-permission toast uses `isSilent` with the in-flight check.
- Unreal pack: optional `lockLine` hook (`editorLockLine`); `Pack` typedef gains `lockLine?`.
- Grouping: worklist.mjs (`GROUP_BYS`, `subGroups`, `splitParked`, `countText`, `FOLD_OVER = 6`), rows.mjs `workGroups` (sub-heads, folded Parked block, "x of y"), state.mjs (`groupBy:<person>` key, `readGroupBy`/`setGroupBy`), console.mjs (Group button, `g` in the terminal, read from the store once a session, reset on session start).
- Stand-in engine: `holdTool(agentId, input)` holds a call at the tool until `release`/`deny`/`fail`; `spawn` now sends `parentAgentId` (as the engine pins it), `toolUseId` and `background`.
- Tests updated for replaced behaviour (not deleted): the pick-view row regexes (Group button, sub-heads before the first teammate row), the stage-block checks run under Group: None, the worker heading regex.
- Line endings: the worktree had mixed CRLF/LF working copies (index is LF); every touched file is LF now (`git ls-files --eol` → w/lf).
- Final: test-all exit 0, unit 154/154, e2e 298/298, paseo in step and tsc clean; `claude plugin validate ather-automata` exit 0 on PATH claude (2.1.293) and on the 2.1.286 desktop exe. console.mjs 1565 → 1548 lines.

## 2026-10-08 · worker, round 2 (review BLOCK)

- R1: `tool.check` hook in watch.mjs marks a call asking when the engine's verdict is "ask" (`markAsking` by tool_use_id; tool.check carries no agentId). Asking calls are not in flight for `isInFlight`/`isSilent`/`longShell`/stuck; `waitWords` leads with "⏳ asking permission: <what>"; the tick toasts an asking call past 10 min. New prop `asking` ("asking you") for AskUserQuestion, kept out of the trail.
- R2: `during(..., next.signal)` ends the call on abort; onSettled wrapped; `endLoop` on a worker's turn.complete; eviction prefers asking calls, then the busiest loop.
- R3: heading hides "Waiting on 0".
- R4, R5: `blocksOf` in worklist.mjs, one render loop in rows.mjs; nothing starts folded while searching.
- R6: `longShell`, `isLive` shared. R7: `lastTool` on the worker record, `lastTools` map deleted. R8: group read guarded by a press counter.
- Stand-in engine: `dispatch(..., signal)`; `holdTool(agentId, input, { ask })` dispatches tool.check answered "ask" before holding, and `abort()` aborts the dispatch's signal.
- Tests: unit 154 → 159 (2 assertions flipped: heading without Waiting on 0, AskUserQuestion → asking); e2e 298 → 305 (asking line and toast, abort and turn-end clearing, a search-opens-groups scenario on a list of its own; A9's Parked head and the squad heading updated).
- Final: test-all exit 0, 159/159, 305/305; both validators exit 0; console.mjs 1556 lines.

## 2026-10-08 · worker, round 3 (F-6)

- Asking is marked from `on('classic.PermissionRequest')`, fired when a permission dialog is shown to the person (BaseHookInput with `agent_id` inside a subagent, `tool_name`, `tool_input`; no tool_use_id). `markAsking({ loop: agent_id ?? '', tool, input, at })` takes the loop's newest in-flight call of that tool not yet asking, the one with the same command first. The hook returns `next(e)` unchanged: it never decides permissions. The tool.check hook is removed (no other use): its "ask" fires before the mode settles it, and in auto mode the classifier often allows at once.
- Asking still lasts until the call settles after a real dialog was shown: there is no "approved, started" event. Acceptable, because it only follows a dialog the person saw.
- Stand-in: `holdTool(..., { dialog: true })` dispatches tool.check "ask" then classic.PermissionRequest for the held call; `{ ask: true }` alone is tool.check "ask" with no dialog.
- Tests: unit 159 → 160 (markAsking by loop/tool/command); e2e 305 → 306 (tool.check "ask" without a dialog: running, no asking line, no toast). Final: test-all exit 0, 160/160, 306/306; both validators exit 0.
