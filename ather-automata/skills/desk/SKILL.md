---
name: desk
description: The decision desk. Gathers every decision that waits on the owner in the repositories they name (the open director calls in their intents' findings, from each base branch) into one private claude.ai page they answer from a phone, then records the answers in each repository the intent skill's way, one pull request per repository. Use for "decision desk", "what waits on me across my repos", "put my decisions on a page", "record my desk answers", or /ather-automata:desk.
---

# The decision desk

The desk is a page, not the Ather pane: the pane shows the repository it is in, and the desk is where several meet. It lists what the pane would list under Needs you as a decision in each repository, with the same options and the same prompts. The page keeps the owner's answers. This skill reads them back and records them. It never decides anything itself.

`DESK` below is `${CLAUDE_PLUGIN_ROOT}/desk/desk.mjs`. Work files go in the session's scratch folder, never in a checkout.

## 1. Collect

The checkouts are the ones the person names, as folders on this machine. Nothing is kept between runs: when they name none, use the checkout the session is in and say that others can be named.

```bash
node "$DESK" collect <checkout> [<checkout> ...] --fetch --out <scratch>/desk
```

`--fetch` fetches each base branch first, as the pane does. Each checkout's line says how many calls wait in how many open intents and which commit was read. A checkout with no `docs/intent` on its base branch lists nothing; one that is no git checkout stops the run with its reason: drop it and say so.

## 2. Publish

Load `artifact-capabilities` and `artifact-design` once if this session has not. Then publish `<scratch>/desk/index.html` with the Artifact tool:

- **The first desk:** `icon: "checklist"`, a one-sentence description, and these capabilities, so only the owner and editors write answers and everyone the page is shared with can read it:
  `{ "db": { "rules": [{ "path": "answers", "read": "view", "write": "admin" }] }, "user": {}, "sample": {} }`
- **An existing desk:** find it (the link the person gives, or `action: "list"` for the title "Decision Desk"), read it, and publish to its `url` without `capabilities`, so it keeps them. Its answers live in its database and survive the republish.

After a first publish, run one `ArtifactData` `list` of `answers` to see the store answers, and give the person the link.

## 3. Record the answers

When the person asks to record, or a scheduled run finds answers:

1. `ArtifactData` `list` of the collection `answers` on the desk's URL. Write the rows to `<scratch>/desk/answers.json` as they came.
2. Collect again (step 1) so the plan reads today's base branches, then:
   ```bash
   node "$DESK" plan <scratch>/desk/desk.json <scratch>/desk/answers.json
   ```
   `answers.json` is a JSON array of the list's rows, each `{ "id": …, "data": { …the answer… } }`; `plan` refuses anything else.
   It lists, per repository, each decision to record and its **Prompt**; under **Ask again**, answers it will not guess at (a letter the finding no longer offers); and the answers already recorded or settled.
3. For each repository in the plan, in its checkout:
   - Start a branch `desk/decisions-<YYYY-MM-DD>` from `origin/<base>` (a worktree when the checkout has other work in it).
   - Treat each **Prompt** as the owner's own message and follow the repository's intent skill (`.agents/skills/intent/SKILL.md`, or the one its `AGENTS.md` names) the way it handles one: capture it in the intent's `log.md` (the Prompt verbatim, as a decision), then its decision step: set the finding's status, fill its Resolution in the finding's own layout (the answer, the date, "by the owner, from the decision desk"), and fold the accepted change into `prompt.md` as a Decisions entry with a Rev bump and a Changelog line. Where the finding has no proposed amendment, the Decisions entry states the answer.
   - Record what the owner said and nothing more. An answer in words that covers only part of a proposed amendment folds only that part; an answer that seems to settle another open finding too does not close it. Name both in the pull request under "For the owner" instead.
   - Follow the repository's `AGENTS.md` for every file that mirrors an intent: Storey regenerates its tracker (`npm run tracker`, or `npx -y tsx scripts/tracker.ts` without `node_modules`) and keeps `docs/ROADMAP-DECISIONS.md` "Waiting on a person" current.
   - Decisions change the intent's spec, not its code: a change the decision calls for is the intent worker's next step, named in the pull request under "Follow-ups".
   - Run the gates the repository's `AGENTS.md` asks for on any change (install its dependencies first when they are missing), commit, push the branch and open a pull request into the base branch. Its body lists each decision (id, the answer, the finding's link), then "For the owner" and "Follow-ups" when they have entries.
   - `ArtifactData` `update` each recorded answer's document (`answers/<repo>~<slug>~<finding>`): `state: "recorded"`, `pr: <the pull request's URL>`.
4. Tell the person, in one short list: per repository, the pull request and what it records; then anything under **Ask again**.

Once a pull request merges, the next collect no longer lists its findings, and the page shows those answers as settled.

## Rules

- Never choose an answer, fill a Resolution the owner did not give, or record a `withdrawn` answer.
- Never push to a base branch or merge: the pull request is the record, and its review is the owner's.
- An answer typed in words is recorded in those words. When they leave the decision unclear, record nothing for it and say so.
- The desk is private to the owner. Do not share its link or make it public.
