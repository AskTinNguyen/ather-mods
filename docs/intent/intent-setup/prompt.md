# Ather Automata: set up intents in a repository

- Rev: 1
- Status: active
- Area: ather-automata
- Owner: Hoàng Vũ
- Skill: `plugin-authoring`
- Branch: `claude/intent-workflow-structure-ed956c`
- Started: 2026-10-09

## Goal

Ather Automata works only in a repository that has the intent structure, and until now that structure was added by hand. In a repository without it, `/ather` offers to set it up, and `/ather setup` does it: the mod hands the session one prompt that names a zip shipped in the plugin. The zip holds a repo-neutral intent skill, a `docs/intent/README.md`, an example `.ather/profile.json`, the pointer paragraph for `AGENTS.md`, and a `SETUP.md` that says how to apply them. The session reads the repository, proposes areas and gates, asks the person to confirm, and then writes.

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

## Acceptance

<!-- What "done" means. Each item has an id and names its proof. Whether it is met lives only in progress.md. -->
- A1: `ather-automata/templates/intent-setup.zip` holds `SETUP.md` and the sources of the five pieces, and is the same bytes as its folder on every machine. Proof: `node dev/pack-templates.mjs --check`; `unzip -t`.
- A2: The mod reads which of the five pieces (skill, readme, profile, ignore, pointer) a repository has. Proof: unit tests in `ather-automata/tests/setup.test.mjs`.
- A3: The bundled templates read as intents do: the four templates through `parseIntent`, the example profile through the web pack. Proof: unit tests.
- A4: In a repository without intents `/ather` asks whether to set them up; `/ather setup` hands the session one prompt naming the zip and only the missing pieces. Proof: e2e rows in `dev/e2e/run.mjs`.
- A5: Once the pieces are there, `/ather` opens Home in the same session, and `/ather setup` reports and sends nothing. Proof: e2e rows.
- A6: Nothing changes in a repository that already runs intents, except that `/ather setup` works there. Proof: `node dev/test-all.mjs` has no FAIL line that the base commit does not have, and the layouts match base.
- A7: Live in Claude Code: in a scratch repository the session asks before writing, then the five pieces exist and nothing is committed; in a copy of this repository only the missing pieces are written and the existing intent folders are byte-identical. Proof: the live run's notes and screenshots.
- A8: Release 0.2.1: both manifests, a Changes line, "Setting up a repository" in the README, Paseo's shared copies in step. Proof: `claude plugin validate ather-automata`; `claude plugin test ather-automata`; the sync check in `dev/test-all.mjs`.

## Constraints

- Background hooks never block the calls they watch; state goes only through `state.mjs`.
- Nothing committed names the private repository the structure was read from.
- No merge into `main` without a person; open a PR.

## Changelog

- rev 1 (2026-10-09): created from L-1, L-2, L-3.
