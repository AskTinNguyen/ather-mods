# Code clean-up and refactoring roadmap

**How to read this.** The ids in brackets (arch-1, console-4, …) point to the verified review findings. Where a verifier corrected a finding, this plan uses the corrected version. Paths are from the repo root at `999a2ba`. "Proof" means the recipe in 2.0 unless an item says otherwise. "Ports" means the closures a host hands a pure module: Io (`state.mjs:20-36`), Repo (`team.mjs`) and Host (`handoff.mjs:22`).

**Start here (the first two weeks)**
1. P0.6: land `dev/check-structure.mjs` (drafted below) with its allowance file, plus `.gitattributes`. S.
2. P0.2: test-all runs every stage and ends with a summary. S.
3. P0.3: each e2e session gets its own copy of the hooks. Main goes green. S–M.
4. P0.7: one line in `paseo/ather-automata/server/needs.ts:57`. The Paseo type-check goes green. S.
5. P1.3: unit tests run in place under `node --test`. S.

**The problem in four lines**
- `ather-automata/hooks/console.mjs` is 2,296 lines. It had 95 commits since 10-01 and appears in 35 of 71 merged PRs. It grew 936 lines in 16 days. The 1,000-line rule only fires when a file *crosses* 1,000 (AGENTS.md:14), so it never fires on this file [console-1, process-6].
- There are 12,870 lines of committed copies: the board has 18 files and 5,159 lines, Paseo 30 files and 7,711 lines. Three scripts make them, each in its own way. PR #83 changed 42 files; 18 were copies and 4 were version files [arch-4].
- Paseo rewrites the controller layer (about 1,700 lines, typed `any`) and is missing 0.6.2–0.6.6. Its type-check has been red on main since 10-19 (`paseo/ather-automata/server/needs.ts:57` has no `sentTo`), and nobody saw it [arch-1, paseo-2].
- There is no CI. The repos e2e on main fails because two sessions share one hooks module. The S2 e2e cannot fail the gate [tests-2, tests-4, tests-1].

**Constraints every item respects**
- Installed plugins are self-contained, so shared code stays copied [arch-4].
- Paseo's bundler only reaches its own folder (`paseo/ather-automata/server/sync.mjs:1-2`).
- `$` never crosses an import. `claude plugin validate` refuses it, and a scratch probe reproduced that [console-1].
- Windows agent PCs need care: 8.3 TEMP paths, long paths, CRLF, and no symlinks [tests-m2, tests-6, process-3].

---

## 1. Target architecture

```
 HOSTS   hold `$` (or Paseo's ctx), build ports, call a flow, and turn its verdict into a toast, a deny or a reply.
         No flow, prompt text or command grammar lives here. Only ather.mjs imports a half.
 ┌──────────────────────────────────────────────────────────────────────────────────────────────┐
 │ Claude Code  ather.mjs ─┬─ watch.mjs       tool.call · prompt · session · MCP tools            │
 │                         ├─ console.mjs     band + pane draw · one ports($) · clocks (~250)     │
 │                         └─ console/*.mjs   console-only logic over ports, no `$`               │
 │ Board        ather-board/hooks/index.mjs                                                       │
 │ Paseo        paseo/ather-automata/server/*.ts   ports from node fs/execFile, switch on `kind`  │
 └──────────────────────────────────┬───────────────────────────────────────────────────────────┘
                                    │ ports only: Io (one makeIo) · Repo · Host
                                    ▼
 SHARED AND PURE: ather-automata/hooks/  (copied by one dev/share.mjs to the board and Paseo)
   flows  tools · commands · policy · away-flow · merge-audit · keys                      [new]
   draw   look (leaf: palette, cells, fit, label) [new] · rows · modes · crew-rows
   views  home (buildHome → paneModel) · decide       ║  store  state = queue + lanes · heartbeats ·
                                                      ║         evidence · away-store [new] · warm-store
   rules  away · guards · handoff · overlap · collide · squad · crew · workers · warm · askrules [new]
   base   model · worklist · team · workspace · shell · transcripts · issues · prs · changes · inflight
          · prefs [new] · packs/index → PACKS [unreal, web, core]
 Imports point down. Views and store sit side by side and never import each other.
 week-calendar/scripts → paseo/week-calendar/server/scripts.generated.ts (+ VERSION), same share script.
```

- **The layers are today's imports, with one exception.** I listed every hooks module's imports. The only import that goes up is `state.mjs:18`, which imports `paneViewOf` from home.mjs; P1.4a removes it. The store importing away and guards (`state.mjs:10-11`) points down: neither of them imports the store. `dev/check-structure.mjs` holds the same table (`LAYERS`), so the diagram and the check cannot disagree. A new module must be placed in a layer before the check passes.
- **Hosts are thin.** Only `ather.mjs`, `watch.mjs`, `console.mjs` and the board's `index.mjs` touch `$`. In code there are 120 `$.` calls in console.mjs and 61 in watch.mjs (116 and 59 lines), and none in any other module [arch strengths]. Each host keeps one ports builder and maps verdicts to effects. A handler group split out of console.mjs either takes ports and holds no `$`, or registers its own hooks and joins the `ENGINE` list in the check.
- **Flows become pure.** Several flows are written twice today: the MCP tool specs and the status report, the /ather and /away grammar, the brief gate and the deferral verdicts, and the merge audit (`watch.mjs:546-617` vs `paseo/ather-automata/server/tools.ts:82-160`). Away across several sessions (`console.mjs:1465-1500`) has no Paseo counterpart at all [arch-1, paseo-3]. Each becomes a pure function over ports.
- **Copies stay, made one way.** One share script follows each consumer's own `./ather/*` imports. `.gitattributes` marks the copies as generated, so reviews collapse them [arch-4, process-4].
- **Adding a feature** takes a pure module, placed in a layer, with a unit test over fake ports (no fake engine). Each host adds one handler line. Words go in `commands.mjs`, a Home part in `HOME_PARTS` (`home.mjs:57-64`), and the PR adds a change fragment. Paseo gets the code from the share step. Where Paseo will not have the feature, the parser returns `{ kind: 'unsupported', why }`, so the gap is said out loud instead of disappearing.
- **Adding a stack** takes one file in `packs/` that exports `{ detect, make }`, plus one entry in `PACKS`. Everything that differs by stack is a field on the pack, never a pack id check: held labels, ask prefixes, proof words, the squad's prop, whether gates show, the board's module map [arch-3, board-9].
- **Adding a surface** takes a host adapter that builds the ports and draws a structured view model. It does not re-parse display strings, as `paseo/ather-automata/client/AtherPanel.tsx:375-379` does today, and it does not rewrite the controller [paseo-5].

| Change | Today | Target |
|---|---|---|
| A feature on all three surfaces | 2 PRs, 64 files, 10 of them copies (#73 + #76) [arch-4] | 1 PR: module + test + 1–2 host lines per surface + 1 fragment. Copies regenerate and collapse in review |
| A fourth stack | `packs/index.mjs` (id union :29, if-chain :94-103), `guards.mjs:13-19`, `squad.mjs:66-67`, `ather-board/hooks/modules.mjs:52`, Paseo `rules.ts:14-41` and `:47` [arch-3] | 1 file + 1 `PACKS` entry |
| An /ather word | 4 word lists and 2 if-chains in 3 files: `console.mjs:566`, `:1533`, `:1536-1577`; `console.ts:601`, `:610-648`; `client/commands.ts:11` [console-5] | 1 row in `commands.mjs` |
| A stored feature | `state.mjs` (969 lines, 31 under the limit) [watch-9] | its own `*-store.mjs` on the one queue |

---

## 2. Phased plan

### 2.0 Rules for every refactor PR

- **Behaviour-preserving only.** A behaviour fix gets its own PR, even one found in the middle of a refactor. 2.6 lists the known ones. Keeping them apart is what keeps the before/after diff empty.
- **A fix may grow a big file, with the owner's say.** When a fix PR grows a file that is already over 1,000 lines (console.mjs, today), it adds one entry to `dev/structure-accept.json`: `{ rule, file, upTo, why }`. CODEOWNERS gives that file to the owner. No other route around the check exists. An admin merge is visible on GitHub, so it is not a quiet one. Once the growth is on main, the entry grants nothing more, and the check says to remove it.
- **The proof recipe:**
  1. On the merge base, run `node dev/test-all.mjs --out <before>`. After P0.5, `--out` writes the golden layouts from repos.mjs and board.mjs. With `S2_ROOT` at the pinned S2 sha (P0.4), it also writes run.mjs's `--layouts`. Save the notes of `claude plugin validate --json <mod>` (P0.5b).
  2. On the branch, do the same into `<after>`. Run the two back to back on one machine.
  3. The PR passes when:
     - `diff -r <before> <after>` is empty. Clock times and ages are masked in the dump, and the local hour is pinned (P0.5a);
     - no test was removed, renamed or skipped, every test that passed before passes after, and any tests added are listed in the PR;
     - validate's notes and gating hooks are equal apart from the `(via …)` names [console-1];
     - `node dev/check-structure.mjs` prints no `FAIL`;
     - `claude plugin test <mod>` passes;
     - the Paseo typecheck and e2e pass whenever a copied module changed.
- **Small PRs on hotspot files.** One section or one flow per PR, merged the same day.

### 2.1 Lanes, held files and hand-offs

Five lanes run in parallel; inside a lane, items go one at a time. Files are held, not lanes. Each hotspot file has a holder. A PR from another lane that needs a held file is a **hand-off**: the author tells the holder, rebases on the holder's last merge, and merges the same day, between two of the holder's PRs.

| File (commits or PRs since 10-01) | Holder | Hand-offs into it |
|---|---|---|
| `console.mjs` (95 commits, 35 of 71 PRs) | A | P1.7 readTeam (one line, B); P2.2 away-flow (B); P2.3 makeIo (B) |
| `home.mjs` | A | P1.4a prefs (B); P2.5 pack defaults (B); P2.7 paneModel (D) |
| `rows.mjs`, `modes.mjs`, `crew-rows.mjs`, new `look.mjs`, `keys.mjs`, `console/*` | A | none |
| `state.mjs` and new `*-store.mjs`, `packs/*`, `guards.mjs`, `shell.mjs`, `away.mjs`, `model.mjs`, `squad.mjs`, `team.mjs` | B | P1.4a (2 import lines in state.mjs, A); P1.7 board firstAt (team.mjs, E) |
| `watch.mjs` | **lock**: one open PR at a time, any lane. Its title starts `[watch.mjs]`; check `gh pr list` before opening another | P1.5a, P1.7 stringify, P2.2, P2.3, P2.5, the 2.6 hook sweep |
| `dev/test-all.mjs`, `dev/e2e/*`, `dev/share.mjs`, `.github/`, `.gitattributes` | C | none |
| `paseo/**` | D | none; every Paseo side of a shared change is D's own PR after the share step |
| `ather-board/hooks` (not the copies), `ather-board/page`, `week-calendar/**` | E | P1.4b (`ather-board/hooks/pane.mjs:9`, one line, A) |
| `ather.test.mjs` (87 commits, 36 PRs) | anyone, until the P2.6 window | P2.6 splits it in one announced window |
| `marketplace.json`, `plugin.json`, the mod READMEs (46, 40 and 42 of 71 PRs) | release only, after P1.2 | none |

- Lane A: P1.4b, P1.5b, the P1.7 worker clock, P1.8, P2.1. Lane B: P1.4a, P1.5a, P1.5c, P1.7 (lane, readTeam, firstAt), P2.2–P2.5. Lane C: P0.1–P0.6, P1.1–P1.3, P2.6. Lane D: P0.7, P1.6, Paseo sides, P2.7. Lane E: board and calendar items, P3.5, P3.6.
- Sources: [process-1, console-1, tests-8].

### Phase 0: safety net first

**P0.1 CI that runs the gates**
- **What.** Add `.github/workflows/gates.yml` and `.github/CODEOWNERS` (`dev/structure-accept.json @AskTinNguyen`). Jobs:
  - `structure`: ubuntu, `fetch-depth: 0`. On pull_request it runs `node dev/check-structure.mjs`; on a push to main, `--base HEAD~1`. On a push, the default base would be HEAD itself, so it would check nothing. It also runs the three `--check` scripts.
  - `gates`: ubuntu and windows × Node 22 and 24, with TEMP/TMP/TMPDIR set to `runner.temp`. Runs `node dev/test-all.mjs` and the week-calendar unit tests.
  - `paseo`: `npm ci` in both paseo packages, then typecheck and the Paseo e2e.
  - `plugin`: `npm i -g @anthropic-ai/claude-code@2.1.296`, the version on the owner's Mac today (`npm view` confirms the package and its `claude` bin), with `CLAUDE_CONFIG_DIR` set to a temp folder. Runs `claude plugin validate --strict` on `.` and on each mod, `claude plugin test` on each mod, and compares the validate snapshot (P0.5b). A pin bump and its snapshot change go in one PR.
- **Required, in this order.** A job runs and reports from day one, but blocks merges only once it is green on main:
  1. `structure` at once. It is green on HEAD (checked).
  2. `plugin` once the snapshot is committed. Validate and the plugin tests pass today [tests-2].
  3. ubuntu `gates` after P0.2 and P0.3.
  4. `paseo` after P0.7.
  5. windows `gates` once it is green. #77 reported about 54 repos-e2e failures there [process-2 verifier].
- **Why.**
  - There is no `.github/`, main is unprotected, and all 71 PRs were merged by their own author [process-2].
  - Each person runs the gates on their own OS and Node and reports the results in prose [tests-2].
  - The Paseo checks are skipped without `npm install` (`dev/test-all.mjs:45-48`, `:97-99`) [paseo-2, tests-m1].
- **Files:** `.github/workflows/gates.yml`, `.github/CODEOWNERS` (both new). Lane C.
- **Risk:** low.
- **Proof:** none needed, since it adds checks. Run it once on main and list the known failures.
- **Size:** M; getting Windows green may be L.
- **Parallel:** yes.
- **Carried caveats:**
  - windows-latest TEMP is reported to be an 8.3 path, so the override is required (not verified) [tests-m2].
  - `paseo/ather-automata/server/test-resolve.mjs:3` uses `module.registerHooks`. Pick the oldest Node with that in mind (not verified) [tests-2].
  - The mod type-check stays skipped in CI unless engine types can be produced there [process-2 verifier].

**P0.2 A test-all that keeps going and says what ran**
- **What.**
  - Stages become a table `{ name, cmd, cwd, when, whySkipped }`, run with `spawnSync` and `process.execPath`.
  - It ends with a summary: stage, result, counts, seconds, and why each skip happened. It exits 1 if any stage failed.
  - New flags: `--only`, `--keep` (WORK is removed otherwise) and `--out <dir>` (P0.5).
  - New stages: `structure` first, then the week-calendar unit tests.
- **Why.**
  - `execSync` throws at the first failure (`dev/test-all.mjs:17`), so the board e2e never ran in the baseline.
  - The unit runner uses plain `node` from PATH (`:76`).
  - WORK is never removed (`:16`).
  - week-calendar has no stage.
  - Findings: [tests-7, calendar-4, tests-10].
- **Files:** `dev/test-all.mjs`. Lane C, first.
- **Risk:** low.
- **Proof:** the same counts on HEAD (unit 397/397, board unit 73/73, repos e2e 328/329 on macOS), and the board e2e now runs (18/18 when run alone) [tests summary].
- **Size:** S.

**P0.3 Make main green: e2e sessions stop sharing one hooks module**
- **What.**
  - `createEngine` copies `out/hooks` to `out/s<n>/hooks` for each booted session and imports from there. A copy is needed: a `?query` import still shares the inner modules [tests-4 verifier].
  - `dev/e2e/repos.mjs:107` imports `checkoutId` from `out/hooks/workspace.mjs` instead of working it out again [tests-6].
  - Sandbox roots use `fs.realpathSync.native` (`harness.mjs:16`, `run.mjs:31`, `ather-board/tests/board.test.mjs:309`, `:341`). Confirm once on an account with an 8.3 TEMP [tests-m2].
- **Why.**
  - The red check at `repos.mjs:1442` comes from session 0030's background read, which writes the module-level `places` (`console.mjs:72`, `:672`) after session 0031's. A trace proved it, and the block fails on its own 3 times out of 3 [tests-4 verifier].
  - Long temp paths cause 13 false failures [tests-6]. A scratch run here, with a long TMPDIR, gave 314/329.
  - It also lets several personas share one run, which the golden layouts need (P0.5).
- **Files:** `dev/e2e/engine.mjs`, `repos.mjs`, `run.mjs`, `harness.mjs`, `ather-board/tests/board.test.mjs`. Lane C.
- **Risk:** low; it is test code. A check that starts failing after the split is a real cross-session bug: file it.
- **Proof:** repos e2e 329/329 three runs in a row, on macOS and on Windows.
- **Size:** S–M.
- **Parallel:** rebase on open PR #84, which edits `harness.mjs` and `run.mjs` [tests-10].

**P0.4 The S2 e2e can fail, on fixed input**
- **What.**
  - `run.mjs` moves onto `harness.checks()/finish()` and keeps its Screens and `--layouts` output [tests-1 verifier (d)].
  - `dev/e2e/s2-ref.txt` holds an S2 sha, read with `git -C $S2_ROOT archive <sha> docs/intent`. Use `ls-tree`/`show` instead where `tar` is missing on Windows. HANVIET_ROOT gets the same treatment.
  - `--baseline <report>` fails only on checks that passed in the baseline.
  - At the pinned sha, sort the 41 failures from PR #84 once: fix each one, or move it to a named list with its reason.
- **Why.**
  - `run.mjs:2141-2156` never sets an exit code.
  - `run.mjs:32` copies the live S2 tree, so the failure set drifted from 8 to 12 to 41 [tests-1, process-12].
- **Files:** `dev/e2e/run.mjs`, `dev/e2e/s2-ref.txt` (new), `dev/test-all.mjs`. Lane C.
- **Risk:** low.
- **Proof:** the same commit gives the same failure set on two machines.
- **Size:** S for the exit code and the pin; M for sorting the failures.
- **Parallel:** after #84.

**P0.5 Record today's behaviour so refactors can be checked**
- **(a) Golden layouts, from the `--out` that already exists.**
  - `repos.mjs` already writes named layouts with `--out <dir>` (`harness.mjs:23-35`; `repos.mjs:12`, `:1624`, `:1866-1891`). `dev/test-all.mjs:90` just never passes it, and `--layouts` reaches only the S2 run (`:108`). test-all passes `--out` through to repos.mjs and board.mjs.
  - Add the missing screens to that set:
    - Home in Advanced and Simple (tracked, untracked, newcomer);
    - an opened decision, Everything open, the intent view;
    - the Away mode, the away window and the band.
    - Sizes: terminal at 60, 72 and 110 columns, desktop at 110.
  - **Mask what moves with the clock.** Layouts print clock times and ages. The critique's two runs differed at `away-many-110.txt:11` (`away until 23:38` against `23:40`). Before laying out, `writeDrawn` and run.mjs's layout writer replace `\b\d{1,2}:\d{2}\b` with `<hh:mm>`, and `<n><unit> ago` and `just now` with `<age> ago`. Masking before layout keeps line wraps the same.
  - **Pin the local hour, not just the zone.** Home's Heading off? section shows only in the evening by the stored offset (`home.mjs:430`, `model.mjs:575-578`). That offset is read from `date +%z` (`watch.mjs:477-482`). With TZ=UTC alone, the section still comes and goes with the hour of the run. The golden stage sets `TZ=Etc/GMT±N` so that the local hour is 13. The golden diff runs on ubuntu: on Windows, `detectTz` asks PowerShell first, which is not expected to read TZ (not verified).
  - Golden = the committed `dev/e2e/golden/` folder. `--update-golden` accepts a change.
- **(b) Validate snapshot.** Run `claude plugin validate --json <mod>` and keep only `contents[].notes` and `contents[].gatingHooks`, with `(via …)` lists removed. The notes use module-relative paths (`./ather.mjs …`). Only `target` and `file` are machine paths, so they are dropped. Committed as `dev/validate-snapshot/<mod>.json`.
- **(c) Tests that pin today's behaviour** for what Phases 1–2 move:
  - the status report JSON and the three MCP schemas (`watch.mjs:546-617`);
  - a table of /ather arguments → handler (`console.mjs:1536-1577`);
  - `needsView` over 12 decisions (`decide.mjs:154`), pinned as it is today, with a comment;
  - the prompt texts at `console.mjs:1293-1320` and `:2179`.
- **(d)** The board page's DOM-free smoke test [board-7 (3)], and the calendar client parsed with `vm.Script` [calendar-8].
- **Why.** Today the pane is checked only end to end, by element key (`dev/e2e/run.mjs:159-164`) [console-12]. The page's only test is "compiles" (`ather-board/tests/board.test.mjs:265-267`) [board-7]. A console.mjs split cannot be judged without a layout diff.
- **Files:** `dev/e2e/harness.mjs`, `screen.mjs`, `repos.mjs`, `board.mjs`, `run.mjs`, `dev/test-all.mjs`, `dev/e2e/golden/**`, `dev/validate-snapshot/*`, a new `ather-automata/tests/pinned.test.mjs`, `ather-board/tests/board.test.mjs`, `week-calendar/scripts/test/render.test.mjs`. Lane C.
- **Risk:** none.
- **Size:** M.
- **Proof:** the masked golden files are byte-stable over 3 runs in a row. Checked so far: in scratch, two runs of `repos.mjs --out` on HEAD, 20 s apart with the local hour pinned, gave all 10 layout files byte-identical, both raw and masked (`<scratch clone>`, `drawn2`, `mask.mjs`). Runs minutes apart still need the mask.
- **Parallel:** after P0.3 (same files).

**P0.6 Guardrails in place**
- **What.**
  - Land `dev/check-structure.mjs` (drafted in full with this proposal) as the first stage of test-all and as the CI `structure` job.
  - Create an empty `dev/structure-accept.json` (`[]`), the owner's allowance file; CODEOWNERS covers it (P0.1).
  - Add to `.gitattributes`:
    - `ather-board/hooks/ather/** linguist-generated=true`
    - `paseo/ather-automata/server/ather/** linguist-generated=true`
    - `paseo/*/server/*.generated.ts linguist-generated=true`

    Do not add `-diff`: it hides a hand edit to a copy from local diffs [arch-4 verifier].
  - Add `* text=auto eol=lf` above the fixtures line. All 335 text files are already LF [process-4 verifier].
- **Why:** [process-6, arch-8, arch-2, arch-3, arch-5, watch-9, calendar-5, arch-4].
- **Size:** S.
- **Proof.** I ran the script in a scratch clone of the repo (`<scratch clone>`):
  - On HEAD it prints 10 `ok` lines in 0.11 s.
  - 10 deliberate violations each failed with their own message.
  - An allowance passes a growth up to its `upTo` and fails past it. A malformed allowance fails.
  - A merge commit checked with `--base HEAD~1` passes.
  - A later PR that grows the file again fails, and the check names the stale allowance.
  - Removing state.mjs's home import prints `better layers: state.mjs 1 -> 0`.
  - `--base` with no value exits 2.

**P0.7 The Paseo type-check goes green**
- **What:** pass `sentTo: {}` at `paseo/ather-automata/server/needs.ts:57`, or spread `FRESH_ANSWERS` (`decide.mjs:104`) [paseo-2].
- **Size:** S. Lane D.
- **Proof:** `npm run typecheck` gives 0 errors. The TS2345 error was reproduced in scratch.
- **Order:** needed before the CI `paseo` job can be required.

**P0.8 The owed D7 live check**
- **What:** run D7 (`docs/intent/away-many-sessions/progress.md:41`). One session writes another session's `away:<sid>` while that session writes its own store. Write the result in state.mjs's header [watch-4, arch-10].
- **Why now:** it decides whether the store needs a redesign (P3.3), and since 0.6.6 sessions write each other's keys.
- **Size:** S; anyone with two live sessions. Needs no lane.

### Phase 1: now (high value, low risk)

**P1.1 One share script for every copy** (code judo)
- **What:** `dev/share.mjs [--check]`, driven by one table with one closure algorithm. It follows imports into any subfolder. It also follows JSDoc `import()` types, so the board's `// @ts-check` copies and Paseo's typed boundary (P1.6) stay whole. Today the type imports add nothing: the closure is 18 = 18 for the board and 25 = 25 for Paseo, with and without them (scratch `closure.mjs`).
  - `ather-board/hooks/ather` ← the board's own `./ather/*` imports: 8 entries today, including `packs/index.mjs` and `decide.mjs`. No transform.
  - `paseo/ather-automata/server/ather` ← the `./ather/*` imports of `server/*.ts`, `server/art/render.mjs` and the client. It strips `// @ts-check` and writes the version into package.json and package-lock.json, as `server/sync.mjs:52-71` does today.
  - `paseo/week-calendar/server/scripts.generated.ts` ← `week-calendar/scripts` minus `test/`, unchanged. The version moves in P1.1b.
  - `art.generated.ts` carries a hash of its SVG source, and PROPS come from `squad.mjs`'s exported `PROP_WORDS` [paseo-9].

  The three old scripts become one-line calls, and the npm scripts point at the new one.
- **Why.**
  - There are three scripts with three algorithms: `ather-board/sync.mjs:16-23`, `paseo/ather-automata/server/sync.mjs:15-23`, `paseo/week-calendar/server/embed.mjs:17-18`.
  - The Paseo sync only walks `''` and `'packs'` (`server/sync.mjs:19`, `:40`). A new `hooks/` subfolder would not be copied, and `--check` would still pass.
  - Paseo carries 5 copies it never imports (crew-rows, modes, rows, warm, warm-store; 1,277 lines), yet PR #83 still churned them.
  - Findings: [arch-4, paseo-10, process-4, paseo-8, paseo-9].
- **Files:** `dev/share.mjs` (new), `ather-board/sync.mjs`, `paseo/ather-automata/server/sync.mjs` and its package.json, `paseo/week-calendar/server/embed.mjs` and its package.json, `dev/test-all.mjs:43-44`, `:52`. Lane C.
- **Risk:** low to medium. The Paseo copy set shrinks by exactly those 5 files.
- **Proof:** `--check` is green, and the copy set changes by exactly the 5 Paseo files. Board unit tests and e2e, and the Paseo typecheck and e2e, are unchanged.
- **Size:** M.
- **Parallel:** lane C, after P0.2.
- **P1.1b (behaviour change, its own PR right after).** `export const VERSION` is generated from week-calendar's plugin.json, and the hand constant at `paseo/week-calendar/server/calendar.ts:12` goes away. That moves "0.3.0" to "0.4.0" (`week-calendar/.claude-plugin/plugin.json:3`). The value is written to `~/.calendar/bin/version.json` (`calendar.ts:49`), and reports read it as `pluginVersion` (`week-calendar/scripts/lib/report.mjs:10-15`). Do it only if the owner keeps paseo/week-calendar at all, since it is unsupported today [paseo-8, calendar-4].

**P1.2 Versions picked at release time** (an enabler; the details belong to the process proposal)
- **What.**
  - Feature PRs add a change fragment in `changes/<mod>/*.md`, outside the shipped folder, instead of a version.
  - `dev/release.mjs` picks the version and writes it.
  - `version` is dropped from the marketplace's `plugins[]` entries; `--strict` validation passes without them. First check that `claude plugin update` picks up a bump in plugin.json alone.
  - A board fragment is required whenever the board's copies change [process-1, arch-9, process-8].
- **Why here:** the three files that conflict most in feature PRs are release bookkeeping. Phase 2's many small PRs need them gone.
- **Size:** S–M. Lane C.

**P1.3 Unit tests run in place under `node --test`**
- **What.**
  - Delete `runUnit`, the WORK copies, the import rewrite, `main.mjs` and the shim's `run()` (`dev/test-all.mjs:66-81`). The `node_modules/claude-code` link already exists (`:31-35`).
  - List test files with `readdirSync`, not a quoted glob [calendar-4 verifier].
  - Make the shim strict: `isDeepStrictEqual`, `.not` rethrows errors that are not assertion failures, and `toMatch` fails on non-strings [tests-3 (4)].
- **Why.**
  - In place, 470 tests pass in 4.8 s, against 7.2 s plus a copy step today [tests-7 verifier].
  - With the strict shim, 397/397 and 73/73 still pass [tests-3 verifier].
- **Files:** `dev/test-all.mjs`, `dev/shim/testing.mjs`. Lane C.
- **Risk:** low.
- **Size:** S.
- **Proof:** the same 470 test names pass.

**P1.4 Fix the layering** (two small PRs)
- **a. View settings out of the views.** A leaf `prefs.mjs` (base layer) holds `paneViewOf` and `groupByOf`. home.mjs and worklist.mjs re-export them, so their importers do not change. `state.mjs:17-18` then imports prefs.mjs.
  - Files: `prefs.mjs` (new), `home.mjs`, `worklist.mjs`, and `state.mjs` (2 import lines; a hand-off from B to A). Lane A.
  - Proof: the recipe, and check-structure prints `better layers: state.mjs 1 -> 0`.
- **b. A `look.mjs` leaf.** Split `rows.mjs` into `look.mjs` (draw layer: palette, cells, padCells, fit, label, section, statusLine, workLine, choiceRow) and `rows.mjs` (the Home lists). `ather-board/hooks/pane.mjs:9` imports `./ather/look.mjs`.
  - Files: `rows.mjs`, `look.mjs` (new), and `ather-board/hooks/pane.mjs` (one line; a hand-off into E). Lane A.
- **Why.** The store's runtime closure is 18 modules; without those imports it is 12. The board ships away, guards, handoff, home and issues (about 1.27k lines) that it never runs. With P1.1, the board's copy set drops from 18 modules to about 13 [arch-5, board-3].
- **Risk:** low.
- **Size:** S each.
- **Parallel:** the first items of lane A.

**P1.5 Shared pure flows, first batch** (code judo; one PR each)
- **a. `tools.mjs`: `toolSpecs(pack, { hasCheckouts })` and `statusReport(readings)`.**
  - The first PR moves the mod side unchanged out of `watch.mjs:546-617`. watch.mjs still spells `$.tool.register` and loops over the specs [arch-1 verifier]. Files: `tools.mjs` (new, flows layer), `watch.mjs` (lock). Lane B.
  - A second PR in lane D switches `paseo/ather-automata/server/tools.ts:82-160` to it. That one is a behaviour change on Paseo: the two status descriptions differ in both directions today (`tools.ts:126`), so one wording wins. State it in the PR.
  - Why start here: the schemas already differ. Paseo lacks `folder` and the tracked lane's pack because it has no cross-checkout tracking, not by accident [arch-1 verifier (b)], which is why toolSpecs takes an option.
  - Proof: the P0.5c tests and the Paseo e2e. Size: S–M.
- **b. `commands.mjs`: the words with their hints.** It provides:
  - `parseAther(args) → { kind, … }` and `parseAway`;
  - `argumentHint()` for both hosts and for `client/commands.ts:11`;
  - `parseIssueRef`, which replaces the regexes at `console.mjs:1300`, `:1505`, `:1549`, `:1722` and `console.ts:591`, `:623`.

  Hosts switch on `kind`; Paseo's `ACTS` table (`console.ts:704`) already has that shape.
  - Files: `commands.mjs` (new), `console.mjs`. Lane A. watch.mjs is only the model for the pattern; nothing there changes.
  - The Paseo switch is lane D's own PR. Adding `/ather find` to Paseo changes behaviour (today it falls into `typed()`, `console.ts:588-597`), so it is a further separate PR [paseo-3 verifier].
  - The literal register names and the `.catch` for /ather and /away moved to the 2.6 hook sweep, since they change what a failure does.
  - Proof: the P0.5c argument table, and the validate snapshot unchanged. Size: M.
- **c. Ask rules from the pack.** `heldPrefixes`, `askRules` and `isOurs` move out of `paseo/ather-automata/server/rules.ts` into a shared `askrules.mjs` (rules layer). Each pack exports its prefixes beside its classifier (`packs/web.mjs:311-333`).
  - A unit test runs every held fixture through `isOurs`. It fails today on `git -C … push` (`guards.mjs:95` vs `rules.ts:8`), which shows the gap [paseo-12, arch-3]. Mark that test as known-failing until the fix lands as its own PR right after.
  - Files: `askrules.mjs`, `packs/web.mjs` (lane B), then `rules.ts` (lane D). Size: S.
- **Why, overall:** [arch-1, paseo-3, console-5, arch-7, paseo-12].

**P1.6 The Paseo boundary typed from the copies**
- **What.**
  - Remove the `ctx.io as never` casts; this adds 0 tsc errors.
  - `import type { Pack } from "./ather/packs/index.mjs"`; this adds 1 error, `readonly` at `tools.ts:37`.
  - Type `views`/`Built` as `ReturnType<typeof buildHome>`.
  - Replace `Any` with the JSDoc typedefs, and derive `AtherSettings` and `Band` with `z.infer`.
  - `ioFor` (`io.ts:187`) returns state.mjs's `Io`.
  - Keep stripping `// @ts-check` unless `server/ather/**` gets a second tsconfig [paseo-4 verifier, arch-2].
- **Risk:** low.
- **Size:** S–M. Lane D.
- **Proof:** typecheck 0 errors, Paseo e2e unchanged, and check-structure prints `better type escapes` (139 counted today across 8 files).

**P1.7 Hot-path cheap wins** (one PR each; each is measured, see section 3)
- **The worker clock follows the drawn view.** The flag is computed before `paneView`, so `crewOf` is skipped [console-4 verifier]. S. Lane A.
- **`cachedLane` keeps an unsure lane for a retry window,** and reads origin, user and email in parallel [watch-7]. S. Lane B.
- **`readTeam` lists each intent folder once** [watch-2 (a)+(c)].
  - team.mjs takes an optional `repo.list`. With it, one listing per intent folder gives the times (with a stat fallback for links), and text is read only for folders that can be shown. Without it, it reads times as today. Lane B, team.mjs only.
  - Then each host adds `list` to its Repo in its own lane: `console.mjs:241-249` (one line, a hand-off into A), `ather-board/hooks/index.mjs:74` (E) and `paseo/.../server/team.ts:11-23` (D). The gain lands per host as its adapter does. M.
- **Stringify the tool input only for MCP tools** (`watch.mjs:238`) [watch-5]. S. watch.mjs lock.
- **Board first dates from the log already read** [board-2 (a)].
  - `parseLog` returns `firstAt` (team.mjs, lane B, a hand-off from E). It ships unused, with a unit test.
  - After the share step, `ather-board/hooks/snapshot.mjs:29` `readCreated` is deleted (lane E). One intended diff, stated in that PR: a folder renamed into docs/intent gets a date (the rename), where `--diff-filter=A` gives it none today. S.
- **Board Map:** lay out once per record set; filters dim dots instead of laying out again [board-7, ux-surfaces-4]. S. Lane E.
- **Paseo:** `readWorker` reads only the new bytes, and bands are computed in a small pool [paseo-7]. M. Lane D.

**P1.8 Small dedupes that stop drift**
- `proofText` merges into `proofLine` (`home.mjs:456-464`, `:486-492`). Lane A.
- One `nextCard` replaces `console.mjs:2268-2276` and `modes.mjs:139-141` [console-10]. Lane A.
- The prompt builders move into home.mjs and both hosts call them [console-6]. Lane A, then lane D for Paseo.
- Paseo's `sessionNameOf` (`console.ts:143-155`) is replaced by `transcripts.mjs` `sessionName`, with a Host from io.ts. This gains the case-insensitive and PowerShell lookups that Windows needs (`transcripts.mjs:49-62`, `:75-81`). That is a behaviour change on Paseo, so it gets its own PR [console-6 verifier, paseo-7]. Lane D.
- Size: S each.

### Phase 2: next (the structural moves)

**P2.1 Decompose console.mjs** (lane A; L in total, S–M per PR)
- **Target:** about 2.0k lines in total, none over 400 [console-1].
  - `console.mjs`, about 250 lines: `register(on)`, `drawBand`/`drawPane`, `inOrder`, wake and clocks, and one `ports($)`.
  - `hooks/console/{session,lanes,read,presses,commands,questions,pane}.mjs`: `$`-free, over ports. The check treats `console/` as host side, so they need no layer, but `$` there fails. Paseo never imports them, so no share step copies them.
  - New shared modules: `keys.mjs` (flows layer), and the Home rows.

**Order, one PR each:**
1. **`freshSession()`.** One session object replaces the 44 module-level `let`s: 39 at `console.mjs:58-196`, plus `:776`, `:1918`, `:1922`, `:1994` and `:2001`. One `redraw({ isStale })` helper replaces 31 `$.ui.invalidate` sites and 15 `stale()` calls [console-2 phase 1]. Do not reuse `openConsole` as a reset: it sets `isAwake = null` (`:537`), and a second wake registers the `$.clock.every` timers again (`:591-602`) [console-1 verifier (c)].
2. **`ports($)`.** This becomes the only console.mjs function that spells `$.noun.method`; io, repo, host and outboxHost are built from it. Check that validate's hook list is unchanged.
3. **One `View` value.** It replaces the mode string and the parallel variables. A pure `resolveView(view, model)` stops the render from writing state (`:2127`, `:2163`, `:2186`, `:2171`). A `MODES` table holds `{ read, draw, showsWorkers }` for each mode. This PR adds unit tests for `resolveView` [console-3].
4. **Home rows move** into modes.mjs or home-rows.mjs, using `nextCard`. console.mjs keeps about 25 lines of press wiring, and element keys stay as they are [console-10].
5. **`keys.mjs`.** One map of keys, with a test that keys are unique per screen. Changing which key does what is a behaviour change, in its own PR with golden updates. The Away mode's `a`/`n` keys were in an approved mockup and need the owner [ux-pane-10 verifier, console-8].
6. **`forSurface(el, frame)`.** It replaces `hotkeyFor`, `keyOf` and the inline ternaries (67 `isClicked` uses) [console-7]. Treating mobile and VS Code as clicked surfaces is a behaviour change, in its own PR [console-14].
7. **One section per PR into `hooks/console/`:** lanes (with a `LaneSnapshot`) [console-9, console-11], read, presses, questions, commands. Presses and questions call each other, so pass one `ctx = { ports, session, ask }` down instead of importing across [console-1].

- **Proof:**
  - the recipe at every step;
  - validate's output equal apart from `via` names;
  - e2e element keys unchanged (`dev/e2e/run.mjs:159-164` and the `findKey` uses);
  - check-structure prints `better size: console.mjs`.
- **Risk:** medium, because this is the busiest file. One-section PRs and the golden layouts keep it low.
- **Parallel:** not inside lane A. While it runs, new console work lands as a pure module plus a one-line hook, or waits. A pause on console.mjs features is the owner's call. So is each allowance a fix PR asks for (2.0).
- **Depends on:** P0.5, P1.4, P1.5b. Not on P1.1: console.mjs's own helpers are copied by neither sync.

**P2.2 Shared controller flows, second batch** (lane B; watch.mjs lock; Paseo sides in lane D)
- **`away-flow.mjs`: `startAwayIn(port, choice, ticked)`,** out of `console.mjs:1465-1500` (a hand-off into A). If Paseo calls it, Paseo gets 0.6.6's away for several sessions. That is a behaviour change on Paseo and waits on the owner's decision about Paseo's support level (`docs/intent/paseo-parity/prompt.md:19`) [paseo-11].
- **`policy.mjs`: `briefVerdict` and `deferVerdict`,** each returning `{ deny | context | toast }`. Today these are `watch.mjs:186-196`, `:210` and `watch.ts:82-104`. After the move there is one deny text.
- **`merge-audit.mjs`** over Repo. Move it unchanged first. Then, separately, add the check of HEAD before `next(e)` and one deadline [watch-6]. It is worth less than toolSpecs [arch-1 verifier], so it goes last.
- **Why:** [arch-1, paseo-3, watch-6].
- **Proof:** unit tests with fake ports and no fake engine, plus the Paseo e2e.
- **Size:** M each.

**P2.3 One Io builder: `makeIo(port)`** (lane B; hand-offs into A and the watch.mjs lock; Paseo side in lane D)
- **What.** A shared builder works out `gitUser`, `gitEmail`, `origin`, `worktrees`, `real` and `repo` from a minimal port: store, fs, run, sessionId, root, redraw.
  - watch.mjs and console.mjs keep only their `$` lambdas, which the validator needs in each file. Meanwhile the check's `io twins` rule keeps the two copies (`watch.mjs:49-88` = `console.mjs:198-237`) identical.
  - Paseo's io.ts passes node fs and execFile.
  - A test asserts that every Io member is present [paseo-1, console-6, watch-9].
  - Add `host` to the Io and the Lane [arch-11].
- **Behaviour change:** on Paseo, keys become repo-scoped (`state.mjs:34`), and `issuesAt` is keyed by repo and person.
- **Two PRs:** first the mod side, with no behaviour change; then the Paseo switch, with a key migration [paseo-1].
- **Size:** M.

**P2.4 Split state.mjs; it stays the one owner** (lane B)
- **What.**
  - First a leaf `queue.mjs` (store layer): `serial`, `KEY`, `version`, `changed`, `readPin`.
  - Then `lanes.mjs`, `heartbeats.mjs`, `evidence-store.mjs` and `away-store.mjs`, each importing that leaf. The names are flat, like `warm-store.mjs`, so today's Paseo sync copies them without P1.1.
  - `state.mjs` re-exports them, so importers do not change. Putting the leaf first avoids the `track`→`beat` and `adoptWindow` cycles [watch-9 verifier].
  - `activeAt` and `lastBeats` become a record keyed by sessionId [arch-6 (1)]. Fixing Paseo's mark-before-write race (`paseo/ather-automata/server/lane.ts:76-82`) is a behaviour change, in its own PR.
- **Why:** 969 lines, 12 module singletons, five sections (`:113`, `:315`, `:481`, `:638`, `:811`) [watch-9, arch-8].
- **Proof:** the recipe, plus the Paseo typecheck. Each new file goes in `LAYERS` (store).
- **Risk:** medium (store ordering). Every write stays on the one `serial` queue.
- **Size:** M.
- **Parallel:** before P2.5, which also edits `state.mjs:14`, `:164`, `:851-852`.

**P2.5 A pack registry** (lane B; hand-offs into A for home.mjs, into E for modules.mjs; watch.mjs lock; lane D for Paseo)
- **What.**
  - `PACKS = [unreal, web, core]`, each with `{ detect, make }`. The web pack is built per checkout (`packs/index.mjs:99`) [arch-3 verifier].
  - `HELD_LABELS`/`HELD_NOUNS` are built from PACKS (`guards.mjs:13-19`).
  - core's output readers move to `packs/readers.mjs` (`core.mjs:7`).
  - New pack fields replace all 5 id checks the check counts today:
    - `showsGates` for `watch.mjs:568` and `paseo/ather-automata/server/tools.ts:110`;
    - `proofWords.track` for `home.mjs:86`;
    - `modules` for `ather-board/hooks/modules.mjs:52` [board-9 (1)];
    - `askPrefixes` (from P1.5c) for `paseo/ather-automata/server/rules.ts:47`.
  - Separately, `propOf(command)` for the squad (`squad.mjs:66-67`). Showing `npm test` in web checkouts fixes a bug, so it is its own PR.
  - Last: drop the 21 `pack = unreal` defaults and the re-exports (`model.mjs:9`, `guards.mjs:37`, `home.mjs:16`), then update the tests.
- **Proof:** the recipe, the web pack tests, and check-structure printing `better packs` and `better pack ids`.
- **Size:** M.
- **When:** no intent plans a fourth stack [arch-3 verifier], so this is "next". The cheap part is already in P1.5c.

**P2.6 Tests by module, e2e by scenario** (lane C)
- **What.**
  - Split `ather.test.mjs` (3,164 lines, 87 commits) by the module under test.
  - Add `tests/support/io.mjs` (one memoryIo with an optional tick), `support/intents.mjs` and `fixtures/findings/*.md`.
  - The e2e becomes `scenarios/<area>.mjs`, with `--grep` and one sandbox per scenario.
  - `engine.settle()` replaces `flush()` and the boot sleeps. It waits until nothing is in flight; it does not fake the clock, because the hooks call `Date.now()` directly about 62 times [tests-5 verifier, tests-8, tests-9].
  - Then put tests under the check's `size` rule (remove `TESTS` from its `applies`).
- **How:** mechanically, one module per commit, with the same test names before and after.
- **Size:** L.
- **Parallel:** it conflicts with every PR that adds tests. Do it in a short, announced window after P1.2.

**P2.7 The Paseo view model as data** (lane D; `paneModel` in home.mjs is a hand-off into A)
- **What.**
  - `paneModel(built, extras)` returns structured fields: `proof[]`, rows with title, detail and owner, `isTracked`, `sync`.
  - zod defaults replace the 45-line `empty` literal.
  - One `AgentState` record per agent, freed in `forgetAgent` [paseo-5, paseo-6].
  - Fixing the proof chip (`AtherPanel.tsx:375-379`) changes behaviour, so it is a separate PR.
- **Size:** M.

### Phase 3: later

- **P3.1 A one-day `$.state` spike** for the drawn view state. It needs a PluginState contract, and it only helps view state: most invalidates follow data reads [console-2 verifier].
- **P3.2 A fixed S2 sample** for run.mjs, so the S2 e2e needs no S2 checkout [tests-1 (2)]. L, because the checks depend on the counts and groupings of the live set.
- **P3.3 Cross-session store redesign, only if D7 (P0.8) fails.** It is L and does not preserve behaviour [watch-4, arch-10].
- **P3.4 A light feature/surface table.** `HOME_PARTS` gets `{ since, surfaces: { paseo: true | 'not yet: <why>' } }`, read by the weekly parity report. No checks of README prose [arch-7 verifier].
- **P3.5 week-calendar.**
  - Split `analyze()` into pure steps, with a commit index per repo [calendar-10].
  - Move `render.mjs`'s CSS and JS into page files, as ather-board/page does [calendar-8].
  - One `configFromSettings` and one `weeklyRule`, as pure modules with no node imports [calendar-5 verifier].
- **P3.6 Board page.** Use an `html` tagged template only if the P0.5 smoke test keeps catching escapes. Show the Map as a list under 640 px [ux-surfaces-4].
- **P3.7 `git-subdir` release refs.** Speculative [arch-4 (3)].

### 2.6 Behaviour fixes to keep out of refactor PRs (each its own PR)

A fix that grows console.mjs adds a `size` allowance with its reason (2.0).

| Fix | Finding | Touches | Lane | When |
|---|---|---|---|---|
| **Gating-hook sweep.** Validate lists 15 hooks without `.catch`: prompt.submit, the 3 MCP tools, Bash, PowerShell, Agent, AskUserQuestion (twice), agent.spawn, classic.PermissionRequest, tool.call, /ather, /away and ui.close. Catch each, or say in one comment why its body cannot throw (`watch.mjs:210` awaits `state.readTz` inside AskUserQuestion). /ather and /away also get literal register names (`console.mjs:565-571`), as /warm has (`watch.mjs:164`, `:754`). One PR per group; the validate snapshot loses those lines as the intended diff | watch-1, console-5 | watch.mjs, console.mjs (allowance) | watch.mjs lock, A | Now |
| **Holds fail closed:** still deny when park fails. An owner decision first: it extends "refuses on purpose" (`watch.mjs:4-6`) to the failure case | watch-1 | `watch.mjs:240-241`, `:621-625` | watch.mjs lock | Now, before P2.2 |
| Segment normalizer (env, `bash -c`, `git.exe`, `push --all`) | watch-10 | `shell.mjs:16-38`, `guards.mjs:90-96` | B | Now |
| Paseo `git -C` ask rule | paseo-12 | `paseo/.../server/rules.ts:8` | D | right after P1.5c |
| Away rule taken from the pack (the with-proof misstatement); nothing focused on Until done | ux-pane-2, ux-pane-m1 | `console.mjs:1776-1795` (allowance), `modes.mjs:225` | A | Now, before P2.1 step 4 |
| Owner names with diacritics | ux-pane-4 | `worklist.mjs:190-192` | B (base layer) | Now |
| Cap Needs you by blocks, not items (updates the P0.5c pin) | ux-pane-11 | `decide.mjs:154` | A | Now |
| `/clear` and resume reset the console | console-13 | console.mjs `session.end` (allowance) | A | with P2.1 step 1 |
| Published page: no local drafts; `<` escaped in the JSON | board-1, board-5 | `ather-board/hooks/page.mjs:29-31`, `:55` | E | Now |
| Weekly report: field allowlist, key snapshot, more redaction patterns | calendar-1 | `week-calendar/scripts/lib/report.mjs:60-66`, `secrets.mjs` | E | Now |
| Cost counted per week; git failures counted | calendar-7, calendar-11 | `logs.mjs:96-101`, `git.mjs:8`, `:80` | E | Next |

---

## 3. Performance: what to measure before and after

No performance PR goes in without a before/after line in its body. Benches live in `dev/bench/` and print one JSON line, as `dev/bench/overlap.mjs` does.

| # | Item | Today (where it was measured) | How to measure | Target | Finding |
|---|---|---|---|---|---|
| 1 | Pane refresh: `readTeam` over the worktrees (`team.mjs:207-227`; every turn end and every 60 s, `console.mjs:390`, `:592`) | 8 worktrees × 230 intents, nothing changed: 490 ms, 24 git runs, 12,888 fs calls. Cold: 817 ms, 44 git runs (scratch bench-workspace.mjs) | Commit `dev/bench/refresh.mjs`, built from the scratch bench: fs calls, git runs and ms, cold and unchanged. Also time session.start → first refresh settled | about 1,850 fs calls when nothing changed (estimate), same git runs | watch-2 |
| 2 | 5 s worker clock (`console.mjs:595-598`, `:971-977`) | redraws the band and pane and rebuilds the crew every 5 s in Simple view and the away window | count `ui.render` dispatches per minute in the stand-in engine, one running worker, per view | 0 in Simple and the away window; unchanged (12 a minute) in Advanced Home | console-4 |
| 3 | Unsure lane (`state.mjs:169`, `:178-181`) | 10 lookups → 30 git processes (scratch unsure.mjs) | same script | ≤ 3 per retry window | watch-7 |
| 4 | Audit after a pull (Unreal only; `watch.mjs:681-689`, `:717-734`) | up to 21 awaited git runs per pull; 1 when HEAD is not a merge | count `$.process.run` for a `git pull` with nothing new, then a real merge | 0 git runs when HEAD did not move to a new merge | watch-6 |
| 5 | Tool result after a gate command (`watch.mjs:627-633`, `:670`) | waits on store writes and an uncached folder walk; judged small [watch-5 verifier] | stand-in: from `next(e)` settling to the hook returning, with 0, 1 and 5 queued tasks | measure only; change only with a reason | watch-5 |
| 6 | Board, each time origin moves (`team.mjs:151`, `snapshot.mjs:29`) | two full-history path-limited logs; 0.02 s on this repo; S2 never measured | time both on an S2 agent PC | one log | board-2 |
| 7 | Board Map (`map.mjs:109`, `:131-146`; `client.js:250-252`) | `layoutGraph` 18–19 ms at 150 intents, about 292 ms at 600, per key or click (scratch timing.mjs, Chromium probe) | same | one layout per record set; < 5 ms per click at 600 | board-7, ux-surfaces-4 |
| 8 | Paseo worker records (`transcripts.ts:72`, `:83`) | the whole transcript is parsed again on each change while the worker runs; worker files up to 2.8 MB | bytes read per minute, panel open, one running worker | only the new bytes | paseo-7 |
| 9 | Paseo bands (`index.server.ts:55-58`) | one agent at a time, capped at 50 agents | `atherBands` latency with 10 and 50 agents and one slow git | pooled; p95 set by the slowest agent, not the sum | paseo-7 |
| 10 | Store size (one file, 4 MiB cap) | slow leak; months to years at today's rate [watch-3 verifier] | nightly store-health on agent PCs: bytes, keys by family | a debug line past 2 MiB; the e2e store rejects writes past 4 MiB | watch-3 |
| 11 | Gate time | unit tests 7.2 s (shim + copy); repos e2e 93.3 s, about 49 s of it fixed sleeps (`repos.mjs:97`, `engine.mjs:343`); S2 run: 42 boots × 1.5 s plus a 16 s sleep (`run.mjs:60`, `:1373`) | the P0.2 summary's seconds per stage | unit < 5 s in place; repos e2e < 50 s with `settle()` (estimate) | tests-5, tests-7 |
| 12 | week-calendar build (`build-calendar.mjs:114`, `git.mjs:58`) | a week that starts on Sunday runs analyze twice and misses the commit cache | build time on an agent PC with S2 | one git log per repo per build | calendar-10 |

---

## 4. Guardrails that keep it from sliding back

| Guardrail | What it stops | Runs in | Required in CI |
|---|---|---|---|
| `dev/check-structure.mjs` (drafted with this proposal) | a file over 1,000 lines that grows (this replaces the crossing-only rule at AGENTS.md:14); a new file over 1,000; `$` outside the host files; a concrete pack imported outside `packs/index.mjs`; an import that goes up a layer, or between store and views; any import of watch/console other than from ather.mjs; a hooks module placed in no layer; a pack id checked outside packs/; new `as never`/`any` in Paseo code; the two `io($)` copies drifting; week-calendar `SCRIPT_FILES` disagreeing with the scripts (`week-calendar/hooks/register.ts:10-14`) | first stage of test-all | `structure`, from day one |
| `dev/structure-accept.json` + CODEOWNERS | a growth nobody agreed to; it is the one accepted route around the check | with the check | via `structure` |
| `dev/share.mjs --check` | copy, version and art drift | test-all | via `structure` |
| `claude plugin validate --strict .` and each mod | disagreement between marketplace and plugin versions (`--strict` already reports it [process-1 verifier]), plugin errors | CI, pinned CLI | `plugin`, once the snapshot exists |
| Validate snapshot (notes and gating hooks only, `via` lists removed) | a new gating hook without `.catch`, a lost hook, a changed `$` surface | CI, against `dev/validate-snapshot/` | `plugin` |
| Paseo `npm ci` + typecheck + e2e | shared signature drift (the `sentTo` break) | CI. Locally it fails only when `paseo/**` or `hooks/**` changed, so Windows contributors who never touch Paseo are not blocked [paseo-2 verifier] | `paseo`, after P0.7 |
| Golden layouts, masked, with the local hour pinned | a silent UI change inside a refactor | test-all on ubuntu; `--update-golden` accepts a change | ubuntu `gates`, after P0.3 |
| Tests that hold the contracts | the `parseAther` table, keys unique per screen, `resolveView`, `needsView`, `ownerName` on Unicode, every held fixture reaching an ask rule | unit stage | ubuntu `gates` |
| Release check (fragments, versions) | version collisions; board copies changed without a board fragment | CI on PRs | yes (process proposal) |
| Opt-in pre-push hook (`git config core.hooksPath dev/hooks`) | a forgotten sync or a structure slip before push | local | no |

**How the drafted `dev/check-structure.mjs` works.**
- Each rule counts something per file. A count may not grow past what the merge base with `origin/main` had, nor past the rule's limit (1,000 for size, 0 for the rest). Today's exceptions pass, a new one fails, and a fixed one prints `better` and cannot come back. Nobody keeps a list by hand.
- The owner can accept a growth: `{ rule, file, upTo, why }` in `dev/structure-accept.json`. A growth past `upTo` still fails. An entry the base has already reached grants nothing more, and the check says to remove it. An entry without a known rule, a whole-number `upTo` or a `why` fails.
- `LAYERS` in the script is the diagram in section 1. A new hooks module fails until it is placed, and where it sits decides what it may import.
- It reads the base in one `git cat-file --batch` run and finishes in about 0.1 s.
- Without a base (a shallow clone) it prints the counts, fails nothing and says so, so CI needs `fetch-depth: 0`. On a push to main, CI passes `--base HEAD~1`; when the base is HEAD itself, the check says it compares only uncommitted changes. `--base` with no value exits 2.
- Tests and `dev/e2e` are notes only, until P2.6 splits them [process-6 verifier].

Counts on HEAD, checked in a scratch clone:
- size: 1 file (console.mjs, 2,296 lines);
- size of tests: 4 notes;
- packs: 11 imports in 7 files;
- layers: state.mjs, 1 (home.mjs);
- pack ids: 5 (`watch.mjs:568`, `home.mjs:86`, `ather-board/hooks/modules.mjs:52`, `paseo/.../rules.ts:47`, `tools.ts:110`);
- type escapes: 139 in 8 files;
- engine, placed, io twins, calendar scripts: 0.

---

## 5. What not to do

- **Do not move `$` helpers into imported modules.** The validator refuses it ("$ is followed only into a function declared in this same file, never across an import") [console-1 probe]. Use ports. Do not build `engine-io.mjs` taking `$` for the board either [board-10 verifier].
- **Do not replace copies with imports across folders, or with symlinks.** Installed plugins are self-contained, and symlinks break on Windows checkouts [arch-4, process-3]. `git-subdir` release refs stay speculative until someone checks Paseo's installer [arch-4 (3)].
- **Do not make a size check required without a way to accept growth.** Fixes to console.mjs would stall until P2.1 shrinks it. The allowance file is that way, and the owner holds it.
- **Do not trust a fixed time zone alone for golden layouts.** The evening rule follows the hour of the run. Pin the hour and mask times.
- **Do not redesign the store for cross-session writes before D7.** It is L, it does not preserve behaviour, and a dead session never drains its inbox [watch-4 verifier].
- **Do not build `features.mjs` with test-all checks of README prose.** That is heavier than the problem; a parity table plus the weekly report is enough [arch-7 verifier].
- **Do not move all pane state into `$.state`.** It needs a PluginState contract and only helps view state; spike it first [console-2 verifier].
- **Do not fake the e2e clock.** The hooks call `Date.now()` directly about 62 times. Wait until nothing is in flight instead [tests-5 verifier].
- **Do not start the pack work by dropping the 21 `pack = unreal` defaults.** That means many test edits for little value. Do the ask prefixes and the squad prop first [arch-3 verifier].
- **Do not split state.mjs into modules that import each other.** Put the queue leaf first; every write stays on the one `serial` [watch-9 verifier].
- **Do not make writes after `next(e)` fire-and-forget across the board.** Tests and the next draw rely on that order [watch-5 verifier]. Do not write the ended heartbeat outside the queue either; a queued tick would undo it [watch-8 verifier].
- **Do not rewrite `client.js` wholesale into tagged templates.** Its 67 `esc()` calls are applied consistently. A smoke test and a layout memo give most of the value [board-7 verifier].
- **Do not share one `look.mjs` across week-calendar.** That creates a new cross-plugin copy. Fix colours locally [ux-surfaces-6 verifier].
- **Do not share one stage table before deciding what "Prove" means.** The pane's Prove (proof rungs) and the list's ◐ (PR not merged) are computed differently [ux-surfaces-1 verifier].
- **Do not put the size rule on tests before they are split.** It would block nearly every PR that adds a test [process-6 verifier]. Do not add `-diff` to `.gitattributes` [arch-4 verifier].
- **Do not mix a behaviour fix into a refactor PR.** The before/after diff is the proof, and it only works if it is empty.

---

## Notes on the critique

- **Taken as given:** the missing acceptance path (now the allowance file and CODEOWNERS); time text in layouts; held files and hand-offs in place of exclusive lanes; jobs required only once green; a pinned CLI and a path-free snapshot; the wider pack-id pattern (5 checks on HEAD, `modules.mjs:52` included); the test-count wording; P1.1b; P2.1 not needing P1.1; following `import()` types; reusing `--out`; the hook sweep; base handling; D7 moved to P0.8; the corrected cites; the Start-here list and plainer words.
- **TZ=UTC is not enough on its own.** Clock text uses the stored offset, which comes from `date +%z` (`watch.mjs:477-482`), so a fixed TZ does fix the zone. But Home's Heading off? appears only from 20:00 to 05:00 by that offset (`home.mjs:430`, `model.mjs:575-578`). Golden files would still flip with the hour of the CI run. The plan pins the local hour on the golden pass and masks clock times and ages.
- **The diagram is re-drawn, not narrowed.** I listed every module's imports. The store sits above the rules: `state.mjs:10-11` imports away and guards, and neither imports the store, so those imports point down and need no removal in P2.4. shell, worklist and the readers are base. decide sits with home in views. The only import that goes up is state → home (`state.mjs:18`), and P1.4a removes it. The check's `LAYERS` table is the diagram, and a "placed" rule makes every new module take a place.
- **P1.5b does not edit watch.mjs.** It cites `watch.mjs:164` and `:754` only as the pattern /warm follows. The Paseo files it named were always meant as lane D's own PR; that is now written down.
- **P2.4 no longer needs P1.1 either.** The new store files have flat names, like `warm-store.mjs`, and today's Paseo sync copies top-level files.
