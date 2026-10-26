# UI/UX improvement proposal

This proposal covers what the S2 team sees: the Claude Code pane, band and pop-ups, the board pane and the shared board page, the Paseo panel, and the week calendar. It uses only the verified review findings, cited by id in brackets (for example [ux-pane-4]). Where a verifier corrected a finding, the corrected version is the one used here.

Paths are relative to the repo root at 999a2ba. `drawn/…` means the layouts the ux-pane reviewer rendered at 72 and 110 columns with the stand-in engine. They are in `docs/review/2026-10-21/drawn/`.

Nobody checked four things: the real desktop app, a light terminal theme (which the team does use: U31), the S2 pack's Home (there was no S2_ROOT), and the Paseo panel on a real host.

Section 4 says how each change ships: as a plain release PR, through the owner of an intent that is still active, or as a new intent.

---

## 1. The five themes that matter most

### Theme 1: What needs you comes first

People open `/ather` between turns to answer two questions: what needs me, and what do I do next. The pane opens 22 rows tall (`ather-automata/hooks/console.mjs:47`), and Advanced is the default (`console.mjs:131`). In Advanced:

- The first Needs you row is on line 11 and Next is on line 21 (`drawn/s1-home-advanced-72.txt:11`, `:21`).
- Above them, stage is said twice, progress twice, the Needs you count twice, and a collision twice on the pane plus once on the band [ux-pane-1].
- Each decision prints its question twice, and on the desktop both copies are in full [ux-pane-6].
- The switch to the lean view, "v: Simple view", is below the fold (`drawn/s1-home-advanced-72.txt:41`). In daytime it sits about 4 lines higher, but it is still below the fold.

The board pane has the same shape. Its first "needs someone" row is on line 16 of a 24-row pane (`ather-board/hooks/index.mjs:239`) [board-4].

**Day to day:** the thing you came for is below the fold, under facts you already know.

### Theme 2: The surfaces never say something untrue

A pane people trust is one they stop double-checking. These cases break that trust today:

- **The away rule is wrong in web repos, in two places** [ux-pane-2].
  - The `/away` dialog says "nothing merges until you are back" (`console.mjs:1783`). In a web repo with `with-proof`, the session may merge once its gates pass (`ather-automata/hooks/packs/web.mjs:606`).
  - The Away mode takes its rule line from the pack, but the web pack's line is the same for every merge policy and never names merges or pushes to main (`packs/web.mjs:607-608`). Without `with-proof`, which is the default (`packs/web.mjs:460`), both are held (`ather-automata/hooks/guards.mjs:90-95`).
- **The README promises more than the holds keep.** It says merges and pushes to main are held "however they are spelled" (`ather-automata/README.md:41`). watch-10 found common forms that are not held, such as `env GIT_TRACE=0 git push origin main` and `bash -c "git push origin main"` [watch-10].
- **Next contradicts a blocking decision.** Next says "Start the work" (`ather-automata/hooks/model.mjs:684`) while the intent's view on the same screen lists F-1 as "(blocking)" (`drawn/d-intent-view-72.txt:8-16`) [ux-pane-5].
- **Needs you hides items.** It cuts items to 9 before grouping them (`ather-automata/hooks/decide.mjs:154`). With 12 decisions the heading says 12, the list shows 9, and one intent's block says "1 decision" [ux-pane-11].
- **/clear leaves stale state.** After `/clear` or a resume, items handed to the old conversation stay hidden, and Next still reads "✓ sent" (`ather-automata/hooks/rows.mjs:83`) [console-13].
- **The shared board page passes off drafts as main.** It shows one PC's uncommitted drafts, and its local edits of intents that are on main, under "Read from origin/main" (`ather-board/hooks/page.mjs:54`) [board-1].
- **The board's suggestions cannot see collisions.** Sonnet's Suggested list never names one, because the brief gets records without them (`ather-board/hooks/index.mjs:186`, `ather-board/hooks/records.mjs:89`) [board-11].
- **Paseo shows proof from another session as unknown.** It draws a grey chip with no state (`paseo/ather-automata/client/AtherPanel.tsx:375-379`) [paseo-5].
- **Paseo sends `/ather find` to the agent as a question.** Its word list has no `find` (`paseo/ather-automata/server/console.ts:601`) [paseo-3].
- **Open on GitHub lies on the phone.** It says "opened issue #N in your browser" but runs `gh` on the PC (`console.mjs:1935`) [console-14].
- **The calendar turns "GitHub was not asked" into "0 PRs".** It treats an unasked GitHub as no PRs (`week-calendar/scripts/lib/analyze.mjs:160`) and writes `prsMerged: 0` (`analyze.mjs:366`). A failed Monday run says nothing anywhere (`week-calendar/scripts/weekly.mjs:17-31`) [calendar-6].

**Day to day:** the moment someone decides to leave for the night is when the pane has to be right.

### Theme 3: Big actions need a deliberate press

- **One Enter starts 24-hour windows.** Opening ☾ focuses "Until done" (`ather-automata/hooks/modes.mjs:225`; the pane opens with `focus: true`, `console.mjs:1866`). One stray Enter starts 24-hour windows in every ticked session [ux-pane-m1].
  - The running window already guards against this on purpose: "one stray Enter must not end the window" (`modes.mjs:259`).
- **One letter starts a 24-hour window from Home.** On Home, `u` starts a 24-hour window in this session (`console.mjs:2285`) [console-8]. This only happens in Advanced, when Heading off? is shown (`ather-automata/hooks/home.mjs:430`), and when the pane has focus.
- **The same letter does different things on different screens.**
  - `w` means keep warm on Home but tracks the intent on an intent's view (`modes.mjs:104`).
  - `s` means Search in Everything open but Stop tracking on an intent's view (`modes.mjs:42`, `:145`) [ux-pane-10, console-8].

**Day to day:** muscle memory from Home should never switch your tracked intent or start autonomy.

### Theme 4: One language on every surface

- **Stage words differ by surface.** The pane says Ship and Shipped (`model.mjs:13`). The board says Proving and Done (`ather-board/hooks/views.mjs:52-56`). The lists say "◐ Items met, PR not merged" (`ather-automata/hooks/worklist.mjs:34`) [ux-surfaces-1].
- **Names are mangled.** "Hoàng Vũ" is drawn as "Ho Ng V" (`worklist.mjs:190-192`; `drawn/w-pick-60.txt:18-19`). Five intents in this repo have that owner [ux-pane-4].
- **Colours mean different things.** Amber means "warning" on the board (`ather-board/page/board.css:1-3`), but marks the GitHub issues group in the pane and in Paseo (`rows.mjs:24`, `paseo/ather-automata/client/WorkSection.tsx:35`) [ux-surfaces-6]. Lime is about 1.14:1 against white [ux-pane-3]; whether anyone on the team uses a light theme is not known.
- **Two different features sound alike.** "Heading off?" and "Stepping out?" sit next to each other (`console.mjs:2286`, `:2291`), and the warm pitch uses the away feature's word (`ather-automata/hooks/warm.mjs:240`) [ux-pane-7].

**Day to day:** a lead reading the board and a developer reading the pane should describe one intent with the same words and see each other's real names.

### Theme 5: The page, the panel and the phone are real surfaces

- **The board page is for people who do not run Claude Code.** It is "for leads and producers who do not run Claude Code" (`ather-board/README.md:12`) and must work at phone width (A7, `docs/intent/ather-board/prompt.md:44`). Today:
  - Rows show no focus ring.
  - Every press drops focus to the top of the page.
  - Map dots ignore Enter [ux-surfaces-2, board-6].
  - Glyphs are explained only in hover titles [ux-surfaces-13].
  - The Map is unreadable on a phone [ux-surfaces-4].
  - "o opens the page with every one" opens on Triage, not on the cut you were looking at [ux-surfaces-12].
- **How far Paseo should follow the mod was never decided** (`docs/intent/paseo-parity/prompt.md:19`). Ten of 23 intents put Paseo under Non-Goals [arch-7]. The panel's README still names 0.6.1 while the package is 0.6.6 (`paseo/ather-automata/README.md:3`) [paseo-11].
- **Clicked surfaces get keyboard hints.** In Claude Code, only the desktop counts as clicked (`console.mjs:2116`), so phone and VS Code users see key hints they cannot press [console-14].
- **The calendar shows a dead toggle.** Every calendar without a saved previous week shows a "Compare with" toggle that does nothing (`week-calendar/scripts/lib/render.mjs:103`, `:389`) [ux-surfaces-8].

---

## 2. Prioritized changes

"Now" means small changes that fix trust or safety. "Next" means changes to structure or wording that need a decision. "Later" means polish.

| Id | When | Change | Surface(s) | User impact | Effort | Findings |
|---|---|---|---|---|---|---|
| U1 | Now | Owner names keep their letters (normalize to NFC, split on Unicode letters, measure widths in cells) | pane, board pane and page, Paseo | Teammates see real names, not "Ho Ng V" | S | ux-pane-4 |
| U2 | Now | Every away sentence that can read the pack takes it from `pack.mandate`, and the web pack's `pane`/`panes` follow its merge policy; the hint and README stay generic but true | pane dialog, Away mode, Paseo, toast, README | The rule shown is the rule enforced, in web repos too | S | ux-pane-2, ux-pane-7, watch-10 |
| U3 | Now | The Away mode opens with nothing focused, and no length is marked "(Recommended)" | pane, dialog | A stray Enter cannot start 24 h windows | S | ux-pane-m1 |
| U4 | Now | Next says "Decide F-1 first" while a blocking decision is open, and the decision's row says it blocks | pane, Paseo (shared model) | No worker run spent against an open director call | S | ux-pane-5 |
| U5 | Now | Needs you groups first, then draws every block; counts are true; rows past 9 get no digit | pane | No hidden decisions in the sync session | S | ux-pane-11 |
| U6 | Now | `/clear` and resume bring back what was handed to the old conversation | pane | Items and Next come back after `/clear` | S | console-13 |
| U7 | Now | Board page keyboard fixes: focus ring, focus kept after a press, Enter/Space on Map dots, stage word for screen readers, a legend under every list | board page | Leads can use the page by keyboard and on a phone | S | ux-surfaces-2, board-6, ux-surfaces-13 |
| U8 | Now | Publish shows origin's truth: every intent as main has it, drafts that exist only on this PC left out; `/board open` keeps local copies and marks them | board page | The shared page stops passing one PC's drafts off as main, and loses no intent | S | board-1 |
| U9 | Now | Calendar page: a `[hidden]` rule, focusable list rows, focus returns after the drawer closes, "no commit" said in words, a darker light-mode label colour | calendar page | No dead toggle; the triage lists work by keyboard | S | ux-surfaces-8, ux-surfaces-6 |
| U10 | Next | Home's Heading off? becomes one row that opens the Away mode; bare `/away` opens it where a pane exists; Paseo agents listed read-only | pane | One place to hand over, always with the session list and the rule | M | ux-pane-2, console-8, arch-11 |
| U11 | Next | Advanced header says each fact once: the track carries the count, the meta line is labelled, the strip goes (Paseo too), no amber merge line while Needs you shows the collision, quick actions move to the foot, the view toggle moves to the title row in both views | pane, Paseo | Needs you at line 5 instead of 11 | M | ux-pane-1 |
| U12 | Next | Each decision says its question and place once; drawn flat when the session tracks the intent (needs a decision) | pane | Shorter Needs you; one press to answer | S | ux-pane-6 |
| U13 | Next | One key map: each letter means one thing on every screen, and only the terminal draws letters; Open on GitHub becomes a link on clicked surfaces | pane | Muscle memory works; phone users see no keys they cannot press | M | console-8, ux-pane-10, console-14, console-7 |
| U14 | Next | One stage ladder and glyph table for the pane, lists, board, page and Paseo (after a decision on what Prove means) | all four surfaces | Leads and developers use the same words | M | ux-surfaces-1, ux-pane-7, ux-pane-12 |
| U15 | Next | Groups drawn quiet with an icon instead of amber or green, so amber means a warning and nothing else; lime marks on the white page get an ink ring | pane, Paseo, board page | Colour means one thing | S | ux-surfaces-6, ux-pane-3, ux-surfaces-4 |
| U16 | Next | Board pane first screen: the note becomes a toast; "N of M shown" only where filters are drawn; a brief failure goes in the status line; People and Areas in fixed columns | board pane | Needs someone near the top; counts scan down a column | S | board-4, ux-surfaces-7 |
| U17 | Next | `o` opens the page on the pane's view and filters (`/board open` only) | board pane and page | The "+N more" promise is kept | S | ux-surfaces-12 |
| U18 | Now | The brief and Ask see collisions | board pane | Suggestions match what the board draws | S | board-11 |
| U19 | Next | Paseo panel: proof sent as data, `/ather find` answered, a press dims only its own control, Retry on a load error, ", recommended" in option labels, the "asking" prop art | Paseo | The panel says true things | M | paseo-5, paseo-3, ux-surfaces-10, paseo-9 |
| U20 | Next | Write down Paseo's support level, for both Paseo plugins; the README version and "Not here yet" follow it | Paseo docs | People know what the panel lacks | S | paseo-11, arch-7 |
| U21 | Next | Calendar: a one-line notice when last week's report did not go out; "PRs not counted" when GitHub was not asked | calendar, session | Operators see a missed week | M | calendar-6 |
| U22 | Later | Map: lay out once and dim on filter; a module list under 640 px | board page | The Map works on a phone and does not lag | M | ux-surfaces-4, board-7 |
| U23 | Later | `/board open` answers at once and says the brief is still coming | board | No minute-long wait on the first try | S | board-8 |
| U24 | Later | The band's message can be pressed; its icons are named where there is room | band | One press to what the band says | S | ux-pane-8 |
| U25 | Later | A newcomer with no stored view opens in Simple; the tour ends with "Your pane"; `/ather`'s hint is built from the word list | pane | A first screen with one clear step | S | ux-pane-9, console-5 |
| U26 | Later | Words: "Away for hours?" vs "Short break?"; warm copy without "away"; "N of M done" everywhere; one moon glyph; ◆ only for "needs you" | pane, band | Two features stop sounding alike | S | ux-pane-7, ux-pane-12 |
| U27 | Later | Board: a "Since yesterday" line and the page's age in its header | board page and pane | The morning read takes one glance | M | ux-surfaces-5 |
| U28 | Later | Calendar: the first ask builds with defaults; style kept only in prefs.json | calendar | No quiz before the first calendar | S | calendar-9 |
| U29 | Later | Paseo Week: a Last week / This week choice and a real error state (only if U20 keeps the Paseo calendar) | Paseo week | The finished week can be republished | S | ux-surfaces-9, calendar-2 |
| U30 | Now | The 5-second worker clock redraws only when workers are drawn | pane, band | Fewer lost desktop presses in Simple and during an away window | S | console-4 |

| U31 | Next | The pane takes AMBER, DONE, red and QUIET from the engine's theme keys ('warning', 'success', 'error', 'subtle'), which follow each person's theme; the lime "needs you" mark and the progress bar get a light-theme pair checked at 4.5:1 | pane, band, Paseo | Readable for the people on light themes | M | ux-pane-3 |

**Light themes are in use.** The team works in both dark and light themes (owner, 2026-10-21). So U31 is planned work, not a question. U15's ink ring and U9's calendar label are its first parts. Every visual change to the pane, the page or the calendar is checked in both themes.

---

## 3. The top changes in detail

### C1. Heading off: one door, the true rule, no accidental start (U2, U3, U10)

**Home, evening, Advanced. Before** (`drawn/s1-home-advanced-72.txt:32-34`):

```
H E A D I N G   O F F ?
Let AI work while you zZz
u: Until done   8 hours   4 hours
```

Pressing `u` opens a 24-hour window in this session only. There is no session list and no rule (`console.mjs:2285-2286`).

**After:**

```
H E A D I N G   O F F ?
The session keeps working; merges and pushes to main wait for your
review.
u: Choose sessions and how long ›
```

The middle line is `forBase(pack.mandate.pane, paneBase)`, the same call the Away mode makes today (`console.mjs:2206`). The S2 text is `packs/unreal.mjs:342`. Pressing `u` opens the Away mode and starts nothing.

**The web pack's rule line follows its policy.** Today `pane` and `panes` are one fixed string (`packs/web.mjs:607-608`). After, they depend on `withProof` the way `away` already does (`packs/web.mjs:606`):

| Merge policy | `pane` after |
|---|---|
| default (`hold`) | "The session keeps working; merges, pushes to main, production deploys, migrations and secret changes wait for your review." |
| `with-proof` | "The session keeps working and may merge once every gate passes; pushes to main, production deploys, migrations and secret changes wait for your review." |

`panes` reads the same with "The sessions keep working". Pushes to main are named in both, because `guards.mjs:95` holds them in every policy. A unit test checks, for each pack and both web policies, that `away`, `pane` and `panes` say merges wait exactly when `merge` is 'never merge'.

**Away mode, after.** This is the approved mockup (`docs/intent/away-many-sessions/prompt.md:15-30`) with three changes: nothing is focused, there is one key set, and Paseo agents are listed read-only.

```
A W A Y
Heading off?
The sessions keep working; merges and pushes to main wait for your
review.

Which sessions?
[x] this session · feat-x
[x] Hệ thống enemy chim mới                       active 3 min ago
[ ] S2 sync main                                   active 1 min ago
    Fix scale · in Paseo, not reachable from here  active 2 min ago
a: all · n: none

1: Until done
   Ends when the work is done, 24 hours at most.
2: 8 hours
   Ends in 8 hours.
3: 4 hours
   Ends in 4 hours.

0: Back
```

Nothing has focus when the mode opens. Today `1: Until done` does (`modes.mjs:225`).

**The question dialog.** It is used by bare `/away` (`console.mjs:1592`) and by the one-question `/ather` menu's Heading off? (`console.mjs:1665`). After U10 it is used only where no pane is drawn. Today it reads (`console.mjs:1783-1785`):

> Heading off? While you are away the session may push branches and open PRs; nothing merges until you are back, and every decision it makes is written down for you.

with "Until done (Recommended)". After, the question is built as `` `Heading off?${goal ? ` Goal: "${goal}".` : ''} ${forBase(pack.mandate.away, paneBase)} Every decision it makes is written down for you.` ``, so the goal clause stays. The choices are "Until done", "8 hours" and "4 hours". In a `with-proof` web repo it then reads:

> Heading off? The session may push branches, open PRs and merge with every gate passed; production deploys, migrations and secrets wait for you. Every decision it makes is written down for you.

The e2e check that pins the old labels changes in the same PR: `dev/e2e/run.mjs:272` expects 'Until done (Recommended)|8 hours|4 hours'.

**The other copies of the rule** change in the same PR. Two cannot read the pack, so they stay generic but true: the `/away` hint is registered in `openConsole` (`console.mjs:566-571`) before the pack is read (`console.mjs:587`), and the README is static.

| Place | Today | After |
|---|---|---|
| `/away` hint (`console.mjs:567`) | "going away? hand over with full autonomy, decisions recorded" | "heading off? the session keeps working and says what waits for you" |
| Paseo panel (`paseo/ather-automata/client/AtherPanel.tsx:292`) | Fixed text: "…nothing merges until you are back…" | The panel draws `view.away.rule`, which the server takes from the agent's `pack.mandate.pane` |
| Return toast (`ather-automata/hooks/watch.mjs:124`) | "merges stay held until you review it" | "Ather: welcome back. Your away window has ended; what it held waits for your review. Type /ather." |
| README (`ather-automata/README.md:9`) | "The session keeps working; merges wait for you." | "The session keeps working; merges and pushes to main wait for you. A web repository set to `with-proof` lets merges through once its gates pass (see Merge policy)." |
| README (`ather-automata/README.md:41`) | "…and pushes to main, however they are spelled." | "…and pushes to main." until watch-10 lands |

**These words are only as true as the holds.** Two clean-up findings decide that: watch-1 (holds fail open when the store errors) and watch-10 (wrapped forms like `env … git push origin main` are not held). Land them before U2 or with it, and add no promise the holds do not keep. On Paseo, the panel's rule is only as true as paseo-12 (`git -C <path> push` likely never reaches Ather there).

**Coming back with nothing recorded.** Today the Needs you item says it twice: "Review: nothing recorded" and "Review what happened while you were away (nothing recorded)" (`drawn/a-review-72.txt:11-12`; `home.mjs:302-305`). After, it is one line: "I'm back: nothing was decided or held".

**How this fits the existing decisions:**

- away-many-sessions is still active (`docs/intent/away-many-sessions/prompt.md:4`, Owner HaiHuynh at `:6`). Its open items already name this gap: "Home's inline Heading off? presets and the desktop question (`/away` alone) still start this session only" (`docs/intent/away-many-sessions/progress.md:43`). So C1 goes to Hai as that intent's Rev 2, not a new intent (section 4).
- It respects that intent's Non-Goal "Changing what an away window allows or holds" (`prompt.md:38`). Nothing held changes; only the words and the way in change.
- The approved mockup's rule line is already S2's `pack.mandate.panes` (`packs/unreal.mjs:343`), so S2 users see no new words.
- It keeps "a: all · n: none" from the mockup (`prompt.md:29`). Whether to change it is Hai and Tin's call under C5, because `n` also means Next on Home [ux-pane-10].
- It carries the running window's "nothing focused" rule (`modes.mjs:259`) over to the start.
- It keeps Heading off? as Home's `away` part: shown only in the evening or while workers run (`home.mjs:430`), and left out of Simple (`docs/intent/simple-view/prompt.md:31`).
- It deliberately revisits Home's one-press presets. The pitch "Let AI work while you zZz" is pinned by `dev/e2e/run.mjs:877`, which changes in the same PR.
- The Paseo row in the list comes from arch-11, which was found by reading, not by a run (`console.mjs:1452-1455`). It needs a `host` field on each lane and a unit test with one lane per host.

### C2. Names keep their letters (U1)

**Before** (`drawn/w-pick-60.txt:18-19`):

```
▾ Ho Ng V · 1
4: ● he-thong-enemy-chim-moi…      ▰▰▱▱▱  1/3  0m  Ho Ng V
```

**After:**

```
▾ Hoàng Vũ · 1
4: ● he-thong-enemy-chim-moi…      ▰▰▱▱▱  1/3  0m  Hoàng Vũ
```

**The fix:**

- `tidyName` (`worklist.mjs:190-192`) normalizes to NFC first.
- It then splits on `/[^\p{L}\p{M}\p{N}]+|(?<=\p{Ll})(?=\p{Lu})/u`, so "HaiHuynh" still becomes "Hai Huynh" and a combining mark is never a separator.
- It capitalizes with `toLocaleUpperCase`.
- The owner column pads by cells, not code units (`rows.mjs:117`, `worklist.mjs:256`). The 77-wide CJK row in `drawn/w-home-72.problems.txt` is partly the stand-in's own drawer (`dev/e2e/screen.mjs:63-64`), but `.length` and `padEnd` are still wrong for wide names.

**How this fits:** it follows ather-board D4, the board reads intents with Ather's own reader (`docs/intent/ather-board/prompt.md:28`). The fix lives in `worklist.mjs`, and the board and Paseo copies follow through `node ather-board/sync.mjs` and `npm run sync`.

**Tests:**

- Add "Hoàng Vũ", "Nguyễn Văn Tín" and a CJK owner at 60 columns to the A7 name table (`ather-automata/tests/ather.test.mjs:1552-1560`).
- Add a test that every `- Owner:` line in `docs/intent/*/prompt.md` keeps its letters.

### C3. Needs you and Next tell the whole truth (U4, U5, U6, U12)

**Before.** A tracked session with a blocking F-1 (`drawn/d-block-open-72.txt:10-28`; the Needs attention lines 21-24 are cut and marked "…"):

```
N E E D S   Y O U   ·   2
◆ 1: ▾ feat-x · 2 decisions · in this session
  · 2: F-1 · Should the HUD scale follow the OS text size, or only …
       Should the HUD scale follow the OS text size, or only our own
       setting?
       in this session
       [ A: Only our own setting (recommended) ]
       [ B: Follow the OS text size too ]
       x: Explain   t: Type an answer   Open findings ›
  · 3: F-2 · Red or blue for the scale slider?
       Red or blue for the scale slider?
…
N E X T
n: Start the work
   A background agent does the work in its own worktree, proved with the
   repository gates.
```

**After:**

```
N E E D S   Y O U   ·   2
◆ 1: F-1 · blocks the work · Should the HUD scale follow the OS te…
       Should the HUD scale follow the OS text size, or only our own
       setting?
       [ A: Only our own setting (recommended) ]
       [ B: Follow the OS text size too ]
       x: Explain   t: Type an answer   Open findings ›
◆ 2: F-2 · Red or blue for the scale slider?
…
N E X T
n: Decide F-1 first
   It blocks the work: Should the HUD scale follow the OS text size, or…
```

**The rules behind the "after":**

- **Blocking first (U4).** When the tracked intent has an open finding with `isBlocking` (`model.mjs:277`), `nextStep` returns "Decide F-1 first" before its stage switch. Pressing it opens F-1 in place and sends nothing. The row title gains "blocks the work" (`home.mjs:325`).
- **Every decision is counted (U5).** `needsView` builds the blocks from every item and then draws them all. Rows past the ninth simply get no digit, as `digit()` already stops at 9 (`console.mjs:2242`). Before: 12 decisions over 3 intents gave "◆ 3: ▸ hitstop-retune · 1 decision" and lost 3 decisions. After, each block shows its true count, for example "◆ 3: ▸ hitstop-retune · 4 decisions".
- **/clear resets what the old conversation held (U6).** On `session.end` with reason `clear` or `resume`, the per-conversation state is reset: sent, the outbox, answers, and the pane view. After `/clear`, Next reads "n: Start the work" again instead of "✓ sent · Start the work". Do not reuse `openConsole` for this, because it would start a second set of clocks (`console.mjs:539`, `:591-602`) [console-13].
- **Each question once (U12).** The row's detail shows the question only when the title had to cut it. "in this session" is not repeated in a session that is working on that intent [ux-pane-6]. Drawing flat when the session tracks the one intent is the part that needs a decision (below).

**How this fits:**

- decide-in-place D3 (`docs/intent/decide-in-place/prompt.md:32`) says the first open decision is expanded, and that an intent with several decisions keeps its grouping.
  - When the list spans several intents (the sync session), C3 keeps the grouping.
  - Drawing flat when the session tracks the one intent is a deliberate change to D3's grouping rule and needs Tin's yes.
  - The single-copy question, the true counts and the "blocks the work" marker do not depend on that decision.
- D4's answering and "✓ Decided" stay as they are.
- "Looking never tracks" (`modes.mjs:101-102`) holds: Decide F-1 first sends nothing.
- Next stays unfocused while items are open (`console.mjs:2275`).

**Tests:**

- `nextStep` with a blocking finding.
- `needsView` with 12 items over 3 intents, and with 12 single items.
- A repos e2e step: press Next, raise `session.end` with reason `clear`, and check that Next is offered again.
- `dev/e2e/run.mjs:980` and `:983` check the untracked group ("no session tracks it"). They stay as they are. No e2e check pins the tracked group today (a grep of `dev/e2e` for "decisions · in this session" finds none), so U12 adds one.
- Run the S2 e2e for U4: a check that expects "Start the work" on an S2 intent with a blocking finding would change. Compare the FAIL set with main by name.

### C4. Advanced Home says each thing once (U11)

**Before** (`drawn/s1-home-advanced-72.txt:1-11`):

```
feat-x ›
Build · 1 of 3 done                                 f: synced just now ↻
Plan ✓ ─ Build ● ─ Prove ○ ─ Ship ○
Engineer
▲ 1 overlap with origin/main · see Needs you

Checklist 1/3 ━━━━━━━━━━ · Workers 0 · Needs you 3

[ ＋ New intent ]  [ ✦ Create ]

N E E D S   Y O U   ·   3
```

**After, Advanced:**

```
feat-x ›                                                 v: Simple view
Plan ✓ ─ Build ● 1/3 ─ Prove ○ ─ Ship ○          f: synced just now ↻
Role: Engineer

N E E D S   Y O U   ·   3
◆ 1: Bring origin/main into feat/x
     ▲ 1 overlap: origin/main changed these lines 0m ago (Lena Park).
     src/a.js:1
```

When there is proof, it joins the meta line, as today: "Role: Engineer · build ✓ · tests ✗" (`dev/e2e/run.mjs:855` checks "build ✓ · tests ✗").

**After, Simple** (before: `drawn/s1-home-simple-72.txt:1-4`, toggle at `:19`). The only change is that the toggle moves to the title row:

```
feat-x ›                                               v: Advanced view
Build · 1 of 3 done                             f: synced just now ↻

N E E D S   Y O U   ·   3
```

**Advanced's foot:**

```
i: Everything open ›   ＋ New intent   ✦ Create

Enter chooses · Esc closes
```

**What goes, and why:**

- **The strip** (`rows.mjs:428-464`). "Checklist 1/3" repeats the track, "Needs you 3" repeats the heading, and "Workers 0" is a zero most of the time. The Workers section already says "Workers · Running N" when anything runs. On the desktop, the strip's bordered cards go too (`rows.mjs:442-450`).
- **Advanced's status line.** The track now carries the stage and the count, and the sync button moves onto the track's line.
- **The amber merge line while Needs you carries the overlap** (`home.mjs:139`). The quiet line "Merges cleanly into origin/main · checked 2m ago" stays, because it says something nothing else does.
- **The bare word "Engineer"** gets a label: "Role: …" (`rows.mjs:474`).

Needs you then starts on line 5, and Next around line 15 of the 22-row pane. If C6 lands, the track's last stage reads "Close" instead of "Ship".

**How the part table changes.** Today one list says what Simple shows, and Advanced shows every part: `isShownIn = (view, part) => view === 'advanced' || SIMPLE_SHOWS.includes(part)` (`home.mjs:57-64`). That cannot express "status in Simple only". So the table gains a column per view. It is still one table in `home.mjs`, and `console.mjs` still draws parts with no check per part:

| Part | Simple | Advanced |
|---|---|---|
| title (with the view toggle) | yes | yes |
| status | yes | no: the track carries stage and count |
| stages, meta, merge | no | yes |
| needs, attention, next | yes | yes |
| crew, preview, actions, away, warm | no | yes |

`strip` and `view` leave the list: the strip is deleted, and the toggle is part of the title row in both views. `isShownIn(view, part)` keeps its signature and reads the row, so Paseo's call (`paseo/ather-automata/server/console.ts:286`) does not change. The panel checks neither `status` nor `view` (a grep of `shows("` in `paseo/ather-automata/client`), so only the strip removal touches it.

**How this fits:**

- It deliberately revises simple-view D5, "home.mjs holds the one list of what Simple leaves out" (`docs/intent/simple-view/prompt.md:34`): still one table, now with two columns.
- It deliberately revises D4, the toggle "at the foot of Home" (`:33`). The toggle moves to the title row in both views, so it sits in one place and is on the first screen. Its labels "Simple view" and "Advanced view" and the `v` key stay, so the e2e label checks hold (`dev/e2e/repos.mjs:1796`, `:1809`, `:1831`).
- It revisits the Non-Goal "Changing what Advanced shows… so no one's pane changes on update" (`:17`). Advanced keeps every fact but says each one once, and nobody's stored view changes.
- It revisits ship-pill D1, the amber merge line ending in "see Needs you" (`docs/intent/ship-pill/prompt.md:35`).
- paseo-parity D2 (`docs/intent/paseo-parity/prompt.md:29`) has the panel draw `SummaryStrip` under `shows("strip")` (`AtherPanel.tsx:239`). The same PR drops it there and runs `npm run sync`.
- The e2e checks that pin the old header change in the same PR: `dev/e2e/run.mjs:855` (the track regex gains " 1/3") and `dev/e2e/repos.mjs:1793` (PARTS loses 'strip'). simple-view A3, "the only addition is the toggle at its foot", is revisited with D4.
- The drawing moves into a pure `homeRows` builder instead of growing the inline Home code (`console.mjs:2217-2296`) [console-10].

### C5. One key map, and no keys where there is no keyboard (U13)

**Today the same letter means different things, and the same action has different letters:**

| Key | Meaning 1 | Meaning 2 |
|---|---|---|
| `s` | Search (`modes.mjs:42`) | Stop tracking (`modes.mjs:145`) |
| `w` | Keep warm (`console.mjs:2291`) | Work on this here, which tracks the intent (`modes.mjs:104`) |
| `o` | Open on GitHub (`console.mjs:1970`) | Sort (`modes.mjs:44`) |
| `n` | Next | none, which unticks every session (`modes.mjs:253`) |

| Action | Key on Home | Key on the issue card |
|---|---|---|
| Open on GitHub | `o` | `2` (`console.mjs:2160`) |
| Copy link | `y` | `3` (`modes.mjs:70`) |

**After.** One `KEYS` table in `rows.mjs`. The action letters mean the same thing on every screen:

```
n Next        v view         f sync          i Everything open
s Search      o Open on GitHub   y Copy link   w Keep warm
u Away        x Explain      t Type an answer   0 Back
1-9  rows and options on this screen
a b c d e g h j k l  Home's preview rows only (rows.mjs:25-26)
```

**Your own tracked intent's view:**

```
N E X T
n: Start the work

Stop tracking   0: Back
```

**A teammate's intent, in this checkout.** "Work on this here" stays the primary button, as today, but has no letter and no focus. Nothing is focused when the view opens, the same rule as the away window (`modes.mjs:259`), so a stray Enter cannot track the intent:

```
[ Work on this here ]   Ask about it   0: Back
```

On the issue card, Open on GitHub and Copy link use `o` and `y`, as on Home. Sort and Group in Everything open keep a letter only if the table frees one for them; otherwise they are plain buttons.

**Clicked surfaces** (desktop, phone, VS Code). `paneView` (`console.mjs:2113`) sets `isClicked` at `:2116` and builds `frame` at `:2130`. After:

- `isClicked = ['desktop', 'vscode', 'mobile'].includes(surface)`, and `frame` gains `hasKeys: !isClicked`. A missing or unknown surface keeps today's terminal drawing.
- Before, on the phone: "1:" keys and the foot "Enter chooses · Esc closes" are drawn (`console.mjs:2120`). Open on GitHub runs `gh issue view N --web` on the PC and toasts "Ather: opened issue #N in your browser." (`console.mjs:1929-1936`).
- After: no letters and no foot. "Open on GitHub ›" is a link that the phone opens. This was not checked on a real phone.

**How this fits:**

- It extends decide-in-place D3, "Hotkeys only where unique on the screen… the desktop draws no keys" (`docs/intent/decide-in-place/prompt.md:32`), to every clicked surface.
- It keeps simple-view A6 (`docs/intent/simple-view/prompt.md:45`).
- It keeps cache-keep-warm D12's choice of `w` for keep warm (`docs/intent/cache-keep-warm/prompt.md:39`). That is why "Work on this here" gives up `w`.
- It keeps "Looking never tracks" (`modes.mjs:101-102`).
- The Away mode's "a: all · n: none" is in the approved mockup (`docs/intent/away-many-sessions/prompt.md:29`). Changing it needs Hai and Tin's sign-off.

**Tests:**

- A unit test that keys are unique per mode.
- An e2e check that, across every layout dumped in one run, a letter always maps to the same label. The engine resolves two buttons on one key with "later wins", so a clash fails silently today [console-8].
- An e2e check that the intent view's tree has no autoFocus, like the existing away-window check.

### C6. One stage ladder, one meaning per glyph and colour (U14, U15, U26)

**Today, one intent reads differently on each surface:**

| The intent | Pane track and pill | Board and page |
|---|---|---|
| Completed, no debrief | ◐ Ship (`model.mjs:616`, `home.mjs:146`) | ■ Done (`views.mjs:52-56`) |
| Completed, debrief written | ■ Shipped | ■ Done |
| Every item met and proven in the session | Ship (`model.mjs:620`) | ◐ Proving or ✓ Ready to close, depending on PRs (`worklist.mjs:18-19`) |
| The ◐ legend | — | "Items met, PR not merged" (`worklist.mjs:34`; `paseo/ather-automata/README.md:22`) |

**Proposed ladder** (the intent decides):

```
○ Plan → ● Build → ◐ Prove → ✓ Close → ■ Done        ‖ Parked
```

- **Track:** `Plan ✓ ─ Build ● 1/3 ─ Prove ○ ─ Close ○`
- **Prove:** the detail says what is still open, for example "tests not passed" or "PR #128 open".
- **Close:** "Ready to close" in prose, "Close" in cells.
- **Done:** "Done", or "Done · debrief written".
- **Legend, on every surface:** `○ Plan  ● Build  ◐ Prove  ✓ Close  ‖ Parked  ■ Done  · ▰▰▰▰▰ items met`
- **Progress:** "1 of 3 done" in prose and "1/3" in cells. Never "met" (`home.mjs:99`) or "Checklist" (`rows.mjs:433`).

**One decision is needed first, from Tin.** The pane's Prove means "proof not passed in a session" (`model.mjs:620`). The lists' ◐ means "PR named, not merged" (`worklist.mjs:18-19`). They are computed differently, and even "close" differs (`model.mjs:403`).

- My recommendation: make them one stage and say the missing piece in words.
- If the answer is no, give them two glyphs and two words.

**Where the one table lives.** Not in `worklist.mjs`: it imports `model.mjs` (`worklist.mjs:6`), and `model.mjs` needs the labels (`model.mjs:13`), so the two would import each other. Put it in a new leaf module, `ather-automata/hooks/stages.mjs`, that imports nothing. `model.mjs` (STAGE_LABELS), `home.mjs` (PILL_GLYPHS) and `worklist.mjs` (STAGE_BLOCKS, LEGEND) read it, and `worklist.mjs` re-exports what the board uses. The copies follow without new steps:

- `ather-board/sync.mjs` copies what the board's entry modules import, so `stages.mjs` comes with `worklist.mjs`. The board's STAGES is a value, so `page.mjs` writes it into the page as JSON (`ather-board/hooks/page.mjs:16-19`).
- `paseo/ather-automata/server/sync.mjs` copies every top-level module except three (`:15-23`), so it copies `stages.mjs` too.

Do not add a lint on everyday words like "Done".

**Glyphs:**

- ◆ is kept for "needs you" only; it comes off the idle brand (`console.mjs:49`).
- One moon, ☾. The pane also uses an emoji moon today (`console.mjs:985`, `modes.mjs:264`).
- "✓ sent" becomes "→ sent", since it means handed over, not done (`rows.mjs:83`).
- ✓ stays on "ready to close" rows, because that is the list's documented meaning (`worklist.mjs:21`, `:34`) [ux-pane-12, as corrected].

**Colours (U15):**

- The issues and teammates groups are drawn quiet with an icon, not amber and green (`rows.mjs:24`; `WorkSection.tsx:35`). Amber is then only a warning, as `board.css:1-3` says.
- On the board page in light mode, lime dots get an ink ring. Lime on white is 1.14:1 (`board.css:8`, `:172`).
- The calendar's light label colour ships in U9 (`week-calendar/scripts/lib/render.mjs:68`: `#7d7a73` to `#68655e`, contrast 3.79:1 to 5.14:1).
- Each plugin keeps its own contrast test. Do not add a cross-plugin tokens module: week-calendar has no sync, and Paseo takes host colours on purpose (`paseo/ather-automata/client/ui.tsx:8`).
- Theme keys for light terminals ship as U31: the team uses both themes.

**How this fits:**

- It revisits ship-pill D2's pill glyphs, "◐ prove or ship… ■ shipped" (`docs/intent/ship-pill/prompt.md:36`).
- It keeps the overlap-check rule "amber only for a warning, never for the other person's side" (`docs/intent/overlap-check/prompt.md:26`).
- It keeps ather-board D4, Ather's own reader and words for the board (`docs/intent/ather-board/prompt.md:28`).
- U26's words: the Home sections become "Away for hours?" and "Short break?". The warm copy stops saying "away" (`warm.mjs:240`). ◔ says "on" when on. That last part revisits cache-keep-warm D11, which shows on/off only by brightness (`docs/intent/cache-keep-warm/prompt.md:38`).

### C7. The board works for leads (U7, U8, U16, U17, U18, U22)

**Shared page, before:**

```
<header>   S2 intents
<tabs>     Triage | Board | Table | Items | People | Areas | Pulse | Map
           (role=tab, no tabpanel, no arrow keys)
<controls> filters · search · "40 of 142 shown"  (changes silently)
<view>     ● dodge-cancel …   stage = glyph, explained only in a hover title
           no focus ring on rows (board.css:58 `all: unset` beats :23)
           Enter on a row drops focus to <body> (client.js:316-323)
           Map: dots take focus, Enter does nothing (client.js:264, 270, 330)
<footer>   Read from origin/main at 999a2ba on … UTC
           (also holds this PC's drafts and local edits)
```

**What a "local" record is.** `readTeam` first loads every folder on origin/main as source 'main' (`ather-automata/hooks/team.mjs:222-223`). It then replaces an entry with the checkout's copy, as source 'local', whenever that copy wins: the folder is pinned, or has dirty or committed local edits (`team.mjs:225-238`). It also adds folders that exist only here. So 'local' covers two things: drafts that exist only on this PC, and this PC's edits of intents that are on main. Simply leaving out 'local' records on publish would drop real intents from the shared page.

**After, publish (U8).** The shared page is built from main's own entries only:

- `readTeam` also returns the entries it built from main before the local overlay (`team.mjs:222-223`), as `mainIntents`. Nothing Ather shows changes.
- `ather-board/hooks/snapshot.mjs` builds the publish records from `mainIntents`. An intent on main with local edits appears with main's text. A folder that exists only on this PC is left out.
- `writePage` (`ather-board/hooks/index.mjs:177-190`) takes `{ isShared }`; `publish` passes true, `openPage` false.
- Each collision keeps its first changed line, which is a documented feature (`ather-board/README.md:58`, `:84`).
- A board test: an intent on main with a dirty local copy appears on the published page with main's text, and a local-only draft does not appear.

```
/board publish (the shared page)
<header>   S2 intents · read 3 h ago from origin/main 999a2ba   (U27; amber after 24 h)
<rows>     main's copy of every intent; drafts that exist only on this PC left out
<footer>   Read from origin/main at 999a2ba on … UTC   (now true)

/board open (this PC only)
<header>   S2 intents · read just now from origin/main 999a2ba · + 2 drafts from this PC
<rows>     ● Build  my-draft (draft on this PC)
           ● Build  dodge-cancel (your local edits)
```

**After, the page itself (U7, U22):**

```
<tabs>     same tabs · ←/→ move between them · #view is the tabpanel
<controls> filters · search · "40 of 142 shown" read out as a status
<view>     ● Build  dodge-cancel …   word beside the glyph when wide, hidden text when narrow
           rows draw a 2 px ring; Enter keeps focus on the same row
           ○ Plan  ● Build  ◐ Prove  ✓ Close  ‖ Parked  ■ Done  · ▰▰▰▰▰ items met
<Map>      laid out once; filters dim dots instead of moving them (U22)
           under 640 px: "Combat 38 · 12 need someone ›" as a list of module groups
           loud dots get an ink ring in light mode (U15)
```

**`o` from the pane opens the same cut (U17).** For `/board open` only, the page gets the pane's `look` in `#board-data` and uses it when the hash is empty. 'modules' maps to 'map', and 'foryou' maps to Triage filtered to the person (`views.mjs:87`; `client.js:13`). Then "+40 more: o opens the page with every one" (`ather-board/hooks/pane.mjs:136`) is true. The published page carries no look and opens on Triage, so nobody sees the publisher's last cut or a For you filtered to the publisher.

**Board pane, before** (`docs/intent/overlap-check/proof/pane-triage-72.txt:1-14`):

```
C L O N E   I N T E N T S
5 intents · 4 open · 0 parked · 1 done · this we…   f: synced just now ↻

1: For you  2: Triage  3: Modules  4: Table  5: Open items  6: People
7: Areas  │  o: Open the page  p: Publish

Ask[what is blocking combat? whose decisions are oldest?]

Search[words from a name, title, area or owner]

Page written: /tmp/ather-board-Zx89kS/clone/.ather/local/board/index.htm
l (open it in a browser)

N E E D S   S O M E O N E  2
```

**After (U16):**

```
C L O N E   I N T E N T S
4 open · 1 done · synced just now ↻                 o: page   p: publish
1: For you  2: Triage  3: Modules  4: Table  5: Items  6: People
7: Areas
Ask[what is blocking combat?]     Search[name, title, area or owner]

N E E D S   S O M E O N E  2
```

**What changes in the pane:**

- **The page note becomes a toast:** "Ather Board: page written to .ather/local/board/index.html". `$.ui.toast` is already used at `ather-board/hooks/index.mjs:210`. Today `note` is set and never cleared (`index.mjs:64`, `:216`, `:229`, `:271`).
- **"N of M shown" is drawn only where the filters are drawn.** This removes the wrong "2 of 5 shown" on For you (`ather-board/hooks/focus.mjs:88-101`).
- **A brief failure moves into the status line** as "brief: no answer ↻".
- **The brief and Ask get the drawn records (U18)**, collisions included (`index.mjs:152`, `:186`).
- **People and Areas get fixed columns.** Before (`docs/intent/board-counts/proof/pane-people-72.txt:14-17`), "Sam Vo  2 open  5 items" sits above "Lena Park  0 open  1 done". After:

```
             Open  Items  Done  Last change
Sam Vo          2      5     ·  0m
Minh Le         1      2     ·  0m
Tin Nguyen      1      1     ·  0m
Lena Park       ·      ·     1  0m
```

**How this fits:**

- It keeps ather-board D1, one data layer and two surfaces (`docs/intent/ather-board/prompt.md:25`). The changes sit in `views.mjs` and `client.js`, and new `views.mjs` exports go in `CALLS` in `ather-board/tests/board.test.mjs`.
- It keeps D3, both audiences (`:27`), and gives leads origin's truth.
- It keeps D8, For you first (`:33`).
- It meets A7, phone width (`:44`).
- It keeps both inputs as the README promises. They now share one line instead of merging into one input [ux-surfaces-7, as corrected].

### C8. The Paseo panel: a written support level, and true chips (U19, U20)

**Decide first.** paseo-parity left "whether the team uses Paseo daily" to the owner (`docs/intent/paseo-parity/prompt.md:19`). There are three choices:

1. **Full parity:** every mod release also ships on Paseo.
2. **Shared code only:** Paseo gets what the synced modules give, and every gap is said out loud.
3. **Frozen.**

Ten of 23 intents already exclude Paseo [arch-7], and the panel's changelog stops at 0.6.1 (`paseo/ather-automata/README.md:71`) [paseo-11]. Choice 2 matches what the team already does. This is Tin's call. The same decision should name the Paseo week calendar, which has never run on a host (`paseo/week-calendar/README.md:5`). U29 is worth doing only if that port is kept.

**Panel, before:**

```
Proof   [○ build ✓ by "Fix scale"]  [✓ tests]       grey chip, no "passed" in its label
Heading off?  fixed text: "…nothing merges until you are back…"   (AtherPanel.tsx:292)
SummaryStrip                                         (AtherPanel.tsx:239)
/ather find dodge   → sent to the agent as a question
press anything      → every row dims to 50% until the call returns
"Ather could not load: …"                            (no way to retry)
README: "Its version is … 0.6.1"                     (package.json says 0.6.6)
```

**Panel, after:**

```
Proof   [✓ build · Fix scale]  [✗ tests]            proof sent as [{ word, state, by }]
Heading off?  <view.away.rule from the pack>         (C1)
(no strip; the track carries the count, as in the pane: C4)
/ather find dodge   → "Not in Paseo yet: /ather find. Use Search in the list."
press a row         → only that row spins
"Ather could not load: <message>"   [ Retry ]
Option labels: "A: Only our own setting, recommended"
README: "Follows Ather Automata <package.json version>.
         Not here yet: <the lines of the parity table>"
```

The worker "asking" prop gets art again. It is missing from the hand-kept list in `paseo/ather-automata/server/art/render.mjs:19`, so it draws an empty chip (`paseo/ather-automata/client/art.tsx:25`) [paseo-9].

**How this fits:**

- It keeps paseo-parity D1 (shared checks, `:28`) and D2 (`shows`, `:29`).
- It keeps the panel's host-theme colours (`ui.tsx:8`).
- It keeps the README's Limits list (`paseo/ather-automata/README.md:42-53`); the parity table fills its "Not here yet" lines.
- Whatever the decision, the panel's words for the away rule and for unsupported commands come from shared code, so they cannot go stale on their own.

---

## 4. How each change ships

### Plain release PRs, in this order

These are clear and small, and need no intent. Versions are named here in merge order. Whoever merges second takes the next number at merge time, or uses a change fragment if the process proposal's fragments land first. Each PR bumps `plugin.json` and `.claude-plugin/marketplace.json`, adds a Changes line, and runs the syncs.

| PR | Version | Changes | Notes |
|---|---|---|---|
| A | ather-automata 0.6.7, ather-board 0.3.1 | U1 names, U4 blocking Next, U5 the Needs you cut, U6 `/clear`, U30 the worker clock; `readTeam` returns `mainIntents` for PR B | Runs `node ather-board/sync.mjs` and `npm run sync`. The board is bumped because its copies of `worklist.mjs` and `decide.mjs` change what it draws (names). Board Changes line: "Owner names keep their letters (Hoàng Vũ, not Ho Ng V)." Adds the repos e2e steps for `/clear` and blocking Next |
| B | ather-board 0.3.2 | U7 page keyboard, U8 publish truth, U18 the brief sees collisions | After A, since U8 reads `mainIntents`. Board files only. Proof: light, dark and 390 px screenshots in the PR |
| C | week-calendar 0.4.1 | U9 calendar page, with the light label colour | Also adds the missing 0.4.0 Changes line (`week-calendar/README.md:88-92`) [calendar-4]. Runs `npm run embed` in `paseo/week-calendar` |

### Through an intent that is still active

**away-many-sessions, Rev 2** (owner HaiHuynh, still active at `docs/intent/away-many-sessions/prompt.md:4`). Its open items already name the gap (`progress.md:43`), so C1 belongs there, not in a new intent. Two PRs:

1. ather-automata 0.6.8: U2 and U3. Updates `dev/e2e/run.mjs:272`. Adds the mandate unit test. Lands with or after watch-1 and watch-10 from the clean-up deliverable.
2. ather-automata 0.6.9: U10. Updates `dev/e2e/run.mjs:877`. Adds the `host` field on lanes [arch-11].

Hai can fold U3 into the D7 live check that is still owed (`progress.md:41`), since both need the desktop app.

### New intents (`docs/intent/<name>`)

| Intent | Goal (one line) | Covers | Needs a decision from |
|---|---|---|---|
| `pane-drawings` (do first) | Every pane and band layout is a committed text file, so a copy or layout change shows as a diff in the PR. | The enabler for C3-C6 | — |
| `home-said-once` | Advanced Home says each fact once, so Needs you starts on the first screen, and each decision says its question once. | U11, U12 | Tin (simple-view D4 and D5, decide-in-place D3, ship-pill D1) |
| `one-key-map` | Each letter means one thing on every screen, and only the terminal draws letters. | U13 | Hai and Tin (Away a/n) |
| `stage-words` | One stage ladder, one glyph per meaning and one word for it on the pane, lists, board, page and Paseo; amber means a warning. | U14, U15, U26 | Tin (what Prove means) |
| `board-for-leads` | The shared page opens on the cut you were looking at, says its age, and works on a phone. | U17, U22, U27 | — |
| `board-first-screen` | What needs someone shows on the board pane's first screen, and `/board open` answers at once. | U16, U23 | — |
| `first-screen` | A newcomer's first Home is one clear step, and the band's message takes you where it points. | U24, U25 | Tin (newcomers open in Simple) |
| `paseo-support-level` | Write down how far each Paseo plugin follows its mod, and make the panel say only true things within that. | U19, U20, U29's fate | Tin (support level) |
| `calendar-says-so` | The week calendar says when a report did not go out or GitHub was not asked, and shows a first calendar without a quiz. | U21, U28, U29 | — |

**What `pane-drawings` must specify,** so the drawings are stable on every machine:

- **Where.** A new `dev/e2e/drawings.mjs` on the existing stand-in engine, harness and screen modules. It needs no S2. It draws Home in Advanced and Simple (tracked, untracked, newcomer), a decision opened, Everything open, an intent's view, the Away mode with one session, the away window and the band, on the terminal at 60, 72 and 110 columns and the desktop at 110. The board pane comes from `node dev/e2e/board.mjs --out`.
- **One process per drawing.** `console.mjs` keeps module state across sessions in one Node process, and the e2e shares one module instance between sessions [tests-4]. Each scenario runs in its own process with one session. Drawings with several sessions are shown, not compared, until tests-4's per-session module copy lands.
- **Normalize, do not fake the clock.** The hooks read `Date.now()` directly 67 times (a grep over `ather-automata/hooks`), so a fixed clock in the stand-in would not reach them [tests-5, as corrected]. Before comparing, replace relative ages ("just now", "0m ago", "checked 2m ago", an age column's "0m") with `<age>`, clock times ("until 06:30") with `<time>`, dates with `<date>`, and temp roots (`/tmp/ather-board-Zx89kS/…`, `C:/Users/…/Temp/…`) with `<tmp>`.
- **Line endings.** Fold CRLF to LF before comparing, as `ather-board/sync.mjs:27` does, and add `dev/e2e/drawings/** text eol=lf` to `.gitattributes`.
- **Wide characters.** Leave CJK names out until `dev/e2e/screen.mjs:63-64` pads by cells. Keep the Vietnamese names, which are narrow letters.
- **Gate.** A difference fails `node dev/test-all.mjs`. `node dev/e2e/drawings.mjs --update` rewrites the files, and the diff is what the reviewer reads.

**Suggested order:**

1. PRs A, B and C, and Hai's Rev 2 PR 1.
2. `pane-drawings`.
3. `home-said-once`, and Hai's Rev 2 PR 2.
4. `stage-words`, with `one-key-map` alongside.
5. The two board intents.
6. `paseo-support-level`. Decide it early, but port after the pane changes settle, so the work is done once.
7. `first-screen` and `calendar-says-so`.

**Ground rules for every change above:**

- Draw in the pure builders (`rows.mjs`, `modes.mjs`, a new `homeRows`), not in `console.mjs`, which is already 2,296 lines [console-1, console-10].
- Keep the element keys the e2e presses (`dev/e2e/run.mjs:159-164`).
- Change the e2e strings that pin copy in the same PR, and name them in the PR.
- After a change to a shared module, run `node ather-board/sync.mjs` and `npm run sync` in `paseo/ather-automata`, and bump ather-board when its copies change what it draws.
- For any visual change to the page, put light, dark and 390 px screenshots in the intent's `proof/`, as `docs/intent/overlap-check/proof/` already does.

**Left to the other deliverables, though users feel them:**

- The holds behind the away words [watch-1, watch-10, paseo-12]. U2 depends on them (C1).
- What the weekly report publishes [calendar-1].
- The `console.mjs` split [console-1].

**UI/UX findings this proposal does not act on:**

- ux-surfaces-3 (the two Paseo plugins' version ranges do not overlap): release hygiene, left to the clean-up deliverable. The support-level decision in C8 settles whether the Paseo calendar is kept at all.
- ux-surfaces-11 (the Paseo UI kit is a hand copy): code quality with no drift today, left to the clean-up deliverable.
- ux-surfaces-6's shared tokens module: dropped, as its verifier advised (C6).
- ux-surfaces-1's lint on stage words: dropped, as its verifier advised.
- ux-surfaces-7's single Find-or-Ask input: dropped; the two inputs share a line instead.
- ux-surfaces-8's automatic calendar theme: left out; the style stays the person's choice in prefs.json.
- ux-surfaces-4's O(n) layout: performance, left to the clean-up deliverable; U22 lays the Map out once.
- ux-surfaces-10's polling cadence: performance, left to the clean-up deliverable; U19 takes its press and Retry parts.
- ux-pane-3's plain capitals on the desktop: the screen-reader claim was not verified.
- ux-pane-7's renames ("Loose ends", `/ather list`): polish with e2e churn, rated low by its verifier.
- ux-pane-12's ◇ on Needs attention rows: dropped; ✓ is the list's documented meaning.
- ux-pane-9's `?` key legend: optional; the tour's "Your pane" step covers it first.

---

## Notes on the critique

I accepted every blocker and major issue, and the minor ones. In two places I followed the critique's point but not its exact fix:

- **pane-drawings: a fixed clock.** The critique asks for a fixed clock and fixed now in `repos.mjs`. That would not hold: the hooks call `Date.now()` directly 67 times (a grep over `ather-automata/hooks`), and the tests-5 verifier found the same. The drawings instead normalize ages, times, dates and temp paths before comparing. That meets the critique's goal of drawings that do not fail on every run.
- **The web pack's rule line.** The critique's suggested text for the default policy is "merges, production deploys, migrations and secret changes wait for your review". It leaves out pushes to main, which `guards.mjs:95` holds in every policy, so the proposed lines in C1 name them too.
- **A line-number detail.** The `/away` hint is registered at `console.mjs:566-571` and the pack is read at `console.mjs:587`, not `:588`. The critique's point stands.
