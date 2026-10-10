# claim-guard: Log

## 2026-10-09, worker

- Baseline at 53c0261: test-all exit 0, unit 174/174, e2e 334/334.
- Engine API (2.1.287 claude-code.d.ts): `classic.Stop` input carries `last_assistant_message` and `stop_hook_active`; its result is `Pick<ClassicResult, 'block' | 'preventContinuation' | 'stopReason' | 'additionalContext'>`, and `block` is "`decision: "block"` with this text as `reason`: the event's block, veto or re-prompt". `classic.SubagentStop` has the same plus `agent_id`. So the guard returns `{ ...result, block }`, as inbox's register.tsx does.
- New pure module `hooks/checks.mjs`: check results (`runsOf`, `withRuns`), edits and staleness (`withEdit`, `isStale`), claims (`claimsIn`), the problem and message (`problemFor`, `claimMessage`, `claimAgainst`, `nextTurn`), the band line (`failingLine`), helpers (`normPath`, `parentOf`, `isMarkdown`, `editedFile`, `runFolder`). shell.mjs: `commandName`.
- Packs: new field `checksOf(rung, command)` (typedef in packs/index.mjs; unreal, web, core).
- state.mjs: key `checks:<sid>` (pruned with the session's other keys), `readChecks`, `noteRuns`, `noteEdit`, `claimAt`, `nextClaimTurn`, all through the one serialised queue.
- watch.mjs: `claimGuard` option; `classic.Stop` and `classic.SubagentStop` hooks; `prompt.submit` resets the main loop's sent-back results; the generic `tool.call` hook records edits; `shell` stamps the run's start and `afterShell` records the runs; `repoOf` (walk up to `.git`, cached), `noteRuns`, `noteEdit`, `claimBlock` (toast "Ather: sent the reply back …").
- console.mjs: `bandHint(model, failing)`; 1554 lines (base 1551).
- plugin.json `userConfig.claimGuard`; version 0.2.1 there and in marketplace.json; README.
- Stand-in engine `engine.stop`; e2e `boot({ options })`; two e2e blocks (18 checks); one screen "Claim guard" in the report.
- Shell heredocs corrupted backslashes twice (a `\b` in a template literal became a backspace byte in web.mjs; `\/` lost in watch.mjs); found by a control-character scan and the code read, fixed with the editor tools; no control characters left in any changed module.
- Final run after every edit: test-all exit 0 (paseo in step, tsc clean), unit 180/180, e2e 352/352; `claude plugin test` 2/2; validate exit 0 on 2.1.293 and 2.1.286.

### claimsIn table (unit A3)

Claims, with their kinds:

| Reply | Kinds |
| --- | --- |
| All tests pass. | test |
| Build succeeded. | build |
| The S2Editor Development build succeeded, so the fix is in. | build |
| Unit 174/174 passed, e2e 334/334 passed. | test |
| All 12 tests passed, 0 failed. | test |
| Type check is clean. | typecheck |
| tsc passes with no errors. | typecheck |
| Lint passes. | lint |
| eslint is clean. | lint |
| The project compiles cleanly. | build |
| All green. | all |
| Verified. | all |
| \*\*Tests pass\*\* and the build is green. | test, build |
| - ✅ Builds clean | build |
| Type checks pass and all builds pass. | build, typecheck |

Traps, none of them a claim: "Tests should pass once CI runs." · "I didn't run the tests." · "The change is untested." · "Not yet tested: the build needs the Editor closed." · "If the build succeeds, merge it." · "Will the tests pass?" · "Tests passed before my last edit, so they need a rerun." · 'The log line "Build succeeded" is from yesterday.' · "Run \`npm test\` to confirm tests pass." · "I verified the path exists." · "Lint was not run." · "The guard sends back replies that say tests pass." · "Add a test that passes when the flag is off." · "The build step passes the environment to the script." · "The type passes through to the caller." · "Tests pass on main but fail on this branch." · "The tests are expected to pass." · "Build.cs passes the flag to UBT." · "The pin cleared, the evidence build still pass, the list unchanged." · "Add a lint pass for the shaders." · a fenced code block holding "All tests pass".

Run over this repository's earlier intent logs and progress files (before this intent's own): 8 sentences read as claims, 7 of them "paseo tsc clean" / "mod type-check clean" (typecheck) and one track-guard sentence ("`evidence:box-scale-tool` build still pass", a description, not a claim). The build, typecheck and lint patterns then took only "passes"/"passed" (and "builds pass", "type checks pass"), which removed the track-guard one; two traps and one claim were added to the table. The 7 typecheck ones are real claims; see findings F-1.
- A refused shell command (`ran.deny`) records no check run (the existing rung path still records an unreadable automation run as 'none'; unchanged).
- Re-run after these changes: test-all exit 0, unit 180/180, e2e 352/352; validate exit 0 on 2.1.293 and 2.1.286. findings.md was refused to this worker; the findings are in the worker's report.
