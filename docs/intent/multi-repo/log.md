# multi-repo: Log

## 2026-10-08, coordinator with builders

- Baseline 3f371b1. Slices S0 to S6: store keys per repository, the workspace and per-checkout lanes, commands held and proved by their checkout, tracking across checkouts, one pane, issues and PRs across. Each slice built by a Claude Opus builder and reviewed by Codex. Unit 170/170, `dev/e2e/repos.mjs` 73/73.
- A live `claude -p --plugin-dir` run over a parent folder with an Unreal and a web checkout found two issues (the reply did not name `web/login`; the status tool read the session's gates), fixed in 7c47578.
- Not pushed: the account had read access only.

## 2026-10-09, coordinator with builders

- Write access arrived. origin/main had moved to 0.2.0; merged by hand in 4d852cf (nine files). Version 0.2.1.
- S7: main's 0.1.8 to 0.2.0 features over several checkouts. Fixed the desktop row's repository name, a waiting worker's lock read in the wrong checkout, Claude Code's records folder kept for one checkout only, and the Work question's labels.
- PR 19 opened.
- S8 (D11): unique checkout names; a repository's issues once. A live run found `/ather find` listing "login, login, login".
- S9 (D12): proof, changes and Continue per checkout. Review found the unscoped keys read for other checkouts and the unscoped Continue removed when tracking another checkout; both fixed.
- First look at the pane on Claude desktop, in a session over `s2`, `s2-b` and `web`: the repository name was clipped with the title on rows with an owner column; fixed in 7ecea10.
- S10 (D13): one id through a symbolic link; a checkout not on GitHub is quiet among several. The second look on the desktop found the workspace shrinking to one checkout when the plugin started again after the model had run `cd web`: the workspace was read from `session.start`'s `cwd`; it is now read from the session's project root (2095c57).
- Unit 222/222, `dev/e2e/repos.mjs` 163/163, S2 e2e 301/334 on a sparse clone of S2's `docs/intent` with the same 33 failing checks as origin/main.
- Open before merge: a run of `dev/test-all.mjs` on a real S2 checkout on Windows, a look at the pane in a real S2 session, and the director's answers to F-1 to F-3 in findings.md.
