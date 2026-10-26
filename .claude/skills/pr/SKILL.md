---
name: pr
description: Hand over a code change in ather-mods - run the thermo-nuclear review on the right diff with this repo's own checks, clear the critical findings, then write the PR description the team expects (gates, review, release, Paseo, go). Use before you commit a code change you are handing over, before you open or update a PR, or when asked for a thermo-nuclear review of a branch.
argument-hint: "[base ref, default origin/main]"
---

# Hand over a change

AGENTS.md asks for a thermo-nuclear review of every code change, all critical findings cleared, the gates green before and after, and a PR that shows it. This is how, in this repository.

A code change is any change that is not Markdown: `.mjs`, `.js`, `.ts`, `.tsx`, `.json` and the like. A Markdown-only change, or a release that only moves version numbers, needs no review; go to step 4.

## 1. The diff to review

The whole branch against what it merges into, without the generated copies (review their sources instead):

```bash
git fetch origin main
git diff origin/main...HEAD -- . ':!ather-board/hooks/ather' ':!paseo/ather-automata/server/ather' ':!*.generated.ts' ':!.claude/skills'
```

## 2. Run the review

Read `.agents/skills/thermo-nuclear-code-quality-review/SKILL.md` and follow it on that diff, as written. In Claude Code you can also type `/thermo-nuclear-code-quality-review`.

Then add this repository's own checks. Each one it fails is a critical finding:

- **One home for each thing.** The look and its colours: `rows.mjs`. Stored values: `state.mjs`, or a `*-store.mjs` beside it on the same `serial` queue. Collision words: `collide.mjs` and the board's `views.mjs`. Stage words and glyphs: `worklist.mjs`. Anything one stack does differently: its pack in `hooks/packs/`, never a `pack.id === ...` check outside `packs/`. A second copy of any of these is a duplicated helper.
- **`$` stays put.** Only `watch.mjs`, `console.mjs`, `ather.mjs` and `ather-board/hooks/index.mjs` touch `$`. Other modules take closures (Io, Repo, Host). `claude plugin validate` refuses `$` passed into an imported function.
- **The store.** It is one JSON file per machine, and a set past 4 MiB is refused. A new kind of key says who deletes it and when (`prune` in `state.mjs`). `state.serial` orders writes inside one session only: a new read-modify-write of a key another session also writes is critical until the live check D7 in `docs/intent/away-many-sessions/progress.md` says the store allows it.
- **Holds do not fail open.** On the path that holds a merge or push during an away window, new code must not turn an error into "not held": no new `.catch(() => null)` or "off" fallback there.
- **Both sides of a copy.** A flow that exists in the mod and again in Paseo (`statusText` and `toolList`, the deny texts, `auditMerge`, `COMMAND_WORDS`) changed on one side only, with no Limits line: say so (the shared-change skill).

And one size rule (AGENTS.md):

- **Size.** Run `node dev/check-size.mjs`. A file pushed from under 1,000 lines to over 1,000 is critical, and so is any growth of a file already over 1,000 (today `console.mjs`): give the new code a module of its own, or move code out first. Only the owner's `size-accepted` label lets a PR through, and CI fails without it.

## 3. Clear what is critical

Fix each critical finding in its own commit. Run the review again on the new diff. Repeat until it reports none. Keep each round: its verdict, the findings by id (C1, C2, ...) and the commit that fixed each. You cannot waive a critical finding yourself; only the repository owner can, in writing, in the PR.

## 4. Gates, release, Paseo

- Gates before and after: the gates skill (`.agents/skills/gates/SKILL.md`).
- Versions: `node dev/check-release.mjs`. For every mod it fails on, read `.agents/skills/release/SKILL.md` and follow it, or add the `release-later` label. Notes about the board's copies are the owner's call: say them in the Release section.
- Shared code: the shared-change skill (`.agents/skills/shared-change/SKILL.md`) says what the board and Paseo need.

## 5. The PR

Use the sections of `.github/pull_request_template.md`, in this order:

1. **Summary.** What the person sees or does differently, in plain words. The intent and its rev, if there is one.
2. **Gates.** The table from the gates skill: base and after, what was skipped and why, the FAIL lines that are main's.
3. **Thermo-nuclear review.** First one line, `Verdict: pass` (or `Verdict: approve`, or `Verdict: block`), for the last round, with nothing else on it. CI reads it (`dev/check-verdict.mjs`) and fails a ready PR whose verdict is `block`, missing, or said twice. Then a table of rounds: each critical finding by id, what it was in one line, and the commit that fixed it. Then the findings left open, each with why, and the size numbers from step 2.
4. **Release.** Each mod's version change and its Changes line, or `release-later`, or "no mod changed". Any board-copies note from check-release.
5. **Paseo.** Shared, ported (files), or not here yet (the Limits line).
6. **Go.** Empty until the owner gives it: who and when.

Open the PR as a draft while any critical finding is open. Mark it ready only when the review reports none and the gates show nothing new. Do not merge, and do not push to `main`: the owner gives the go.

## 6. When the work is an intent

Record the same as a step in its `progress.md`: the review's verdict with the rounds, and the gates line. Keep the `- PR: #<n>` line at the top of `progress.md` current.
