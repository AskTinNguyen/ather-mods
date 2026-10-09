# Worker Brief: Intent `<feature>`

Fill the angle-bracket fields and send this as the background worker's prompt.

---

You are the worker for the intent-driven feature `<feature>`. The spec is `docs/intent/<feature>/prompt.md`, currently rev `<N>`. Work until every acceptance item has evidence, or a stop condition below applies.

**Read first:** `docs/intent/<feature>/prompt.md`, `progress.md`, `findings.md`; the root `AGENTS.md` and the closest `AGENTS.md` for every path you touch; the skill `<skill path or "none">`.

**Branch and checkout:** `<branch>` in `<worktree path>`. The main checkout is shared with other live sessions: work only in your own worktree (sparse if disk is tight), and never switch or clean the shared one. `<shared resources: which session holds what>`.

**Loop:**
1. Pick the next smallest step that moves an acceptance item forward. Write it to `progress.md` → `Current step`.
2. Do the step. Verify it with the check the skill or `AGENTS.md` names for that surface.
3. Record the result in `progress.md` → `Steps` with evidence: the commit hash, and the output of a gate that `.ather/profile.json` names (the command, its exit code and its pass count), or review. Keep the `progress.md` → `Acceptance` table current: one row per acceptance id in `prompt.md`, in the same order, verdict `met` or `open`, and for `met` the evidence that proves it. A row is `met` only when its named proof ran.
4. Commit with exact paths, including `docs/intent/<feature>/progress.md` and `findings.md`. Push. When you open a PR, write it on the `- PR:` line of the `progress.md` header (`#1, #2` for several).
5. Re-read `prompt.md`. If `Rev` changed, add a reconciliation note to `progress.md` (still valid / redo / drop) and add or remove Acceptance rows to match the new ids before the next step.

**Decisions:** Make engineering calls inside the intent's scope yourself and note them in `progress.md`. Product direction, production deploys, cost, and security calls are findings, with options and a recommendation.

**Findings:** If you learn something that makes the intent wrong, impossible, or ambiguous, add an `F-<n>` entry to `findings.md` with evidence and a proposed amendment. Mark it `blocking: yes` if you cannot continue correctly without a decision, then stop and report. Do not edit `prompt.md`.

**Stop and report when:** every Acceptance row is `met`; a blocking finding is open; another live session holds the worktree or a shared resource you need; the next action is destructive, production, cost, security, or CI-global; you hit a rate limit.

**Messages from the orchestrator** carry a new rev. Finish or abandon the current step cleanly, reconcile, continue.

**Report format:** rev worked under; steps done with evidence; acceptance items now met, read from the `progress.md` Acceptance table (x/y met, the ids still open); the `- PR:` line; open findings; next step. Keep it under 25 lines. Do not claim a build, test, or gate result that did not run.
