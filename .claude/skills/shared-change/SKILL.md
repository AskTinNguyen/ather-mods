---
name: shared-change
description: Bring a change to shared code along to every place that carries it - the board's copies, the Paseo port and the week calendar's embedded scripts - and decide what the Paseo side does. Use after you change anything in ather-automata/hooks or week-calendar/scripts, when a sync check fails, or when you resolve a merge conflict in a copied file.
---

# A change to shared code

`ather-automata/hooks` and `week-calendar/scripts` are copied into other plugins, because an installed plugin carries only its own folder. One change to them can change three things people run: Ather in Claude Code, the board, and the Paseo plugins.

## 1. Where the copies go

| Source | Copy | How |
| --- | --- | --- |
| `ather-automata/hooks/*.mjs`, `hooks/packs/*.mjs` | `ather-board/hooks/ather/` | `node ather-board/sync.mjs`. It copies what six modules import (team, model, worklist, rows, overlap, collide), following import lines and JSDoc `import()` types |
| the same, except `ather.mjs`, `watch.mjs` and `console.mjs` | `paseo/ather-automata/server/ather/` | `npm run sync` in `paseo/ather-automata`. It drops the `// @ts-check` line and writes the mod's version into `package.json` and `package-lock.json` |
| `week-calendar/scripts` (four scripts and `lib/*`) | `paseo/week-calendar/server/scripts.generated.ts` | `npm run embed` in `paseo/week-calendar` |
| `squad.mjs` kinds and props | `paseo/ather-automata/server/art.generated.ts` | `npm run art` in `paseo/ather-automata`. Nothing checks this one |
| `.agents/skills/*` | `.claude/skills/*` | `node dev/skills.mjs` |

Rules:
- Never edit a copy. Change the source and run the sync.
- A merge conflict in a copy: resolve the source, then run the sync again. Do not resolve the copy by hand.
- Run the syncs before `node dev/test-all.mjs`: it stops at the first copy out of step.

## 2. Traps the checks do not catch

- **A new folder under `hooks/`.** The Paseo sync copies only `hooks/` and `hooks/packs/`, and its check still passes. Keep new modules in those two, or change `paseo/ather-automata/server/sync.mjs` in the same PR.
- **A new `$`-using file.** Only `watch.mjs`, `console.mjs` and `ather.mjs` may touch `$`; the Paseo sync skips exactly those three. Any other new module is copied to Paseo, so it must be pure.
- **A new file in `week-calendar/scripts/lib/`.** Add it to `SCRIPT_FILES` in `week-calendar/hooks/register.ts` too. The embed picks it up by itself; the Claude Code copy to `~/.calendar/bin` does not, and the Monday job then fails on agent PCs.
- **`paseo/week-calendar/client/ui.tsx`** is a hand copy of the first 522 lines of `paseo/ather-automata/client/ui.tsx`. Change both.

## 3. The board ships it too

When `ather-board/hooks/ather/` changed, installed boards run the new code only after a board release. `node dev/check-release.mjs` prints a note naming those files. The board does not release for its copies alone (AGENTS.md): they ship with its next real release. Put the note in the PR's Release section.
- A change to the board's own files (not its copies) always needs a board release, or the `release-later` label.

## 4. Decide the Paseo side

Paseo shares the pure modules but rewrites the two engine halves. For anything that changed in `watch.mjs` or `console.mjs`, or anything new a person sees, pick one and say which in the PR:

1. **Shared already.** The change lives in a pure module the Paseo server already calls. Nothing to port.
2. **Ported.** Make the same change on the Paseo side:

   | Mod | Paseo |
   | --- | --- |
   | `watch.mjs` hooks, holds, the brief gate, deferred questions, the merge audit | `server/watch.ts`. Paseo has no hook before a tool runs: holds work through the ask rules in `server/rules.ts`, answered in `watch.ts` |
   | the status, away and profile tools (`registerTools`, `statusText`) | `server/tools.ts` (`toolList`) |
   | `/ather` and `/away` words (`COMMAND_WORDS`, `argumentHint`) | `server/console.ts` and `client/commands.ts` |
   | Home, Needs you, the work list, the band | `server/console.ts`, `shared/contracts.ts` and the panel in `client/` |
   | a held tool in `packs/web.mjs` | `WEB_TOOLS` in `server/rules.ts`, or Paseo never asks about it |

3. **Not here yet.** Add a line under `## Limits` in `paseo/ather-automata/README.md`: what is missing and from which version.

## 5. Check the Paseo side

```bash
cd paseo/ather-automata && npm ci && npm run typecheck
cd ../week-calendar && npm ci && npm run typecheck
cd ../.. && node dev/test-all.mjs
```

With `node_modules` in place, test-all also runs the Paseo type-check and the Paseo e2e. Without them it says "skipped": report that, it is not a pass.

On the Paseo side, use the copies' own types: `import type { Pack } from "./ather/packs/index.mjs"`. Do not add `as never` or `any`: they hide exactly the drift this type-check is there to catch.

## 6. Say it in the PR

One line each:
- **Copies:** synced (board, Paseo, embed, art), or not affected.
- **Board:** released as x.y.z, `release-later`, the check-release note for the owner, or not affected.
- **Paseo:** shared, ported (files), or not here yet (the Limits line).
