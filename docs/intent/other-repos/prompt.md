# Ather Automata: repositories that are not S2

- Rev: 3
- Status: completed
- Area: ather-automata
- Owner: Hoàng Vũ
- Skill: `plugin-authoring`
- Branch: `claude/ather-other-repos`
- Started: 2026-10-10

## Goal

Ather Automata was built for the S2 game repository on Windows PCs: its team list reads `origin/main`, its proof comes from gates matched word for word, and its pages speak of S2 and of PCs. On 2026-10-10 `/ather setup` was run for real in sipherxyz/ninetails-monitoring (Python and React, macOS, merges into `develop`), and the session that ran it reported what does not fit (log.md has the report). Make the mod right for such a repository: the branch a team merges into is read from the repository, a gate is matched the way people really type its command, an acceptance list written as a table is read, and the pages say what a person on macOS or outside S2 does.

## Non-Goals

- The Paseo version's behaviour. Its shared modules stay synced; its Io has no git, so its base branch stays `main`.
- The public intent skill (AskTinNguyen/intent): a "Base branch" line in its `assets/contract.md` is asked of its owner, not changed here.
- New traps (a Node version newer than `.nvmrc`): the pages say it, the mod does not detect it.
- Any change for a repository whose base branch is `main` and whose gates already match: its pane, prompts, store keys and git calls stay as they are.

## Decisions

- D1 Base branch: the branch a checkout's team merges into is, in this order: `baseBranch` in `.ather/profile.json` (a branch name; rev 3: the key the web pack reads, where rev 1 said `base`); the remote's default branch (`git symbolic-ref --short refs/remotes/origin/HEAD`, without `origin/`); `main`. It is read once per checkout and session, with the lane. Everything that reads or names `origin/main` today uses `origin/<base>` of its checkout: the team's intents and their commit dates, which local folders are ahead, the fetch (its refspec names the base), "only on origin/main" and "pull main" in what is said and in the prompts handed to the session, and the debug line. The held kind keeps its id `push-main` (it is in stores and windows) and holds a push to `main`, `master` or the checkout's base; what is said names the base when it is not `main`. An Io that cannot ask git (Paseo) has `main`.
- D2 Gates as people type them, in `packs/web.mjs`: (a) when several gates match a segment, the one with the longest command is the gate, wherever it stands in the profile; (b) a gate whose first word is a bare program name (no `/` or `\\` in it: `python3`, `pnpm`) is matched by that program wherever it is run from: the segment's first word is reduced to the last part of its path, without `.exe`, and `python`, `python3` and `python3.<n>` are one program, so `.venv/bin/python scripts/validate.py` proves a gate written `python3 scripts/validate.py`; a gate whose first word is itself a path (`./scripts/check.sh`) is compared as written, so another script of the same name elsewhere does not prove it; (c) a gate whose command is `cd <folder> && <command>` matches where a command runs those two segments one after the other, the folder compared as written, without a trailing slash. Nothing else about matching changes: a prefix still matches, an environment prefix is still dropped.
- D3 Acceptance as a table: `acceptanceItems` reads an Acceptance section written as a table (`| A1 | <item> | <proof> |`, a header and a rule row first) as it reads a list (`- A1: …`): the first cell is the id, the second the text. A section with both is read as its list. A prompt with several Acceptance sections ("## Acceptance", then "## Acceptance, rev 2") is read section by section, so a table in one and a list in another both count. Verdicts still come only from progress.md.
- D4 The pages. The mod's README: installing is the same on macOS and Windows and needs no S2 checkout; a section for a repository that is not S2 (install, `/ather setup`, confirm areas and gates, merge the setup PR, restart the session, `/ather`); the roles and the proofs of the web pack beside the Unreal ones; "PC" where it means any machine becomes "machine". `templates/intent-setup/SETUP.md`: how a gate's command is matched (D2), a note for teammates on Windows when the setup made a link on macOS, what to do when the repository has a `skills-lock.json`, and the base branch (D1); the setup prompt and step 10's report name the `.claude/skills/intent` link.
- D5 Release: both manifests go to 0.2.6 with one Changes line. Rev 3: 0.2.7, one Changes line shared with the web pack fixes it merges with.
- D6 (rev 3) The plugin no longer sets a repository up (0.2.6, intent `remove-setup`). Of D4, the README section for a repository that is not S2 says to add the intent structure yourself, and everything D4 says of `SETUP.md` and of the setup prompt is dropped with them.

## Acceptance

<!-- What "done" means. Each item has an id and names its proof. Whether it is met lives only in progress.md. -->
- A1: a checkout whose team merges into `develop` lists the intents `origin/develop` holds, dates them by their commits there, fetches `develop`, and holds a push to `develop`; a profile's `baseBranch` wins over the remote's default; a checkout on `main` makes the git calls it made before (D1). Proof: unit on the base's three sources and on the fetch refspec; e2e `dev/e2e/repos.mjs` with a real origin whose default branch is `develop`; the existing unit, repos e2e and S2 e2e checks unchanged.
- A2: a narrow gate listed after a wide one is the gate of its own command; `.venv/bin/python …`, `python …` and a Windows `python.exe` path prove a `python3 …` gate; `cd app && <command>` proves a gate written so; a command that only shares a prefix with no gate proves nothing (D2). Proof: unit on `rungsOfCommand`, each case with the profile of ninetails-monitoring's setup PR.
- A3: an intent whose acceptance is a table is counted and its items take their verdicts from progress.md; the four intents of this repository written so (crew-tree-and-groups, decide-in-place, team-truth, multi-repo) read with their real number of items (D3). Proof: unit on `acceptanceItems` with a table, a list and both; unit over those four files.
- A4: the README says what D4 lists (rev 3: without the setup, D6), and nothing in them tells a person outside S2 or on macOS to do what does not apply to them. Proof: review by the coordinator against D4, and `claude plugin validate`.
- A5: no regressions; Paseo copies synced; both manifests at 0.2.6 (D5). Proof: `node dev/test-all.mjs` with the type-check and the S2 e2e, `claude plugin validate`, `claude plugin test ather-automata`.

## Constraints

- A repository on `main` with matching gates sees no change: no existing unit test, `repos.mjs` check or S2 e2e check may change, except one that pins a text D1 rewords.
- Shared modules are synced to `paseo/ather-automata` (`node server/sync.mjs`); `dev/test-all.mjs` fails while the copies differ.
- No attribution lines in commits.

## Changelog

- Rev 1 (2026-10-10): opened from the report of the session that ran `/ather setup` in ninetails-monitoring, and from the owner's word to do its four points.
- Rev 2 (2026-10-10): from the reviews of S1 and S2. D3: sections are read one by one. D2 (b): only a gate that names a bare program is matched by that program at any path; a gate that is a path is compared as written.
- Rev 3 (2026-10-10): merged on one branch with the web pack's changes (PR 45 and PR 48), after `/ather setup` was removed in 0.2.6. D1: one profile key, `baseBranch`, read through the web pack's branch-name check. D2's matching chooses the gates a command runs, and each gate keeps its own result (web-pack W7). D6: the pages without the setup. D5: 0.2.7.
- completed (2026-10-10): every acceptance item is met; this file reaches `main` with the merge of PR #49 (release 0.2.7).
