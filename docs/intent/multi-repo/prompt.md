# Ather Automata: several repositories

- Rev: 1
- Status: active
- Area: ather-automata
- Owner: Hoàng Vũ
- Skill: `plugin-authoring`
- Branch: `claude/automata-multi-repo-support-bbfecb`
- Started: 2026-10-08

## Goal

Ather Automata assumes one session is one checkout: one root from `$.session.root()`, one pack, one `origin/main`, `gh` run in that root, intents under `<root>/docs/intent`. People now work across repositories (S2, han-viet, ather-mods) on one PC and sometimes from one session (`cd ../han-viet && npm test`, or a session opened in a parent folder). Make the Claude Code mod correct and useful there: what is kept per repository never mixes (done in 0.1.7's first slice), every command is judged by the repository it runs in, an intent in another checkout can be tracked, and one `/ather` pane shows the intents, issues and PRs of every repository the session works with.

## Non-Goals

- The Paseo version (`paseo/ather-automata`). Its shared pure modules stay synced (`npm run sync`), and its Io has no `repo`/`origin`/workspace, so it keeps behaving as one checkout.
- Repositories the session does not name or contain: no scanning of the disk beyond the session folder's direct children.
- Cross-repository intents (one intent spanning two repos). An intent lives in one checkout's `docs/intent`.
- Changing any behaviour for a session whose workspace is one checkout: its pane, prompts, keys and layouts stay as in 0.1.7.

## Decisions

- D1 (done, slice S0): A repository is named by its origin URL, `owner/repo` lowercased (`state.repoId`); without an origin, `path:<root>`. Issue lists, PR states, intent proof, today's changes and "Continue …" are kept per repository. Before-0.1.7 proof and Continue read through until the scoped key is written.
- D2 Workspace: the checkouts a session works with, read once per session, in this order and de-duplicated by checkout root: (1) the checkout holding the session folder (walk up to a `.git` folder or file); (2) the folders named in the plugin option `repos` (one string, folders separated by `;` or newlines, absolute or relative to the session folder), each resolved to its checkout; (3) only when the session folder is not inside a checkout, its direct child folders that are checkouts, by name. At most 8. A folder that is not a checkout is skipped and logged to debug.
- D3 Per-checkout lane: `state.laneAt(io, root)` gives `{ root, repo, isS2, me, pack }` for any checkout root (pack by `packFor`, once per session and root; origin read in that root). The session's lane is the lane of its own folder, as today.
- D4 Commands by checkout: each shell segment runs in a folder (its `git -C`, else the last `cd`, else the session folder, `shell.withFolders`), which resolves to the checkout holding it. A segment's held check uses that checkout's pack and branch. Held kinds there: the window's own list for the session's checkout; for any other checkout, the window's list plus that checkout's pack defaults (`pack.held.defaults`), so a window never holds less in another repository than that repository's defaults. A with-proof merge counts only proof in that checkout's scope. A segment outside every checkout uses the session's lane.
- D5 Proof by checkout: a shell result is read with the pack of the checkout its last segment ran in. Its rungs go to the tracked intent's scope when that checkout is the tracked intent's checkout; otherwise to this session's scope for that checkout: `<sid>` for the session's own checkout (as today), `<sid>|<repo>` for another. `prune` treats the part before `|` as the session id. MCP evidence (the Editor) stays with the session's checkout.
- D6 Tracking across checkouts: the tracked intent is a checkout root and a slug. `pinned:<sid>` keeps the plain slug when the root is the session's checkout (as today), and `{ slug, root }` otherwise; `readPinned` keeps returning the slug, a new `readTracked` returns `{ slug, root }`. A write into `<checkout>/docs/intent/<slug>/prompt.md|log.md` from the main conversation tracks that intent in the checkout the path resolves to; edits to its prompt, findings or progress record changes under that checkout's repository. Every reader of the tracked intent's files (intent view, lane text, status tool, away ledger, debrief, hasIntentFolder) uses its root. The tracked intent's proof scope is `<its repo>|<slug>`. The heartbeat goes to the session's checkout as today and also to the tracked intent's checkout when that differs, so "Also tracked in …" works there.
- D7 Pane across the workspace: the console runs when any workspace checkout has `docs/intent`. Intents are read per checkout (`team.readTeam` with its own cache, parsed with its own pack) and listed together. Each work row gets its repository's short name (the repo id's last segment, e.g. `han-viet`), drawn dim after the title, only when the workspace has more than one checkout with intents. An intent's identity in the pane is `key` = its slug for the session's checkout and `<short name>/<slug>` otherwise; `slug` stays the folder name for paths. Its stage uses its own checkout's pack, PR states and the person's role for that pack. Work on this here tracks it in its own checkout (D6); Ask about it reads it with `git -C <its root>`. The words of Next, Create and Prove come from the tracked intent's pack, else the session checkout's, else the first workspace checkout's.
- D8 Issues and PRs across: `gh issue list` runs in each workspace checkout, each list kept per repository (D1), merged in the pane with the short name when there is more than one; an issue's id is `issue:<short name>#<n>` outside the session's checkout. Starting an intent from an issue starts it in that issue's checkout (the prompt names the folder); Open on GitHub and Copy link use that checkout. `/ather issue <n>` prefers the session checkout's issue, then the first match. PR states are read with `gh pr view` in each intent's checkout and kept per repository.
- D9 Sync across: each checkout's main is fetched with the same argv, env and 10-minute throttle, one fetch at a time overall; the header's sync line reports the least recently synced checkout; ↻ fetches every checkout that may fetch now.
- D10 One checkout, no change: with a workspace of one checkout, every pane layout, prompt, store key and git/gh call is as in 0.1.7 (the e2e layouts are the check).

## Acceptance

| Id | Item | Proof |
| --- | --- | --- |
| A1 | Issue lists, PR states, intent proof, changes and Continue are kept per repository; old keys read through once. (S0) | Unit "several repositories on one machine". |
| A2 | The workspace and per-checkout lanes follow D2 and D3. (S1) | Unit: checkout resolution (dir `.git`, worktree `.git` file, nested folder), workspace order and de-duplication, option parsing, cap of 8, parent-folder children. |
| A3 | A command is held, and proved, by the checkout it runs in (D4, D5). (S2) | Unit on guards with per-folder packs. e2e (`dev/e2e/repos.mjs`, real git): a session in an Unreal checkout with an away window holds `cd ../web && vercel --prod`; `cd ../web && npm test` passing records `tests` in `<sid>|<web repo>`, not in the session's scope; a with-proof merge in the web checkout is allowed only with the web checkout's proof. |
| A4 | An intent in another checkout can be tracked, viewed, proved and untracked (D6). (S3) | Unit on state (`readTracked`, scopes, prune). e2e: writing `../web/docs/intent/x/prompt.md` tracks `x` in web; its view, status tool, away ledger path and proof use web's root and repo; untrack clears it. |
| A5 | One pane lists the intents of every workspace checkout with their short names; one checkout looks as before (D7, D9, D10). (S4) | e2e: a parent-folder session over two checkouts lists both checkouts' intents with names, the same slug in both shows as two rows, Work on this here on the other checkout's intent tracks it there; sync line and ↻ over both. Single-checkout e2e layouts unchanged (`--layouts` diff empty). |
| A6 | Issues and PRs come from every workspace checkout (D8). (S5) | e2e with gh fixtures per checkout: both lists merged with names; Start an intent names the issue's checkout; PR states per checkout drive each intent's stage. |
| A7 | No regressions; Paseo copies synced; `claude plugin test ather-automata` passes. | `node dev/test-all.mjs` (unit + repos e2e; S2 e2e when S2_ROOT is set), `claude plugin test`. |

## Slices

| Slice | Scope | Depends on |
| --- | --- | --- |
| S0 | D1 (already written, uncommitted): review and commit. | — |
| S1 | D2, D3: `checkoutOf`, `workspace`, `laneAt`, the `repos` user option, Io changes; no behaviour change yet. | S0 |
| S2 | D4, D5: commands and proof by checkout; `dev/e2e/repos.mjs` harness wired into `dev/test-all.mjs`. | S1 |
| S3 | D6: tracking across checkouts. | S2 |
| S4 | D7, D9, D10: pane intents and sync across the workspace. | S3 |
| S5 | D8: issues and PRs across. | S4 |
| S6 | Whole-diff review, README and changelog, final e2e. | S5 |
