# Ather Automata: no "tests pass" without a passing run

- Rev: 1
- Status: active
- Area: ather-automata
- Owner: Tin Nguyen
- Skill: `plugin-authoring`
- Branch: `intent/claim-guard`
- Started: 2026-10-08

## Goal

The studio's first rule for agents is never to claim a build, test or check that did not run or did not pass (S2 AGENTS.md). Ather already reads build and test results from tool output into its proof records. When a reply says a build, tests, a type check or lint pass, and the latest run of that kind failed, never ran this session, or ran before a later edit, send Claude back once with what is wrong, so it reruns the check or says plainly that the change is untested.

## Non-Goals

- Running any check itself. The mod never runs a command.
- Judging claims about checks run by other sessions or people, or about PIE/visual proof (Ather's proof ladder already covers those for the tracked intent).
- Blocking more than once per result: a corrected or acknowledged reply ends the turn.
- A model call to read claims: the claim reader is a pure pattern reader, tuned to avoid false positives.

## Sources

- The petekp/inbox mod (MIT; ideas only, nothing copied): `checks.ts` `claimsIn(reply)` reads claim sentences per kind; `check-tracking.ts` keeps each check's latest result with its folder and target and marks it stale after a later edit in its repo (a Markdown-only edit leaves tests, type checks and builds current); at `classic.Stop` a contradicted claim returns `block: claimMessage(...)`, once per result.
- Tin (2026-10-08): yes to the tests-pass guard after Decide in place.
- Ather today: guards.mjs `buildResult`, `automationResult`, `isBuildCommand`, `isEditorBuild`, the web pack's lint/tsc/Playwright readers, and watch.mjs records rungs (`state.setRung`) per intent scope with who produced them.

## Decisions

- D1 (runs): a pure module keeps, per session, the latest result of each check: kind (build, test, typecheck, lint; the pack names which commands are which), the folder it ran in, pass/fail/unknown, a one-line summary, and when it ended. Results come from the readers Ather already has (the unreal and web packs), not new parsing where one exists.
- D2 (stale): a result is stale when a file in its folder's repo was edited after it ended (Write/Edit/MultiEdit/NotebookEdit tool calls, any loop of the session); an edit touching only `.md` files leaves build, test and typecheck results current. A later passing run of the same check replaces it.
- D3 (claims): a pure `claimsIn(reply)` finds sentences that state a check passes ("tests pass", "all tests passed", "build succeeded", "builds clean", "type check is clean", "lint passes", "all green", "verified") and their kind; negations and hedges ("not yet tested", "untested", "should pass", "I didn't run") are not claims. Unit-tested on real-style replies, including false-positive traps.
- D4 (guard): at `classic.Stop` for the main loop (and a worker's own stop for its reply, if the engine gives it), a claim of a kind whose latest result in the session is failed, stale, or missing returns `block` with one message naming the claim and the problem ("You said the build succeeded, but the last S2Editor build failed: <summary>. Run it, or say it is untested."). Once per result: the same result never blocks twice; a new run or the next turn resets it.
- D5 (visible): the band shows a failed check as one line ("✗ S2Editor build failed · 14:20") until a passing run of it; the pane's header proof line keeps using the existing rungs.
- D6 (off switch): a profile/config toggle turns the guard off (default on).

## Acceptance

| Id | Item | Proof |
| --- | --- | --- |
| A1 | Latest result per check kept with folder, result, summary, time, from the existing readers. | Unit + e2e (a failing then passing build). |
| A2 | Stale after a later non-Markdown edit in the repo; Markdown-only edits keep build/test/typecheck current. | Unit. |
| A3 | `claimsIn` finds claims per kind and ignores negations/hedges. | Unit on a table of real-style sentences incl. traps. |
| A4 | A contradicted claim at Stop returns one block with the D4 message; a true claim, an unclaimed reply, or a second stop on the same result does not block. | e2e with the stand-in's classic.Stop. |
| A5 | The band shows a failing check until it passes. | e2e. |
| A6 | The guard can be turned off. | e2e. |
| A7 | No regressions; Paseo copies in sync; validate exit 0 on the PATH claude and the 2.1.286 desktop exe; version 0.2.1 with a Changes line. | `node dev/test-all.mjs`; validators. |
| A8 | Thermo-nuclear review PASS (S2 skill). | Recorded in progress.md by the coordinator. |
