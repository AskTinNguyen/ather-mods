# Ather Automata: the decision desk

- Rev: 1
- Status: active
- Area: ather-automata
- Owner: Tin Nguyen
- Skill: `plugin-authoring`
- Branch: `intent/decision-desk`
- Started: 2026-10-12

## Goal

Every decision that waits on the owner, in every repository the owner names, on one page they can answer from a phone. The page lists each open director call that the Ather pane would list in its own repository, with its options as buttons, the recommended one marked, a typed answer and an explanation on request. An answer is kept with the page. A session then records the answers in each repository the intent skill's way, one pull request per repository, and the page says where each answer stands: answered, recorded (with its PR), settled once the base branch reads it closed.

## Non-Goals

- Listing several repositories in the Ather pane. The pane shows the repository it is in (one-repo-pane); the desk is a separate page.
- Keeping a list of repositories. Each run names its checkouts; nothing is stored for the machine (one-repo-pane D3).
- Deciding anything without the owner's press, or writing to a repository from the page. The page keeps answers; a session records them (decide-in-place D4).
- The rows of a repository's own hand-written registers (Storey's `docs/ROADMAP-DECISIONS.md` "Waiting on a person"). Only intents' findings are read (F-1).
- Sending answers to a cloud session from the page itself (F-2).

## Sources

- L-1: the owner picked "Decision desk" from the proposals and asked for it built in full while away.
- Storey on 2026-10-12: 20 open director calls across 13 intents, 17 of them with options parsed, read by the pane's own `directorCalls` (a probe in this session). Cycle 2 stopped on the owner's answers (`storey/docs/CYCLE2-HANDOFF.md`).
- one-repo-pane (2026-10-11): the pane shows one repository and nothing is set up to choose repositories.
- decide-in-place: options and recommendation parsed from the findings (`parseOptions`), a filled Resolution closes a finding, and the prompt an answer hands the session (`decidePrompt`).
- apmos-wiki `DESIGN.md`: the owner's approved visual language, "The Drawing Set".

## Decisions

- D1 (surface): a claude.ai Artifact page, private to the owner, declaring `db` (the answers), `user` (who answered) and `sample` (Explain). It opens on a phone and on the desktop. The Ather pane is unchanged.
- D2 (what is listed): for each checkout named on the command line, the open intents on its base branch (`baseOf` over its profile and the clone's default branch), read with `readMain` and its pack's `parseIntent`; their `directorCalls`, each with `findingAnswers` (the same options, recommendation and prompts as the pane). Nothing from the working tree: the desk shows what the team sees.
- D3 (answers): one `db` document per decision in the collection `answers`, keyed by repository, intent and finding. It holds the choice (an option's letter, or the typed words), the prompt it hands a session (`decidePrompt`), who answered and when, and a state: `answered`, then `recorded` with the PR, set by the session. An answer can be changed until it is recorded.
- D4 (recording): the `plan` command reads the answers and a fresh collection and lists, per repository, the decisions to record and the exact prompt for each; answers whose finding is already closed on the base branch are settled and left out. The desk skill walks a session through it: a branch per repository, each decision recorded as the intent skill's decision step says, the repository's own gates, one PR, then each answer marked `recorded`.
- D5 (Explain): asks Claude through `sample`, with the finding as written and its options, to explain in plain words without deciding. Hidden where the page cannot ask.
- D6 (look): The Drawing Set (apmos-wiki `DESIGN.md`): warm paper and a ruled grid, one sheet with a title block, mono annotations, a serif title, seal red only for a blocking call (the stop family). Light only, as that system rules out a dark mode. Phone first.
- D7 (code): the pure part in `ather-automata/desk/model.mjs` (no `$`, no Node), the command line in `desk/desk.mjs`, the page template in `desk/page.html`, the procedure in `skills/desk/SKILL.md`. Each reuses the hooks modules that already own the logic; none copies them.

## Acceptance

| Id | Item | Proof |
| --- | --- | --- |
| A1 | `collect` over two or more checkouts lists exactly the pane's director calls of each base branch, with options and prompts, and writes the data and the page. | Unit over git fixtures (base branch, completed intents left out, closed findings left out, a working-tree edit not read); live run over storey and ather-mods. |
| A2 | The page draws every state: waiting (options, recommended marked, typed answer, Explain), answered (change it), recorded (its PR), settled, read-only for a viewer who cannot write, and no `db`. | Playwright over the page with a stand-in `claude`: assertions per state; screenshots at 390 and 1280 px (light only, D6). |
| A3 | `plan` lists per repository what to record with the exact `decidePrompt`, and leaves out recorded, settled and withdrawn answers. | Unit. |
| A4 | The desk skill takes a session from collect to published page to recorded PRs; the plugin validates with it. | `claude plugin validate ather-automata`; a dry run of `plan` and the recording on a scratch clone (no push). |
| A5 | The live desk: published with `db`, `user` and `sample`; one `ArtifactData` list of `answers`. | The artifact link; the list's result. |
| A6 | No regressions; README (The decision desk, Commands, Changes 0.4.0), both manifests at 0.4.0, Paseo copies in step. | `node dev/test-all.mjs`; `claude plugin validate`; `claude plugin test`. |
| A7 | Thermo-nuclear review: no critical finding open. | The review's verdict in progress.md and the PR. |

## Changelog

- rev 1 (2026-10-12): created from L-1.
