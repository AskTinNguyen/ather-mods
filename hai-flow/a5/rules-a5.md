## ★ A5 is ON: five rules on top of Ather's intent flow ([H] = the hook enforces it; conflicts: D5 > D1 > D3 > D2 > D4)
The intent skill and Ather's loop (Plan, Build, Prove, Ship; findings; away window) come first; A5 adds checks to them and never replaces a step.
- D1 Yêu Tổ quốc (protect shared state) [H] In the shared checkout, git that discards work (reset --hard, clean -f, checkout/restore/stash that drop changes) or moves the tree (switch, checkout <branch>), and edits to repository config (*.uproject, *.Build.cs, *.Target.cs, Config/*.ini, root .gitignore/.gitattributes/AGENTS.md/CLAUDE.md) need Hai's approval in a dialog; inside a worktree of your own (`git -C <worktree> …`) they are yours. Everywhere: force push, push to main, `git add .`, recursive deletes outside temp folders and settings.json need approval. `--no-verify`, `GIT_LFS_SKIP_SMUDGE=1`, `git sparse-checkout set` in the shared checkout, and edits to the hai-flow mod are refused (Hai turns A5 off to let the mod be edited). A worker (subagent) is never asked: the call is refused, and the worker leaves it undone, stops and reports it (the intent skill's stop-and-report on a destructive action).
- D2 Học tập tốt (read first, prove after) [P] Read the target and one call site before editing. [H] Proof is Ather's: with an intent tracked, `Verified:` names only the rungs Ather has read pass (build, tests, read-back, PIE, Editor check) and says `chưa: <what is still needed>` until the role's proof is complete. With no intent, run a build/test or start PIE after the last edit and read its result, or write `chưa: <why>` (docs-only changes need none). [H] New TODO/FIXME goes under `Open:`.
- D3 Kỷ luật tốt (stay in scope) [H] With a scope file (`a5/scope` in the mod), edits outside it need approval. [P] Unrelated issues go under `Open:`, unfixed.
- D4 Vệ sinh (clean up) [H] Tag temporary debug lines `A5TMP`; leftovers block finishing. Secrets in edits are refused.
- D5 Thật thà (be honest) [H] An Unreal build counts only by its own `Result:` line (Build.bat exits 0 on failure; never pipe it to tail). A failed check this turn, or a failed rung in Ather's proof, means `Verified:` says FAILED. Removing test assertions needs approval. [P] Label claims MEASURED / INFERRED / WITHDRAWN.

Report, required when this loop changed files in a git project (intent files under docs/intent/ excepted; the hook keeps the turn going until it is right; labels in English, content may be Vietnamese):
```
Changed: <every edited file>
Verified: <what Ather or the tool output showed pass> | FAILED: <what> | chưa: <what is still needed>
Risk: <what can break, who>
Open: <remaining work, TODOs, unrelated issues>
```
