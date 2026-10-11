# Ather Automata: the pane shows the repository it is in

- Rev: 1
- Status: active
- Area: ather-automata
- Owner: Hoàng Vũ
- Skill: `plugin-authoring`
- Branch: `claude/coordinate-build-repo-inspect-edf954`
- Started: 2026-10-11

## Goal

The Ather pane of a session shows the intents, issues, PRs and worktrees of one repository: the checkout the session is opened in, with its clone's worktrees. Nothing is set up to choose repositories any more: the `repos` setting, the folders kept for the machine, the Repositories view, `/ather repos` and the `repos` tool are removed. This takes back the listing part of `multi-repo` (D2's other sources, D15, D17); what a command in another checkout is judged by, and tracking an intent in another checkout, stay.

## Non-Goals

- A picker to switch the pane to another repository.
- Changes to guards and proof by checkout (`multi-repo` D4, D5) or tracking across checkouts (D6): a `cd ../web && …` is still judged by web's pack, and an intent written in another checkout is still tracked there.
- The Paseo version's behaviour: it already works with one checkout; its synced copies follow.
- Clearing the `tracedFolders` value an earlier version kept in the store: it is no longer read.

## Decisions

- D1 (rev 1): the workspace is the checkout holding the session folder, then the worktrees `git worktree list` names for its clone (multi-repo D14, unchanged, at most 24). Nothing else is added: no `repos` setting, no kept folders, no child checkouts of a parent folder. Source: L-1.
- D2 (rev 1): a session opened in a folder that is in no checkout has no workspace: `/ather` and `/away` answer as in a repository without intents. Source: L-1 and the owner's answer (Q-1: "Checkout của session").
- D3 (rev 1): removed: the plugin option `repos`; `state.readTraced`, `addTraced`, `removeTraced` and their store key; the Repositories view and its row on Home; `/ather repos` (and `repos` in the command words and the argument hint); the `repos` MCP tool. Nothing replaces them. Source: L-1 ("ko cần setup repos add delete v.v... nữa").
- D4 (rev 1): kept: guards and proof by the checkout a command runs in (multi-repo D4, D5), tracking an intent in another checkout and its view (D6, and D11's `outside` name for its checkout), names for worktrees (D11, D14), keys per checkout (D12, D13). Source: the owner's answer (Q-2: "Giữ").

## Acceptance

- A1: a session in a checkout with worktrees lists that clone's intents, issues and PRs, its worktrees' own intents with their names, and nothing from a sibling checkout beside it. Proof: unit tests on `readWorkspace`; e2e rows in `dev/e2e/repos.mjs`.
- A2: a session opened in a parent folder holding checkouts has no pane: `/ather` answers as in a repository without intents. Proof: e2e row.
- A3: no code, test, setting or README names the removed pieces (D3): `rg -n "readTraced|addTraced|removeTraced|tracedFolders|parseRepos|repos-|/ather repos|'repos'"` over `ather-automata`, `paseo/ather-automata`, `dev` finds nothing. Proof: the search; `claude plugin validate ather-automata`.
- A4: a command in another checkout is still held and proved by that checkout's pack, and a write into another checkout's intent still tracks it there. Proof: the existing e2e rows for multi-repo A3 and A4, kept passing.
- A5: a session in one checkout without worktrees sees what it saw on 0.2.8 apart from the Repositories row. Proof: `node dev/test-all.mjs` against a sparse S2 clone has no FAIL line that the base commit does not have.
- A6: release 0.2.9: both manifests, a Changes line, the mod's README (Several repositories, Commands, Install's settings) and the Paseo sync. Proof: `claude plugin validate ather-automata`; `npm run sync:check` and `npm run typecheck` in `paseo/ather-automata`.
- A7: live in Claude Code: a checkout with a worktree, and a sibling checkout with intents, show only the session's repository. Proof: the live run's notes.

## Constraints

- Background hooks never block the calls they watch; state goes only through `state.mjs`.
- No merge into `main` without a person.

## Changelog

- rev 1 (2026-10-11): created from L-1, Q-1 and Q-2.
