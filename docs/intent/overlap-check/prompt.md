# Overlap check: open work that changes the same lines

- Rev: 2
- Status: active
- Area: ather-board
- Owner: Tin Nguyen
- Skill: `plugin-authoring`
- Branch: `ccr-c3eb09ca-i9bahh`
- Started: 2026-10-18

## Goal

Two people find out that their work collides only when one of them merges and the other gets a conflict: by then the first change is on main and the second has to be reworked under time pressure. Ather already reads every open intent and fetches the base branch; it can see the collision coming. Add one shared check, in Ather Automata's modules, that says which open intents change the same lines as the base branch or as each other, and show it on the board as a new Triage reason, **Colliding**: which two intents, which files and lines, each side's version, and one action handed to the session. The check is the base the Ship card (a follow-up) will use in the pane.

## Non-Goals

- The Ship card and the pill above the prompt in Ather's own pane (mockups A and C). They read this check, in a follow-up intent, once it has run on the board.
- Resolving, merging or rebasing anything. The board stays read-only: every action is a prompt handed to the session, which asks before it writes, commits or messages anyone.
- GitHub. The check uses git and the branches already fetched; the board still does not ask GitHub about PRs.
- Stored results. This change keeps them in memory, keyed by the branch tips (D6); where the pane stores them is the Ship card's decision (Follow-ups).
- A Paseo version: the board has none yet.

## Sources

- A 30-second "Create PR" demo (2026-10-18): one card that mutates in place, with the conflicting commits tinted and a popover "Lena Park changed the same lines on main" listing file, line, and each side's line.
- Mockups F (Triage: Colliding) and H (one row on every surface), Ather UI Mockups canvas (https://claude.ai/artifact/SYAtxxGdkFbNTCd41WJqRG, version 9), after two Fable design reviews (simplification and grouping). The review's rules that bind this intent: the stage glyph first, the warning after the name as amber `▲` plus a short label; amber only for a warning, never for "the other person's side"; no helper sentences on the surface; a cut-off group ends with "N more ›".
- The code as of origin/main eae8432: the board reads intents with Automata's modules copied into `ather-board/hooks/ather/` by `ather-board/sync.mjs` (`dev/test-all.mjs` fails while the copies differ); `model.mjs` does not read an intent's `- Branch:` line; `state.mjs` is 954 lines (the thermo-nuclear review blocks a file pushed past 1,000); the board fetches the base branch at most every ten minutes, without tags or gc.
- git: `git merge-tree --write-tree` (git 2.38 and later) merges two commits without a worktree or index and writes a tree whose conflicted files carry conflict markers; it exits 1 when there are conflicts.

## Decisions

- D1 (where it lives): one pure module, `ather-automata/hooks/overlap.mjs`: which pairs to compare, and reading git's output into overlaps. No `$` in it; the git commands run where Ather already runs git, and their output is handed in. `sync.mjs` copies it to the board with the other shared modules. The board draws it; nothing about Colliding is written in Automata's pane in this change.
- D2 (an intent's branch): `model.mjs` reads the `- Branch:` line (backticks stripped, read with `shell.mjs` `branchNamed`, so a template's `intent/<feature>` is no branch). An intent is compared when it is open (not completed, not parked) and its branch exists on the remote as fetched. Without a Branch line, or with a branch that is not on the remote, it is simply not compared; data hygiene does not list it (most intents have no pushed branch until late).
- D2a (rev 2, fetching the branches): the board's fetch brought only the base, so a clone knew no intent's branch until its owner fetched it. With the base's fetch (every ten minutes at most), the board asks origin once where every branch is (`git ls-remote --heads origin`) and fetches, in one fetch with the base's flags (no tags, no FETCH_HEAD, no gc), only the open intents' branches that moved. It writes only their remote-tracking refs. A failure is logged and the sync line still speaks for the base alone. `team.mjs` `fetchArgs` takes several branches for it. A remote-tracking ref of a branch deleted on origin is left: merged into the base, it changes nothing and is never merged.
- D3 (what collides): a pair collides when merging them would conflict.
  - An intent against the base branch: `git merge-tree --write-tree origin/<base> origin/<branch>`. A conflict means the base moved on under the intent.
  - Two open intents: the same command on their two branches, run only for pairs whose changed files (`git diff --name-only origin/<base>...origin/<branch>`, once per branch) share a path. Most pairs share none, so the cost stays near one diff per open branch.
  - The lines: for each conflicted path, read the written tree's file and take each conflict block's starting line (in the first side's file) and the first changed line on each side; a diff3 base section is skipped. A binary file (git's "Cannot merge binary files"), or one with no markers, is one place, "binary, both changed"; a file one side deleted is one place too. At most six places are kept per pair; the count says how many there are.
  - The names: each side is named by its intent's owner; the base side by its last author on those files, with that commit's time ("origin/main changed these lines 6m ago (Lena Park)"). Naming the intent that merged them is a follow-up.
- D4 (old git): where `git merge-tree --write-tree` is not available (git before 2.38), the check reports nothing and the board's data hygiene shows one line, "git <version> cannot check overlaps (needs 2.38)". It never fails the board or blocks a hook.
- D5 (the board's Triage): Colliding is a reason, second after waiting on a decision. One row per pair: `<glyph> a ⇄ <glyph> b ▲ N overlaps`, the files on the right in quiet type, then age and owners, the same columns as every Triage row. Pressing a row opens it in place:
  - one quiet fact ("hitstop-retune merged to main 6m ago", or "Neither is merged yet");
  - each spot as `path:line`, then each side's line on one grey ground, named by person;
  - two actions handed to the session. On the person's own intent: "Bring <base> into <slug>", then "Draft a note to <owner>" (drafted, never sent). On two teammates' intents: "Ask <a> and <b> who goes first" (drafted), then "Open both intents".
  - An intent sits under its worst reason, as today; its row names the others.
- D6 (when it runs, rev 2): after each read of the board, in the background, one run at a time: the board draws without waiting, and the rows appear when the check is done (on S2, the first run's diffs and merges can take a while). Each branch's files are kept by `<base tip>...<tip>` and each merge by its two tips, in memory, so an unchanged pair is never merged twice and a run with nothing moved is one git call. The calls run one after another on purpose, beside the person's own git. Nothing is persisted.
- D7 (the page): `/board open` and `/board publish` show the same group in Triage with the same rows; on the page, a row opens in place the same way (read-only: no actions there). The records carry their collisions, so the page's own copy of the views draws them with no new data shape.
- D8 (rev 2, the rest of the board): an intent in a collision warns "overlaps <what>" on its own row in every view (a warning like stale, not a reason: it stays under its own reason in Triage). Colliding is not one of Triage's reasons: its rows are pairs, drawn by a group of their own. For you shows the person's own collisions after their decisions, counted with them, and does not list those intents again under their other work.
- D9 (rev 2, a narrow pane): under 90 columns the pair row leaves out its file, so the two names keep the room; opened, it lists every place.

## Acceptance

| Id | Item | Proof |
| --- | --- | --- |
| A1 | The Branch line is read; intents without one, or whose branch is not on the remote, are not compared. | Unit on real intent headers (this repository's `docs/intent/*/prompt.md`); unit with a branch missing from a fixture remote. |
| A2 | Pairs to compare: every open intent with the base; two intents only when their changed files share a path. | Unit on `overlap.mjs` with fixture file lists. |
| A3 | Conflicts read from `git merge-tree` output and the written tree: paths, starting lines, each side's first line, the side names. | Unit on captured output; an e2e on a temporary repository with a real conflict (base moved, two branches touching one file, one branch touching another file). |
| A4 | Before git 2.38, nothing is reported, one data-hygiene line says why, and the board draws as before. | Unit with a stubbed version; e2e with merge-tree failing. |
| A5 | Triage shows Colliding second, with the D5 row and expanded form; the actions hand the exact prompts; nothing is sent until the session asks. | Board unit tests on the view; pane e2e screens at 72 and 110 columns and the desktop tree. |
| A6 | An unchanged pair is not merged again; a moved tip is. | Unit counting git calls across two runs. |
| A7 | `/board open` shows the same rows and expands in place. | Page e2e (the page's client test). |
| A8 | No regressions: `node dev/test-all.mjs` green (with `S2_ROOT` for one run before merge, where one is at hand), the board's copies in sync, `claude plugin validate` and `claude plugin test` pass for both mods; ather-board 0.2.0 with a Changes line; ather-automata's version bumped for the new shared module. | The runs, recorded in progress.md. |
| A10 | Visual proof: the pane at 72 and 110 columns and the page (light, dark, phone) on a real repository with conflicts. | `proof/`, made by `node dev/e2e/board.mjs --out`. |
| A9 | Thermo-nuclear review PASS on the branch's whole diff, every critical finding fixed or accepted in writing by the owner. | Recorded in progress.md and the PR's Thermo-nuclear review section. |

## Follow-ups

- The Ship card and the prompt pill in Ather's pane (mockups A, C), reading this check; that intent decides where the pane keeps its results (`state.mjs` has 46 lines of room).
- The board's intent timeline and the counts that open (mockups G, I).

## Changelog

- rev 1 (2026-10-18): created.
- rev 2 (2026-10-18): built. D2a (fetching the intents' branches), D3's binary and deleted places and the base side's naming, D6 (in the background, not on the fetch), D8 (warnings, For you), D9 (narrow panes).
