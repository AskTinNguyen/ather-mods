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

## 2026-10-09, merging main again

- origin/main had moved to 0.2.2 (0.2.1: every question through `$.ui.ask`; 0.2.2: `/ather setup`). Merged by hand in 6217aef (eight files: the two manifests, the README, `console.mjs`, `state.mjs` and its Paseo copy, `watch.mjs`, the stand-in engine). Version 0.2.3; the comments on the unscoped keys say "before 0.2.3".
- What the join needed: setting up is detected in the session's own lane only, around the per-checkout read, and a reading of the same root kept by `laneAt` is dropped with it. `/ather` asks the setup question only when no workspace checkout has intents; `/ather setup` works on the session's own root. The console's work begins again after a setup only where it was skipped at the start: where another checkout's intents had begun it, a second start would have doubled its timers.
- The questions this branch added (the Work question by key, a decision on another checkout's intent) go through main's `ask` as they are: their labels differ.
- Unit 249/249, `dev/e2e/repos.mjs` 168/168 (five new rows: a workspace where only the other checkout has intents, and a parent folder with none), S2 e2e 319/352 on the sparse clone with the same 33 failing checks as before the merge. `claude plugin test ather-automata` 3/3.
- main moved once more, to 5982f9f (a session that tracks an intent is offered that intent's decisions only; every Paseo screen names its agent). Merged in 16abf65 without a conflict, with one change: main's filter compared the tracked intent's slug, and here the tracked intent is named by its key, so the filter compares keys. By slug, a session tracking `web/login` was offered no decision at all, and one tracking its own `login` was offered web's too. Paseo's screen is as main has it. Unit 251/251 (main's test as written, and one for the same slug in two checkouts), repos e2e 168/168, `claude plugin test ather-automata` 3/3. S2 e2e 301/352 on the sparse clone: the 33 from before and 18 more, the same 51 as main at 5982f9f on the same clone. The 18 are the decisions section of `dev/e2e/run.mjs`, which tracks `zz-decide` and still expects the decisions of `zz-group` beside it; main changed the rule without that script.
- `dev/e2e/run.mjs` follows the rule now (7b314a0); the hooks are as they were. Its decisions section runs the rows about two intents with nothing tracked, `zz-decide` first because its files are the newer, and has two new rows for the rule: tracking `zz-decide` offers its decision and not `zz-group`'s, and `/ather untrack` offers `zz-group`'s again. The other two of the 18 expected the same thing elsewhere: the merge-loss row now gives the tracked intent a decision of its own, and the untrack row compares what waits after untracking with what waited before tracking. S2 e2e 321/354 on the sparse clone: the 18 pass, and the 33 failing checks are the ones from before the merge.
- main moved a third time, to 108ad08, and took 0.2.3 for its own fix: a session's title read through Windows PowerShell keeps its emoji and dashes (`selectStringPs` in `transcripts.mjs`). Merged in 542b7c9 with one conflict, in the changelog. This release is 0.2.4: both manifests, the changelog entry (on top, above main's 0.2.3), and the comments on the unscoped keys, which say "before 0.2.4". main's search and its test are as main has them; nothing here builds a PowerShell search another way. Unit 252/252, `dev/e2e/repos.mjs` 168/168, S2 e2e 321/354 on the sparse clone with the same 33 failing checks, `claude plugin test ather-automata` 3/3.

## 2026-10-09, a clone's worktrees (S11)

- Asked for by the owner: a repository's worktrees should be traced without naming each. Claude keeps them in `<repo>/.claude/worktrees/<name>`, which neither the `repos` setting nor a parent-folder session reaches. D14 (Rev 6): git is asked (`git worktree list --porcelain`) in every D2 checkout; per clone one fetch, main's intents once, each other worktree only what its own copy wins.
- Built by a Claude Opus 5.5 builder in 52a22b1, reviewed by Codex (gpt-6.1-sol): two Major, both fixed in 9ebc8c1 and verified by the same reviewer.
- The first live run found what the stand-in engine could not: at session start the app rejects the first `git worktree list` runs ("$.process.run(git) aborted", four in a row), and the empty answer was kept for the session. 0ce0454: git "could not say" is null, such a read is not kept, and the console asks again; the stand-in engine can now reject a run by its argv.
- Seen live on the base commit too, so not from this slice: the first `git fetch` after the pane is drawn is rejected the same way ("git fetch failed: … aborted") and the sync line waits for the next due time or ↻.
- Open: a session opened in a worktree names itself by the repository and the main checkout `<name>-2` when that has rows of its own; the workspace is read once per session, so a worktree made during it is seen by the next one.

## 2026-10-09, the traced folders from the pane (S12) and the first fetch (S13)

- S12, asked for by the owner: a place in the pane to set the folders to trace, kept for the PC. D15 (Rev 7): one machine key in the store, read after the `repos` setting's folders; a Repositories view opened from Home (first built at the foot of Everything open, moved on the owner's word), `/ather repos`, `add` and `remove`; a change applies in the session that made it at once. Built in 5770422, 7f73bce and 0b12f56; Codex found that Remove matched a folder's spelling only.
- S13, found by the live runs of S11 and S12 and present on the branch before them: the pane's first draw starts the first fetch, Claude Code stops what an abandoned draw started, and the rejection was kept as a failed sync for ten minutes. Read from the plugin-authoring reference ("Work that outlives a dispatch") and tried live: a timer started inside the draw is rejected too; a pressed sync and the console's own timers are not. D16 (Rev 8), fd735af: such a fetch is no try, and the console's five-second timer asks for what is due while the pane is drawn.
- Unit 265/265, `dev/e2e/repos.mjs` 225/225, S2 e2e 317/354 on a sparse clone with the same 37 failing checks as the branch before these slices.
- Open: the first `git config user.name` and `git worktree list` of a session are rejected the same way and are asked again (the pane treats nobody as you for a moment); typing into a pane field could not be tried in tmux; a real S2 checkout, Windows and Claude desktop were not run.

## 2026-10-10, merging main a fourth time

- main moved to 76a24e7 and took 0.2.4 for its own change: `/ather setup` hands the session `templates/intent-setup/SETUP.md` and, for the skill or the readme, the public repository AskTinNguyen/intent, instead of a zip (it also brought week-calendar 0.4.0). Merged in cc5ac8a with five conflicts: `setup.mjs`, `console.mjs`, the setup tests, the README and Paseo's copy of `setup.mjs`.
- The join: main's prompt with this branch's repository folder named first, so `setupPrompt` takes `root` and `steps`. The row of `dev/e2e/repos.mjs` for `/ather setup` in a workspace looked for the zip's name in the prompt; it looks for `SETUP.md` now.
- This release is 0.2.5: both manifests, the changelog entry (on top, above main's 0.2.4), and the comments on the unscoped keys, which say "before 0.2.5".
- The type-check of `dev/test-all.mjs` had never passed with the engine's types written on a Mac: `hooks/watch.mjs` registers its shell hook for the tool `PowerShell`, which those types do not list (TS2322, then TS2589). The hook is typed as Bash, whose `command` it shares; the matcher's value is unchanged (bcc3b10).
- With `CLAUDE_CODE_TYPES` set: type-check clean (the mod's hooks, and `paseo/ather-automata` after `npm ci`), unit 254/254, `dev/e2e/repos.mjs` 168/168, S2 e2e 317/354 on a fresh sparse clone of S2's `docs/intent`, the same 37 failing checks as the branch before the merge (bc47469) on that clone. `claude plugin validate ather-automata` passed, `claude plugin test ather-automata` 3/3.
- The worktree and traced-folder slices (S11 to S13) took the same merge in a3ddb9d, with three conflicts in text (the changelog, this log, the progress table). On that tree, with `CLAUDE_CODE_TYPES` set: type-check clean, unit 266/266, `dev/e2e/repos.mjs` 225/225, S2 e2e 317/354 with the same 37 failing checks, `claude plugin validate ather-automata` passed, `claude plugin test ather-automata` 3/3.

## 2026-10-10, the whole S2 e2e on macOS

- On this Mac the S2 e2e stood at 317/354 on the branch (300/352 on main), on a sparse clone of S2's `docs/intent`. Thirty of the 37 were one fault in the hooks: `readTeam` compared the session's folder with git's toplevel as text, git names the real folder, and macOS's temporary folder is behind a link, so the e2e's real checkout was taken for no checkout (no origin/main, no fetch). Fixed in c00813f by also comparing where the folder really lands; a session opened through a linked folder has the same fault. An interactive terminal session is not hit: there the app hands the hooks the real folder already.
- The other seven followed the S2 checkout's load, not the code (9747bb1): Needs you's count read as one digit from "1 2"; the checkout's own nine decisions pushing the decisions block's rule item past the nine rows drawn; an issue looked for among Home's five rows and the Work question's four.
- After both: unit 268/268, `dev/e2e/repos.mjs` 225/225, S2 e2e 354/354, type-check clean, both Paseo plugins type-check, `claude plugin validate` and `claude plugin test` pass.
- Noted, not changed: Needs you draws nine rows; with more waiting, the rest (a rule to make, later decisions) are not drawn and nothing says so beyond the count.

