---
name: gates
description: Run the checks a change to ather-mods needs, and write down what ran. Use before you commit or hand over a change, when someone asks whether the gates are green, or when a check fails and you need to know if main fails it too. Says which installs and env vars each check needs, which checks were skipped and why, and gives the lines for progress.md and the PR.
argument-hint: "[base ref, default origin/main]"
---

# Gates

Run what the change needs, on the base and on the branch, and say exactly what ran. A skipped check is not a pass.

## 1. See what changed

```bash
git fetch origin main
git diff --name-only origin/main...HEAD
git status --short
```

## 2. Bring the copies along first

`node dev/test-all.mjs` checks the copies before anything else and stops at the first one out of step. Sync before you run it:

| You changed | Run |
| --- | --- |
| `ather-automata/hooks/**` | `node dev/sync-shared.mjs ather-board` and `node dev/sync-shared.mjs ather-lanes`, then `npm run sync` in `paseo/ather-automata` (and `npm run art` there if `squad.mjs` kinds or props changed) |
| `week-calendar/scripts/**` | `npm run embed` in `paseo/week-calendar` |
| `.agents/skills/**` | `node dev/skills.mjs` |

Never edit a copy by hand: `ather-board/hooks/ather/`, `ather-lanes/hooks/ather/`, `paseo/ather-automata/server/ather/`, `*.generated.ts`, the copied folders in `.claude/skills/`. The shared-change skill covers what else a shared change needs.

## 3. Pick the checks

| Check | Run it when | It needs |
| --- | --- | --- |
| `node dev/test-all.mjs` | any code change | Node 22.15 or later (CI uses 24 and 22) and a short temp folder (step 5) |
| the same with `S2_ROOT=<your S2 checkout>` | the change shows in an S2 session: hooks, the unreal pack, the pane | an S2 checkout. `HANVIET_ROOT=<a han-viet checkout>` adds the web pane |
| its type-check | any `.mjs` under `ather-automata/hooks` or `ather-board/hooks` | the engine's types. Set `CLAUDE_CODE_TYPES` to a `claude-code.d.ts`, or load the mod once in Claude Code: it writes `ather-automata/.claude-plugin/types/claude-code/index.d.ts`, and test-all finds that by itself. The plugin-authoring skill documents the API those types describe |
| its Paseo type-check and Paseo e2e | anything under `paseo/`, or any shared hooks module | `npm ci` once in `paseo/ather-automata` and in `paseo/week-calendar`. test-all then runs both |
| `node --test week-calendar/scripts/test/*.test.mjs` | anything under `week-calendar/` | nothing more. test-all does not run these |
| `claude plugin validate --strict <mod>` and `claude plugin test <mod>` | a change inside that mod | Claude Code. No login needed |
| `claude plugin validate --strict .` | `.claude-plugin/marketplace.json` changed | Claude Code |
| `node dev/check-release.mjs` and `node dev/check-size.mjs` | before you push | `git fetch origin main` first. CI runs both on every PR |

## 4. When something fails, run the base too

test-all stops at the first stage that fails, so the stages after it did not run. Say so. `node dev/test-all.mjs --only <stage>` runs one stage (copies, paseo, type-check, unit, repos, board, lanes or s2), to get past a known failure or to re-run the one you fixed. Before you blame your change, run the same stages on the base, in a worktree you remove afterwards:

```bash
git worktree add --detach ../ather-base origin/main
cd ../ather-base
# Only if your branch's run had the Paseo stages: give the base the same installs.
(cd paseo/ather-automata && npm ci) && (cd paseo/week-calendar && npm ci)
node dev/test-all.mjs
cd - && git worktree remove --force ../ather-base
```

- Compare only the stages that ran on both sides. A stage skipped on one side is "not compared", not "same".
- Compare the FAIL lines by name. A FAIL on both is main's. A FAIL only on your branch is yours to fix.
- If `../ather-base` is left from an earlier run, `git worktree remove --force ../ather-base` first.
- To see whether main is red in CI already: `gh run list --workflow ci --branch main --limit 1`.

## 5. Your machine

- **A short temp folder.** The e2e names checkouts by their path. A temp folder near 100 characters long gave 13 false failures in the repos e2e. On Windows, an 8.3 short name such as `C:/Users/HAI~1.HUY/...` gives false failures too. Point `TEMP`, `TMP` and `TMPDIR` at a short folder, written out in full.
- **Windows.** Run `git config --global core.longpaths true` once.
- **Clean up.** The runs leave `ather-*` and `wc-*` folders in the temp folder. Delete old ones now and then; one PC filled 35 GB.
- **No S2 checkout?** Leave `S2_ROOT` unset. The S2 run is skipped and test-all says so. Say it in your report too.

## 6. Write it down

In the PR's **Gates** section, and as a step in the intent's `progress.md` when the work is an intent. The numbers below are an example; write your own:

| Gate | Base (origin/main `<sha>`) | After (`<sha>`) |
| --- | --- | --- |
| unit | 397/397 | 398/398 |
| board unit | 73/73 | 73/73 |
| repos e2e | 328/329 | 328/329 |
| board e2e | 18/18 | 18/18 |
| S2 e2e | skipped: no S2_ROOT | skipped: no S2_ROOT |
| type-check | skipped: no engine types | skipped: no engine types |
| Paseo type-check, Paseo e2e | ... | ... |
| `claude plugin validate --strict` / `test` | ... | ... |

Under the table:
- **Skipped:** each skipped check and why.
- **Same as main:** each FAIL line that fails on the base too, by name.
- **New:** none. If there is one, the change is not ready.
