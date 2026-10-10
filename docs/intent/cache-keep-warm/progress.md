# cache-keep-warm: Progress

- Working under rev: 2
- Worker: the orchestrating session itself (no background worker: the intent skill is not on this branch, L-2)
- Current step: S5, the PR
- Next step: review (Tin)
- PR: https://github.com/AskTinNguyen/ather-mods/pull/51 (open, for review; not merged)

## Acceptance

<!-- One row per acceptance id in prompt.md, same order. Verdict is exactly met or open; met needs evidence (commit / command and its result line). -->

| Item | Verdict | Evidence |
| --- | --- | --- |
| A1 | met | S4, [proof/](proof/README.md). Same prompt 115 minutes after the last turn: A (`/warm on`, reads at 01:02 and 01:57, each "101,944 of 101,738 tokens from the cache (kept)") read 101,944 and wrote 495; B (`/warm off`) read 27,862 and wrote 74,663. A's `/warm`: "3 pings · 1 return warm, 0 cold · $0.22 spent, ~$0.39 re-write avoided" (the ledger also holds C and D). Each read cost $0.020. |
| A2 | met | S1. Plugin test "/warm on turns it on for the session…" (`/warm 2h` → "on; next read at … (0 of 2 this idle period). Cap 2 hours, set for this session."), "keep warm is off by default"; unit "/warm words", "options read safely"; live: `/warm` in session A answered "Keep the cache warm: off. Cap 3 hours, from the plugin settings." and `/warm on` armed it. |
| A3 | met | S1. Unit "a ping is due five minutes before the hour…", "a timer that fires at or past the TTL … does not ping"; plugin test "keep warm on: a ping each 55 minutes up to the cap…" (0 forks at 54 min, 1 at 55, 3 at 165, none at 220). |
| A4 | met | S1. Unit "each guard has its reason" (off, unattended, no-turn, stopped, short-ttl, busy, small, cap, quota) and "an away window…". |
| A5 | met | S1. Plugin test: a fork that read 0 tokens → no second fork in two hours, `/warm` "stopped for this idle period … 1 missed". |
| A6 | met | S1. Unit "the TTL is five minutes when a turn re-wrote…"; plugin test "a re-write after 20 idle minutes…" → no fork, `/warm` "paused: the cache lives five minutes". |
| A7 | met | S1. Unit "the status line and /warm say…" (`◔ warm 1/3 · next 21:55`); plugin test ledger line "3 pings · 1 return warm, 0 cold · $0.22 spent, ~$1.42 re-write avoided"; live: session A's status line `◔ warm 0/3 · next 00:27` (out/A-after-first-turn.png). |
| A8 | met | S2, S3: `S2_ROOT=E:/S2_ node dev/test-all.mjs --layouts …` (CLAUDE_CODE_TYPES set) → type-check clean, `322/322 passed`, `292/292 passed`, `348/348 passed` (main: 292/292, 348/348); layouts identical to main's but for the S2 intents' ages (an hour later); `claude plugin validate ather-automata` → `✔ Validation passed`; `claude plugin test ather-automata` → `8 pass 0 fail`. |
| A9 | open | 0.3.0 in both manifests, README section, Changes line; review half with the PR. |

## Steps

<!-- S<n> (rev <r>, <YYYY-MM-DD>): <what was done>. Evidence: <commit / command and result line / PR>. Acceptance: <A-ids moved>. -->

- S1 (rev 1, 2026-10-10): `hooks/warm.mjs` (rules), the keep-warm section of `hooks/watch.mjs`, `state.mjs` keys (`warm:<sid>` as a lane key, `warmLedger`), options and 0.3.0, `tests/warm.test.mjs` (11), four plugin tests on the mocked clock. Evidence: commit 38b8076; `claude plugin validate ather-automata` → `✔ Validation passed`; `claude plugin test ather-automata` → `7 pass 0 fail`. Acceptance: A2-A7.
- S2 (rev 2, 2026-10-10): F-1 found by bisection and fixed (D7); repos e2e junctions (D9, commit b359cfb); Paseo copies synced (`server/sync.mjs`). Evidence: `node dev/test-all.mjs` (CLAUDE_CODE_TYPES set) → type-check clean, `322/322 passed`; repos e2e `292 of 292 checks passed` on the branch and on main. Acceptance: A8 (part).
- S3 (rev 2, 2026-10-11): F-2 found live (sessions C, D) and fixed (D10: from the second turn; calibration from the third; `/warm` shows the last read); the e2e's command list now has /warm. Evidence: commits a7704de, d41002f; the full suite as in A8.
- S4 (rev 2, 2026-10-11): A1 live, sessions A and B on the frozen a7704de, 00:06 to 02:02. Evidence: [proof/](proof/README.md), transcripts' usage in proof/transcript-usage.txt. Acceptance: A1.
- S5 (rev 2, 2026-10-11): PR #51 to main for review. Acceptance: A9 (review half open).

