# Ather Automata: Heading off for several sessions at once

- Rev: 1
- Status: active
- Area: ather-automata
- Owner: HaiHuynh
- Skill: `plugin-authoring`
- Branch: `intent/away-many-sessions`
- Started: 2026-10-21

## Goal

When Hai leaves for the night, every session that should keep working goes Away in one step, without opening each session. Today the Away dialog ("Heading off?", Until done / 8 hours / 4 hours) opens a window for the pane's own session only; each window is kept per session (`away:<session id>` in `ather-automata/hooks/state.mjs`), so Hai has to visit every session (Hai, 2026-10-20: "Tôi có khá nhiều session đang ongoing trong S2, làm sao để tất cả tụi nó chuyển sang mode Away khi tôi đi, mà không phải check thủ công từng session một?"; 2026-10-21: "Bật Away cần show list các session để tôi tick"; mockup approved: "Mockup ok").

Approved mockup:

```
 AWAY ★A5R
 Heading off?
 The sessions keep working; merges and pushes to main wait for your review.

 Which sessions?
 [x] this session · Walker topic S2 deep dive
 [x] Hệ thống enemy chim mới        active 3 min ago
 [x] L_Master_AoBing QA/Playtest    active 12 min ago
 [x] Enhance Form material reveal   active 40 min ago
 [ ] ♾️S2 sync main                  active 1 min ago
 [ ] Duyệt PR được assign review    (scheduled)
     a: all · n: none
 Until done   Ends when the work is done, 24 hours at most.
 8 hours
 4 hours
 Back
```

## Non-Goals

- Changing what an away window allows or holds (merges and pushes to main stay held; the ledger and the review stay per session).
- Opening a window in a session that is not live, or in another checkout.
- Deciding anything for a session beyond opening its window with the person's own words as the goal.

## Acceptance

- A1: The Away dialog lists the live sessions of this checkout (Ather's lanes, named by their app title as in 0.6.5, else their branch), this session first, each with a tick box and when it was last active. Ticked by default: this session and every session tracking an intent; not ticked: a session whose title or lane marks it as the sync conductor or a scheduled task (heuristic, stated in the code), and a session already in an away window (shown with its end time, not tickable). `a` ticks all, `n` none, a press on a row toggles it. With one live session the dialog is as today. Proof: unit tests on the list model (order, defaults, labels); e2e: the dialog with three lanes.
- A2: Choosing Until done / 8 hours / 4 hours opens a window in each ticked session: each gets its own window (its ledger, its holds, its review) with the same length and goal, and the mandate is delivered to it (the app's `send_message` where both run in the desktop app, else `$.session.send`, the same delivery Needs you uses in 0.6.5). A session the mandate cannot reach is named in the result line, and its window is not opened. The windows opened together carry one group id. Proof: e2e (three lanes: two receive the mandate and hold merges, one unreachable is named); unit tests on the group record.
- A3: Ending: "I'm back" (or `/away stop`) in any session of a group ends every window of that group, each going to its review as today. Proof: e2e.
- A4: Terminal: `/away <length> all` opens windows in every default-ticked session; `/away <length> <name>[, <name>]` in the named ones (matched on title or lane, case-insensitive). Proof: unit tests on the parse; e2e.
- A5: No regression: the Paseo port stays in step where it shares these modules (`npm run sync -- --check` in paseo/ather-automata); `S2_ROOT=<S2 checkout> node dev/test-all.mjs` against origin/main (same failing set, the new tests passing), `claude plugin validate` and `claude plugin test`; version bump with a Changes line; a thermo-nuclear review per AGENTS.md with no open critical finding, recorded in progress.md and the PR. Proof: gate.
- A6: A PR to main, merged by the orchestrator on Hai's go (2026-10-21: "Tôi không merge được, bạn tự làm tiếp nhé"). Proof: review.

## Constraints

- Work only in the worktree `D:/Projects/ather-mods-wt/away-many`; never in the live checkout `D:/Projects/ather-mods`.
- Hooks never block or fail the calls they watch; pure rules without `$`; stored values only through `state.mjs` (Ather's conventions).

## Changelog

- rev 1 (2026-10-21): created from L-1.
