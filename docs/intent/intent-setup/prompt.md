# Ather Automata: set up intents in a repository

- Rev: 3
- Status: active
- Area: ather-automata
- Owner: Hoàng Vũ
- Skill: `plugin-authoring`
- Branch: `claude/coordinate-build-refactor-setup-9bc44f`
- Started: 2026-10-09

## Goal

Ather Automata works only in a repository that has the intent structure, and until now that structure was added by hand. In a repository without it, `/ather` offers to set it up, and `/ather setup` does it: the mod hands the session one prompt. From rev 3 the intent skill and the project contract (`docs/intent/README.md`) come from the public repository https://github.com/AskTinNguyen/intent, not from a zip shipped in the plugin. The plugin keeps only what that repository does not have, as plain files: a `SETUP.md` with Ather's steps and an example `.ather/profile.json`. The session clones the repository, reads the checkout it runs in, proposes areas and gates, asks the person to confirm, and then writes.

## Non-Goals

- The mod writing a repository's files itself: the session writes, after the person's yes.
- Sample intents, or any change to intents a repository already has.
- A Set up button on the Paseo panel: the Paseo version gets the shared code and words only. Follow-up.
- Setting up this repository (it has intents but no skill, README or profile): a later change, done with this feature.

## Decisions

- D1 (rev 1): the feature lives in the mod and works in whatever repository the session runs in. Source: L-2.
- D2 (rev 1): the session does the writing from a prompt; the mod reads which pieces exist and names only the missing ones. Source: L-2.
- D3 (rev 1): the skill text is the S2 skill made neutral: no Unreal words; proof is the output of a gate the profile names. Source: L-2.
- D4 (rev 1): the bundle ships as a zip that stands alone (`SETUP.md` inside); nothing points at a private repository. Source: L-3.
- D5 (rev 1): `.agents/skills/intent/` is the skill's home; setup also makes it loadable by Claude Code under `.claude/skills/intent`. Source: L-3 (accepted as proposed).
- D6 (rev 1): `pack` is `unreal` with a `*.uproject` at the root, else `web`; `mergePolicy` is `hold`. Source: L-3.
- D7 (rev 1): setup is safe to run again: nothing existing is overwritten, and with nothing missing `/ather setup` only reports. Source: L-3.
- D8 (rev 2): the question fix of F-1, built as its own change (PR #24, release 0.2.1), is merged into this branch; this intent releases as 0.2.2. Source: L-5.
- D9 (rev 3): the intent skill and the contract come from the public repository https://github.com/AskTinNguyen/intent (its `skills/intent/` folder; the contract by its `references/setup.md`, from `assets/contract.md`). The zip, `dev/pack-templates.mjs` and the plugin's own copies of the skill, the readme and the pointer paragraph are removed. Replaces D4, and the skill text of D3. Source: L-6.
- D10 (rev 3): what the public repository does not have stays in the plugin as plain files, `templates/intent-setup/SETUP.md` (Ather's steps and rules) and `templates/intent-setup/profile.example.json`. The prompt names `SETUP.md` by its path in the plugin folder, and names the repository only when a piece that comes from it (the skill, the readme) is missing. Source: L-6 (coordinator's reading; D5, D6 and D7 stand).
- D11 (rev 3): the profile repeats the contract: `areas` are the names in its Areas table, spelled the same; `gates` are the commands its Proofs table lists. One question covers both files. Source: L-6 (coordinator's reading).
- D12 (rev 3): an instruction file that points at `docs/intent/README.md` (the line the public skill's own setup offers) counts as the pointer, as one that names the skill does. Source: L-6 (coordinator's reading).
- D13 (rev 3): this change releases as the next version on `main` when it merges (0.2.4 now), and the coordinator opens the PR and merges it once every acceptance item is met and the PR is mergeable. Source: L-7.

## Acceptance

<!-- What "done" means. Each item has an id and names its proof. Whether it is met lives only in progress.md. -->
- A1 (rev 3): the repository has no zip and no zip builder: `ather-automata/templates/intent-setup.zip`, `dev/pack-templates.mjs`, the templates step of `dev/test-all.mjs` and the plugin's copies of the skill, the readme and the pointer are gone. The plugin ships `templates/intent-setup/SETUP.md` and `profile.example.json`. Proof: `git ls-files` lists no zip; `node dev/test-all.mjs` exits 0.
- A2: The mod reads which of the five pieces (skill, readme, profile, ignore, pointer) a repository has; from rev 3 a pointer at `docs/intent/README.md` counts (D12). Proof: unit tests in `ather-automata/tests/setup.test.mjs`.
- A3 (rev 3): what the session is handed reads as intents do: the example profile through the web pack; `SETUP.md` names every target path, the repository, and the two places in it that it sends the session to (`skills/intent/`, `references/setup.md`); the public repository's four templates through `parseIntent`, and its contract through `readSetup`. Proof: unit tests for the plugin's files; for the public repository, the coordinator's run of the mod's readers over a clone, with its commit.
- A4 (rev 3): In a repository without intents `/ather` asks whether to set them up; `/ather setup` hands the session one prompt naming `SETUP.md` in the plugin folder, the repository when the skill or the readme is missing, and only the missing pieces. Proof: unit tests; e2e rows in `dev/e2e/run.mjs`; `claude plugin test ather-automata`.
- A5: Once the pieces are there, `/ather` opens Home in the same session, and `/ather setup` reports and sends nothing. Proof: e2e rows.
- A6: Nothing changes in a repository that already runs intents, except that `/ather setup` works there. Proof: `node dev/test-all.mjs` has no FAIL line that the base commit does not have.
- A7 (rev 3): Live in Claude Code: in a scratch repository the session clones the public repository, asks before writing, then the five pieces exist, `.agents/skills/intent/` is identical to the clone's `skills/intent/`, and nothing is committed; the mod's readers find the result complete. Proof: the live run's notes.
- A8 (rev 3): Release as the next version: both manifests, a Changes line, "Setting up a repository" and the maintainer notes in the README, the root and Paseo READMEs, Paseo's shared copies in step. Proof: `claude plugin validate ather-automata`; `claude plugin test ather-automata`; the sync check in `dev/test-all.mjs`.

## Constraints

- Background hooks never block the calls they watch; state goes only through `state.mjs`.
- Nothing committed names the private repository the structure was read from.
- No merge into `main` without a person; open a PR. For rev 3 the person said to merge once it is done and mergeable (D13).

## Changelog

- rev 1 (2026-10-09): created from L-1, L-2, L-3.
- rev 2 (2026-10-09): the release is 0.2.2, on top of the question fix merged from PR #24 (D8, A8), from L-5.
- rev 3 (2026-10-09): the skill and the contract come from the public repository; the zip and its builder are removed (D9 to D13; A1, A3, A4, A7 and A8 rewritten, A2 widened), from L-6 and L-7.
