// The A5R model tools' definitions (the editor and sync tools) and `/a5r help`, moved out of register.ts (rev 44) so the
// host file can take rev 44's wiring without growing. Pure text: no `$`.
import { FOCUS_USAGE } from './focus.ts'
import { HANDOFF_USAGE } from './handoff.ts'
import { HOST_USAGE } from './hosts.ts'
import { EDITOR_USAGE } from './order.ts'
import { RULE_FORM } from './syncrules.ts'

export const EDITOR_TOOL_DEF = {
  name: 'editor',
  description:
    'a5r A5R Editor holder for the shared S2 checkout: the only way to take or give the Unreal Editor while A5R is on. ' +
    '"request" asks for a slot (minutes, pie, build, what): sessions are served in the order they asked, a slot must end before the next sync cutoff, and launching needs the RAM launch gate; ' +
    'you are granted at once when you are at the head and the lock is free, else you get your place and are told when it is yours. ' +
    '"release" gives it back (stop PIE and every background process of yours that could call MCP first; list packages to discard in dont_save). ' +
    '"extend" adds minutes before your lease ends, if it still fits. "status" reads the holder, the queue, RAM and the next sync. "focus_done" (note: what was reached): only when the person gave this session a Focus, once its milestone is reached: it ends the Focus and gives the Editor back (during a Focus, release and extend keep the lock to the box end). Never write Saved/EDITOR_OWNER.txt yourself.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['request', 'release', 'extend', 'status', 'focus_done'] },
      minutes: { type: 'number', description: 'request: how long you need the Editor (5–180, default 30; ≤ 20 without a build may ask the holder to yield). extend: how many more minutes.' },
      pie: { type: 'boolean', description: 'request: the slot starts PIE (the launch gate is higher).' },
      launch: { type: 'boolean', description: 'request: false when the slot never launches the Editor (it holds the lock to keep the Editor down, as the sync worker does, or for a build): the RAM launch gate is skipped, and such a request may go before a head that waits only for memory, for at most 30 min, launching no Editor in that slot.' },
      build: { type: 'boolean', description: 'request: the Editor must be closed for a build (one window ≤ 45 min while anyone is queued; longer when nobody is and no sync cutoff falls inside it).' },
      what: { type: 'string', description: 'request: what the slot is for, one line.' },
      lane: { type: 'string', description: 'request: the lane name written into the lock (default: this session\'s title).' },
      mode: { type: 'string', enum: ['interactive', 'unattended'] },
      pausable: { type: 'boolean', description: 'request: whether you can yield at a safe point (default true; false for a PIE request unless given).' },
      next_safe: { type: 'string', description: 'request: your next safe point, HH:MM or "after save".' },
      freeGb: { type: 'number', description: 'any action: free RAM in GB you read yourself, only when A5R said the RAM probe failed twice (used for 2 min, through the normal gates, logged).' },
      needGb: { type: 'number', description: 'request: the free RAM the work needs in GB, when you know it (default: the launch gate). Used only to say whether another machine fits better.' },
      readOnly: { type: 'boolean', description: 'request: the work only reads (no saves, no commits); a read-only request that has waited long for an Editor held by another may be told another machine fits.' },
      wants: { type: 'array', items: { type: 'string' }, description: 'request: role tags another machine must have to fit (all of them).' },
      note: { type: 'string', description: 'release: one line for the lock note. focus_done: what was reached.' },
      dont_save: { type: 'array', items: { type: 'string' }, description: 'release: dirty packages to discard (Don\'t-Save), each confirmed by its owning lane.' },
      pie_stopped: { type: 'boolean', description: 'release: PIE this session started has ended (needed only when no stop was seen).' },
    },
    required: ['action'],
  },
}

export const SYNC_TOOL_DEF = {
  name: 'sync',
  description:
    'a5r A5R Sync main holder for the shared S2 checkout: plans a merge of origin/main and its timeline. At the cutoff (sync − 30 min) every session is told to commit its own paths, write its resume note and release the Editor by sync − 10; ' +
    'from the sync time until done or abort, other sessions are refused git writes and Editor use in the shared checkout; the freeze is a lease with a hard end (T + 45 min, T + 90 min with a build), after which the sync expires and every session is told. At the sync time the holder\'s a5r starts the sync worker, which runs the merge and ends with done or abort. ' +
    '"plan" (at HH:MM, build, holder: a session id8 or lane, default this session; rules; a sync this session holds is moved), "move", "build" (build: true/false, before the freeze), "cancel" (before the freeze), "conflicts" (paths: the conflicted paths when the automatic dry-run could not run), "rules" (rules: the conflict rules the worker applies, until it starts), "done" (note, with the post-merge test result line), "abort" (note: why), "takeover" (a sync, or a merge, revert or cherry-pick left half done in the shared checkout, whose holder is gone), "status". Only the holder changes a planned sync. A worker that aborts hands the sync back to its holder, still frozen: finish it by hand and call done, or abort.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['plan', 'move', 'build', 'cancel', 'conflicts', 'rules', 'done', 'abort', 'takeover', 'status'] },
      build: { type: 'boolean', description: 'plan, move, build: the sync includes a build (a longer freeze).' },
      at: { type: 'string', description: 'plan, move: the sync time, HH:MM (the next time it comes round).' },
      holder: { type: 'string', description: 'plan: the session that will run the merge (its first 8 hex or its lane); default this session.' },
      paths: { type: 'array', items: { type: 'string' }, description: 'conflicts: repo-relative conflicted paths.' },
      rules: { anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: `plan, rules: the holder's conflict rules for the worker, ${RULE_FORM}; the worker resolves a conflicted path a rule matches with that side, .uasset/.umap included (git checkout --<side> -- <path>), and a path no rule matches as before.` },
      note: { type: 'string', description: 'done, abort: one line (what merged, or why it was aborted).' },
    },
    required: ['action'],
  },
}

/** a5r-hosts S-a, S-b: the host tool: hosts (L1: declare, check, pause) and hand-offs (L0 record). */
export const HOST_TOOL_DEF = {
  name: 'host',
  description:
    'a5r A5R hosts: other machines work can move to. Hosts (L1): "add" declares one (id: a-z0-9-; reach: "ssh:<host or alias>" or "manual"; label, owner; options: { config, reverse, laneRoot, a5rRoot }; the local ssh client itself only by the person, /a5r host add --ssh) and runs its health checks at once, in order: C1 reach and the remote OS, C2 byte-clean stdin and stdout, C4 clock skew, C5 orphan helper processes, C10 RAM; the first failure stops the run with its fix line, and a second add or "check" (id; checks: ["C2", …] to name some; paste: a file of a manual host\'s pasted lines) resumes at the first check not passed. ' +
    '"status": this machine\'s level and what the next level needs; "list"; "set" (id; label, owner, assumed, or reach/options, which re-checks; or asHost: this machine when it serves others); "pause" (id, reason), "resume" (id: after a link storm too), "remove" (id). Declarations go to the machine-local hosts file; checks, level and link counts to Saved/A5R/hosts/<id>/state.json (never edit those by hand). ' +
    'Hand-offs (L0): action "handoff", op "create" records that a lane runs elsewhere (label: the machine, free text; branch; base: a ref pushed to the remote, optionally sha; claims: repo-relative paths or globs, "!" exclusive, "~" shared, binary assets exclusive by default; task: one line); ' +
    '"update" (id; label, task, note, claims, or state "merged" once a result is in), "cancel" (id), "result" (id, ref: the PR, branch or report where the work landed), "list". ' +
    'While a hand-off is open its exclusive claims refuse other sessions\' edits of those paths here and fail rule 1 at A5R acceptance unless progress.md or findings.md names the path. ' +
    '"suggest" (minutes, pie, build, readOnly, needGb, wants, waitedMin): whether a declared host fits the work better than this machine, as JSON { suggestion: "none" | { host, label, reasons }, whyNot: [{ host, codes }] }; reasons RAM, LONG, READONLY_WAIT, FREEZE (IDLE joins a host that fits); why-not codes UNCHECKED, STALE_CARD, UNAVAILABLE, FROZEN, NO_ROLE, NO_TRUST, NO_RAM. It never creates a hand-off.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'status', 'add', 'set', 'check', 'pause', 'resume', 'remove', 'suggest', 'handoff'] },
      op: { type: 'string', enum: ['create', 'update', 'cancel', 'result', 'list'], description: 'handoff: what to do (default list).' },
      id: { type: 'string', description: 'add, set, check, pause, resume, remove: the host id. handoff update, cancel, result: the hand-off id.' },
      reach: { type: 'string', description: 'add, set: "ssh:<host or ssh alias>" or "manual".' },
      options: { type: 'object', description: 'add, set: reach options for ssh: { config: an ssh config file, reverse: true when the host must wake this machine, laneRoot, a5rRoot: where writes may go on the host }. The ssh client program is the person\'s choice (/a5r host add … --ssh <client>); the tool refuses it.' },
      owner: { type: 'string', description: 'add, set: who answers for the host.' },
      assumed: { type: 'object', description: 'set: for a host without A5R, { roles?, availability?: { state: yes|no, reason? } }, shown as assumed.' },
      asHost: { type: 'object', description: 'set: this machine when it serves others: { enabled, coordinationRoot?, laneRoot?, roles, availability, trust }.' },
      checks: { type: 'array', items: { type: 'string' }, description: 'check: the checks to run (C1 … C13); none: resume at the first not passed.' },
      paste: { type: 'string', description: 'check: a file holding the lines a manual host printed (see the add answer).' },
      reason: { type: 'string', description: 'pause: one line.' },
      label: { type: 'string', description: 'add, set: the host\'s label. handoff create, update: the machine the lane runs on (free text).' },
      branch: { type: 'string', description: 'handoff create: the branch the work lands on (intent/<slug> names the intent).' },
      base: { type: 'string', description: 'handoff create: the pushed ref the work starts from (default: the branch, else main).' },
      sha: { type: 'string', description: 'handoff create: the base commit; it must be on the remote (D7).' },
      claims: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'object', properties: { path: { type: 'string' }, exclusive: { type: 'boolean' } }, required: ['path'] }] }, description: 'handoff create, update: repo-relative paths, folders or globs the lane holds.' },
      task: { type: 'string', description: 'handoff create, update: what is done there, one line.' },
      ref: { type: 'string', description: 'handoff result: where the work landed (#PR, a PR URL, a branch, a report path).' },
      state: { type: 'string', enum: ['merged'], description: 'handoff update: merged, once the result is taken.' },
      note: { type: 'string', description: 'handoff create, update: one line.' },
      minutes: { type: 'number', description: 'suggest: how long the work needs (default 30).' },
      pie: { type: 'boolean', description: 'suggest: the work starts PIE (the higher launch gate is the RAM it needs).' },
      build: { type: 'boolean', description: 'suggest: the work builds.' },
      readOnly: { type: 'boolean', description: 'suggest: the work only reads.' },
      needGb: { type: 'number', description: 'suggest: the free RAM it needs in GB (default: the launch gate in force).' },
      wants: { type: 'array', items: { type: 'string' }, description: 'suggest: role tags the host must have (all of them).' },
      waitedMin: { type: 'number', description: 'suggest: how long a read-only request has waited for the Editor here.' },
    },
    required: ['action'],
  },
}

/** Every A5R model tool by its full name, with the answer when its run fails (hotfix 0.18.2: never a throw). */
export const A5R_TOOL_ERRORS: ReadonlyMap<string, (msg: string) => string> = new Map<string, (msg: string) => string>([
  ['mcp__a5r__editor', msg => `A5R · Editor — A5R hit an error reading the lock or the queue: ${msg} → retry the call; if it fails again, /a5r off and take Saved/EDITOR_OWNER.txt by hand (AGENTS.md)`],
  ['mcp__a5r__sync', msg => `A5R · Sync main — A5R hit an error in the sync tool: ${msg} → retry the call; if it fails again, use /a5r sync (or /a5r off and coordinate the merge by hand)`],
  ['mcp__a5r__host', msg => `A5R · host — A5R hit an error in the host tool: ${msg} → retry the call; if it fails again, use /a5r host or /a5r handoff`],
])

/** A57: `/a5r help`. */
export const A5R_HELP = [
  'A5R commands:',
  '/a5r · opens the A5R pane',
  '/a5r on | off · the five rules and the Editor, RAM and Sync main coordination, for every session',
  '/a5r status · the state as text',
  '/a5r accept · A5R acceptance now, for this session\'s repository (the full list)',
  '/a5r pass <intent slug | PR number> · lets the next PR call or close of that intent (or that PR\'s after-the-fact score) through once, even if acceptance fails; acceptance never asks',
  'At the tool call A5R never asks and never waits: git that can discard work in the shared checkout runs on exact paths when no other session\'s uncommitted change is in its way (else it names the path and owner); with no paths, `.` or a top folder it is refused with the same command on exact paths; shared config, recursive deletes and removed test assertions run and are recorded for acceptance; a plain force push, push to main, git add . in the shared checkout, --no-verify, GIT_LFS_SKIP_SMUDGE, reset --hard, clean -x and moving the shared tree are refused with what to do instead; git push --force-with-lease to a branch of your own and git add . in a worktree of your own run.',
  'Editor: a build window is at most 45 min while anyone else is queued, longer when nobody is and no sync cutoff falls inside it. Sync main: at the sync time this session\'s a5r takes the Editor lock for the sync, starts the sync worker (it calls no a5r tool), records its SYNC DONE / SYNC ABORT line and releases the lock. Each notice reaches a session once; the cutoff notice only sessions with uncommitted changes in the shared checkout or on the Editor queue.',
  '/a5r gate <with PIE GB> <without PIE GB> | reset · the launch gate',
  `${EDITOR_USAGE}: the person's own order of the Editor queue and time of a turn (the panel's row controls do the same; no tool can)`,
  `${FOCUS_USAGE}: the person gives one session the Editor for a milestone (the panel's Focus… and the EDITOR line's End / +30 / +60 do the same; no tool can); the focus session ends it with the editor tool's focus_done`,
  `${HANDOFF_USAGE}: a lane that runs on another machine (L0 record); while it is open its exclusive claims refuse edits of those paths here`,
  `${HOST_USAGE}: other machines (L1): declare one, run its health checks (C1 reach, C2 byte-clean link, C4 clock, C5 orphan helpers, C10 RAM), pause or resume it`,
  '/a5r sync HH:MM [build] [for <session>] | move HH:MM | build on|off | cancel | done | abort | takeover · Sync main',
  'A5R acceptance steps in only at the end of the tracked intent\'s checklist (every row met or waived), at Ather\'s Ship prompt and when an intent closes; a PR before that runs unscored.',
].join('\n')
