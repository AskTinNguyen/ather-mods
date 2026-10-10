# Ather Automata: stop setting repositories up: Progress

- Working under rev: 1
- Worker: `Claude Opus 5.5 builder for the code; Codex gpt-6.1-sol reviews; the coordinator writes the READMEs, runs the gates and the live run, and commits`
- Current step: none
- Next step: none; PR #47 is merged (merge commit 42a3774)
- PR: #47

## Acceptance

<!-- One row per acceptance id in prompt.md, same order. Verdict is exactly met or open; met needs evidence (commit / gate output / review). -->

| Item | Verdict | Evidence |
| --- | --- | --- |
| A1 | met | e2e rows "no intents: /ather …", "/ather setup …", "/ather init asks nothing, submits nothing, opens no pane and answers as /away does" and, in `dev/e2e/repos.mjs`, "a parent folder whose checkouts have no intents: /ather asks nothing, submits nothing and opens no pane". Seen failing first on the unchanged code (the question was asked; a prompt was submitted). `claude plugin test ather-automata` → 3 pass, 0 fail (seen failing first: 1 pass, 2 fail). Commits 0a33857, ae7bab8. |
| A2 | met | `git ls-files \| grep -i "setup\.\|templates"` prints nothing; `grep -rn "setup.mjs\|setupCommand\|setupQuestion\|readSetup\|SETUP_PIECES\|intent-setup\|/ather setup" ather-automata/hooks ather-automata/tests dev paseo/ather-automata/server` prints nothing; `dev/test-all.mjs` → "paseo/ather-automata: shared modules in step". Commit 0a33857. |
| A3 | met | Unit: the four tests under "a repository that gets its intents while the session runs" in `tests/ather.test.mjs` (moved from `tests/setup.test.mjs`, same expectations). e2e rows: "with the structure added by hand, /ather in the same session opens Home, asks nothing and submits nothing", "the profile tool is registered again with the new profile's areas", "the same session reads the new profile". Commit 0a33857. |
| A4 | met | `CLAUDE_CODE_TYPES=<engine types> S2_ROOT=<S2 intents copy> node dev/test-all.mjs` on ae7bab8 → exit 0, type-check clean, unit 244/244, repos e2e 234/234, e2e 348/348, no FAIL line. The base commit 1575e1a on the same copy: unit 268/268, repos e2e 235/235, e2e 354/354, no FAIL line. The difference is the rows this change removed: 28 unit tests of `setup.test.mjs` less the 4 moved, 1 repos e2e row, 6 e2e rows. |
| A5 | met | Claude Code 2.1.296, the plugin loaded from a copy of commit 4aaa846 (`claude --plugin-dir`, tmux). Scratch repository without `docs/intent`: `/ather`, `/ather setup`, `/ather init` and `/away tonight` each answered "Ather Automata works in repositories with intents (a docs/intent folder); none here.", with no question, no pane and nothing sent to the session. After one intent folder, `.ather/profile.json` and the ignore line were added by hand, `/ather` in the same session opened Home with "Pick up first-feature". In a copy of this repository's `docs/intent`, `/ather` opened Home as before, and `/ather setup` opened the view of the one open intent the word matches (the path any word takes), with nothing sent. |
| A6 | met | 0.2.6 in both manifests; the Changes line; "A repository without intents" in `ather-automata/README.md`; the root and Paseo READMEs. `claude plugin validate ather-automata` → "Validation passed"; `claude plugin test ather-automata` → 3 pass, 0 fail. Commit 4aaa846. |

## Steps

<!-- S<n> (rev <r>, <YYYY-MM-DD>): <what was done>. Evidence: <commit / gate command, exit code and pass count / review>. Acceptance: <A-ids moved>. -->

- S1 (rev 1, 2026-10-10): baseline. The base commit 1575e1a on a copy of S2's intents. Evidence: `S2_ROOT=<S2 intents copy> node dev/test-all.mjs` → exit 0, unit 268/268, repos e2e 235/235, e2e 354/354. Acceptance: none.
- S2 (rev 1, 2026-10-10): the setup removed from the mod: the command, the question, `hooks/setup.mjs`, its tests, `templates/intent-setup/` and Paseo's copy; the tests changed first and seen failing. Evidence: commit 0a33857; the A4 run. Acceptance: A1, A2, A3, A4.
- S3 (rev 1, 2026-10-10): release 0.2.6 and the READMEs; this record. Evidence: commit 4aaa846. Acceptance: A6.
- S4 (rev 1, 2026-10-10): review of both commits by Codex gpt-6.1-sol: one finding (the plugin test no longer checked that the reply names no setup command), accepted, fixed in ae7bab8, approved by the same reviewer. Acceptance: A1.
- S5 (rev 1, 2026-10-10): the live run in Claude Code 2.1.296. Evidence: the A5 row. Acceptance: A5.
- S6 (rev 1, 2026-10-10): open setup work stopped (D5): issues 39 and 41 closed as not planned; the session on PR 45 took the four setup commits off its branch, which now fixes issues 37 and 38 only.

## Follow-ups

- Done: PR 44 (`claude/ather-other-repos`) edited `SETUP.md`, `hooks/setup.mjs` and a README step that said to type `/ather setup`. Those parts were dropped when it was merged with this change (`docs/intent/other-repos`, rev 3).
