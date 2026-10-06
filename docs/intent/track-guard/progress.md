# track-guard: Progress

- Working under rev: 1
- Worker: track-guard worker (Claude Opus subagent, worktree `D:/Projects/ather-mods-wt/track-guard`)
- Current step: S1, untrack and proof attribution in state.mjs (A1 core, A5 stamping), lane reading moved into state.mjs, `/ather untrack` and the profile tool's `track: "none"`, with unit tests
- Next step: S2, auto-track only for the session's own orchestration (A3)
- PR: none

## Acceptance

<!-- One row per acceptance id in prompt.md, same order. Verdict is exactly met or open; met needs evidence (commit / command and its result line). -->

| Item | Verdict | Evidence |
| --- | --- | --- |
| A1 | open | |
| A2 | open | |
| A3 | open | |
| A4 | open | |
| A5 | open | |
| A6 | open | |
| A7 | open | |
| A8 | open | |

## Steps

<!-- S<n> (rev <r>, <YYYY-MM-DD>): <what was done>. Evidence: <commit / command and result line / PR>. Acceptance: <A-ids moved>. -->

- S0 (rev 1, 2026-10-06): baseline on `main` 24eb1f4 in this worktree: `S2_ROOT=E:/Projects/s2 node dev/test-all.mjs --layouts <scratch>/tg-base` → `105/105 passed`, `184/185 passed` (the one failure: "a teammate's name sits in its own column at the right edge", which depends on the S2 checkout's current intents). Layouts kept outside the repo for the A7 diff. Acceptance: none (baseline).

- S1 (rev 1, 2026-10-06): untrack and proof attribution in `state.mjs`. `state.untrack(io, me)` clears the pin, `last:<me>` when it names the same intent, adds the slug to `untracked:<sid>` (a lane key: it moves on /clear and is pruned with the lane), rewrites the heartbeat at once; refused while the window's phase is `running` (a window waiting for review does not refuse). `state.track` takes `isAuto` (a write never re-tracks an untracked slug; an explicit track lifts the stop) and rewrites the heartbeat at once. `writeEvidence` stamps `by` (first 8 characters of the session id), so `setRung`, `noteMcp` and `/ather checked` records carry it and the status tool shows it. The heartbeat (`writeHeartbeat`, with `lastActiveAt` from `markActive` on every prompt and tool call), `readLane`, `isLaneLive` and `readPeers` moved from watch.mjs into state.mjs. `/ather untrack`, the profile tool's `track: "none"`, pure `untrackText`, `proofLine`, `heldByLine` in home.mjs. Evidence: this commit; `node --test ather-automata/tests/*.test.mjs` → `# pass 112 # fail 0` (7 new under "track guard"); `S2_ROOT=E:/Projects/s2 node dev/test-all.mjs --layouts <scratch>/tg-s1` → `112/112 passed`, `192/193 passed` (only the pre-existing failure; 8 new e2e checks in "track guard (0.1.1)"), layouts-72 and -110 identical to the base (`cmp` silent); type-check of `hooks/*.mjs` and `hooks/packs/*.mjs` against this build's engine types (`tsc` 5.6, the test-all.mjs settings) → no errors. Acceptance: A1 (core; the Intent view's Stop tracking comes with S3), A5 (stamping and status; the view's text comes with S3), A4 (lane record and line; the view and lane text come with S3).

## Decisions (worker)

- W1: `untrack` is refused only while the window runs (phase `running`); a window waiting for review does not hold the pin, since its ledger and holds no longer depend on it.
- W2: the per-session stop is the store key `untracked:<sid>` (a list of slugs), a lane key like `pinned`: it follows /clear and an adopted window, and prune removes it with the rest of an ended lane. An explicit track of the slug lifts it.
- W3: `by` is the first 8 characters of the session id, as the Editor lock names sessions; the Intent view shows a session title for it when Claude Code's record has one (the same lookup as the lock line).
- W4: the heartbeat is written through the state queue (`writeHeartbeat`), and `track`/`untrack` rewrite the last one written by this session at once, only while that file is still there (a cleanup is never undone).
