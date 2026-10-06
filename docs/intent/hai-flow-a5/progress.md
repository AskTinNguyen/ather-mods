# hai-flow-a5: Progress

- Working under rev: 2
- Worker: Claude worker session (2026-10-06)
- Current step: S2, A1 (everything new and the existing Editor gate, tiles, status line and toasts only while A5 is on; 🟥/⏯️ always)
- Next step: S3, Editor holder wiring (model tool `editor`, minute timer, notices)
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

- S0 (rev 1, 2026-10-06): hai-flow 0.3 moved from the S2 session's scratch folder into `hai-flow/` unchanged (A5 fitted to Ather's intent flow: shared-checkout-only git rules, worker stop-and-report, Ather proof in `Verified:`; 🟥 to Needs you or PENDING.md). Before the move: `claude plugin validate` → `✔ Validation passed`; type-check exit 0; `claude plugin test` → `35 pass 0 fail`. Evidence: this commit. Acceptance: none (baseline).
- S1 (rev 2, 2026-10-06): pure core `hooks/coord.ts`: session files (`Saved/HaiFlow/editor/<id8>.json`, heartbeat, want, holding, yield asks, delivered notice ids), liveness from files (Ather lane ended or > 10 min, session file > 3 min with no fresh lane; neither file = unknown, never gone), deterministic queue (first requested first served, sync holder first in cutoff/freeze), `decide` (head only, free lock, slot ends by the cutoff, launch gate only when no Editor runs, stale-lease recovery only with holder gone and no Editor), `mayAskYield` (≤ 20 min, no build, head, pausable live holder, once per holder per hour), D2 `heldLine`/`freeLine` with `safeNote` so no reader mistakes a note for a field, `parseLockLine` (HELD/HANDED/FREE and older lines), RAM probe argv + parse + `cleanupPlan`, sync timeline (planned → cutoff → frozen → done/aborted/cancelled), merge-tree parse and rule-11 classification, freeze `gitWrites`, `writesLock`, notice texts and ids. Unit tests `tests/coord.test.ts` (14), including a verbatim copy of Ather's `parseEditorLock` reading holder/until/session from the D2 lines. Probe run once for real on this machine (read-only): JSON parsed, 12 processes. merge-tree `--name-only` output shape checked in a scratch repo (git 2.45.1). Evidence: `✔ Validation passed`; tsc exit 0; `49 pass 0 fail`; commit below. Acceptance: A3/A5 unit parts (engine parts open).

## Engineering decisions (inside the intent's scope)

- E1 Grant vs sync: a grant's slot must end by the cutoff (T − 30), which satisfies both A3 ("fits before the next sync cutoff") and A5 ("grants that would cross the sync are deferred"); from the cutoff until done/abort only the sync holder is granted. The wait names the room left ("ask again for ≤ N min").
- E2 Launch gate (D5) applies only when no UnrealEditor runs; a FREE lock with the Editor still open is reused and its memory is already counted. PIE start 5 GB / abort 3 GB stay fixed. A missing RAM reading fails closed (the slot waits).
- E3 Liveness is conservative: a fresh Ather lane vouches for a session even if its hai-flow file is stale; a holder with neither file is unknown and its lease is never freed. Recovery writes `FREE … note=stale lease … background=unknown` (the gone holder cannot assert `none`).
- E4 Every hai-flow session with A5 on keeps a session file (heartbeat) even without a request, so "holder runs hai-flow" and "every A5 session" are file facts.
- E5 Panel presets for a sync: the first half hour ≥ 45 min ahead, then +1 h, +2 h (the cutoff notice still lands before its cutoff).
- E6 Launch gate control: one shared override in the plugin store (every session reads it) over the plugin options; the panel moves both gates together by 1 GB and Reset returns to the options; clamped to 10–60 GB.
