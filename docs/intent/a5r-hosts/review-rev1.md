# Review of rev 1 (from t6, 2026-11-09): structural fixes for rev 2

Rev 1 covers the scenarios, levels, checks and schemas well. Seven structural problems must be fixed before anyone
builds from it. Each item: problem, why it breaks, the fix to write.

## R1. One option block mixes "machines I send to" with "my settings as a host"
`hosts.<id>` holds `availability`, `trust`, `roles`, `laneRoot`, `capacity`, but D8/D12 say the HOST owns
availability and trust. On the origin these fields are someone else's facts, copied and going stale.
Fix: split into two blocks.
- `hosts` (outbound, origin side): id, label, owner, reach, repo, engine rule, assumed notes only.
- `asHost` (inbound, this machine when it serves others): roles, laneRoot, capacity, availability, trust,
  ephemeral, maxJobs. Published in this machine's card; the origin reads them from the card, never stores them.
For a probe-only host (no A5R) the origin may keep `assumed: { roles, availability }`, clearly marked as assumed.

## R2. Mutable state lives in settings.json
`checks`, `level`, `pausedUntil`, and link counts are written often, but settings.json is user config that A5R itself
treats as an ask-path and that agents/humans edit. Fix: options hold declarations only; state goes to
`Saved/A5R/hosts/<id>/state.json` (checks with checkedAt, level, pausedUntil, link storm), one writer (the origin's
host tool). Say where this lives when a user has several checkouts (A5R's Saved/ is per checkout): pick one rule
(per checkout, or a per-machine dir) and state it.

## R3. The host must be able to read the hand-off without a reverse link
D5 puts the ask only in the origin's `Saved/A5R/handoffs/<id>.json`; the host would have to reach back to read it,
which S6 says may be impossible. Fix: delivery is always origin -> host. The origin writes its hand-off into the
host's `Saved/A5R/inbox/<id>.json` through `writeFile` (the origin remains its only writer, a copy of its own file);
the host writes `jobs/<id>.json`; the origin reads the job file with `readFile` on its tick. Every L2 flow then needs
only the origin -> host direction; `deliver` from the host is an optional doorbell. State this as a decision and make
C12 test it with the reverse direction absent.

## R4. A job on an A5R host bypasses that host's Editor holder
Nothing says a job's Editor/PIE/build on the host goes through the host's own Editor queue, RAM gate and sync freeze.
Two Editors on one host would OOM (one Editor is ~26-35 GB on a 64 GB machine). Fix: decision: a job runs as a
session on the host and requests the host's Editor like any local session; the card shows it in the queue. On a
probe-only host the job must hold the plain lock file protocol the host uses.

## R5. Per-checkout coordination vs lanes on the same machine
A5R coordinates per checkout (`Saved/A5R` of the shared checkout), but a host lane is a second checkout (worktree)
on the same machine sharing the same RAM and Editor capacity. Fix: state which checkout's `Saved/A5R` the lane's
sessions use for Editor/RAM (recommend: the host's primary checkout, named in `asHost.coordinationRoot`), or raise it
as F8 with that recommendation. Without this, R4 cannot be enforced.

## R6. No build order
15 acceptance rows, 4 adapters, 13 checks: nobody can build this in one go. Fix: add a "Slices" section, each slice
shippable alone and useful:
1. S-a L0: `handoff record` + claims visible + acceptance claim check (no adapters).
2. S-b `host add` with checks C1, C2, C4, C5, C10 on the `ssh` and `manual` adapters + state.json + Hosts tile (L1).
3. S-c card publishing on A5R hosts + `suggest` + queue hint.
4. S-d L2 hand-off over inbox/job files (R3), preemption, C3, C7-C9, C11-C13, `herdr` and `command` adapters.
5. S-e reference runner for A5R-less hosts (F2).
Map each A# to its slice.

## R7. Acceptance of results
Say how a result returns into the origin's acceptance: a PR opened on the host is scored after the fact via the
intent's `- PR:` line (existing A5R feature); the hand-off reaches `merged` only after that score passes or the person
passes it. Add to A7.

## Smaller
- C8: computing the origin checkout size (~770k files) is slow; allow a declared size estimate and cache the measured one.
- D11 `LONG` default 120 min: fine; note it is a suggestion threshold only.
- Keep F1-F7 as written (Hải marked accept); add F8 from R5 if not decided.
