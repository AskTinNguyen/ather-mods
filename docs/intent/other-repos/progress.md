# Ather Automata: repositories that are not S2: Progress

- Working under rev: 3
- Worker: Claude Opus 5.5 builders, one per slice; Codex gpt-6.1-sol reviews each slice; the coordinator commits
- Current step: none; every slice is built and reviewed, and the branch is merged with the web pack's changes (S5)
- Next step: none; it reaches `main` with PR #49, the branch that holds PR 44, PR 45 and PR 48
- PR: #44, merged through #49

## Acceptance

<!-- One row per acceptance id in prompt.md, same order. Verdict is exactly met or open; met needs evidence (commit / gate output / review). -->

| Item | Verdict | Evidence |
| --- | --- | --- |
| A1 | met | S3, dd10154 and f757366. Unit: the base's three sources (profile `base`, the remote's default, `main`; a git that could not say is not taken for `main`), `readTeam` over a base of `develop`, the fetch refspec, the guards. e2e `dev/e2e/repos.mjs`, "a team that merges into another branch" (19 checks): an origin on `develop` with an intent the checkout has not pulled lists both as the team's, fetches `develop`, holds `git push origin develop` while away; a second origin on `main` still fetches `main`; a profile `base` wins; a worktree on another base is fetched and listed for itself; a held push in another checkout names that checkout's branch. No existing check changed. Review (Codex): one Major and three Minor, all fixed in f757366, verify APPROVED. Live: a scratch clone of an origin whose only branch is `develop`, one commit behind: the debug log says `origin/develop moved` and both intents are listed as the team's. |
| A2 | met | S2, c801955 and 621853d. Unit in `tests/web.test.mjs`, "gates as people type them" (6 tests) on a profile shaped like ninetails-monitoring's: the narrow gate is its own whatever the order; `.venv/bin/python`, `python`, `python3.12` and a Windows `python.exe` prove a `python3` gate; `cd app && …` proves a gate written so, and `||`, a pipe and `;` do not; a path gate is proved only by its own path; other commands prove nothing. Review: two Major (a path gate lost its path; `cd app || …` counted), fixed in 621853d, verify APPROVED. Run by hand on the built module with the same profile: the same results. |
| A3 | met | S1, acbdce9 and fbc6269. Unit in `tests/acceptance.test.mjs`, "acceptance written as a table" (5 tests): a table's ids, texts and verdicts; a list and a section with both read as the list; no item from a header, a rule row or another table; each Acceptance section read on its own; the four intents of this repository read from their files: crew-tree-and-groups 11, decide-in-place 10, team-truth 11, multi-repo 15 (by hand: 11/11, 10/10, 11/11, 15/15 met). Review: one Major (a table in one section dropped when a later section was a list) and one Minor, fixed in fbc6269, verify APPROVED. |
| A4 | met | S4, 833af2f and 6ad1311. The README: install on macOS and Windows and outside S2; the section "In a repository that is not S2" (steps, roles, proof, the base branch, how a gate is matched, macOS notes); the roles of both packs; "machine" for "PC"; the 0.2.6 line. SETUP.md: gate matching and order, the link for a teammate on Windows, `skills-lock.json`, `base`, the link in the report. The setup prompt names the `.claude/skills/intent` link. Read by the coordinator against D4; the roles checked against `packs/web.mjs`. Review: one Minor (proof is not from gates alone), reworded in 6ad1311, verify APPROVED. `claude plugin validate` passes. |
| A5 | met | A clean copy of 833af2f on macOS, Node 23.9: Paseo copies in step and both Paseo plugins type-check; type-check clean; unit 282/282; repos e2e 254/254; S2 e2e 354/354 (a sparse clone of S2's `docs/intent`); `claude plugin validate` passes; `claude plugin test ather-automata` 3/3; both manifests at 0.2.6. 6ad1311 after it changes the README only. Not run: Windows, a real S2 checkout, Claude desktop. |

## Slices

| Slice | Scope | State |
| --- | --- | --- |
| S1 | D3: acceptance as a table | done: acbdce9, fbc6269 |
| S2 | D2: gates as people type them | done: c801955, 621853d |
| S3 | D1: the base branch | done: dd10154, f757366 |
| S4 | D4, D5: the pages and the release | done: 833af2f, 6ad1311 |
| S5 | Rev 3: merged with PR 45 and PR 48 on `combine/web-pack-other-repos` | done: 6c3cccb, 082f137 |

## Reconciliations

- rev 2 -> 3 (2026-10-10): merged with the web pack's changes on one branch, after the setup was removed. Still valid: A2, A3 and their evidence; A1 with the key renamed (`baseBranch`): its unit tests and e2e rows run under the new key; A5's gates, run again on the merged branch (below). Redone: A1's base now goes through the branch-name check the web pack uses, so a value that is no branch name falls back to the remote's default; a held label is the pack's own word first, then worded for the checkout's base. Dropped: the `SETUP.md` half of A4 and the setup prompt's link (D6); the README steps no longer name `/ather setup`.
- Evidence on the merged branch (082f137): `CLAUDE_CODE_TYPES=<engine types> S2_ROOT=<S2 intents copy> node dev/test-all.mjs` → exit 0, type-check clean, unit 311/311, repos e2e 292/292, S2 e2e 348/348. Every unit test and e2e row of PR 44 and of PR 48 is there (main 244, 234; PR 48 adds 48 and 39; PR 44 adds 14 and 19; five more unit tests cover where they meet). The Paseo plugin type-checks (`tsc --noEmit`, exit 0).
- 0.2.8 (2026-10-10): the base's second source moved from `git symbolic-ref` to the clone's files (one reader, `packs/index.mjs`), and `forBase` words the hold as the web pack does. A1's unit tests and e2e rows were changed with it: `baseOf` is a plain function, the case "a git that could not say is not taken for main" went with the git call, and the e2e row that counted two `symbolic-ref` runs now expects none. Evidence: the gates of the branch `combine/0.2.8`.
