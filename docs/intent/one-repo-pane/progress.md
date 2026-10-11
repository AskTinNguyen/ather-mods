# Ather Automata: the pane shows the repository it is in: Progress

- Working under rev: 1
- Worker: Claude Opus 5.5 builder (an Agent-tool subagent: `claude -p` had hit its weekly limit); Codex gpt-6.1-sol reviews; the coordinator wrote the README, ran the gates and the live run, and committed
- Current step: none
- Next step: open a PR when the owner asks
- PR: none

## Acceptance

| Item | Verdict | Evidence |
| --- | --- | --- |
| A1 | met | Unit rows on `readWorkspace` in `tests/ather.test.mjs` (a checkout beside the session is not added; worktrees in git's order, a sibling clone's left out). e2e in `dev/e2e/repos.mjs`: a session in s2 with worktree s2-x and web beside it lists only s2's and s2-x's intents, fetches only s2, reads issues and PRs only there. Commit bf0b0fa. |
| A2 | met | e2e row: a parent-folder session answers `/ather`, `/ather pick` and `/away` as a checkout without intents, opens no pane, runs no gh or fetch. Live: "… none here." from a session in the folder holding the checkouts (2026-10-11). |
| A3 | met | The search over `ather-automata`, `paseo/ather-automata` and `dev` (READMEs aside) finds nothing; the 0.2.9 Changes line names the removed pieces on purpose. `claude plugin validate ather-automata` passed. |
| A4 | met | The multi-repo A3 and A4 e2e rows (a `cd ../web` command held and proved by web's pack; a write into web's intent tracks it there) pass in `dev/e2e/repos.mjs`. |
| A5 | met | `node dev/test-all.mjs` with a sparse S2 clone: unit 326/326, checkouts e2e 257/257, e2e 349/349, no FAIL line; the base 7217b29 had none on the same clone either. Re-run by the coordinator. |
| A6 | met | Version 0.2.9 in both manifests, a Changes line, the README's "One repository, its worktrees, and other checkouts", Commands and Install (ff0bd61). Paseo `npm run sync`, `sync:check` and `typecheck` clean (bf0b0fa). Codex review: one Major (README), fixed in ff0bd61, verify APPROVED. |
| A7 | met | Live in Claude Code (tmux, `--plugin-dir`, 2026-10-11): a session in `app` with worktree `app-feat` and sibling `web` (intent `billing`) lists app's and app-feat's intents and nothing of web; Home has no Repositories row; `/ather repos` is no command (the words go to the session as a question). Scratch checkouts with no origin. |
