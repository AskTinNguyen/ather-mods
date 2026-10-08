# Ather Automata: the team's real state, scannable

- Rev: 1
- Status: completed
- Area: ather-automata
- Owner: Tin Nguyen
- Skill: `plugin-authoring`
- Branch: `intent/team-truth`
- Started: 2026-10-07

## Goal

Now that the team uses Ather with many intents, the pane must show the team's real state and stay scannable. Today it reads only the local checkout's `docs/intent/`: Tin's shared checkout shows 4 open intents while `origin/main` has 23, and every intent's age is the time someone last pulled (folder mtimes cluster at pull times), so 0.1.4's 7/30/90-day chips measure pulls, not work. Read intents from `origin/main` through git, with real last-commit dates, fetched in the background without taking git's lock; show how fresh the list is; sort it three ways; flag what needs each person's attention; and give every work row one anatomy so the list reads in columns.

## Non-Goals

- Intents that exist only on open PRs (deferred: intents reach main with their feature PR, so the yield is small).
- A team-wide director-calls queue. Tin: "I only want my own." Needs you stays the person's own intents.
- Stale-by-age flags (the corpus is days old; most intents live 1-2 days). Saved views, Following, a Team view, overlap warnings, a roster file.
- Area/Owner/Stage/Attention filter chips (about 30 controls on a narrow pane). Search stays.
- Changing the S2 repo. This is the mod only.

## Sources

- Proposal and its two reviews (2026-10-07): a fresh-eyes check that measured the gap (45 intents on main, 23 open; local 22, 4 open) and a critique that found the mtime-as-age bug, that the director queue would be empty, that the roster is unnecessary (`isSamePerson` already prefix-matches git names; the holes are missing or team Owners), that team data across machines is git-only, and that filter chips overload the pane.
- Tin's answers (2026-10-07): own director calls only; Cinematic is a team led by Tien Dang (`TienDang` / `TienDang-VFX`); the fetch runs in the background without taking git's lock; the team list stays in everyone's view; tidy owner names for display; Home shows 4 team rows.
- The approved mockup and Gestalt tidy-up in the session of 2026-10-07 (summarised under Decisions).

## Decisions

- D1: Intents come from `origin/main` (read with `git show`/`ls-tree`/`log`, never touching the working tree or index), merged with local-only intent folders, which are tagged `local`. Where an intent exists in both, the local copy wins only if it differs and is newer by its own last commit or is uncommitted; each row records which source it came from.
- D2: Every git call Ather makes for this runs with `GIT_OPTIONAL_LOCKS=0` and never writes the index. The fetch is `git fetch --no-tags origin main` (narrow refspec), in the background: when the pane is first drawn, then at most every 10 minutes; one fetch at a time; a failure leaves the last list and says so in the sync line.
- D3: An intent's date is its folder's last commit on `origin/main` (one batched `git log` for all of `docs/intent`, not one call per intent); a local-only or locally edited intent uses its file mtime. 0.1.4's age chips go; Sort replaces them.
- D4: Sort cycles Recent (default) / Ready to close / Oldest. "Ready to close" groups the list in stage blocks: Ready to close (every item met), Proving, Building, Parked.
- D5: Needs attention, per person, above Next: their own intents that have every item met ("Close it?") or are parked with no reason ("Add one?"). Each opens its intent; nothing is done without a press.
- D6: Owner display: git names tidied (`LamPhung-Art` → Lam Phung, `trucnguyen` → Truc Nguyen, `DuyTranSipher` → Duy Tran): split camel case and strip trailing role or org suffixes, title-case; matching people still uses `isSamePerson`. A known team is shown with its lead: `Cinematic` → "Tien Dang · Cinematic". An intent with no Owner falls back to its folder's first committer on main.
- D7 (Gestalt): one row anatomy for every work row — stage glyph · title · progress bar and count · age · owner — with the right-hand columns aligned; progress as a mini bar beside the count; lime only for what needs the person (Needs you, Needs attention, Next); decisions grouped per intent ("quest-debug-panel · 4 decisions", opening the list); letter-spaced capitals for top-level sections only, subgroups bold with a count; Home's team preview shows 4 rows then "+N more ›"; one header status line with "synced N min ago ↻" at its right; the repeated brand line under the title bar goes; stage glyphs ● Build, ◐ Prove, ✓ All items met, ‖ Parked, with a one-line legend at the foot of Everything open; warnings ("⚠ parked, no reason") sit on their row.

## Acceptance

| Id | Item | Proof |
| --- | --- | --- |
| A1 | The pane lists intents from `origin/main` plus local-only ones, each with its source; a checkout behind main shows main's open intents. | e2e: a sandbox git repo whose origin/main has intents the working tree lacks; the pane lists them. Live: against E:\S2_, read-only, the open count matches origin/main (23 on 2026-10-07). |
| A2 | Dates are last-commit dates, not mtimes; one batched git call. | Unit: date parsing from a `git log --name-only` sample; e2e: folders with identical mtimes get different ages from their commits. |
| A3 | Background fetch: narrow refspec, `GIT_OPTIONAL_LOCKS=0`, never more than one at a time, at most every 10 min; failure keeps the list and shows it. | e2e asserts the argv and env of the git calls and the throttle; a failing fetch keeps rows and changes the sync line. |
| A4 | The sync line reads "synced N min ago ↻"; ↻ fetches now. | e2e on terminal and desktop. |
| A5 | Sort cycles Recent / Ready to close / Oldest; Ready to close shows stage blocks; age chips are gone. | Unit for the sort and grouping; e2e screens. |
| A6 | Needs attention lists the person's own all-met and parked-without-reason intents above Next, each opening its intent. | Unit on the model; e2e with a fixture of each. |
| A7 | Owner names tidied; Cinematic shows "Tien Dang · Cinematic"; ownerless intents fall back to the first committer. | Unit table of real names from main; e2e. |
| A8 | One row anatomy with aligned right-hand columns and mini progress bars, on Home's team preview (4 rows + "+N more ›") and Everything open, on terminal (72 cols) and desktop. | e2e screens at 72 and 110 columns, checked for alignment and width; desktop tree assertions. |
| A9 | Decisions grouped per intent in Needs you; lime only on Needs you, Needs attention and Next. | e2e: an intent with 4 calls renders one block; colour assertions on the tree. |
| A10 | No regressions; the pure modules' Paseo copies are in sync; `claude plugin validate` passes on 2.1.287 and 2.1.286. | `node dev/test-all.mjs` green; both validators. |
| A11 | Passes a thermo-nuclear review (S2 skill `.agents/skills/thermo-nuclear-code-quality-review`). | Review verdict PASS recorded in progress.md. |
