# Setting up intents in a repository

This page adds the intent structure to a repository. An intent is one
feature, tracked as a living record in `docs/intent/<feature>/`, so a new
session can resume the work from the files alone.

You may be an agent or a person. The intent skill and the project contract
come from the public repository https://github.com/AskTinNguyen/intent. This
page carries what that repository does not have: the steps below, the profile
Ather Automata reads (`profile.example.json`, beside this page), the ignore
line and the pointer paragraph.

## What gets added

| Piece | Path in the repository | From |
| --- | --- | --- |
| The skill | `.agents/skills/intent/` | `skills/intent/` of the public repository, copied unchanged |
| The readme | `docs/intent/README.md` | the project contract, drafted as the skill's `references/setup.md` says, from its `assets/contract.md` |
| The profile | `.ather/profile.json` | written in the shape of `profile.example.json`, beside this page |
| The ignore line | `.gitignore` | this page: one line, `.ather/local/` |
| The pointer | `AGENTS.md` | this page: the paragraph in step 9 |

## Rules

- Ask before you write. Propose the contract and the gates, and wait for the
  person to confirm them.
- Never overwrite a file that exists. Where a piece is already there, leave it
  and add only what is missing.
- Never change an intent that already exists under `docs/intent/`.
- Do not create a sample intent.
- Work on a new branch. Do not commit until the person says so.
- Where the skill's `references/setup.md` and this page differ, this page
  wins. That file asks one question at a time, offers its own pointer line and
  commits on a branch. Here you ask once (step 4), add the paragraph in step 9
  and leave everything uncommitted.

## Steps

1. **Read the repository.** Read its README, its `AGENTS.md` or `CLAUDE.md`,
   the top-level folders, the package scripts or test runners, and the CI
   workflows. Note which of the five pieces above already exist.

   When the skill or the readme is missing, clone the public repository to a
   temporary folder outside the repository:

   ```
   git clone --depth 1 https://github.com/AskTinNguyen/intent
   ```

   When both are already there, no clone is needed.

2. **Draft the contract.** The contract is `docs/intent/README.md`.

   When it is missing, draft it the way the clone's
   `skills/intent/references/setup.md` says, from
   `skills/intent/assets/contract.md`. Do not write it yet. When
   `.ather/profile.json` already lists `areas`, use that list. When intents
   already exist under `docs/intent/`, keep every name their `- Area:` lines
   use, spelled the same: an intent whose area is not in the list is shown as
   unsorted.

   When it is already there, leave it as it is. Read its areas and its proofs:
   the profile repeats them, and you propose no new ones.

3. **Propose the gates.** A gate is a command that proves something about the
   work. Take the gates from the commands the contract's Proofs table lists.
   Where the contract lists none, take them from the scripts and CI workflows
   you read. Do not invent a command the repository does not have. For each
   gate give:
   - `id`: a short name, for example `tests`;
   - `command`: the command as a person runs it from the repository root;
   - `proofs`: what a pass proves, one or more of `tests`, `lint`, `build`
     and `ui`;
   - `proves`: one line that says what the command checks.

4. **Ask once.** Show what you will write and ask the person to confirm or
   change it, in one question: the gates, and for a contract you drafted, its
   short summary (areas, proofs, merge authority, and what you could not
   tell). Write nothing before the answer.

5. **Copy the skill.** Copy the clone's `skills/intent/` to
   `.agents/skills/intent/` without changing it.

   Claude Code loads skills only from `.claude/skills/`. Make the skill
   loadable there: create `.claude/skills/intent` as a relative link to
   `../../.agents/skills/intent`. Where links do not work (Windows without
   developer mode, for example), copy the folder instead.

6. **Write the readme.** Write the confirmed contract to
   `docs/intent/README.md`. Skip this step when the file was already there.

7. **Write the profile.** Write `.ather/profile.json` in the shape of
   `profile.example.json`, beside this page:
   - `version`: `1`;
   - `pack`: `unreal` when a `*.uproject` file is at the repository root,
     `web` otherwise;
   - `gates`: the confirmed gates;
   - `mergePolicy`: `hold`;
   - `areas`: the area names in the contract, spelled the same;
   - `base`: only when the team merges into a branch that is not the remote's default branch, that branch's name.

8. **Add the ignore line.** Add `.ather/local/` on a line of its own to
   `.gitignore`. Create the file when there is none.

9. **Add the pointer.** Add this paragraph to `AGENTS.md`:

   ```
   Feature work that takes more than one step runs as an intent. Use
   `.agents/skills/intent/SKILL.md`. The project contract and the area list
   are in `docs/intent/README.md`.
   ```

   When the repository's instruction file is `CLAUDE.md` and it has no
   `AGENTS.md`, add it to `CLAUDE.md`. When it has neither, create `AGENTS.md`
   with the paragraph. A file that already points at `docs/intent/README.md`
   or at the skill needs nothing.

10. **Report.** List the files you added and the lines you added to existing
    files. Leave them uncommitted for the person to read.

## After setup

To begin a feature, type `/intent` and what you want. With Ather Automata
installed, `/ather` shows the repository's intents and what is next. A session
that was open before the setup reads the profile when it next starts.

The areas live in two places, `docs/intent/README.md` and
`.ather/profile.json`. Change both in one change.
