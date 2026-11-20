# A5R Super Focus: park every other session, work with one, restore them after

- Rev: 1
- Status: active
- Area: a5r
- Owner: HaiHuynh
- Skill: `plugin-authoring`
- Branch: `intent/a5r-superfocus`
- Started: 2026-11-20

## Goal

Hai runs many desktop sessions on one S2 checkout. Some have uncommitted work, some wait on a review, some are half done.
Super Focus lets him stop all of them safely, work with one session (and its subsessions) until it is done, then bring
the others back where they were.

1. **Scan.** `/a5r superfocus start` lists every other session A5R knows (a live session, or one whose touch file still
   names uncommitted paths in the shared checkout) with its kind: `wip` (uncommitted paths), `busy` (holds or waits for
   the Editor, or runs agents), `clean` (nothing local).
2. **Park.** A5R sends each of them one message: commit your own paths to `park/<id8>/<yyyymmdd>` without moving the
   shared tree (a temporary index), restore those paths in the shared tree to HEAD, write
   `Saved/LANE_NOTES/<id>.md`, stop PIE, release the Editor, stop your background processes, then report with the
   superfocus tool (`parked`, branch, sha, note). The person's own session gets the same as a prompt.
3. **Choose.** `/a5r superfocus <name>` picks the focus session once every listed session has parked (`!` at the end
   chooses anyway: the unparked ones are kept, never archived). A5R gives it a Focus (the Editor, default 3 h, extendable)
   and hands this session one prompt with the clean-up: stop and archive every parked session except the chosen one,
   plan a sync of main a few minutes ahead (with a build), then bring the chosen session's park branch back.
4. **Work.** The chosen session (and its subsessions) works alone.
5. **Restore.** `/a5r superfocus restore` hands this session one prompt: unarchive every archived session and send each a
   message with its park branch, the base it parked on, and its resume note, so it brings its own paths back onto
   today's main itself. `/a5r superfocus cancel` does the same without a chosen session.

Everything Super Focus knows is in one file, `Saved/A5R/superfocus.json` (git-ignored), which restore reads; nothing is
written into the S2 repository.

## Non-Goals

- A5R stopping, archiving or unarchiving sessions itself: the plugin engine has no such call. The model of the session the
  person typed in does it with the desktop app's session tools, from the exact list A5R hands it.
- Discarding anybody's work: a session restores its paths to HEAD only after they are committed to its park branch.
  Uncommitted paths no session owns are listed, never touched.
- Other machines, other checkouts.

## Decisions

- D1 Person-only: start, choose, restore and cancel come from the person's own `/a5r superfocus` command, never a tool.
  The superfocus tool only records a session's own `parked` report (and `status`).
- D2 Never during a sync: start and choose are refused while a sync is in its cutoff or freeze, or a merge, revert or
  cherry-pick is in progress in the shared checkout. The sync holder session is never listed (never parked, never
  archived).
- D3 The session the person typed in is the conductor: it parks its own paths like the others but is never archived.
- D4 One Super Focus at a time; a new start is refused until the last one is restored or cancelled.

## Acceptance

| Id | Done when | Proof |
| --- | --- | --- |
| S1 | Scan lists the other live sessions and the sessions with touch paths, with their kind, and leaves out the sync holder and this session | `gate: claude plugin test a5r` (superfocus tests) |
| S2 | Start writes superfocus.json and sends one park message to each listed session (and a prompt to this one) | `gate: claude plugin test a5r` |
| S3 | Start and choose are refused in a sync cutoff or freeze and while a merge is in progress; a second start is refused | `gate: claude plugin test a5r` |
| S4 | The superfocus tool's `parked` records branch, sha and note for its own entry only | `gate: claude plugin test a5r` |
| S5 | Choose is refused while a listed session has not parked, unless `!`; it gives the Focus and hands the clean-up prompt naming every session to stop and archive, never the chosen one, the conductor, an unparked one or the sync holder | `gate: claude plugin test a5r` |
| S6 | Restore and cancel hand the prompt that unarchives and messages every archived session with its branch, base and note | `gate: claude plugin test a5r` |
| S7 | The gates pass: `node dev/test-all.mjs`, `node dev/check-size.mjs --base intent/a5r` | `gate: …` |
| S8 | A thermo-nuclear review with `Verdict: pass` | `review` |

## Changelog

- Rev 1 (2026-11-20): from Hải's Super Focus Mode prompt and the plan agreed in the session.
