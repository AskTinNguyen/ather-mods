# Intents

An intent is one feature, tracked as a living record in a folder of this
directory. The folder is committed to Git. A new session can resume the work
from the files alone.

The skill that runs intents is
[.agents/skills/intent/SKILL.md](../../.agents/skills/intent/SKILL.md). Read it
before you create or change an intent. Ather Automata reads this structure with
the profile in `.ather/profile.json`.

## Folder rules

- Each intent has its own folder: `docs/intent/<slug>/`. The slug is a short
  kebab-case name.
- Each folder has four files: `prompt.md`, `progress.md`, `findings.md`, and
  `log.md`. Copy them from `.agents/skills/intent/assets/templates/`.
- `prompt.md` holds the goal, the decisions, and the acceptance list. Only the
  orchestrator edits it.
- `progress.md` holds the acceptance table (`met` or `open`, with evidence) and
  the `- PR:` line. Only the worker edits it.
- `findings.md` holds discoveries that can change the intent. The worker adds
  entries. The orchestrator resolves them.
- `log.md` is append-only. It holds each user prompt verbatim, with secrets and
  machine paths replaced by `<redacted>` or `<local path>`.
- An item is `met` only in the `progress.md` table. Do not mark it in
  `prompt.md`.
- Each header line uses the form `- Field: value`. The header has `Rev`,
  `Status`, `Area`, `Owner`, `Skill`, `Branch`, and `Started`.
- `Area` is one name from the list below. Do not add an area in an intent. Add it
  to this list and to `.ather/profile.json` in one change.
- Do not commit secrets, tokens, or machine-specific paths.
- Do branch work in a separate Git worktree. Do not use the main checkout.

## Areas

- `<area>`: <what it covers, and the folders it lives in>.
