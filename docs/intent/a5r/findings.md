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

## F-5 (2026-10-07, rev 15) | blocking: no | status: resolved (orchestrator)

**Found:** the rev 15 brief says the A5-off section and its refusals still read "hai-flow ·" and "# Hai's flow (hai-flow mod…)". Measured: neither string is in this mod at 39bf284 (only the README history line and test data named hai-flow); they are the strings of the older **hai-flow 0.3.0** mod, which still exists at `C:/Users/hai.huynh/.claude/mods/hai-flow/` (`hooks/register.ts` line 80: the `hai-flow · <gate>` refusal; `a5/rules-flow.md` line 1: "# Hai's flow (hai-flow mod, beside Ather Automata)") and as a per-session copy at `C:/Users/hai.huynh/.claude/dev-mods/55144c82-8fe3-484b-b93c-3ba8104e813a/hai-flow/`. `claude plugin list` here shows `a5@inline` (`D:\Projects\ather-mods\a5`) and Ather, not hai-flow, so a session that shows hai-flow texts loads that copy some other way. Nothing was changed there (outside the worktree).
**Proposed amendment:** none to A48 (its strings are this mod's and are renamed). At release, Hai or the orchestrator removes or stops loading the hai-flow copies, so no session shows both names.
**Resolution:** resolved 2026-10-07 by the orchestrator: no plugin setting loads `~/.claude/mods/hai-flow/` (the 2026-10-06 first build; `CLAUDE_CODE_PLUGIN_DIRS` names only a5, ather-automata, anim-bug-intake), so other sessions never show hai-flow. The copy that loads is this orchestrator session's own hot-reload folder `dev-mods/55144c82…/hai-flow/` (plugin-authoring watch), so only this session shows both names. At release that session copy is removed; the unloaded `~/.claude/mods/hai-flow/` is left for Hai to delete (not loaded, harmless). No change to A48.

## F-6 (2026-10-13) | blocking: no | status: open (director)

**Found:** A82's measurement ("the grant notice appeared up to 13 times in one session", 12× in 58c825ad) counts transcript bookkeeping, not deliveries. MEASURED in `C:/Users/hai.huynh/.claude/projects/E--Projects-s2/58c825ad-5590-4774-ba84-7f76ec307dda.jsonl`: of the lines holding "granted to this session until 20:33", one is the `queue-operation` enqueue, one the delivered prompt (`"origin":{"kind":"plugin","name":"a5r"}`, 2026-10-08T12:48:50Z), and the rest are `"type":"last-prompt"` lines that repeat the last prompt after each later turn. Counting only user prompts and hook context: 58c825ad 4 grants (ends 20:11, 20:33, 11:08, 19:55: four different grants), b4f33d56 6 different grants, 854c41df 4; the disk notice once per session per day. So each notice id reached its session once (`push` dedups by id; `delivered` is kept in the session file).
**Proposed amendment:** none needed: A82 is built and tested as written (one grant → one notice over many calls, turns and minutes; disk once a day; cutoff only to whom it concerns). If the repetition Hai saw was in the app's view, it is the app replaying the last prompt, not A5R; a reading of the transcript should skip `last-prompt` and `queue-operation` lines.
**Resolution:**

## F-7 (2026-10-13) | blocking: no | status: open (director)

**Found:** whether A5R's own hooks see the Bash/git calls of the sync worker it spawned is INFERRED, not measured. MEASURED: its calls to A5R's registered tools got no `tool.call` answer from a5r (four worker transcripts), while the holder's `turn.complete` hook did see the worker end (f41dc683: "sync worker ended without done or abort: I did not run the merge, and I could not record the abort either"). The engine types (`HookFailure` kind `re-entry`: "no hook runs under its own frame"; `next.origin` names the plugin whose frame caused the dispatch) say a plugin's hooks are skipped for every call raised beneath its own `$.agent.spawn`, so the worker's git is most likely neither refused nor checked by A5R (not by the freeze, rule 1 or the A74 fact checks); the four transcripts reached no git write to show it either way. Built so nothing depends on it: the lock is taken and released in code, the end is read at `turn.complete`, and if the calls are seen the worker passes as the frozen holder (same session id; tested). Also noted: `rules/config.json` is the shared rule set with the Hermes kit (`tests/a5r.test.ts` "the same shell and path cases the Hermes kit's tests/test_core.py runs"); the force-push pattern and add-all's `where: shared` changed here, the Hermes kit's own copy (outside this repository) was not touched.
**Proposed amendment:** keep A79's review row ("the next real sync") and read in that sync's worker transcript whether any of its git writes was answered by A5R; if the Hermes kit must keep parity, copy the two `rules/config.json` lines there (Hai's or the orchestrator's call).
**Resolution:**

## F-8 (2026-10-16, rev 30) | blocking: no | status: resolved (orchestrator, rev 30, under A84)

**Found:** A84 covers a lock line A5R did not write; a lock that is **missing or empty** is still the S2 standard's "unknown, not free" (`decide` → wait `missing`, coord.ts), and with A5R on nobody can write it (an edit or redirect of `Saved/EDITOR_OWNER.txt` is refused, the editor tool never takes a missing lock). So a deleted lock file stalls every Editor request until someone with A5R off writes it; the wait text now says "never write it by hand under A5R" and names a finding for Ather's Needs you, which is honest but not a way out. Not measured in a session (no incident seen), INFERRED from the code.
**Proposed amendment:** treat a missing lock like A84's unreadable line: held for 2 h from when it went missing (or at once when the file never existed and no Unreal or build process runs), then the head of the queue writes a FREE line and takes it; or let `editor request` write a FREE line for a missing lock when a fresh probe shows no Unreal or build process. Director's call (it departs from the S2 standard's wording).
**Resolution:** resolved 2026-10-16 by the orchestrator (rev 30, under A84, in line with A73 "never wait"): a missing or empty lock is written by A5R as the standard FREE line (note `lock file was missing; written by A5R, no Unreal process running`) the first time a session's tick or editor request finds it and a fresh probe shows no UnrealEditor/UnrealEditor-Cmd; with an Editor running it stays held by unknown until that process ends, then FREE; nothing killed; one writer (alert claim + read-compare-write). Built in S87.

## F-9 (2026-10-20, rev 33) | blocking: no | status: open

**Found:** the Fable adversary review of 84eddfa (F3): a conflicting `git revert -m 1 <merge sha>` (the A93 build-failed path) or a cherry-pick in the shared checkout leaves `.git/REVERT_HEAD` / `.git/CHERRY_PICK_HEAD`, not `.git/MERGE_HEAD`. S99 accepts both for A97's resolve exemption, as asked. A14's merge guard (`freezeProblem` in register.ts: non-holders' git writes refused while `.git/MERGE_HEAD` exists; `mergeGuardStep` for its notice) and A61's grant hold still key on MERGE_HEAD only, so while a revert waits to be resolved outside a freeze (after an expiry, or a revert run by hand after done) another session could `git add` or commit over the half-resolved index.
**Proposed amendment:** A14 and A61 read "while `.git/MERGE_HEAD`, `.git/REVERT_HEAD` or `.git/CHERRY_PICK_HEAD` exists in the shared checkout" (gitshared.ts `CONFLICT_HEADS` already names the three); the Merge guard notice names which one. Not built in rev 33 (the coordinator: do not widen A14 in this change).
**Resolution:**
