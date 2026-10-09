# Setting up intents in a repository

This bundle adds the intent structure to a repository. An intent is one
feature, tracked as a living record in `docs/intent/<feature>/`, so a new
session can resume the work from the files alone.

You may be an agent or a person. Nothing else is needed: the files to add are
under `files/` next to this page, and the steps are below.

## What gets added

| Piece | Path in the repository | From |
| --- | --- | --- |
| The skill | `.agents/skills/intent/` | `files/.agents/skills/intent/`, copied unchanged |
| The readme | `docs/intent/README.md` | `files/docs/intent/README.md`, with the areas filled in |
| The profile | `.ather/profile.json` | written from `files/.ather/profile.example.json` |
| The ignore line | `.gitignore` | one line: `.ather/local/` |
| The pointer | `AGENTS.md` | the paragraph in `files/AGENTS.intent.md` |

## Rules

- Ask before you write. Propose the areas and the gates, and wait for the
  person to confirm them.
- Never overwrite a file that exists. Where a piece is already there, leave it
  and add only what is missing.
- Never change an intent that already exists under `docs/intent/`.
- Do not create a sample intent.
- Work on a new branch. Do not commit until the person says so.

## Steps

1. **Read the repository.** Read its README, its `AGENTS.md` or `CLAUDE.md`,
   the top-level folders, the package scripts or test runners, and the CI
   workflows. Note which of the five pieces above already exist.

2. **Propose the areas.** An area is a part of the product that work belongs
   to. Propose 5 to 13 of them, each a short kebab-case name with one line that
   says what it covers and where it lives. For example:

   ```
   - `api`: the HTTP API and its handlers (`server/api/`).
   ```

   When the repository already has an area list (`## Areas` in
   `docs/intent/README.md`, or `areas` in `.ather/profile.json`), use that
   list as it is and propose nothing new. When intents already exist under
   `docs/intent/`, keep every name their `- Area:` lines use, spelled the
   same: an intent whose area is not in the list is shown as unsorted.

3. **Propose the gates.** A gate is a command that proves something about the
   work. For each one give:
   - `id`: a short name, for example `tests`;
   - `command`: the command as a person runs it from the repository root;
   - `proofs`: what a pass proves, one or more of `tests`, `lint`, `build`
     and `ui`;
   - `proves`: one line that says what the command checks.

   Take the gates from the scripts and CI workflows you read. Do not invent a
   command the repository does not have.

4. **Ask once.** Show the areas and the gates together and ask the person to
   confirm or change them, in one question. Write nothing before the answer.

5. **Copy the skill.** Copy `files/.agents/skills/intent/` to
   `.agents/skills/intent/` without changing it.

   Claude Code loads skills only from `.claude/skills/`. Make the skill
   loadable there: create `.claude/skills/intent` as a relative link to
   `../../.agents/skills/intent`. Where links do not work (Windows without
   developer mode, for example), copy the folder instead.

6. **Write the readme.** Copy `files/docs/intent/README.md` to
   `docs/intent/README.md`, and replace the one placeholder line under
   `## Areas` with the confirmed areas, one line each.

7. **Write the profile.** Write `.ather/profile.json` in the shape of
   `files/.ather/profile.example.json`:
   - `version`: `1`;
   - `pack`: `unreal` when a `*.uproject` file is at the repository root,
     `web` otherwise;
   - `gates`: the confirmed gates;
   - `mergePolicy`: `hold`;
   - `areas`: the confirmed area names, the same list as in the readme.

8. **Add the ignore line.** Add `.ather/local/` on a line of its own to
   `.gitignore`. Create the file when there is none.

9. **Add the pointer.** Add the paragraph in `files/AGENTS.intent.md` to
   `AGENTS.md`. When the repository's instruction file is `CLAUDE.md` and it
   has no `AGENTS.md`, add it to `CLAUDE.md`. When it has neither, create
   `AGENTS.md` with the paragraph.

10. **Report.** List the files you added and the lines you added to existing
    files. Leave them uncommitted for the person to read.

## After setup

To begin a feature, type `/intent` and what you want. With Ather Automata
installed, `/ather` shows the repository's intents and what is next. A session
that was open before the setup reads the profile when it next starts.

The areas live in two places, `docs/intent/README.md` and
`.ather/profile.json`. Change both in one change.
