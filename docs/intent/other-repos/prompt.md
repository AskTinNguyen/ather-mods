# Ather Automata: repositories that are not S2

- Rev: 1
- Status: active
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

- D1 Base branch: the branch a checkout's team merges into is, in this order: `base` in `.ather/profile.json` (a branch name); the remote's default branch (`git symbolic-ref --short refs/remotes/origin/HEAD`, without `origin/`); `main`. It is read once per checkout and session, with the lane. Everything that reads or names `origin/main` today uses `origin/<base>` of its checkout: the team's intents and their commit dates, which local folders are ahead, the fetch (its refspec names the base), "only on origin/main" and "pull main" in what is said and in the prompts handed to the session, and the debug line. The held kind keeps its id `push-main` (it is in stores and windows) and holds a push to `main`, `master` or the checkout's base; what is said names the base when it is not `main`. An Io that cannot ask git (Paseo) has `main`.
- D2 Gates as people type them, in `packs/web.mjs`: (a) when several gates match a segment, the one with the longest command is the gate, wherever it stands in the profile; (b) the first word of a segment and of a gate is compared as a program: the last part of its path, without `.exe`, and `python`, `python3` and `python3.<n>` are one program, so `.venv/bin/python scripts/validate.py` proves a gate written `python3 scripts/validate.py`; (c) a gate whose command is `cd <folder> && <command>` matches where a command runs those two segments one after the other, the folder compared as written, without a trailing slash. Nothing else about matching changes: a prefix still matches, an environment prefix is still dropped.
- D3 Acceptance as a table: `acceptanceItems` reads an Acceptance section written as a table (`| A1 | <item> | <proof> |`, a header and a rule row first) as it reads a list (`- A1: …`): the first cell is the id, the second the text. A section with both is read as its list. Verdicts still come only from progress.md.
- D4 The pages. The mod's README: installing is the same on macOS and Windows and needs no S2 checkout; a section for a repository that is not S2 (install, `/ather setup`, confirm areas and gates, merge the setup PR, restart the session, `/ather`); the roles and the proofs of the web pack beside the Unreal ones; "PC" where it means any machine becomes "machine". `templates/intent-setup/SETUP.md`: how a gate's command is matched (D2), a note for teammates on Windows when the setup made a link on macOS, what to do when the repository has a `skills-lock.json`, and the base branch (D1); the setup prompt and step 10's report name the `.claude/skills/intent` link.
- D5 Release: both manifests go to 0.2.6 with one Changes line.

## Acceptance

<!-- What "done" means. Each item has an id and names its proof. Whether it is met lives only in progress.md. -->
- A1: a checkout whose team merges into `develop` lists the intents `origin/develop` holds, dates them by their commits there, fetches `develop`, and holds a push to `develop`; a profile's `base` wins over the remote's default; a checkout on `main` makes the git calls it made before (D1). Proof: unit on the base's three sources and on the fetch refspec; e2e `dev/e2e/repos.mjs` with a real origin whose default branch is `develop`; the existing unit, repos e2e and S2 e2e checks unchanged.
- A2: a narrow gate listed after a wide one is the gate of its own command; `.venv/bin/python …`, `python …` and a Windows `python.exe` path prove a `python3 …` gate; `cd app && <command>` proves a gate written so; a command that only shares a prefix with no gate proves nothing (D2). Proof: unit on `rungsOfCommand`, each case with the profile of ninetails-monitoring's setup PR.
- A3: an intent whose acceptance is a table is counted and its items take their verdicts from progress.md; the four intents of this repository written so (crew-tree-and-groups, decide-in-place, team-truth, multi-repo) read with their real number of items (D3). Proof: unit on `acceptanceItems` with a table, a list and both; unit over those four files.
- A4: the README and SETUP.md say what D4 lists, and nothing in them tells a person outside S2 or on macOS to do what does not apply to them. Proof: review by the coordinator against D4, and `claude plugin validate`.
- A5: no regressions; Paseo copies synced; both manifests at 0.2.6 (D5). Proof: `node dev/test-all.mjs` with the type-check and the S2 e2e, `claude plugin validate`, `claude plugin test ather-automata`.

## Constraints

- A repository on `main` with matching gates sees no change: no existing unit test, `repos.mjs` check or S2 e2e check may change, except one that pins a text D1 rewords.
- Shared modules are synced to `paseo/ather-automata` (`node server/sync.mjs`); `dev/test-all.mjs` fails while the copies differ.
- No attribution lines in commits.

## Changelog

- Rev 1 (2026-10-10): opened from the report of the session that ran `/ather setup` in ninetails-monitoring, and from the owner's word to do its four points.
