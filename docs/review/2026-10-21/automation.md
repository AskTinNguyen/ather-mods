## Skills and scheduled runners

### Summary

- **Skills.** Four repo skills are drafted in full: `gates`, `pr`, `shared-change` and `release`. All four can be invoked by the model, because none of them pushes or merges. The `intent` skill is copied in from its upstream, not written again. The source of truth is `.agents/skills/`. `node dev/skills.mjs` copies every skill into `.claude/skills/` as real files, and CI fails while a copy differs. The script deletes only stale copies; a contributor's own untracked skill there is left alone.
- **GitHub Actions.** Four workflows:
  - `ci.yml` checks the copies, runs the gates on Linux and Windows, runs the Paseo checks, and runs `claude plugin validate`/`test`. The Windows legs report but do not fail the run until main is green there.
  - `pr-rules.yml` runs the release guard, the size ratchet, and the thermo-nuclear verdict check (a verdict of `block` fails).
  - `weekly.yml` runs the mods on the newest Claude Code, posts a health issue, and has an opt-in engine type-check.
  - `thermo-review.yml` is opt-in: Claude reviews a PR that carries a label.
- **Scripts behind the workflows:** `dev/check-release.mjs`, `dev/check-size.mjs`, `dev/skills.mjs`.
- **Routines.** Three cloud routines take the work that needs judgement. The owner creates them.
- **Three decisions for the owner** (listed below): whether the board releases whenever its copies move, when the size ratchet blocks, and whether a version-only release needs no review. Until the owner decides each one, the drafts only warn.

Every script and workflow step was run against a scratch clone of `999a2ba`. The guards were also replayed over the last 11 merges (results below). Nothing in the repository was changed.

### Changed after the drafts' own thermo-nuclear review

The first review of these drafts blocked on five critical findings (README, "Thermo-nuclear review of this branch's drafts"). What the files on this branch do now:

- The verdict check is `dev/check-verdict.mjs`, with a test (`dev/check-verdict.test.mjs`). It reads exactly one line, `Verdict: pass`, `Verdict: approve` or `Verdict: block`. The "Round N" and "No critical findings" fallbacks are gone, so PR bodies from before this change no longer pass it. The version-only exemption reads the version files from `dev/branch.mjs`.
- `dev/branch.mjs` holds what the three checks share: git, the base, the changed files, the release units, which files a mod ships, and one way to report. check-release and check-size now agree on what is shipped: `paseo/ather-automata/server/sync.mjs` and `server/art/render.mjs` are dev-only for both.
- `dev/typecheck.mjs` is the one type-check; test-all and `weekly.yml` both run it.
- test-all has stages and `--only <stage>`. The `copies` stage now includes `dev/skills.mjs --check`, so the separate `copies` job is gone. The `paseo` job runs `node dev/test-all.mjs --only paseo`. The unit stage also runs `dev/*.test.mjs`.
- `dev/mirror.mjs` is the one copy mechanism behind `ather-board/sync.mjs`, `paseo/ather-automata/server/sync.mjs` and `dev/skills.mjs`.
- The pinned Claude Code version is in `.github/claude-code-version`, and both workflows read it. The mod list comes from the marketplace. `claude-code-action` is pinned to a commit. The release and size jobs skip description-only edits.

Line references to `dev/test-all.mjs` below are from before this change.

### Facts checked before drafting

| Fact the drafts rely on | Evidence |
| --- | --- |
| Local CLI is Claude Code 2.1.296. On npm, `@anthropic-ai/claude-code` has `stable` = 2.1.304 and `latest` = 2.1.306. | `claude --version`; `npm view @anthropic-ai/claude-code dist-tags` |
| The npm package installs a native binary through per-platform optional dependencies (linux-x64, win32-x64 and others) plus a `postinstall`. It needs Node >= 22. | `npm view @anthropic-ai/claude-code@2.1.304 optionalDependencies scripts engines` |
| `claude plugin validate --strict` passes for `.` and all three mods. `claude plugin test` passes 8/8, 12/12 and 4/4, about 1 s each. Both ran with an empty `CLAUDE_CONFIG_DIR` and no API key, so CI needs no login. | Scratch runs on a `git archive` copy of HEAD |
| `validate`, `test` and `init` do not write the engine types, so the type-check (`dev/test-all.mjs:55-64`) stays skipped in CI unless a session writes them. | Checked `.claude-plugin/` and `TMPDIR` after each run; `.gitignore:1-2` says the engine writes them "when a mod loads" |
| `claude plugin tag --dry-run <mod>` refuses uncommitted version files ("Uncommitted changes affecting this release — commit them first … (or use --force)"). After the commit it passes and creates nothing. | Scratch: bumped ather-board to 0.3.1, ran it before and after `git commit`, then checked `git tag` |
| Claude Code loads project skills only from `.claude/skills/<name>/SKILL.md`. It follows a symlinked skill folder and does not mention `.agents/skills`. A personal skill wins over a project skill of the same name. Frontmatter includes `name`, `description`, `disable-model-invocation`, `argument-hint`, `allowed-tools`, `paths`. A skill with `disable-model-invocation: true` cannot be invoked by the model. | https://code.claude.com/docs/en/skills ("Enterprise over personal, and personal over project") |
| Codex scans `.agents/skills` in every folder from the launch folder up to the repo root, follows symlinks, and requires `name` and `description`. | https://developers.openai.com/codex/skills (redirects to learn.chatgpt.com/docs/build-skills) |
| Cursor reads `.agents/skills/` and `.cursor/skills/`, and also `.claude/skills/` for compatibility. | https://cursor.com/docs/skills |
| Git's `core.symlinks` default is true, "except git-clone(1) or git-init(1) will probe and set core.symlinks false if appropriate". When it is false, a symlink is checked out as a small file holding the link text. | `git help config` (git 2.54) |
| `~/.claude/skills/thermo-nuclear-code-quality-review` on the owner's machine links to `~/.agents/skills/thermo-nuclear-code-quality-review`, a folder of about 95 machine-wide skills, not to this checkout. Its `SKILL.md` is byte-identical to the repo's today. `SOURCE.md:5` wrongly says it "points at this file in the current checkout". | `readlink`; `ls ~/.agents/skills \| wc -l` → 95; `cmp` |
| Current action majors: `actions/checkout@v7` (v7.0.1), `actions/setup-node@v7` (v7.0.0; has `package-manager-cache` and `cache-dependency-path`), `actions/upload-artifact@v7`, `anthropics/claude-code-action@v1` (v1.0.256). The `@v4` majors in the task are three majors old. | `gh api repos/<action>/releases`; `action.yml` at each major |
| claude-code-action inputs include `prompt`, `claude_args`, `anthropic_api_key`, `claude_code_oauth_token` and `github_token`. Its PR-review example needs `contents: read`, `pull-requests: write` and `id-token: write`. | The action's `action.yml`, `docs/solutions.md`, `docs/faq.md` |
| Cloud scheduled tasks (formerly routines) are a research preview on Pro, Max, Team and Enterprise. They are created at claude.ai/code/routines or with `/schedule`. The minimum interval is 1 hour, and each task belongs to one account. A run acts as that user on GitHub, clones the repo, pushes to `claude/` branches and uses the skills committed to the repo. | https://code.claude.com/docs/en/routines |
| Desktop scheduled tasks run locally, only while the app is open and the computer is awake. Missed runs get one catch-up run on wake. | https://code.claude.com/docs/en/desktop-scheduled-tasks |
| `module.registerHooks`, which the Paseo e2e uses (`paseo/ather-automata/server/test-resolve.mjs:3`), was added in Node v23.5.0 and v22.15.0. | https://nodejs.org/api/module.html |
| With a real `npm ci`, the `paseo/ather-automata` type-check fails today: `server/needs.ts(57,51): error TS2345 ... Property 'sentTo' is missing`. `paseo/week-calendar` passes. | Scratch `npm ci && npm run typecheck` |
| The Paseo e2e passes 9/9 with node_modules in place, but only after `ather-automata/hooks` is copied to `dev/e2e/out/hooks` (`dev/e2e/screen.mjs:5` imports `./out/hooks/rows.mjs`), as `dev/test-all.mjs:84-86` does. | Scratch run |
| With an empty global git config and HOME, unit tests pass 397/397, board unit 73/73, week-calendar 25/25 and board e2e 18/18. The repos e2e gave 315/329 with a ~104-character TMPDIR (13 store-key FAILs plus the race), against 328/329 in the baseline. So CI must use a short temp folder. | Scratch `node dev/test-all.mjs`; `scratchpad/baseline-test.log` |
| There is no `.github/`. `main` is not protected. The repo is public and user-owned (`AskTinNguyen`). Only GitHub's default labels exist. | `ls -la`; `gh api .../branches/main --jq .protected` → false; `gh repo view`; `gh label list` |
| The upstream intent skill exists: `AskTinNguyen/intent` `skills/intent/` at `72edeb9d3ed6`. It is missing from this repo, yet the brief gate's deny text and other prompts point at it. | `gh api repos/AskTinNguyen/intent/git/trees/main?recursive=1`; `ather-automata/hooks/watch.mjs:191`, `home.mjs:47`, `issues.mjs:111`, `packs/web.mjs:584,587,598`, `packs/unreal.mjs:254-255` |

### A) Repo skills

#### Where they live

- **One source: `.agents/skills/<name>/`.** Codex and Cursor read it natively. AGENTS.md is addressed to "every agent" (`AGENTS.md:3`). The vendored review skill already lives there, and the mod's own prompts name `.agents/skills/intent/...`.
- **Claude Code gets a copy in `.claude/skills/<name>/`, written by `node dev/skills.mjs`.**
  - The copies are real files, byte-equal, with CRLF folded to LF.
  - A file in `.claude/skills/` is removed only when it is a stale copy: it sits in a folder that `.agents/skills` also has, or git tracks it. Any other folder, such as a contributor's own untracked skill, is left alone and named. This was tested: `my-local/SKILL.md` survived, while a stray file in a copied folder and a tracked folder with no source were both removed.
  - `--check` fails on any differing copy and on any stale copy. CI runs it in the `copies` job.
- **Why not symlinks.** Claude Code and Codex both follow symlinked skill folders. But a Windows clone without symlink rights sets `core.symlinks=false`, and each symlink is then written as a one-line text file. On those agent PCs Claude Code would silently see no skill.
- **Cost of copies.** Cursor also reads `.claude/skills/`, so in Cursor each skill appears in two places with identical content. I did not verify how Cursor treats two skills with the same name.
- **The owner's personal copy.** `~/.claude/skills/thermo-nuclear-code-quality-review` points into a machine-wide library of about 95 skills, so deleting it would remove the command in every other repo. Keep it. A personal skill beats the project copy, so keep it in step with the vendored file by hand. The drafted `SOURCE.md` corrects line 5 and says this.

#### The skills

| Skill | Purpose (one line) | Triggers | Status |
| --- | --- | --- | --- |
| **gates** | Run the checks a change needs, with the right installs and env vars, on base and branch, and write down what ran (skipped is not passed). | Model-invoked before a commit or hand-over, on "are the gates green", or when a check fails. `/gates`. | **Drafted** |
| **pr** | Run the thermo-nuclear review on the right diff (generated copies excluded), add this repo's own checks, then write the PR description in the team's shape with a `Verdict:` line. | Model-invoked before handing over code or opening/updating a PR; "thermo-nuclear review". `/pr`. | **Drafted** |
| **shared-change** | After an edit to `ather-automata/hooks` or `week-calendar/scripts`: every copy and how to sync it, the traps no check catches, the board note, and the Paseo decision (shared, ported or Limits line) with a file map. | Model-invoked after shared-code edits, a failing sync check, or a conflict in a copy. | **Drafted** (covers the proposed paseo-parity, ather-shared-change, paseo-port and week-calendar-change) |
| **release** | Give a changed mod its next version from main as it is now, written everywhere, with the Changes line. Check open PRs' claims, run `check-release` and `validate --strict .` before the commit, and `tag --dry-run` after it. Re-check after main moves. | Model-invoked when the person asks to release or bump, when `check-release` fails on a mod, or when main took the branch's number. `/release <mod> [patch\|minor]`. The `pr` and `shared-change` skills also name its path. | **Drafted** |
| **intent** | Start, advance or close an intent (prompt, progress, log, worker brief). | Upstream description: `/intent`, or a feature prompt (auto-capture). | **Vendor** from `AskTinNguyen/intent@72edeb9d3ed6` with the drafted `SOURCE.md`. It first reads `docs/intent/README.md` (the project contract), which does not exist here yet. Run `/intent init` once and record the areas, the statuses Ather reads (active, parked, completed), the proofs (the gates) and merge authority. |
| thermo-nuclear-code-quality-review | Vendored, unchanged. Only `SOURCE.md` is corrected. | `/thermo-nuclear-code-quality-review`. | Exists in `.agents/skills`. `dev/skills.mjs` makes it reachable in a fresh Claude Code session. |
| layout-diff | Render pane layouts before and after, and diff them. | — | **Later.** It needs a golden-layout harness first: `repos.mjs --out` dumps only the collision scenario, and `run.mjs --layouts` needs `S2_ROOT`. |
| console-change, hot-path-review, board-add-view, surface-change, pane-ux-review | Checklists from the findings. | — | **Folded in, not separate.** Their critical questions are bullets in `pr`, and their sync and parity steps are in `shared-change`. Split one out only when that area's PRs keep missing it. |

What the four drafted skills encode, and the evidence behind each rule:

- **gates**
  - Sync before `test-all`, because test-all checks the copies first and stops (`dev/test-all.mjs:17,43-52`).
  - Which stages are optional and what each needs (`dev/test-all.mjs:45-49,55-64,97-99,105`).
  - The week-calendar tests are not in test-all (calendar-4).
  - The base run: run it in a worktree that also gets `npm ci` when the branch's run had the Paseo stages. Compare only stages that ran on both sides. Remove the worktree afterwards.
  - A short temp folder (measured above); the Windows 8.3 TEMP (`docs/intent/needs-you-session-jump/findings.md:15-17`); the disk leak (PR #84).
- **pr**
  - Diff scope: `git diff origin/main...HEAD -- . ':!ather-board/hooks/ather' ':!paseo/ather-automata/server/ather' ':!*.generated.ts' ':!.claude/skills'` (pathspecs tested).
  - Repo criticals: canonical homes (process-3); the `$` rule (`state.mjs:6-8`, and validate's refusal, console-1); store keys need an owner, and cross-session writes wait on D7 (watch-3, watch-4, arch-10); no new fail-open on holds (watch-1); one-sided changes to paired flows (arch-1).
  - Size follows AGENTS.md as written. Crossing 1,000 lines is critical (`AGENTS.md:14`). Growth of a file already over 1,000 is a reported finding with its numbers. It becomes critical only once the owner sets `SIZE_RATCHET=enforce` and AGENTS.md says so.
  - The `Verdict:` line that CI reads.
- **shared-change**
  - Sync mechanics: `ather-board/sync.mjs:16-25`, `paseo/ather-automata/server/sync.mjs:15,19,52-71`, `paseo/week-calendar/server/embed.mjs:17-18`.
  - Traps no check catches: a new hooks subfolder (arch-4 verifier); `SCRIPT_FILES` (`week-calendar/hooks/register.ts:10-14`); the `ui.tsx` hand copy (paseo-10); `WEB_TOOLS` (arch-3).
  - The board release when its copies move is presented as the owner's decision, not as a rule.
- **release**
  - Version files and the sync: `README.md:57-72`, `paseo/ather-automata/server/sync.mjs:52-71`.
  - The open-PR claim check. It was tested and found draft #62 still claiming `0.4.0`.
  - `tag --dry-run` runs after the commit, and `--force` is never used.
  - A green check is only as fresh as main was when it ran. Re-check after merging main, because #78 went from 0.6.2 to 0.6.5 (arch-9). Branch protection's "up to date" rule enforces this.

### B) CI and scheduled runners

| Runner | Trigger | What it does | Cost / secrets | Owner action |
| --- | --- | --- | --- | --- |
| `ci.yml` job `copies` | PR, push to main, manual | Paseo sync, embed, board and skills `--check` | None; under 1 min | Require it |
| `ci.yml` job `gates` | same | `node dev/test-all.mjs` on ubuntu (Node 24 and the newest 22) and windows (Node 24), with TEMP/TMP/TMPDIR set to `$RUNNER_TEMP`. Also the week-calendar node tests. Reports are kept as artifacts. | None. About 100 s of test time locally; Windows not measured | Require the ubuntu legs once main is green. Windows is `continue-on-error` until green. |
| `ci.yml` job `paseo` | same | `npm ci` (cached), type-check of both Paseo plugins, Paseo e2e (copies the hooks first). Windows is `continue-on-error`, like `gates`. | None | Require the ubuntu leg after `needs.ts:57` is fixed |
| `ci.yml` job `plugin` | same | Claude Code pinned at 2.1.296: `validate --strict` on `.` and each mod, and `claude plugin test` on each | None (no login) | Require it. Move the pin when `weekly` is green on a newer engine. |
| `pr-rules.yml` `release guard` | PR opened, pushed, labelled, edited | `dev/check-release.mjs` (rules below). The `release-later` label turns a missing bump into a warning. Board-copies-only changes are a note unless the repo variable `BOARD_COPIES=enforce` is set. | None | Create the `release-later` label; require the check; turn on "up to date before merging" (step 6) |
| `pr-rules.yml` `size ratchet` | same | `dev/check-size.mjs`: no held source file crosses 1,000 lines, and none over 1,000 grows. Advisory until the variable `SIZE_RATCHET=enforce` is set. The `size-accepted` label lets one PR through. | None | Create the `size-accepted` label; decide when to enforce (decision 2) |
| `pr-rules.yml` `review verdict in the description` | same, ready PRs only | For a non-Markdown change: reads the verdict in the "Thermo-nuclear review" section, with template comments stripped. It uses the `Verdict:` line if present, else the last "Round N:"/"Pass N:", else a "No critical findings" line. It fails when the verdict is missing, unclear or `block`. Version-only PRs are exempt. | None | Require it. Agree on the version-only exemption (decision 3). |
| `weekly.yml` `engine` | Mondays 01:17 UTC (08:17 ICT), manual | Runs `validate --strict` and `plugin test` on everything under npm tags `stable` and `latest`, one at a time (`max-parallel: 1`). A failure opens or adds to one "Engine drift: Claude Code X" issue and fails the run. | None | Read the issue |
| `weekly.yml` `health` | same | Posts `check-release --unreleased`, `check-size --report` and the week's merges as a comment on one "Weekly health" issue | None | Read it weekly |
| `weekly.yml` `engine-types` | same, if the variable `ENGINE_TYPES=on` | Loads both mods in one `claude -p` with `--max-budget-usd 0.05`, then type-checks the hooks against the types the engine wrote (same options as `dev/test-all.mjs:57-63`). It warns and stops if no types appear. | Secret `ANTHROPIC_API_KEY`; at most $0.05 a week | Optional |
| `thermo-review.yml` | PR with the label `thermo-review` (labelled, pushed, ready) | `claude-code-action@v1` reads the `pr` skill and the vendored review skill and reviews the scoped diff. It may run `node dev/check-size.mjs`; origin/main is already fetched. It posts one comment starting `Verdict: approve\|block` (edited on re-runs) plus inline comments on critical findings. It cannot edit or push. | Secret `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` (`claude setup-token`), the Claude GitHub App (`/install-github-app`), and one Claude session per labelled push | Opt in: add the secret, install the app, create the `thermo-review` label |
| `.github/pull_request_template.md` | Every new PR | Sections: Summary, Gates (base/after table), Thermo-nuclear review (`Verdict:`, rounds, fixes, left open), Release, Paseo, Go | — | — |

`dev/check-release.mjs` rules (a full draft is in the files):

- **Release units:**
  - ather-automata, which includes `paseo/ather-automata`;
  - ather-board, whose `hooks/ather` copies are a separate case: a change to them alone is a note until the owner decides;
  - week-calendar;
  - paseo/week-calendar, warnings only until the owner decides its support level (paseo-8).
- **Shipped** means non-Markdown, not a test, and not a dev-only script.
- **Always checked:** plugin.json equals the marketplace entry and Paseo's `package.json`/lock, and every marketplace entry is known.
- **On a branch:** a unit whose shipped files changed must raise its version above the base tip's, and its README needs a `- **x.y.z**` line. Any raised version must also be above the base's. A version-only release PR, like #80, passes.
- **A pass holds only for the base it ran against.** That is why rollout step 6 requires branches to be up to date.
- **`--unreleased`** lists what each unit changed since its version last moved on its first-parent line.

Replayed over the last 11 merges (each merge commit against its first parent):

| PR (merge) | Release guard, default (`warn`) | With `--board-copies enforce` | Size ratchet (held files) |
| --- | --- | --- | --- |
| #83 (999a2ba) | pass, note: 8 board copies | fail: ather-board | `console.mjs` 2199→2296 |
| #78 (cd32f4d) | pass, note: 3 board copies | fail: ather-board | `console.mjs` 2158→2199 |
| #82 (5ad17e6) | pass | pass | pass |
| #77 (a333961) | pass | pass | pass |
| #81 (0929807) | pass | pass | pass |
| #80 (bf23813) | pass | pass | pass |
| #79 (1101858) | **fail: ather-automata** (4 files, released later by #80, the `release-later` case), note: 2 board copies | fail: ather-automata and ather-board | pass |
| #76 (9ec10ea) | pass, note: 2 board copies | fail: ather-board | pass |
| #75 (4715f1b) | pass, note: 4 board copies | fail: ather-board | `console.mjs` 2157→2171 |
| #74 (09e1dac) | pass | pass | pass |
| #73 (f4860d3) | pass | pass | `console.mjs` 2122→2157 |

- Every merge also gets the standing note that paseo/week-calendar is 0.3.0 while week-calendar is 0.4.0.
- With `enforce`, 5 of the last 9 merges would have needed an extra board release. The board stayed at 0.3.0 through all of them.
- Separately from this replay, #32 (merge `76a24e7`, which carries 610cfd0) fails because week-calendar 0.4.0 has no Changes line (calendar-4).
- `--unreleased` on HEAD: ather-board has 14 shipped files changed since `09e1dac` (all copies), and paseo/week-calendar has 5.
- Tests, `dev/` and copies show only as size notes.

The verdict check replayed on PR bodies:
- It passes #83, #78, #82, #77, #75, #74, #79, #73, #72, #69, #68, #64 and #61.
- It fails #81, which changed `paseo-plugin.json` with "No code change" and no section.
- It exempts #80 as version-only.
- Synthetic bodies: `Verdict: block (C1 open)` fails, `Verdict: bypassed` fails as unclear, and an empty template `Verdict:` fails.

#### Decisions for the owner

**Decided 2026-10-21:** 1 no (copies only note), 2 no (CI enforces the ratchet, no `SIZE_RATCHET` variable), 3 no (version-only PRs are exempt). The drafts follow these answers; the text below is the original question.

1. **Does ather-board release whenever its copies move?** Yes means 5 of the last 9 merges would each have carried a board bump. Installed boards then get every shared-module change. No means boards keep old copies until the board itself changes; board-3 found the user-facing harm small. Until you decide, the guard only notes it. To make it a rule, set the variable `BOARD_COPIES=enforce` and add the line to AGENTS.md.
2. **When does growth of a file over 1,000 lines block?** Today AGENTS.md blocks only crossing 1,000. The ratchet would have blocked #73, #75, #78 and #83. To make it a rule, set `SIZE_RATCHET=enforce` and change `AGENTS.md:14` in the same PR. The `pr` skill and CI follow from that.
3. **Do version-only release PRs need a thermo-nuclear review?** AGENTS.md counts `.json` as code. #80 and #81 already skipped the review. The check exempts PRs that only move version numbers. Say so in AGENTS.md, or drop the exemption.

#### What will be red on day one (so roll out in order)

1. `ci.yml` `paseo` (ubuntu): the type-check fails at `paseo/ather-automata/server/needs.ts:57` (verified with real `npm ci`). The fix is `sentTo: {}` (paseo-2).
2. `ci.yml` `gates`: the repos e2e race (`FAIL the row says where it went`, tests-4) failed in the macOS baseline. It was not run on Linux. test-all stops at the first failing stage, so the board e2e would then not run either.
3. `ci.yml` `gates` and `paseo` on Windows: PR #77 reports 54 environment-dependent repos-e2e failures on main, and PRs #77, #80 and #82 report the board A1 unit test failing on main. Neither was verified on GitHub's Windows runners. Both legs only report until they are green.
4. `ci.yml` `copies`: fails until `node dev/skills.mjs` has written and committed `.claude/skills/`.

#### Cloud routines (proposals; the owner creates them)

All three run in a cloud session that clones `AskTinNguyen/ather-mods`.
- **Shared setup.** Repo: `AskTinNguyen/ather-mods`. Environment: Default (trusted network, enough for `node`, `git` and npm).
- **Billing and identity.** Runs bill the creator's subscription and act as the creator on GitHub.
- **Output.** Each routine reports in its run's own session. The two that change anything change only Markdown, on a `claude/` branch, as a draft PR. Nothing merges.

**1. Weekly debt sweep**: Mondays 09:07 Asia/Ho_Chi_Minh. Report only.
```
You are the weekly debt sweep for this repository (AskTinNguyen/ather-mods). Work read-only: change no file, push nothing, open nothing.
1. Run: node dev/check-size.mjs --report ; node dev/check-release.mjs --unreleased ; node ather-board/sync.mjs --check ; node paseo/ather-automata/server/sync.mjs --check ; node paseo/week-calendar/server/embed.mjs --check ; node dev/skills.mjs --check
2. For every file the size report marks "over 1,000", give its line count a week ago: git show $(git rev-list -1 --before='7 days ago' origin/main):<file> | wc -l
3. Count "as never" and "type Any = any" in paseo/ather-automata/server/*.ts now and a week ago (git grep -c at both commits).
4. List the modules in paseo/ather-automata/server/ather/ that nothing imports: follow the import lines from paseo/ather-automata/server/*.ts, server/art/render.mjs, client/, shared/ and index.*.
5. From git log --first-parent --since='7 days ago' origin/main, name the merge that grew a file over 1,000 lines the most.
6. Reply with at most 25 lines, in short plain sentences: what grew and what shrank; which mod has unreleased changes and should release next; copies out of step; the cast count, then and now; and one cleanup of small size to do next, naming the file and the function. No praise, no filler.
```

**2. Paseo parity report**: Mondays 09:37 Asia/Ho_Chi_Minh. Docs-only draft PR.
```
You keep the Paseo port's README honest for AskTinNguyen/ather-mods.
1. Read "## Changes" in ather-automata/README.md, and "## Limits" and "## Changes" in paseo/ather-automata/README.md. List each ather-automata version newer than the newest version in the Paseo README's Changes.
2. For each, decide from the code whether Paseo has it. Compare: COMMAND_WORDS and argumentHint in ather-automata/hooks/console.mjs with paseo/ather-automata/server/console.ts and client/commands.ts; the tool schemas in watch.mjs registerTools with server/tools.ts toolList; the deny texts in watch.mjs with server/watch.ts; startAwayIn and comeBack in console.mjs with console.ts; WEB_TOOLS in server/rules.ts with heldKindOf in hooks/packs/web.mjs.
3. For each gap not already under "## Limits", add one line there in the README's voice: "Not here yet: <what the person cannot do> (<version>)." Change no file but paseo/ather-automata/README.md.
4. If you changed it, push the branch claude/paseo-parity-<YYYY-MM-DD> and open a draft PR titled "docs(paseo): parity at ather-automata <version>". In its body list each gap with the file and function on each side. It is Markdown only, so it needs no thermo-nuclear review. Do not merge. If nothing changed, open nothing.
5. Reply with the gap list either way.
```

**3. Stale-intent sweep**: Thursdays 09:07 Asia/Ho_Chi_Minh. Docs-only draft PR; no Status changes.
```
You keep the intents in AskTinNguyen/ather-mods readable by Ather.
1. For each docs/intent/<slug>/prompt.md read Status, Owner and Branch; for each progress.md read its "- PR:" line.
2. Flag: a Status other than active, parked or completed (Ather reads only those: ather-automata/hooks/model.mjs); a completed intent with no "- PR: #N" line, or "PR: none"; an active intent whose PR is merged (git log --first-parent origin/main --grep "Merge pull request #N "); an active intent with no commit on its Branch or under its folder for 14 days; two open intents with the same Branch.
3. Fix only what is certain: write a missing or stale "- PR: #N" line when exactly one merge commit on main names the intent's branch. Never change a Status: list those for their Owner instead.
4. If you changed files, push claude/intent-hygiene-<YYYY-MM-DD> and open a draft PR "docs(intent): PR lines" listing each fix, then, separately, each Status the Owner should decide, by intent and Owner. Markdown only. Do not merge.
5. Reply with the same lists.
```

**Optional, local:** a Desktop scheduled task on one S2 agent PC.
- **Why local.** The S2 e2e needs a private S2 checkout, which a cloud clone cannot cheaply provide.
- **Schedule.** Weekdays 02:07, with "Worktree" set.
- **Prompt:** "Fetch origin; in this worktree check out origin/main; set TEMP/TMP to a short folder; run `S2_ROOT=<S2 checkout> node dev/test-all.mjs`; compare its FAIL lines by name with yesterday's list in `~/.ather-nightly/`; save today's; reply with new and fixed failures; delete `ather-*` temp folders older than two days."
- **Caveat.** It runs only while the PC is awake and the app is open.

### Rollout order

1. **Prerequisites** (other deliverables):
   - fix `paseo/ather-automata/server/needs.ts:57` (`sentTo: {}`);
   - fix or quarantine the repos-e2e race (tests-4: a hooks copy per booted session);
   - answer decision 1. If yes, release ather-board 0.3.1 for the 14 unreleased copy changes, with a Changes line such as "No change to what you see: Ather's shared modules moved (ather-automata 0.6.6)."
2. **PR "skills"** (Markdown plus one small script):
   - `.agents/skills/{gates,pr,shared-change,release}/SKILL.md`;
   - `.agents/skills/intent/` copied from upstream at `72edeb9d3ed6`, plus the drafted `SOURCE.md`;
   - the corrected `.agents/skills/thermo-nuclear-code-quality-review/SOURCE.md`;
   - `dev/skills.mjs`; then run `node dev/skills.mjs` and commit `.claude/skills/`;
   - the AGENTS.md lines below.
   - Then run `/intent init` to write `docs/intent/README.md`.
3. **PR "guards":** `dev/check-release.mjs`, `dev/check-size.mjs`, `.github/workflows/pr-rules.yml`, `.github/pull_request_template.md`. The owner runs `gh label create release-later`, `gh label create size-accepted` and `gh label create thermo-review`.
4. **PR "ci":** `.github/workflows/ci.yml`. Watch it on main for a week; the Windows legs stay advisory.
5. **PR "weekly":** `.github/workflows/weekly.yml`.
6. **Branch protection on main:**
   - Require `gates (ubuntu-latest, Node 24)`, `gates (ubuntu-latest, Node 22)`, `claude plugin validate and test`, `release guard` and `review verdict in the description`.
   - **Turn on "Require branches to be up to date before merging".** GitHub does not re-run checks when main moves. Without this, two PRs that both bump to the same version each pass against the old main, and the second merges on a stale green check (the #78/#82 case). With it, the second PR must merge main first, and `release guard` runs again on top. A merge queue would do the same, but it is offered for organization-owned repositories, so I did not count on it for this user-owned repo (not verified).
   - Add `paseo (ubuntu-latest)` once step 1 lands. Add the Windows legs when they are green, then drop their `continue-on-error`.
   - Set `SIZE_RATCHET=enforce` and `BOARD_COPIES=enforce` only as decisions 2 and 1 say.
   - Turn on "Automatically delete head branches" (process-10).
7. **Opt-in AI:** add the secret and the Claude GitHub App for `thermo-review.yml`; optionally set `ENGINE_TYPES=on`.
8. **Routines:** the owner creates the three routines above with `/schedule` or at claude.ai/code/routines.
9. **Later:**
   - fold the three sync scripts and `dev/skills.mjs` into one `dev/share.mjs` (arch-4), then update `shared-change` and the `copies` job;
   - add `node dev/skills.mjs --check` to `dev/test-all.mjs`'s first stage;
   - add `layout-diff` once a golden-layout harness exists;
   - if the team adopts change fragments (process-1), flip check-release's rule to "feature PRs add a fragment and no version".

### Lines for AGENTS.md (for the AGENTS.md deliverable)

- Skills live in `.agents/skills/<name>/`. `.claude/skills/` holds copies written by `node dev/skills.mjs`: never edit those.
- Use them as follows:
  - `gates` before you hand over;
  - `pr` for the thermo-nuclear review and the PR description (its `Verdict:` line is read by CI);
  - `shared-change` after any edit to `ather-automata/hooks` or `week-calendar/scripts`;
  - `release` for versions;
  - `intent` for `docs/intent`.
- CI must be green, and main merges only branches that are up to date with it. Labels: `release-later` (the fix ships in a later release PR), `size-accepted` (owner only), `thermo-review` (ask Claude for a review).
- Owner decisions, written once they are made:
  - "A file over 1,000 lines may not grow" (decision 2; replaces `AGENTS.md:14`'s crossing-only rule);
  - "The board releases when its copies change" (decision 1);
  - "A release PR that only moves version numbers needs no thermo-nuclear review" (decision 3).

### Not verified

- No workflow ran on GitHub itself. The YAML parses (Ruby), and every `run:` block was executed locally in bash against the scratch clone, except `npm install -g` and the `gh issue` calls. The `release guard` and `review verdict` steps were extracted from the YAML and run against past merges and PR bodies.
- Windows runners: Git Bash paths in artifact globs, and `claude plugin test` on Windows. Also the repos e2e on Linux.
- Whether a `claude -p --plugin-dir` session writes `.claude-plugin/types/`. The step degrades to a warning if it does not. The type-check itself was verified: with the 2.1.304 bundled engine types it runs clean on HEAD in about 2 s and catches an injected TS2322.
- Whether `gh` is authenticated inside a cloud routine. That is why the routines only push `claude/` branches and open draft PRs, which the docs describe.
- How Cursor treats the same skill name found in both `.agents/skills` and `.claude/skills`.
- Whether GitHub offers a merge queue for this user-owned repository.

### Notes on the critique

All six major and all minor points were checked and accepted; none was wrong.
- **Verified in the repo or scratch:**
  - `tag --dry-run` refuses uncommitted files (reproduced; it now runs after the commit, with `--force` ruled out);
  - `dev/skills.mjs` deleted an untracked `my-local` skill (fixed and retested);
  - the board-copy replay is 5 of the last 9 merges (#75, #76, #78, #79, #83), now in the table and put to the owner as decision 1, with warn-only as the default;
  - #75 also grew `console.mjs` (2157→2171), now listed;
  - the `views.mjs`/`map.mjs` bullet was dropped, since `board.test.mjs` already enforces it;
  - the personal skill link points into a ~95-skill library (confirmed), so the advice is now "keep it in step", and `SOURCE.md` is corrected.
- **Policy:** the `pr` skill no longer makes growth past 1,000 lines critical on its own (decision 2). The `release` skill is now model-invocable, and the other skills give its path.
- **Remaining minors:** "up to date before merging" was added to step 6. The verdict check now reads the verdict and fails on `block`. `thermo-review` may run `check-size` and is told origin/main is already fetched. The Node 22 comment was reworded. `weekly` runs its engine legs one at a time. The gates skill's base run installs the Paseo packages when needed, compares only shared stages and removes its worktree. The Windows `paseo` leg is advisory.
- **One addition beyond the critique:** a merge queue would also solve the stale-check problem, but I did not rely on it, because GitHub offers it for organization-owned repositories and this one is user-owned (not verified).