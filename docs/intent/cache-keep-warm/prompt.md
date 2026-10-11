# Ather Automata cache keep-warm

- Rev: 3
- Status: in progress
- Area: ather-automata
- Owner: Tin Nguyen
- Skill: `plugin-authoring`
- Branch: `intent/cache-keep-warm`
- Started: 2026-10-10

## Goal

A session's prompt cache lives for one hour after its last read (five minutes in usage overage). A person who steps away for longer comes back to a first turn that re-writes the whole context at twice the input price, and is slow. Offer, opt-in, to keep the cache warm while the person is idle: shortly before it would lapse, read it once more with a tool-less fork of the session's own last request, which costs a tenth of the input price and resets the hour. Within a cap, and never when it cannot pay off.

## Non-Goals

- On by default. It spends money with nobody watching.
- Re-warming a cache that has already lapsed: that is the full re-write it exists to avoid.
- Keeping workers' (subagents') caches warm.
- A five-minute keep-warm: at 15 pings an hour it rarely pays off; on the five-minute TTL the feature pauses.

## Sources

- The design agreed in conversation on 2026-10-10 (L-1, L-2): cost model, engine primitives, guards.
- Engine API (Claude Code 2.1.293 plugin types): `$.model.fork` ("Runs one tool-less completion over the session's OWN transcript as the main thread last sent it, so the API serves that prefix from its cache"; `usage.cache_read_input_tokens` near zero when the entry lapsed), `turn.complete`'s `usage`, `$.session.usage()` (`context.tokens`, `rateLimits`, `cost.usd`), `$.clock.after`. The live TTL is not exposed to plugins (only to the Pre/PostModelSwitch settings hooks).

## Decisions

- D1 (rev 1): The ping is `$.model.fork`, never a prompt into the session: it adds nothing to the transcript, runs no tools, and its usage says whether the cache was hit.
- D2 (rev 2): The pure rules are `hooks/warm.mjs`; the wiring is a section of `hooks/watch.mjs`, as the design first sketched; stored values go through `state.mjs`. Rev 1's own half (`warmth.mjs`) does not load: the engine refuses a second unmatched hook on `session.start`, `prompt.submit` and `session.end` within one module, and `$` may not cross files. `turn.complete`, whose unmatched hook is console.mjs's, is hooked under two matchers (`isAborted` false and true) that cover every turn.
- D3 (rev 1): Its command is `/warm`, not `/ather warm`: `/ather` answers only where there are intents.
- D4 (rev 1): `ask` mode is one toast per session at the first idle period that could use it, naming `/warm on`; no dialog, which would wait on a person who has just walked away.
- D5 (rev 1): The TTL is learned, not read: assume one hour; a main-thread turn that re-wrote at least 80% of the context after a gap of 5 to 55 minutes means the five-minute TTL (or a changed prefix), and the session pauses keep-warm with one toast.
- D7 (rev 2): The warm part of `session.end` is synchronous and its ledger write is not awaited (F-1).
- D8 (rev 2): Proof of A1 comes from two live sessions driven headlessly in a Windows pseudo-console (pywinpty), their screens kept by a terminal emulator (pyte) and rendered to PNG (Pillow), and from their transcripts' per-response usage: A with `/warm on`, B with `/warm off` as the control, the same context and the same prompt at the same time ~115 minutes later. The driver strips the host session's `CLAUDE*`/`ANTHROPIC*` environment so each is a session of its own. Tools installed for it: pywinpty, pyte, Pillow (pip, user site).
- D9 (rev 2): The repos e2e links folders as junctions (`fs.symlinkSync(…, 'junction')`): Windows refuses symbolic links without Developer Mode, and the type is ignored elsewhere.
- D10 (rev 2): Keep-warm starts from the session's second main-thread turn (counted again after /clear); TTL calibration from its third; `/warm` shows the last read ("Last read at 01:02: 101,944 of 101,738 tokens from the cache (kept).") and the debug log records each read's usage (F-2).
- D11 (rev 3): A ◔ in the row above the prompt (console.mjs), between ☾ and ⤢: dim when off, at full strength when on, `1/3` in amber beside it while a read is due, `◔ –` dim where the cache lives five minutes. A press toggles it for the session, as `/warm on|off`, and says so in a toast. Only where the row is drawn (repositories with intents, L-4 option A); elsewhere `/warm` and the status line. The halves meet in state.mjs: watch.mjs publishes what keep-warm is doing (`showWarm`, a redraw without a version bump) and answers the toggle (`onWarmToggle`, as `onSetUp`).
- D12 (rev 3): Home has a **Stepping out?** section right after Heading off?, at any hour (not only in the evening as Heading off? is): one line on what keep-warm is doing and a button, Keep the cache warm or Stop keeping warm, hotkey `w` (`k` is taken by the list rows' `PICK_KEYS`) (L-5).
- D13 (rev 3): An away window with an end hands keep-warm over: on, its cap the window's length plus an hour (at most 17 hours, 18 reads, under the 19 a re-write costs), from its start until the person has reviewed it, unless they said `/warm off` in that session; the start's reply says so. Until done hands nothing over (L-6).
- D6 (rev 1): Money: a ping's real cost is the change in `$.session.usage().cost.usd` around it; the re-write it avoids is estimated as 19 times the cache-read part (2x write minus the 0.1x read the next turn still pays). Shown with "~".

## Acceptance

- A1: Verify the premise: a fork at about 55 minutes keeps the main thread's one-hour entry, so that a real turn at about 110 minutes reads the context from the cache. The ledger records, for each return after pings, whether the person's first turn hit (`returnsWarm`) or re-wrote (`returnsCold`); `/warm` shows both. Proof: a live session with `/warm on`, idle for two hours, then one prompt; `/warm` reads "1 return warm".
- A2: Options: `cacheKeepWarm` (`off` default, `ask`, `on`) and `cacheKeepWarmHours` (default 3) in the manifest; `/warm on | off | <n>h` overrides them for the session (kept across /clear and reloads); `/warm` alone says the state, the next ping's time and the ledger. Proof: gate: plugin test.
- A3: Timing: each main-thread `turn.complete` re-arms one timer for TTL − 5 minutes after it; a prompt cancels it; a ping that hit re-arms from its own time; a timer that fires at or past the TTL (the machine slept) does nothing. Proof: gate: unit tests and plugin test on the mocked clock.
- A4: Guards: no ping when off, paused, before the session's second turn (D10), a turn is running, the context is under 30,000 tokens, the cap (`floor(hours × 60 / 55)` pings per idle period) is reached, an away window runs that ends after the cap or is "until done", any rate-limit window is over 85%, the session is not interactive, or the fork answers `nothing-to-fork`. Proof: gate: unit tests.
- A5: A ping that misses (cache read under 90% of the context) stops keep-warm for that idle period and counts as `missed` in the ledger. Proof: gate: plugin test.
- A6: TTL calibration per D5. Proof: gate: unit test and plugin test.
- A7: Showing it: the status line reads `◔ warm 2/3 · next 14:55` while armed and is cleared otherwise; the ledger (`$.store`, machine-wide) counts pings, misses, wasted pings (an idle period that ended without the person's return: next session start or a lapse), returns warm and cold, ping dollars and estimated dollars avoided. Proof: gate: unit test of the text, plugin test.
- A8: No regression: `node dev/test-all.mjs` passes as on `main`; `claude plugin validate ather-automata` and `claude plugin test ather-automata` pass. Proof: gate.
- A10: The row's ◔ and Home's Stepping out? turn keep-warm on and off for the session, each with its toast; ◔ shows `0/3` in amber once a read is due; the pane says "Kept warm: 0 of 3 reads done, the next at HH:MM." Proof: gate: S2 e2e block "Keep-warm from the band's ◔ and from the pane's Stepping out?", unit tests of the badge, toast and pane text.
- A11: `/away 8h` turns it on with a cap of 9 hours and says so; `/away until done` leaves it off. Proof: gate: S2 e2e blocks, unit "an away window hands it over".
- A9: Release: 0.3.0 in both manifests, a Changes line and a README section. Proof: review (Tin).

## Constraints

- Keep Ather's conventions: pure rules without `$`, stored values only through `state.mjs`, hooks never block or fail the calls they watch, plain short wording.
- Push the branch and open a PR to `main` for review (L-3); never merge.

## Changelog

- rev 1 (2026-10-10): created from L-1 and L-2.
- rev 3 (2026-10-11): L-4 to L-6; D11-D13, A10, A11.
- rev 2 (2026-10-10): L-3 (autonomy while away); D2 revised, D7-D9 added; constraint on pushing lifted.
