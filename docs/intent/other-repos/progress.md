# Ather Automata: repositories that are not S2: Progress

- Working under rev: 2
- Worker: Claude Opus 5.5 builders, one per slice; Codex gpt-6.1-sol reviews each slice; the coordinator commits
- Current step: none; every slice is built and reviewed
- Next step: the owner reads PR 44 and merges it; then set Status: completed
- PR: #44

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
