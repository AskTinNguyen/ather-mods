---
name: intent
description: Run a feature as a living intent in docs/intent/<feature>/, followed by a background worker. Use when the user types /intent, and also when the user invokes any other skill with a prompt that asks to build, change, or fix a feature (auto-capture). Not for one-off utility skills or questions.
---

# Intent-Driven Sessions

One feature, one living intent. The user's prompt becomes `docs/intent/<feature>/prompt.md`. A background worker executes against it until the acceptance list is met. Every later prompt is logged verbatim and either amends the intent, answers a finding, or is answered from progress. The folder is committed, so any later session resumes from the files alone.

## Invocation

The user types at most one command. Everything else is plain conversation.

| The user | You do |
| --- | --- |
| `/intent <prompt>` | Start a new intent from the prompt. |
| Invokes another skill with a feature prompt | Auto-capture: start a new intent, with that skill as the worker's skill. |
| `/intent` alone | List open intents (status, rev, blocking findings). If exactly one is active or parked, resume it; otherwise ask which. |
| Says "park it" / "we're done" | Set `Status: parked` or `completed`, stop the worker, commit. |
| Anything else while an intent is active | Route it through the orchestrator loop below. No command needed. |

### Starting

Infer everything the user did not say:

- **Feature name:** a short kebab-case slug from the prompt. If `docs/intent/<slug>/` exists and is not the same feature, add a distinguishing word.
- **Skill:** the invoked skill for auto-capture; otherwise the best match among the skills this repository has (`.claude/skills`, `.agents/skills`) and its `AGENTS.md`, or `none` when no skill fits.
- **Area:** exactly one from the list in [docs/intent/README.md](../../../docs/intent/README.md#areas). Never invent a new area; pick the closest. `.ather/profile.json` repeats the list; change both together.
- **Owner:** the person who asked for the feature, as `git config user.name` spells them. When that name is not a person's (a team or shared-workstation name such as `Cinematic`), ask the user once for their own name and use it: the Owner line is how teammates see whose intent it is.
- **Issue:** when the work comes from a GitHub issue, `#<number>` (run the issue preflight first: `gh issue view <number>` and `gh pr list --search <number>`, to find work that already exists). Leave the line out otherwise.
- **Acceptance:** items with ids drafted from the prompt, each naming its proof; no checkboxes.

Then reply with one short block, and start the worker in the same turn without waiting for confirmation:

> Started **<slug>** (rev 1), area <Area>, skill `<skill>`.
> Done when: A1 … A2 … A3 …
> Rename it, change the area or skill, or change the list by just saying so.

A correction to any of these is an ordinary `intent` message: amend, bump the rev, continue.

### Auto-capture

When the user invokes a skill other than `intent`, capture only if the prompt asks to build, change, or fix something that takes more than one step. Do not capture one-off utilities (a skill that runs one command, opens or closes a tool, or looks something up), questions, reviews, or reports. When unsure, capture.

On capture, run the skill's task through the intent: the skill becomes the worker's skill and the prompt becomes L-1. Open the reply with one line: `Tracking this as intent **<slug>**; say "no intent" to skip.` If the user says "no intent", delete the uncommitted folder, stop the worker if it has not committed anything, and continue as a plain skill run.

If an intent is already active and the new skill prompt clearly belongs to it, log it as an `intent` message on that intent instead of starting another.

## Files And Ownership

Copy the templates from `assets/templates/` into `docs/intent/<feature>/`. One writer per file, and each fact in one place:

| File | Writer | Content |
| --- | --- | --- |
| `prompt.md` | Orchestrator only | The intent: goal, non-goals, decisions, acceptance (what done means: ids and proofs, no checkboxes), constraints, changelog. Carries `Rev` and `Status`. |
| `log.md` | Orchestrator only | Append-only. Each user prompt verbatim, with its classification and the rev it produced. |
| `progress.md` | Worker only | The `- PR:` line; the Acceptance table (one row per acceptance id: `met` or `open`, with evidence); current step, next step, completed steps with evidence, reconciliation notes. |
| `findings.md` | Worker adds, orchestrator resolves | Discoveries that may change the intent, each with a proposed amendment. |

Whether an item is met lives only in the `progress.md` table; never tick or annotate it in `prompt.md`. The worker never edits `prompt.md`. A worker that thinks the intent is wrong writes a finding. This keeps the spec from drifting toward whatever was built.

Findings are for changes to the intent and for product direction, production deploys, cost, and security calls, which go to the user as options with a recommendation. Engineering decisions inside the intent's scope are the worker's to make; it records them in `progress.md` and moves on.

## Orchestrator Loop

1. **Capture.** Append the user's message verbatim to `log.md`. Replace credentials, tokens, and machine-specific paths with `<redacted>` or `<local path>`. The repository rule against committing secrets and machine paths applies to verbatim prompts too.
2. **Classify** the message and record the class in the log entry:
   - `intent`: new goal, correction, or change of direction. Amend `prompt.md` directly, bump `Rev`, add a changelog line citing the log entry, and tell the user the new rev in one line. Amendments apply without a confirmation round-trip.
   - `decision`: answers a finding. Mark the finding `accepted` or `rejected`, fold accepted amendments into `prompt.md` (bump `Rev`), and add a `Decisions` entry.
   - `question`: answer from `progress.md` and `findings.md`. No rev change.
   - `aside`: unrelated to the intent. Handle it normally; log it with that class only.
3. **Dispatch.** If the worker is running, send it the new rev on its existing thread (Claude Code: `SendMessage`) so it keeps its context. If no worker is running and work remains, start one in the background with the brief in `assets/worker-brief.md`, on the most capable model the harness offers (Claude Code: an Opus `Agent`). Record the agent name in `progress.md` → `Worker`.
4. **Review** each worker report against the acceptance list and the evidence it cites. Do not accept a claim without its evidence row. Relay to the user in plain language: what changed, what was proven, and the open blocking findings as decisions for them.
5. **Close.** When every row of the `progress.md` Acceptance table is `met` and every PR on its `- PR:` line is merged (`gh pr view <n> --json state`), set `Status: completed`, add a changelog line, stop the worker, commit, and report scope, checks, residual risk, and follow-ups. Check this whenever you read an intent, not only after a worker report: a PR merged outside the loop still closes its intent.

On the first capture, draft `Acceptance` as items with ids from the prompt and show them to the user with rev 1. Their correction, if any, becomes rev 2.

## Worker Rules

The brief in `assets/worker-brief.md` holds the full contract. The essentials:

- Load the named skill and every `AGENTS.md` that applies to the paths it touches.
- Re-read `prompt.md` at each step boundary. If `Rev` changed, write a reconciliation note in `progress.md` (what stays valid, what is redone, what is dropped), then continue under the new rev.
- Keep steps small enough that a rev change never costs more than one step.
- Update `progress.md` after every step with evidence: the commit hash, and the output of a gate that `.ather/profile.json` names (the command, its exit code and its pass count), or review. Cite files as `<local path>/...` and do not write machine paths.
- Stop and report on: every acceptance item met; a `blocking` finding; another live session holds the worktree or a shared resource you need; a destructive, production, cost, or security action; a rate limit. Production deploys and secret changes stay held for a person.
- Commit with exact paths, including the intent folder, on the feature branch. Never force-push. Never touch another session's uncommitted files.

## Git

- The intent folder lives on the feature's branch and lands with the feature's PR. Commit it in the same commits as the work it describes, or in a separate `intent(<feature>): rev N` commit.
- For an intent-driven feature, `progress.md` is the execution record. No separate plan document is required.
- Checkouts are shared with other live sessions. Do branch work in a separate worktree (sparse when disk is tight), never by switching the shared checkout, and use path-scoped git commands only. The main checkout can hold a person's uncommitted work: use `git worktree add <local path>/<name> -b <branch> origin/main`. Do not run `git stash`: worktrees of one repository share the stash list.

## Resuming In A New Session

Agent names do not survive sessions. On `/intent` (or when the user names a parked intent), read all four files. If the intent is done (every Acceptance row `met`, every PR merged), close it first (step 5) instead of starting a worker. Otherwise summarize status in five lines or fewer, list open blocking findings, and start a fresh worker from the brief. The files are the whole state; do not rely on chat history or memory for it.
