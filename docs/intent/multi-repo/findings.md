# multi-repo: Findings

Discoveries that may change the intent. The worker adds entries; the orchestrator resolves them.

<!--
## F-<n> (<YYYY-MM-DD>, rev <r>) | blocking: yes | no | status: open | accepted | rejected

**Found:** <what, with evidence>
**Proposed amendment:** <the change to prompt.md>
**Resolution:** <decision and resulting rev, filled by the orchestrator>
-->

## F-1 (2026-10-09, rev 5) | blocking: yes | status: accepted

**Found:** D12 keeps an intent's proof, a session's proof in another checkout, today's changes and "Continue …" per checkout (`<owner/repo>@<folder>`). On main they are kept per machine (`evidence:<slug>`, `changes:<slug>`, `last:<person>`), so two sessions in two worktrees or clones of one repository that track the same intent share them. With D12 they no longer do, and that also holds for a person with one repository and several worktrees, which goes beyond "one checkout, no change" (D10). It was asked for after a live run over a parent folder with two clones of one repository: tracking `s2-b/login` made Home offer `s2/login`, and a test run in one clone proved the other clone's intent (and, in a with-proof repository, would have allowed its merge). What was kept before 0.2.1 still reads through once, for the session's own checkout.

**Options:**
- A (recommended): keep D12 as built, per checkout. Proof says something about one working tree, and a with-proof merge in one clone should not pass on another clone's tests.
- B: per repository, as on main. Every checkout of a repository shares an intent's proof, changes and "Continue …"; only different repositories are kept apart (the branch as it was at cba5db7).
- C: proof and changes per checkout, "Continue …" per repository.

**Proposed amendment:** none for A. For B or C, D12 is rewritten and slice S9 (a4f6a0d, cd1ccfb) changes with it.
**Resolution:** A, decided by the owner (Hoàng Vũ) on 2026-10-10 in the pane; the same answer was given in issue 23 on 2026-10-09. D12 stays as built: an intent's proof, a session's proof in another checkout, today's changes and "Continue …" are kept per checkout. No amendment; recorded as D18 in rev 10.

## F-2 (2026-10-09, rev 5) | blocking: no | status: accepted

**Found:** D11 names a checkout in the pane by the last part of its repository's id (`han-viet`), and only when two checkouts of the workspace would share that name by their folders' names (`s2`, `s2-b`), numbered if those clash too. Names hold only letters, digits, `_`, `.` and `-`, and do not change during a session. They make every key outside the session's own checkout (`web/login`, `web#7`) and the dim cell after a row's title. A repository's assigned issues are listed once however many of its checkouts the workspace has.

**Options:**
- A (recommended): keep D11 as built. The usual case reads as the repository's name, and only a clash falls back to folders.
- B: always the folder's name. One rule, but a checkout in a folder named `work` or `main` reads worse than its repository's name.
- C: always `owner/repo`. Never ambiguous between owners, but long in a narrow pane, and two clones of one repository still need folders.

**Proposed amendment:** none for A. For B or C, D11 and `workspace.checkoutNames` change.
**Resolution:** A, decided by the owner (Hoàng Vũ) on 2026-10-10 in the pane; the same answer was given in issue 23 on 2026-10-09. D11 stays as built: a checkout is named by its repository's short name, and by its folder only when two would share it (D14 adds how a clone's worktrees are named). No amendment; recorded as D18 in rev 10.

## F-3 (2026-10-09, rev 5) | blocking: no | status: accepted

**Found:** D13 treats a checkout whose remotes are not on GitHub differently by workspace size. Among several checkouts it has no GitHub issues: no failure, no retry, and Refresh says how many issues the others have. With one checkout nothing changes from main: Refresh says "could not read your GitHub issues: none of the git remotes … point to a known GitHub host", and the read is retried three times. The split keeps D10 (one checkout, no change), at the cost of two behaviours for one condition.

**Options:**
- A (recommended): keep D13 as built: quiet among several, as on main for one.
- B: quiet everywhere. A repository that is not on GitHub never reports a failure or retries, also with one checkout. Simpler, but it changes main's words for a session in such a repository.

**Proposed amendment:** none for A. For B, D13 drops its last sentence about one checkout and `refreshIssues` loses the `isSeveral` condition for this case.
**Resolution:** A, decided by the owner (Hoàng Vũ) on 2026-10-10 in the pane; the same answer was given in issue 23 on 2026-10-09. D13 stays as built: a checkout that is not on GitHub is quiet among several, and reports the failure as on main with one. No amendment; recorded as D18 in rev 10.
