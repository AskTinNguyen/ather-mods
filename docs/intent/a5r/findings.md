# A5R (Agent 5 Rules; formerly hai-flow A5): Findings

Discoveries that may change the intent. The worker adds entries; the orchestrator resolves them.

<!--
## F-<n> (<YYYY-MM-DD>, rev <r>) | blocking: yes | no | status: open | accepted | rejected

**Found:** <what, with evidence>
**Proposed amendment:** <the change to prompt.md>
**Resolution:** <decision and resulting rev, filled by the orchestrator>
-->

## F-1 (2026-10-06, rev 1) | blocking: no | status: accepted (director)

**Found:** two numbers and one rhythm are Hai's to set, not engineering: (a) when a sync happens — planned per sync (`/a5 sync HH:MM`) or fixed daily windows (the paused runbook had 09:00/15:00 checkpoints and 12:00/18:00 trains; Hai turned periodic procedures off on 30/09 and planned today's 16:00 sync himself); (b) the Editor launch gate — free RAM needed before a session may launch the Editor (measured on this machine: Editor idle ≈ 25.7 GB on L_TALab, PIE peak ≈ 31.4 GB); Hai's own PIE gate (5 GB start, 3 GB abort) is fixed and not in question.
**Proposed amendment:** keep D4 (planned syncs, fixed windows optional) and D5 (launch at ≥ 31 GB free with PIE, ≥ 28 GB without, after cleanup) unless Hai picks otherwise.
**Resolution:** decided by Hai (L-3): (a) planning a sync is a control on the A5 panel, no fixed windows by default; (b) the launch gate is adjustable on the panel and in options, defaults 31/28 GB. Folded into D4, D5 and A2 at rev 2.

## F-2 (2026-10-06, rev 2) | blocking: no | status: rejected

**Found:** the Sources line lists, from `runbook-sync-lane.md` (C++ trains rule 2), "`Source/` and `Plugins/` frozen from the cutoff", but A5's acceptance names only the cutoff notice and the freeze from T. Built (S5): the cutoff notice tells every session to keep `Source/` and `Plugins/` edits out of the shared tree from the cutoff; nothing refuses such an edit before T. The runbook's reason is a build compiling whatever is on disk; a planned sync under D4 is a merge that may or may not build.
**Proposed amendment:** none needed if the notice is enough (recommended: D4 syncs are not C++ trains). Alternative: add to A5 "from the cutoff, an Edit/Write under `Source/` or `Plugins/` of the shared checkout asks Hai (A5 D1 ask), the sync holder excepted".
**Resolution:** rejected by Hai (L-4): the cutoff notice is enough; a planned sync is not always a C++ train. No change.

## F-3 (2026-10-06, rev 2) | blocking: no | status: accepted

**Found:** two dry-run details the intent leaves open. (a) The cutoff dry-run (`git merge-tree --write-tree --name-only HEAD origin/main`) runs against the last fetched `origin/main`; hai-flow does not fetch (a fetch at cutoff would touch the network and the LFS endpoint without the holder). (b) The runbook's cutoff also intersects the files main adds with the tree's untracked files ("untracked would be overwritten", invisible to merge-tree); not built.
**Proposed amendment:** (a) keep: the holder fetches when it runs s2-sync-main, and the holder's notice says so if Hai wants that wording; or add "the holder's hai-flow runs `git fetch origin main` (no LFS, 60 s, GIT_TERMINAL_PROMPT=0) before the dry-run". (b) add to A5 if wanted: "untracked files that main adds are listed to their owners at the cutoff". Recommendation: keep (a) as is, defer (b) to a later rev.
**Resolution:** decided by Hai (L-4): (a) kept as built (hai-flow never fetches; the holder fetches when it runs s2-sync-main); (b) accepted as A11 at rev 3.

## F-4 (2026-10-07, rev 12) | blocking: no | status: fixed (S50)

**Found:** while building A41, the live a5 0.11.0 twice refused one of this worker's shell commands as a PR opening: each command only wrote a file (a here-document, then a `node -e` string) whose text quoted a gh PR-API example with `-f head=`; `isPrCommand` matched that text anywhere in the command, and the session's own checkout was scored (rules 2–5 listed for intent hai-flow-a5).
**Proposed amendment:** none: within A41's scope (acceptance must score the PR, and only a PR).
**Resolution:** fixed in S50: `isPrCommand` reads the command without here-document bodies (`accept.commandText`) and needs `gh` at a command position (line start, after `&&`, `||`, `;`, `|`, `(`), so text inside a here-document or a quoted string is not a PR; tests in `tests/pr-branch.test.ts`. The worker wrote those files with the Edit tool instead; no PR was opened. Until 0.11.1 is live, a shell command whose own text quotes a gh PR call is refused this way.
