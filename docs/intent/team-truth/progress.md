# Progress: team-truth

- Worker: Claude Code background agent, 2026-10-07 (S1; S2 after the thermo-nuclear BLOCK)
- PR: none yet (uncommitted on `intent/team-truth`; the coordinator commits)

## Acceptance

| Item | Verdict | Evidence |
| --- | --- | --- |
| A1 | met | Unit "origin/main's intents are listed with their commit dates, plus the checkout's own, each with its source (A1, A2, D1)". e2e (real git sandbox, working tree behind origin): "before the pane is drawn nothing is fetched, and the list is origin/main as last pulled plus the local draft", "the pane's first draw fetches origin's main in the background, and the list then holds main's open intents the checkout lacks (A1)", "each row records its source: the checkout's own draft is tagged local, main's are not (A1, D1)". Live, read-only against E:\S2_ (round 2, 2026-10-07): origin/main 6b0337256dfd has 44 intent folders; the reader lists 44, **23 open** (23 from main, 0 local), dates from commits (2026-10-04T11:28 to 2026-10-07T10:30). First read 1.6 s with 9 git calls; a second read with nothing moved took 92 ms and 3 `rev-parse` calls (no status, no log). Round 1 (working tree then at 695968dd728b, 21 folders, 4 open): same 23 from origin/main 1e5e6a78bbe6. |
| A2 | met | Unit "a batched git log dates every folder by its last commit and names its first author (A2, A7)" (parses a `git log --format=%x00%ct%x09%an --name-only` sample). e2e "dates come from one batched git log for all of docs/intent, never one per intent (A2)" and "folders with the same file times get their own ages from their commits: 3d and 1d, not the pull's 1h (A2)". |
| A3 | met | Unit "the fetch: narrow refspec, no tags; due when the pane is first drawn, then at most every ten minutes, one at a time (A3)" (FETCH_ARGS = `-c gc.auto=0 -c maintenance.auto=false fetch --no-tags --no-write-fetch-head --no-recurse-submodules origin +refs/heads/main:refs/remotes/origin/main`, GIT_ENV) and "a fetch is synced when git says so and origin/main resolves; one that ran into a git lock names it and waits for its next due time (A3)". e2e: "the fetch moves origin/main by an explicit refspec, no tags, no FETCH_HEAD, no submodules, no auto gc, with GIT_OPTIONAL_LOCKS=0 and no prompt (A3)", "every git call Ather makes runs with GIT_OPTIONAL_LOCKS=0, and none writes the working tree or the index (A3, D2)", "reads run one at a time: three turn ends at once make at most two reads, and with nothing changed none asks git status again (D2)", "the minute timer does not fetch again within ten minutes", "↻ fetches now, and two quick presses make one fetch; the new intent shows (A4)", "after ten minutes the timer fetches again on its own", "a failed fetch keeps every row and the sync line says so (A3)". Live fetch on E:\S2_ with the new argv: GitHub unreachable from this machine at the time (see F-4). |
| A4 | met | Unit "the sync line: \"synced N min ago ↻\" …". e2e terminal "the status line ends in \"synced N min ago ↻\" in the terminal, f fetches now (A4)"; desktop "on the desktop the sync line is a press with no key drawn (A4)"; the desktop press fetched (fetch count 1 → 2). |
| A5 | met | Unit "the age chips are gone: Sort cycles Recent, Ready to close, Oldest; an undated item sorts as the oldest (A5)" and "Ready to close groups the list in stage blocks: all met, proving, building, parked (A5)". e2e "\"Everything open\" starts unfiltered and sorted by Recent; the age chips are gone (A5)", "Sort cycles Recent → Ready to close → Oldest → Recent; Ready to close shows bold stage blocks with counts (A5)", "the stage blocks are subgroups: bold, not letter-spaced, and never lime"; screen "Terminal · Everything open sorted for closing (72 columns)". |
| A6 | met | Unit "Needs attention: the person's own all-met intents and parked ones with no reason, never a teammate's (A6)". e2e "Needs attention lists the person's own all-met and parked-without-reason intents, above Next (A6)", "… each opens its intent, and nothing is done for them", "a teammate's parked intent without a reason warns on its own row and is not in the person's Needs attention (D5, D7)". |
| A7 | met | Unit "owner names from main, tidied for display; a team shows with its lead; no Owner falls back to the first committer (A7)": a table of the 20 author/Owner spellings on origin/main (LamPhung-Art, trucnguyen, DuyTranSipher, HaiHuynhTA, ThangtrinhGEatherlabs, TienPhamProducerAther, HuyLuongDucGameDesignAther, KhoaLe (Game Engineer), haothansipher, …). e2e "owners tidied: LamPhung-Art is Lam Phung, Cinematic is \"Tien Dang · Cinematic\", the ownerless intent shows its first committer (A7)". Live: owners read Khoa Le, Truc Nguyen, Lam Phung, Hao Than, Thang Trinh, Duy Tran, Tien Dang, Hai Huynh. |
| A8 | met | Unit "one row anatomy: glyph, title, warning, mini bar and count, age, owner; columns as wide as the widest (A8)". e2e at 72 and 110 columns: "one anatomy @72/@110: every intent row as wide as the pane, its count column ending at one place, a mini bar beside it (A8)", "Everything open @72/@110: every intent row's age column ends at the same column, no line wider than the pane", "Everything open @72/@110: the legend at the foot", "Home previews four teammates' intents, then \"+1 more ›\" (A8)", "… on the desktop too: four rows with their column boxes, then \"+1 more ›\", no keys drawn (A8)", "on the desktop every row has the same column boxes (bar, count, age, owner) of the same widths, and no hotkeys (A8)". Screens below. |
| A9 | met | Unit "decisions wait in one block per intent, in the order they came (A9)". e2e "four decisions on one intent wait as one block, \"quest-calls · 4 decisions\" (A9)", "… and pressing it opens the four, each its own press", "lime only on Needs you, Needs attention and Next (A9)" (every lime node sits under the needs, attention, next-section or strip key), "Everything open has no lime: nothing there is waiting on the person (A9)". |
| A10 | met | Round 2: `node dev/test-all.mjs` with CLAUDE_CODE_TYPES and S2_ROOT=E:/S2_: Paseo shared modules in step, Paseo ather-automata `tsc --noEmit` clean, mod type-check clean, **unit 137/137, e2e 271/271**. `claude plugin validate ather-automata`: exit 0 on 2.1.292 (PATH) and exit 0 on 2.1.286 (desktop exe). |
| A11 | met | Thermo-nuclear review (S2 skill): round 1 BLOCK (overlapping refreshes, a leaky cache key, fetch hazards in the shared checkout, view-model logic in console.mjs, duplicated facts, studio rules outside the pack, optional fields), all fixed; round 2 PASS on 2026-10-07. Coordinator re-ran: unit 137/137, e2e 271/271; validate exit 0 on 2.1.292 and 2.1.286; a live run of the fetch argv on E:\S2_ exited 0, left FETCH_HEAD and refs unlocked; live read 23 open, cached re-read 74 ms. |

## Screens (e2e, real git sandbox behind its origin)

Terminal · Home, 72 columns:

```text
What next?
                                                    f: synced just now ↻
Role not set · /ather role · Editor free

Yours 4 · Workers 0 · Needs you 4

[ ＋ New intent ]

N E E D S   Y O U   ·   4
◆ 1: ▸ quest-calls · 4 decisions

N E E D S   A T T E N T I O N   ·   2
✓ 2: mine-met · every item met · Close it?
‖ 3: mine-parked · parked, no reason · Add one?

N E X T
n: Pick up quest-calls
Tools · 0/2 · 4 need you

A L S O   Y O U R S
a: ● local-draft local                      ▱▱▱▱▱  0/2  1h
b: ✓ mine-met                               ▰▰▰▰▰  2/2  2h
c: ‖ mine-parked ⚠ parked, no reason        ▱▱▱▱▱  0/2  2h

T E A M M A T E S '   I N T E N T S   ·   5
Read-only: their decisions stay theirs.
d: ● ownerless                              ▱▱▱▱▱  0/2  2h  Truc Nguyen
e: ● teammate-c                             ▱▱▱▱▱  0/2  2h  Duy Tran
g: ‖ teammate-d ⚠ parked, no reason         ▱▱▱▱▱  0/2  2h  Tien Dang
h: ● teammate-b                             ▱▱▱▱▱  0/2  1d  Tien Dang ·…
i: +1 more ›
```

Terminal · Everything open, 110 columns:

```text
Everything open
9 open · yours first                                                                      f: synced just now ↻

s: Search…   o: Sort: Recent

▾ Y O U R   I N T E N T S   ·   4
1: ● local-draft local                                                   ▱▱▱▱▱  0/2  1h
2: ● quest-calls                                                         ▱▱▱▱▱  0/2  2h
3: ✓ mine-met                                                            ▰▰▰▰▰  2/2  2h
4: ‖ mine-parked ⚠ parked, no reason                                     ▱▱▱▱▱  0/2  2h

▾ T E A M M A T E S '   I N T E N T S   ·   5
5: ● ownerless                                                           ▱▱▱▱▱  0/2  2h  Truc Nguyen
6: ● teammate-c                                                          ▱▱▱▱▱  0/2  2h  Duy Tran
7: ‖ teammate-d ⚠ parked, no reason                                      ▱▱▱▱▱  0/2  2h  Tien Dang
8: ● teammate-b                                                          ▱▱▱▱▱  0/2  1d  Tien Dang · Cinematic
9: ◐ teammate-a                                                          ▰▰▱▱▱  1/3  3d  Lam Phung

● Build  ◐ Prove  ✓ All items met  ‖ Parked
```

(Trailing padding of the owner column trimmed here; the issues group is omitted.)
