# Working in ather-mods

Rules for every agent (Claude Code, Cursor, Codex) and every person who changes this repository. The mod READMEs say what each mod does; this file says how to change them.

## Map

- `.claude-plugin/marketplace.json`: the `ather` marketplace. It lists the four mods.
- `ather-automata/`: Ather in Claude Code. `hooks/ather.mjs` loads two halves: `watch.mjs` (guards, the brief gate, keep-warm, away windows) and `console.mjs` (band, pane, pop-ups, `/ather`, `/away`). Pure modules sit beside them; `hooks/packs/` holds each stack's words, proofs and holds.
- `ather-board/`: `/board` and the shareable page (`page/`). `hooks/ather/` is a copy.
- `ather-lanes/`: `/lanes`, the machine's S2 agent lanes as a board. `hooks/ather/` is a copy.
- `week-calendar/`: the weekly calendar and report for agent PCs (`scripts/`, `hooks/register.ts`).
- `paseo/`: the same mods as Paseo plugins. `server/ather/` and `*.generated.ts` are copies.
- `dev/`: the gates (`test-all.mjs`), the e2e harness, benches.
- `docs/intent/<slug>/`: planned work (see Intents).
- `.agents/skills/`: this repo's skills (see Skills).

## Golden rules

- **Never edit a copy.** `ather-board/hooks/ather/`, `ather-lanes/hooks/ather/`, `paseo/ather-automata/server/ather/`, `paseo/*/server/*.generated.ts` and `.claude/skills/` are written by scripts. Edit the source (`ather-automata/hooks/`, `week-calendar/scripts/`, `.agents/skills/`) and run the sync. A merge conflict in a copy: fix the source, sync again.
- **`$` stays in its host file.** In ather-automata and ather-board only `ather.mjs`, `watch.mjs`, `console.mjs` and `ather-board/hooks/index.mjs` touch `$` (week-calendar's host is `hooks/register.ts`). Other modules take closures (Io, Repo, Host). `claude plugin validate` refuses `$` passed into an imported function.
- **Stored values go through `state.mjs`** (or a `*-store.mjs` beside it on the same `serial` queue). The store is one JSON file per machine, 4 MiB at most: a new kind of key says who deletes it. `serial` orders one session only.
- **Hooks never block or fail the calls they watch,** except a held action, which refuses on purpose. Do not add a new `.catch(() => null)` on a hold path.
- **No file crosses 1,000 lines, and no file already over 1,000 grows.** Either is a critical finding (`node dev/check-size.mjs`). `console.mjs` is over: put new console work in a module of its own, or move code out first.
- **Stack differences live in the pack.** No `pack.id === ...` checks outside `hooks/packs/`.
- **Shared code reaches the board and Paseo.** Decide the Paseo side in the PR: shared, ported, or a line under `## Limits` in `paseo/ather-automata/README.md`.

## Syncs

| You changed | Run |
| --- | --- |
| `ather-automata/hooks/**` | `node dev/sync-shared.mjs <mod>` for each mod with a `shared.json` (ather-board, ather-lanes), then `npm run sync` in `paseo/ather-automata` (`npm run art` too if `squad.mjs` kinds or props changed) |
| `week-calendar/scripts/**` | `npm run embed` in `paseo/week-calendar`. A new `scripts/lib` file also goes in `SCRIPT_FILES` (`week-calendar/hooks/register.ts`) |
| `.agents/skills/**` | `node dev/skills.mjs` |

Run them before the gates: `test-all` checks the copies first and stops there.

## Gates

- Every code change: `node dev/test-all.mjs`. It stops at the first failing stage, and a skipped stage is not a pass. `S2_ROOT`, `CLAUDE_CODE_TYPES` and `npm ci` in `paseo/*` turn on its optional stages.
- `week-calendar/`: `node --test week-calendar/scripts/test/*.test.mjs` (not in test-all).
- A changed mod: `claude plugin validate --strict <mod>` and `claude plugin test <mod>`. A changed marketplace: `claude plugin validate --strict .`.
- When something fails, run the same on `origin/main` and compare FAIL lines by name.

Details, env vars and Windows notes: the `gates` skill.

## Every code change gets a thermo-nuclear review

A code change is any change to a file that is not prose (Markdown). `.json` counts, except a release PR that only moves version numbers: it needs no review. Before you commit a code change you are handing over (a push, a PR, the end of your task), and again before you open or update a PR:

1. Run [`.agents/skills/thermo-nuclear-code-quality-review/SKILL.md`](.agents/skills/thermo-nuclear-code-quality-review/SKILL.md) on the branch's whole diff against `origin/main`, without the copies. The `pr` skill gives the diff and this repo's own checks.
2. Clear every critical finding the skill's Approval Bar names (a code-judo move left on the table, a file pushed over 1,000 lines or one over 1,000 that grows, tangled branching, scattered feature checks, a needless wrapper or cast, a duplicated helper or wrong layer). Fix, review again, repeat until none. Only the repository owner can accept a critical finding, in writing, with the reason, in the PR.
3. Keep the gates green before and after. A restructuring does not change behaviour.
4. The PR has a **Thermo-nuclear review** section with one line `Verdict: pass` (or `approve`; `block` while a finding is open), then each finding and the commit that fixed it. An intent's `progress.md` records the same.

A change with an open critical finding stays a draft.

## Releasing

A mod's version tells teammates' Claude Code that something changed. Use the `release` skill. In short:

- Pick the next version from `origin/main` as it is now, never one an open PR already claims. Check again after every merge of main.
- Write it in `<mod>/.claude-plugin/plugin.json` and its entry in `.claude-plugin/marketplace.json`. For ather-automata, `npm run sync` in `paseo/ather-automata` writes the Paseo package files.
- Add one line at the top of `## Changes` in the mod's README: `- **x.y.z** what the person sees or does differently.`
- ather-board does not release when only its copies (`hooks/ather/`) move; they ship with its next release.

## Intents

- One folder per piece of work: `docs/intent/<slug>/` with `prompt.md` (Rev, Status, Area, Owner, Skill, Branch, Started; Goal, Non-Goals, Sources, Decisions, Acceptance), `progress.md` (steps, gates, review, `- PR: #N`) and `log.md` (prompts, append-only).
- Status starts with `active`, `parked` or `completed` (a note may follow). Ather treats any other word as unknown.
- From now on: branch `intent/<slug>`; other work `fix/<slug>`, `release/<mod>-<version>`, `paseo/<slug>`. Commits e.g. `feat(<mod>): ...`, `fix(<mod>): ...`, `refactor(<slug>): ...`, `docs(<slug>): ...`, `test(<area>): ...`, `release(<mod>): x.y.z`, `intent(<slug>): ...`.
- The unit tests read some of these intents, so a Markdown edit here can still fail a gate.
- Use the `intent` skill to start, advance or close one.

## Skills

Sources live in `.agents/skills/<name>/`. `.claude/skills/` holds copies for Claude Code: never edit those.

| Skill | Use it |
| --- | --- |
| `gates` | before you commit or hand over; when a check fails |
| `pr` | to run the thermo-nuclear review and write the PR description |
| `shared-change` | after any edit to `ather-automata/hooks` or `week-calendar/scripts` |
| `release` | to give a mod its next version |
| `intent` | for anything under `docs/intent/` |
| `plugin-authoring` (Claude Code's own skill, not in this repo) | before changing a mod's hooks: the engine API, and the types the type-check uses |

## Writing

- Words people read (pane text, READMEs, Changes): short, plain, concrete sentences that say what the person sees and does ("what needs you", "Heading off?"). No jargon.
- The repository is public. In `log.md` and PRs, redact credentials, machine paths and anything from S2 that is not already public.

## Never

- Push to `main`.
- Merge without the repository owner's go, written in the PR.
- Ship a version number that `main` or another open PR already uses.
- Edit a generated copy, or resolve a conflict inside one.
- Open a PR as ready while a critical finding is open, or call a skipped gate a pass.
