// A made-up machine with the shape of a real one's files (lanes.ps1 -Action Status -Json, the _machine slot and
// heartbeat files, an Ather Automata session heartbeat, the for-each-ref, the reflog, gh's JSON, .git/config).
// Every lane name, branch, intent, number, path and host here is invented; none is a real machine's.
// It holds each case A1 names: lane 0, registered and unregistered lanes, pool ready and building, a harness
// worktree, a missing one, a sidecar intent with no folder, a half-written heartbeat, a session heartbeat on another
// branch, a lane heartbeat, a lane with none, a branch with no PR, a detached worktree, a slot held by a name that is
// no worktree; PERF_SLOTS is the same machine during a perf capture.

const MAIN = 'X:\\work\\game'
const LANES = 'X:\\work\\lanes'

/** @param {Record<string, unknown>} fields */
const lane = fields => ({ name: '', path: '', branch: '', head: '0123456789ab', kind: 'lane', missing: false, sidecar: 'registered', origin: 'register', intent: '', tier: '', claims: 0, session: '', slotNeed: 'none', slotHeld: '', heartbeat: '', heartbeatMinutes: null, heartbeatState: '', heartbeatNote: '', stalled: false, stallReason: '', ...fields })

export const STATUS = JSON.stringify(
  {
    machineDir: `${LANES}\\_machine`,
    lanes: [
      lane({ name: 'game', path: MAIN, branch: 'main', kind: 'main checkout (lane 0)', sidecar: '(lane 0, no sidecar)', origin: '' }),
      lane({ name: '_pool-01', path: `${LANES}\\_pool-01`, branch: 'pool/01', kind: 'pool (ready)', sidecar: 'registered', origin: 'pool' }),
      lane({ name: '_poolbuild-02', path: `${LANES}\\_poolbuild-02`, branch: 'pool/02', kind: 'pool (building)', sidecar: 'unregistered', origin: '' }),
      lane({ name: 'combat-hitstop', path: `${LANES}\\combat-hitstop`, branch: 'feat/combat-hitstop', intent: 'combat-hitstop', tier: 'T1', slotNeed: 'full', slotHeld: 'full-1', claims: 2 }),
      lane({ name: 'editor-fix', path: `${LANES}\\editor-fix`, branch: 'fix/editor-filter', intent: 'editor-fix', tier: 'T2', slotNeed: 'full' }),
      lane({ name: 'perf-capture', path: `${LANES}\\perf-capture`, branch: 'perf/frame-budget', intent: 'frame-budget', tier: 'T2', slotNeed: 'light', slotHeld: 'light-1' }),
      lane({ name: 'docs-sweep', path: `${LANES}\\docs-sweep`, branch: 'docs/sweep', intent: 'issue-1234', tier: 'T0', heartbeat: '2 min', heartbeatMinutes: 2.1, heartbeatState: 'working' }),
      lane({ name: 'scratch-a', path: `${LANES}\\scratch-a`, branch: 'try/scratch-a', sidecar: 'unregistered', origin: '' }),
      lane({ name: 'probe', path: `${LANES}\\probe`, branch: '(detached)', sidecar: 'unregistered', origin: '' }),
      lane({ name: 'agent-1', path: `${MAIN}\\.claude\\worktrees\\agent-1`, branch: 'claude/agent-1', kind: 'harness worktree (.claude\\worktrees)', sidecar: 'unregistered', origin: '' }),
      lane({ name: 'old-lane', path: `${LANES}\\old-lane`, branch: 'feat/old', missing: true, sidecar: 'unregistered', origin: '' }),
    ],
    stale: [],
    slots: [],
    stallMinutes: 20,
    stalledCount: 0,
    seconds: 0.41,
  },
  null,
  2,
)

// A slot file as editor-slot.ps1 Take writes it: its first line like the old lock, then key lines.
/** @param {string} holder @param {string} until @param {string} kind @param {string} id */
export const slotFile = (holder, until, kind, id) =>
  `held by ${holder} until ${until}; session -; kind ${kind}; slot ${id}\r\nlane=${holder}\r\npath=${LANES}\\${holder}\r\nsession=\r\nkind=${kind}\r\npurpose=made up\r\nhost=PC-0\r\nsince=2026-10-24T19:00:00.0000000+07:00\r\nuntil=2026-10-24T${until}:00.0000000+07:00\r\n`

// The clock the slot files are read at: 20:10 local.
export const NOW_MINUTES = 20 * 60 + 10

export const SLOTS = {
  'full-1': slotFile('combat-hitstop', '20:44', 'full', 'full-1'),
  'light-1': slotFile('perf-capture', '20:04', 'light', 'light-1'),
  'light-2': slotFile('ghost-lane', '21:30', 'light', 'light-2'),
}

export const PERF_SLOTS = {
  'full-1': slotFile('perf-capture', '20:04', 'perf', 'full-1'),
  'light-1': slotFile('perf-capture', '20:04', 'perf', 'light-1'),
  'light-2': slotFile('perf-capture', '20:04', 'perf', 'light-2'),
  'build-1': slotFile('perf-capture', '20:04', 'perf', 'build-1'),
}

// What editor-slot.ps1 Sync writes into EDITOR_OWNER.txt from the full slot above.
export const POINTER = `held by combat-hitstop until 20:44; session -; kind full; slot full-1; machine-level Editor slots in ${LANES}\\_machine\\slots (s2-agent-lanes editor-slot.ps1)\r\n`

const AT = Date.UTC(2026, 9, 24, 13, 0)
export const NOW = AT

// _machine\heartbeats\<lane>.json; perf-capture's is half-written.
export const LANE_BEATS = {
  'docs-sweep': JSON.stringify({ lane: 'docs-sweep', session: '', state: 'working', note: 'made up', at: new Date(AT - 2 * 60000).toISOString(), host: 'PC-0' }, null, 4),
  'perf-capture': '{\n    "lane":  "perf-capture",\n    "st',
}

// Ather Automata session heartbeats under <worktree>\Saved\AtherAutomata\lanes\: combat-hitstop's on its branch,
// docs-sweep's from a session on another branch.
export const SESSION_BEATS = {
  'combat-hitstop': JSON.stringify({ sessionId: 'aaaaaaaa-0000-0000-0000-000000000001', intent: 'combat-hitstop', branch: 'feat/combat-hitstop', updatedAt: AT - 6 * 60000, lastActiveAt: AT - 7 * 60000, away: 'off', hasEnded: false }),
  'docs-sweep': JSON.stringify({ sessionId: 'aaaaaaaa-0000-0000-0000-000000000002', intent: 'docs-sweep', branch: 'docs/old-sweep', updatedAt: AT - 60000, away: 'off', hasEnded: true }),
}

const unix = (/** @type {number} */ ms) => Math.floor(ms / 1000)
export const REFS = [
  `main 0 30 ${unix(AT - 3 * 3600000)}`,
  `feat/combat-hitstop 4 2 ${unix(AT - 3600000)}`,
  `fix/editor-filter 3 27 ${unix(AT - 3600000)}`,
  `perf/frame-budget 2 0 ${unix(AT - 4 * 3600000)}`,
  `docs/sweep 1 0 ${unix(AT - 2 * 3600000)}`,
  `try/scratch-a 1 3 ${unix(AT - 3 * 86400000)}`,
  `claude/agent-1 0 0 ${unix(AT - 86400000)}`,
  `feat/old 0 0 ${unix(AT - 9 * 86400000)}`,
  '',
].join('\n')

export const REFLOG = `0000000000000000000000000000000000000000 1111111111111111111111111111111111111111 A Person <a@example.com> ${unix(AT - 86400000)} +0700\tfetch: fast-forward\n1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 A Person <a@example.com> ${unix(AT - 3600000)} +0700\tfetch origin +refs/heads/main:refs/remotes/origin/main: fast-forward\n`

export const GIT_CONFIG = '[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = git@github.com:example-studio/game.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n'
export const REPO = 'example-studio/game'

// gh pr list --json number,headRefName,state,isDraft,statusCheckRollup: editor-fix's checks fail, combat-hitstop's
// pass, perf-capture's draft waits; another fork's PR from a branch of the same name is filtered out by the caller.
export const PRS = JSON.stringify([
  { number: 398, headRefName: 'fix/editor-filter', state: 'OPEN', isDraft: false, statusCheckRollup: [{ __typename: 'CheckRun', conclusion: 'FAILURE', status: 'COMPLETED' }, { __typename: 'CheckRun', conclusion: 'SUCCESS', status: 'COMPLETED' }] },
  { number: 390, headRefName: 'fix/editor-filter', state: 'CLOSED', isDraft: false, statusCheckRollup: [] },
  { number: 401, headRefName: 'feat/combat-hitstop', state: 'OPEN', isDraft: false, statusCheckRollup: [{ __typename: 'StatusContext', state: 'SUCCESS' }] },
  { number: 402, headRefName: 'perf/frame-budget', state: 'OPEN', isDraft: true, statusCheckRollup: [{ __typename: 'CheckRun', conclusion: '', status: 'IN_PROGRESS' }] },
  { number: 7, headRefName: 'main', state: 'OPEN', isDraft: false, statusCheckRollup: [] },
])

/** @param {string} title @param {string} owner */
const prompt = (title, owner = 'A Person') => [`# ${title}`, '', '- Rev: 1', '- Status: active', '- Area: Tools', `- Owner: ${owner}`, '', '## Goal', '', `${title}.`, '', '## Acceptance', '', '- A1: One.', ''].join('\n')

/** @param {string} id @param {string} date @param {string} question */
const call = (id, date, question) => `## ${id} (${date}, rev 1) | blocking: no | status: open (director)\n\n${question}\n\n**Options:**\n- A (recommended): yes\n- B: no\n`

// The lanes' intents (docs/intent/<slug>/ in each lane); docs-sweep's sidecar names issue-1234, which has no folder.
export const INTENTS = {
  'combat-hitstop': { prompt: prompt('Combat hitstop'), findings: call('F-2', '2026-10-21', 'Apply hitstop to parries as well?') },
  'editor-fix': {
    prompt: prompt('Editor filter fix'),
    findings: [call('F-2', '2026-10-19', 'Hide inactive actors in the outliner by default?'), call('F-4', '2026-10-20', 'Keep the old filter as a menu item for one release, so people who rely on it can switch back?'), call('F-5', '2026-10-22', 'Ship behind a console variable first?'), '## F-6 (2026-10-23, rev 1) | blocking: no | status: closed\n\nSettled.\n'].join('\n'),
  },
  'frame-budget': { prompt: prompt('Frame budget'), findings: '' },
}

export const PATHS = { MAIN: MAIN.replace(/\\/g, '/'), LANES: LANES.replace(/\\/g, '/'), MACHINE: `${LANES.replace(/\\/g, '/')}/_machine` }

// The sidecars `_machine\lanes\<name>.json` behind STATUS' registered lanes, as lanes.ps1 Register writes them.
export const SIDECARS = Object.fromEntries(
  JSON.parse(STATUS)
    .lanes.filter((/** @type {any} */ one) => one.sidecar === 'registered')
    .map((/** @type {any} */ one) => [one.name, JSON.stringify({ name: one.name, path: one.path, branch: one.branch, origin: one.origin, intent: one.intent, tier: one.tier, claims: [], session: '', slot: one.slotNeed, written: '2026-10-24T19:00:00.0000000+07:00', host: 'PC-0' }, null, 4)]),
)

// The worktree folders of the lanes folder (each with its `.git` file); old-lane's folder is gone.
export const LANE_FOLDERS = ['_pool-01', '_poolbuild-02', 'combat-hitstop', 'editor-fix', 'perf-capture', 'docs-sweep', 'scratch-a', 'probe']
