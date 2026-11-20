# Progress: a5r-superfocus

- PR: (opening)
- Rev: 1
- Worker: the session itself (no background worker)

## Acceptance

| Id | Status | Evidence |
| --- | --- | --- |
| S1 | met | `claude plugin test a5r`: `(pass) S1 scan: live sessions and touch owners with their kind; never this session, a gone one without paths, or the sync holder` |
| S2 | met | `(pass) S2 start writes the file, messages every listed session once and prompts this one` |
| S3 | met | `(pass) S3 refused in a sync cutoff or freeze, over a merge, and while one runs` |
| S4 | met | `(pass) S4 parked records branch, sha and note for its own entry only`; `(pass) the superfocus tool: parked writes its own entry, status reads, any other action is refused` |
| S5 | met | `(pass) S5 choose waits for every park unless !, gives the Focus, and archives only parked others`; `(pass) S5 the choice gives the Focus in the same change, and is refused when another Focus runs`; rev40 `A117: person-only` checks the tool offers only parked and status |
| S6 | met | `(pass) S6 restore and cancel unarchive and message every archived session with its branch and note` |
| S7 | met, with base failures | `claude plugin test a5r`: `831 pass, 0 fail` (EXIT=0); `claude plugin validate --strict a5r`: `✔ Validation passed`; `node dev/check-size.mjs --base origin/intent/a5r`: `size check: passed` (register.ts 4148 → 4139); `node dev/check-release.mjs --base origin/intent/a5r`: `release check: passed with 1 notes`. `node dev/test-all.mjs`: copies, unit (`427/427 passed`) pass; repos e2e fails `72/73` on `reading a checkout (A1) > origin/main's intents …`, and the same stage on the base fails too (`295/350 passed`), so later stages did not run. Type-check with Ather's engine types (`CLAUDE_CODE_TYPES`): no error in a5r; 7 errors in ather-automata and ather-lanes, the same 7 on the base |
| S8 | met | Thermo-nuclear review, 3 rounds (block, block, pass), below |

## Thermo-nuclear review

| Round | Verdict | Critical findings | Fixed by |
| --- | --- | --- | --- |
| 1 | block | C1 the command rebuilt personCommand / personChange (no log, no serial); C2 the file and the Focus written in two steps; C3 duplicated helpers (str, isNum, date pad); C4 the session record built twice | person-change path, planSuperFocus, lease.ts str/isNum and coord ymd, sessionOf |
| 2 | block | C5 the result carried out through a side object and comma expressions; a failed put-back hidden | the command body in superfocushost.ts on register.ts's own personCommand / personChange; personChange gains `after` |
| 3 | pass | none | minors 1–5 done after: `after` runs once the Editor's queue is let go and the messages go in parallel; `write` returns its own refusal text; one PersonChange type in hostio.ts; the origin refusal has its own next step; one isShow test |

Left open (minor): `str` and `isNum` live in lease.ts beside each other until a small parsing module is worth it.

## Steps

1. Spec (prompt.md rev 1), pure module superfocus.ts and its tests (9).
2. Host on closures (superfocushost.ts), the superfocus tool, `/a5r superfocus`, superfocus.json person-only (order.ts).
3. register.ts kept from growing: paneOf and entrance moved to theme.ts, withCurtain / withOverlay to icons.ts.
4. Three review rounds, the fixes above; three tool-list tests updated for the new tool.

## Next

- Hải reviews and merges the PR; the live plugin changes only when intent/a5r is fast-forwarded in the live folder.
- F-2: the first live run with Hải watching, no sync planned within the hour.
