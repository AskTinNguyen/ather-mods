# Ather Automata: stop setting repositories up

- Rev: 1
- Status: completed
- Area: ather-automata
- Owner: Hoàng Vũ
- Skill: `plugin-authoring`
- Branch: `claude/remove-ather-setup-skill-352338`
- Started: 2026-10-10

## Goal

Ather Automata stops setting a repository up for intents. `/ather setup`, the question `/ather` asked where there were no intents, and the files the plugin shipped for it are removed. Each team adds the intent structure to its own repository; Ather works once a `docs/intent` folder is there. This takes back what the completed intent `intent-setup` built (0.2.2 to 0.2.4).

## Non-Goals

- A replacement inside the mod (a wizard, a check of which pieces are missing, a link to steps): none.
- Changes to the public intent repository (https://github.com/AskTinNguyen/intent). Its own `/intent init` stays the way to draft a project contract.
- Changes for a repository that already runs intents.

## Decisions

- D1 (rev 1): where no checkout of the session has intents, `/ather` answers the pack's sentence ("… none here."), as `/away` does, and asks, sends and opens nothing. Source: L-1 (coordinator's reading: this is what `/ather` did before 0.2.2).
- D2 (rev 1): `setup` and `init` are no longer words `/ather` knows. Source: L-1.
- D3 (rev 1): `hooks/setup.mjs`, `tests/setup.test.mjs`, `templates/intent-setup/` and Paseo's copy of `setup.mjs` are deleted, not kept as a page to follow by hand. The README says what Ather reads and names the public repository. Source: L-1 (coordinator's reading of "user sẽ tự add").
- D4 (rev 1): a checkout that gets its `docs/intent` folder while a session runs is still read again, so `/ather` opens the pane in the same session after the structure was added by hand. Source: coordinator (the reading is what a person adding the structure needs; it was built with the setup and does not depend on it).
- D5 (rev 1): open work on the setup stops: issues 39 and 41 are closed as not planned, and their fixes leave PR 45. Source: L-2.

## Acceptance

<!-- What "done" means. Each item has an id and names its proof. Whether it is met lives only in progress.md. -->
- A1: in a repository without intents, `/ather`, `/ather setup` and `/ather init` ask nothing, submit nothing, open no pane and answer as `/away` does. Proof: e2e rows in `dev/e2e/run.mjs` and `dev/e2e/repos.mjs`; `claude plugin test ather-automata`.
- A2: the setup's files are gone: `ather-automata/hooks/setup.mjs`, `ather-automata/tests/setup.test.mjs`, `ather-automata/templates/`, `paseo/ather-automata/server/ather/setup.mjs`, and nothing in the mod or the tests names them. Proof: `git ls-files`; the sync check in `dev/test-all.mjs`.
- A3: with the structure added by hand, `/ather` in the same session opens Home, reads the new profile and registers the profile tool again with its areas. Proof: unit tests in `ather-automata/tests/ather.test.mjs`; e2e rows.
- A4: nothing changes in a repository that runs intents. Proof: `node dev/test-all.mjs` has no FAIL line that the base commit does not have.
- A5: live in Claude Code: A1 and A3 in a scratch repository, and `/ather` in a repository that runs intents. Proof: the live run's notes.
- A6: release 0.2.6: both manifests, a Changes line, "A repository without intents" in the mod's README, the root and Paseo READMEs. Proof: `claude plugin validate ather-automata`; `claude plugin test ather-automata`.

## Constraints

- Background hooks never block the calls they watch; state goes only through `state.mjs`.
- No merge into `main` without a person.

## Changelog

- rev 1 (2026-10-10): created from L-1 and L-2.
- completed (2026-10-10): every acceptance item is met and PR #47 is merged (merge commit 42a3774, release 0.2.6).
