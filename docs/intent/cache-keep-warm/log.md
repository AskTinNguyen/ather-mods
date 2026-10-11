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

## L-4 (2026-10-11) | class: intent | -> rev 3

> Great, in addition to the command slash warm, can you make a button for it in the mods row panel? Propose

> A

The proposal: ◔ between ☾ and ⤢ in the row above the prompt, a toggle for the session; option A, only where the row is already drawn.

## L-5 (2026-10-11) | class: intent | -> rev 3

> I think button should also appear in Arher Automata side panel, near the Heading to Bed section

## L-6 (2026-10-11) | class: decision | -> rev 3

> When user selects away for 8 hours, will the warm feature automatically get switch on as.part of the delegation? I think it should

## L-7 (2026-10-11) | class: review | -> rev 4

> https://github.com/cursor/plugins/blob/main/cursor-team-kit/skills/thermo-nuclear-code-quality-review/SKILL.md
>
> Install original skill into the Ather mods repo and invoke that instead.

Installed unchanged on `chore/thermo-nuclear-review-skill` (with AGENTS.md, L-9). Verdict on this branch: not approvable: state.mjs past 1,000 lines, keep-warm threaded through unrelated hooks with eleven mutable variables, repeated sequential reads and a racing publish, the away policy in the wrong layer, string-typed reasons, a silent toggle fallback, two definitions of the person.

## L-8 (2026-10-11) | class: decision | -> rev 4

> Agree, proceed

## L-9 (2026-10-11) | class: intent | -> skill branch

> while working on that, create a AGENTS.md for our ather-mods repo, to enforce the strict anytime there's a code change, the thermo-nuclear skill must be invoked and all critical findings must pass

