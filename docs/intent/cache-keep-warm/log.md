# Ather Automata cache keep-warm: Prompt Log

Append-only. Each user prompt verbatim, with credentials and machine paths redacted.

## L-1 (2026-10-10) | class: intent | -> rev 1

> Explain Claude Code concept of cache read and its 1 hour limit, and whether we could implement a small feature that comes with the automata mods plugin that would maintain cache at the 59 minutes mark and what kind of costs will this incur versus just letting cache expire

> Review through this case and propose a suitable opt-in design as an Ather Mods

The proposal: a `$.model.fork` ping at TTL − 5 minutes, opt-in through `userConfig`, guards (context size, cap, away window, rate limits, lapse after sleep), TTL calibration, a ledger of what it spent and saved; first step, verify that a fork keeps the main thread's entry.

## L-2 (2026-10-10) | class: decision | -> rev 1

> Go ahead

> Do 2

The intent skill is not on this branch (`.agents/skills/intent/SKILL.md` missing); option 2: build directly on `intent/cache-keep-warm`, with this record written by hand in the shape of the other intents and no background worker.

## L-3 (2026-10-10) | class: decision | -> rev 2

> Ill be away from computer for the next 8 hours, so do not stop to get my permission, and just proceed throughout until the plan is thoroughly complete and validated with visual proofs. If there are any areas that you think should be added to make better and richer, any tools that should be installed to do your job better, feel free to do it and record your decision. You have full computer use autonomy,

Taken as: finish every acceptance item, including A1's live two-hour check in a real session with screenshots; record each decision here and in prompt.md; push the branch and open a PR to `main` for review (the Constraints' "no push without the owner's go" is lifted by this message); never merge.
