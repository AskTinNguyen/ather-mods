---
name: release
description: Give a changed mod its next version, in every place the version is written, with its Changes line, and check it. Use when the person asks to release or bump ather-automata, ather-board or week-calendar, when dev/check-release.mjs fails because a changed mod needs a version, or when main moved and took the version your branch picked. It edits and commits on your branch only; it never pushes to main or merges.
argument-hint: "<ather-automata | ather-board | week-calendar> [patch | minor]"
---

# Release a mod

A mod's version tells every teammate's Claude Code that something changed. It lives in several files, and two PRs must never ship the same number. Pick it from main as it is now, not as it was when the branch started.

## 1. Which mods need one

```bash
git fetch origin main
node dev/check-release.mjs
```

- A **FAIL** names a mod whose shipped files changed on this branch without a new version. A mod ships its folder; `ather-automata` also ships `paseo/ather-automata`.
- A **note** that only the board's copies changed is not a failure. The board does not release for its copies alone (AGENTS.md); they ship with its next real release.
- A fix that will be released in a later PR of its own gets the `release-later` label instead. Then stop here.

## 2. Pick the number

1. Main's version: `git show origin/main:<mod>/.claude-plugin/plugin.json`.
2. Patch (0.6.6 to 0.6.7) for a fix. Minor (0.6.6 to 0.7.0) for something new the person sees or does.
3. Check that no open PR claims it:

   ```bash
   for n in $(gh pr list --state open --json number --jq '.[].number'); do
     gh pr diff "$n" | awk -v n="$n" '/^diff --git/ { file = $3 } file ~ /plugin\.json$/ && /^\+ *"version"/ { print "#" n, file, $0 }'
   done
   ```

   If one claims your number and will merge first, take the next one, and say so in your PR. A stale draft's claim (a number already below main's) does not count.

## 3. Write it everywhere

| Mod | Files |
| --- | --- |
| ather-automata | `ather-automata/.claude-plugin/plugin.json` and its entry in `.claude-plugin/marketplace.json`. Then `npm run sync` in `paseo/ather-automata`, which writes `package.json` and `package-lock.json` |
| ather-board | `ather-board/.claude-plugin/plugin.json` and its entry in `.claude-plugin/marketplace.json` |
| week-calendar | `week-calendar/.claude-plugin/plugin.json` and its entry in `.claude-plugin/marketplace.json` |
| paseo/week-calendar | only when its own files changed: `package.json`, `package-lock.json`, `server/calendar.ts` `VERSION` and its README. check-release only warns here until the owner says whether this port is supported |

## 4. The Changes line

Add one line at the top of the mod's README, under `## Changes`:

```markdown
- **0.6.7** Needs you counts every decision again after /clear. Before, the ones you pressed in the old conversation stayed hidden.
```

- One or two sentences: what the person sees or does differently. Plain words, no file names unless a maintainer needs them.
- A Paseo-only change goes in `ather-automata/README.md` too, ending with "(Paseo 0.6.7)".
- A board release made only because its copies moved can say so: "No change to what you see: Ather's shared modules moved (ather-automata 0.6.7)."

## 5. Check it, before the commit

```bash
node dev/check-release.mjs
claude plugin validate --strict .
claude plugin validate --strict <mod>
```

`validate --strict .` also fails when plugin.json and the marketplace entry disagree. Then run the gates skill (`.agents/skills/gates/SKILL.md`): `npm run sync` touched files that test-all checks.

## 6. Commit, then check the tag

```bash
git commit -m "release(<mod>): <version>"     # or as part of the feature's last commit
claude plugin tag --dry-run <mod>
```

- `tag --dry-run` refuses uncommitted version files, so it comes after the commit. It creates nothing.
- If it says something is uncommitted, commit it. Never add `--force`, and never run `tag` without `--dry-run`: the team does not tag releases.

## 7. Again after main moves

A green release check is only as fresh as the main it ran against. Two PRs can each pass with the same number.

- After every merge of main into the branch, run `node dev/check-release.mjs` again. If main took your number meanwhile, pick the next one, rewrite the Changes line, run `npm run sync` again and commit.
- main requires branches to be up to date before merging, so GitHub asks for exactly this before the merge button works. Do not get round it.
- Never push to main and never merge. The owner gives the go.
