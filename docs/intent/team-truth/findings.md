# Findings

## F-1 (2026-10-07) | blocking: no | status: decided

The list stage of an intent this session does not track has no session proof to go on, and the spec left Proving vs Building open. The worker's first call (Proving = at least one item met) made `lead-vfx` at 2/25 read as proving, which contradicts the tracked header's stages (`currentStage`: Build while an item is open, Prove once all are met).

Decision (coordinator, engineering): the list uses the header's stages without the session's proof. Building while any item is open; Proving (◐) once every item is met and its PRs are not all merged; Ready to close (✓) once they are, or when it names no PR. PR states come from the existing background `gh pr view` poll (`prs.mjs`), which already covers every all-met intent. Legend: "● Building  ◐ Items met, PR not merged  ✓ Ready to close  ‖ Parked"; Needs attention's "Close it?" fires only on ready to close.

## F-2 (2026-10-07) | blocking: no | status: open

Claude Code 2.1.287 is no longer installed on this PC; `claude plugin validate` ran on 2.1.292 (PATH) and 2.1.286 (desktop), both exit 0. The type-check uses the 2.1.287 types file.

## F-3 (2026-10-07) | blocking: no | status: open

An intent that is only on origin/main (not yet in this checkout) can be viewed but not tracked: `state.track` needs its folder on disk. "Work on this here" and Next's "Pick up …" say "<slug> is on origin/main but not in this checkout yet: pull main to work on it here." Next can still offer one of the person's main-only intents first; if that reads badly, Next could prefer intents the checkout has.

## F-4 (2026-10-07) | blocking: no | status: open

Two things on this machine the checks depend on, not the change. (1) The e2e copies E:\S2_'s working tree `docs/intent`; during the session that shared checkout was moved to origin/main (21 folders and 4 open became 45 and 23), which broke six assertions that assumed exactly one director call of Tin's and a team of four or fewer. They were made data-independent (one call or several, "Go through N things"; the "+N more ›" press by key; colours unique while there are eight people or fewer). (2) The second allowed live fetch on E:\S2_, with the new explicit refspec, failed to reach github.com (port 443, 21 s). The argv is proven against real git in the e2e sandbox; E:\S2_'s own `remote.origin.fetch` is `+refs/heads/main:refs/remotes/origin/main`, the same refspec.
