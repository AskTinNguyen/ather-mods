// @ts-check
// Ather Automata, the Unreal pack: what is particular to the S2 game project.
// Roles and their proof, the evidence rungs and how tool output shows them,
// the Editor owner lock, held Editor actions, known traps, the Create catalog
// and the words the session is asked with. Pure: no `$`.

import { isPiped, withoutHeredocs } from '../shell.mjs'

/** @typedef {import('./index.mjs').Pack} Pack */
/** @typedef {import('./index.mjs').Rung} Rung */

export const ROLES = /** @type {const} */ (['engineer', 'techart', 'designer'])
export const ROLE_LABELS = { engineer: 'Engineer', techart: 'Tech artist', designer: 'Designer' }
export const OWNERS = 'Tin Nguyen, CanhNguyen and VuTruong'
const RUNG_LABELS = { build: 'a build that succeeded', automation: 'passing tests', readback: 'a read-back check', pie: 'a PIE proof', editor: 'your own Editor check' }
const PROOF_WORDS = { build: 'build', automation: 'tests', readback: 'read-back', pie: 'PIE', editor: 'Editor check' }

// The studio's intent areas (docs/intent/README.md#areas, decided 2026-10-03).
export const AREAS = ['Tools', 'Combat', 'AI', 'Enemies', 'Bosses', 'Characters & Animation', 'VFX', 'World & Levels', 'Audio', 'UI', 'Pipeline', 'Optimization']

/** @param {string} text @returns {(typeof ROLES)[number] | null} */
export const parseRole = text => {
  const words = text.toLowerCase()
  if (/design/.test(words)) return 'designer'
  if (/tech\s*-?\s*art/.test(words)) return 'techart'
  if (/engineer|programmer|coder|developer/.test(words)) return 'engineer'
  return null
}

/** @param {string} text */
export const normalizeArea = text => AREAS.find(area => area.toLowerCase() === text.trim().toLowerCase()) ?? 'Unsorted'

/** @typedef {Record<'build' | 'automation' | 'readback' | 'pie' | 'editor', Rung>} Evidence */

/** @returns {Evidence} */
export const emptyEvidence = () => ({
  build: { state: 'none', detail: '' },
  automation: { state: 'none', detail: '' },
  readback: { state: 'none', detail: '' },
  pie: { state: 'none', detail: '' },
  editor: { state: 'none', detail: '' },
})

/** @param {string} role @returns {string[]} */
const requiredRungs = role => (role === 'engineer' ? ['build', 'automation'] : role === 'techart' ? ['editor', 'pie'] : ['pie'])

// With no role set, any role's proof counts: a PIE proof, or a build that succeeded with passing tests.
/** @param {Record<string, Rung>} evidence @param {string} role */
const isProven = (evidence, role) =>
  role === '' ? evidence.pie?.state === 'pass' || (evidence.build?.state === 'pass' && evidence.automation?.state === 'pass') : requiredRungs(role).every(rung => evidence[rung]?.state === 'pass')

// ---------------------------------------------------------------- the Editor lock

/**
 * @typedef {{ state: 'free' | 'held' | 'unknown', holder: string, until: string, isStale: boolean, raw: string, session: string }} EditorLock `session`: the first 8 hex of the Claude session named in it, or ''
 * @param {string | null} raw @param {number} nowMinutes @returns {EditorLock}
 */
export const parseEditorLock = (raw, nowMinutes) => {
  const text = (raw ?? '').trim()
  const session = /\bsession\s+([0-9a-f]{8})/i.exec(text)?.[1]?.toLowerCase() ?? ''
  if (text === '') return { state: 'unknown', holder: '', until: '', isStale: false, raw: text, session }
  const free = /free\s+since\s+(\d{1,2}:\d{2})/i.exec(text)
  // "…launched by Claude session b3ebb2cb; free for Tin to use; no agent holds it since 20:40" is free too.
  if (free || /^free\b/i.test(text) || /\bfree (for|to use)\b|\bno (agent|one|lane) holds it\b/i.test(text)) return { state: 'free', holder: '', until: free?.[1] ?? /holds it since\s+(\d{1,2}:\d{2})/i.exec(text)?.[1] ?? '', isStale: false, raw: text, session }
  const until = /until\s+(\d{1,2}:\d{2})/i.exec(text)?.[1] ?? ''
  const named = /(?:holder|owner)\s*[:=]\s*([^,;\n]+)|held by\s+([^,;\n]+)/i.exec(text)
  const holder = (named?.[1] ?? named?.[2] ?? text.split(/\r?\n/)[0] ?? '').replace(/\buntil\b.*$/i, '').trim()
  const end = /^(\d{1,2}):(\d{2})$/.exec(until)
  const endMinutes = end ? Number(end[1]) * 60 + Number(end[2]) : null
  const isStale = endMinutes !== null && nowMinutes - endMinutes > 30 && nowMinutes - endMinutes < 12 * 60
  return { state: 'held', holder: holder.slice(0, 60), until, isStale, raw: text, session }
}

// A worker's waiting line, when its long command names the lock file (a wait loop on the Editor):
// the lock file's first line as written, cut. Nothing else is inferred from the command.
/** @param {string} command @param {string} raw */
export const editorLockLine = (command, raw) => {
  if (!/EDITOR_OWNER/i.test(command)) return ''
  const first = raw.trim().split(/\r?\n/)[0]?.trim() ?? ''
  return first.length <= 50 ? first : `${first.slice(0, 49)}…`
}

// ---------------------------------------------------------------- evidence from tool output

/** @param {string} command */
export const isBuildCommand = command => /Build\.(bat|sh|cmd)\b|UnrealBuildTool|RunUAT|Wait-ForS2EditorCloseAndBuild|\bbuild\.cmd\b/i.test(withoutHeredocs(command))

// Only a build of the Editor target is evidence for an intent; a tool or shader build is not.
/** @param {string} command */
export const isEditorBuild = command => isBuildCommand(command) && /\bS2Editor\b/i.test(command)

/** @param {string} text @returns {'pass' | 'fail' | null} */
export const buildResult = text => {
  const lines = [...text.matchAll(/Result:\s*(Succeeded|Failed[^\r\n]*)/g)]
  const last = lines[lines.length - 1]?.[1]
  return last === undefined ? null : last.startsWith('Succeeded') ? 'pass' : 'fail'
}

/** @param {string} command */
export const isAutomationCommand = command => /Automation\s+RunTests|RunAutomationTests|ExecCmds=.{0,40}Automation|ue-run-automation|Run-S2Automation/i.test(command)

/** @param {string} text @returns {'pass' | 'fail' | null} */
// A pass needs tests that ran and passed; no tests, any failure or any non-zero exit is a fail.
export const automationResult = text => {
  if (/EXIT CODE:\s*-?[1-9]|Result=\{?Fail|\b[1-9]\d* (tests? )?failed\b|\bno (automation )?tests? (were )?(found|matched|run)\b|\b0 tests? (found|ran|run|executed|passed)\b/i.test(text)) return 'fail'
  if (/\b[1-9]\d* (tests? )?passed\b|\b([1-9]\d*)\/\1 (tests? )?pass|\ball [1-9]\d* tests? passed\b/i.test(text)) return 'pass'
  return null
}

// Reading a build's log file, where its Result line is.
/** @param {string} command */
export const isLogRead = command => /\.log\b/i.test(command) && !isBuildCommand(command)

/** @typedef {import('./index.mjs').ShellReading} ShellReading */

// What a finished shell command proved, in the order watch.mjs records it.
/** @param {string} command @param {string} text @param {{ isError?: boolean }} ran @returns {ShellReading} */
export const readShell = (command, text, ran) => {
  /** @type {ShellReading} */
  const out = { rungs: [], context: [], toasts: [], bumps: [] }
  if (isBuildCommand(command)) {
    const result = buildResult(text)
    if (result && isEditorBuild(command)) out.rungs.push({ rung: 'build', value: { state: result, detail: result === 'pass' ? 'Result: Succeeded' : 'Result: Failed' } })
    if (isPiped(command) && result === 'fail' && ran.isError !== true) {
      out.context.push('Ather Automata: the build printed "Result: Failed" although the command exited 0. The exit code is the pipe\'s, not the build\'s. Treat this build as failed.')
      out.toasts.push({ text: 'Ather: piped build reported success but its Result line says Failed.', timeoutMs: 10000 })
      out.bumps.push('buildsCorrected')
    } else if (isPiped(command) && result === null) {
      out.context.push('Ather Automata: this build was piped through a filter, so its exit code is the filter\'s. Read the build\'s own "Result:" line from the log before claiming the build passed.')
    }
  }
  if (isLogRead(command) && /\bS2Editor\b/.test(text)) {
    const result = buildResult(text)
    if (result) out.rungs.push({ rung: 'build', value: { state: result, detail: result === 'pass' ? 'Result: Succeeded (from the log)' : 'Result: Failed (from the log)' } })
  }
  if (isAutomationCommand(command)) {
    // Every run replaces the last result: a run whose outcome cannot be read is no evidence.
    const result = automationResult(text)
    out.rungs.push({ rung: 'automation', value: { state: result ?? 'none', detail: result === 'pass' ? 'tests passed' : result === 'fail' ? 'tests failed or none ran' : 'no test result read' } })
  }
  return out
}

/** @param {string} input an MCP call's arguments as text */
export const isAssetSave = input => /save_assets|save_asset\b|save_actor|save_level|SaveAssets|SavePackage/i.test(input)

// What an MCP call is evidence of. PIE counts only when PIE or a test run is started,
// never for any console command.
/** @param {string} input @returns {'write' | 'read' | 'pie' | null} */
export const mcpKind = input => {
  if (/StartPIE|PlayInEditor|RunTestSimulation|Sipher\.Bench\.Combo\.Start\b/i.test(input)) return 'pie'
  if (/\b(set_|create_|connect_|break_|add_|delete|remove_|compile|save_|write_|update_|SetRowField)/i.test(input)) return 'write'
  if (/\b(get_|read_|find_|list_|exists|describe|GetPIEStatus)/i.test(input)) return 'read'
  return null
}

// ---------------------------------------------------------------- held actions

const HELD_LABELS = { 'editor-restart': 'Editor restarts', 'asset-save': 'Asset saves through MCP' }
const HELD_NOUNS = { 'editor-restart': 'an Editor restart', 'asset-save': 'an asset save' }

/** @param {string} segment @param {readonly string[]} held @returns {string | null} */
const heldSegment = (segment, held) => (held.includes('editor-restart') && /(Stop-Process|taskkill|kill)\b.*UnrealEditor|Start-Process.*UnrealEditor|UnrealEditor(\.exe)?\s+.*\.uproject/i.test(segment) ? 'editor-restart' : null)

// ---------------------------------------------------------------- known traps

// `rule`: where the repository already prevents the trap, as a file under the checkout and a phrase
// only that rule contains. Once the phrase is there, the trap is not offered as a rule again.
export const GOTCHAS = [
  { id: 'live-coding', pattern: /Unable to build while Live Coding is active/i, title: 'A running Editor blocks the build (Live Coding)', fix: 'Close the Editor, or use Wait-ForS2EditorCloseAndBuild.ps1 when another lane holds it. UHT success at the top of the log means nothing here.', rule: { file: '.agents/skills/s2-unreal-engine/SKILL.md', text: 'A running Editor with Live Coding blocks Build.bat' } },
  { id: 'port-8000', pattern: /HttpListener unable to bind/i, title: 'MCP port 8000 still held (TIME_WAIT)', fix: 'Stop the Editor, wait until Get-NetTCPConnection -LocalPort 8000 returns nothing in any state, then relaunch and check the listener PID.', rule: { file: '.agents/skills/unreal-mcp/SKILL.md', text: 'Get-NetTCPConnection -LocalPort 8000' } },
  { id: 'restore-packages', pattern: /Restore Packages/i, title: 'Restore Packages dialog blocks startup', fix: 'Stop the Editor and move Saved/Autosaves/PackageRestoreData.json aside (rename, never delete) before relaunching.', rule: { file: '.agents/skills/unreal-mcp/SKILL.md', text: 'PackageRestoreData.json' } },
  { id: 'mcp-session', pattern: /Unknown session id|no session id/i, title: 'Stale MCP session id', fix: 'Delete the cached MCP session file after an Editor relaunch, and run MCP clients one at a time.', rule: { file: '.agents/skills/unreal-mcp/SKILL.md', text: 'Unknown session id' } },
  { id: 'asset-missing', pattern: /Asset does not exist/i, title: '"Asset does not exist" from every Editor tool', fix: 'Check McpPieTools GetPIEStatus first: a harness that threw before StopPIE leaves PIE running. In a fresh Editor verify saves by mtime and git.', rule: { file: '.agents/skills/unreal-mcp/SKILL.md', text: 'GetPIEStatus' } },
  { id: 'index-lock', pattern: /index\.lock/i, title: 'Git index.lock in the shared checkout', fix: 'Find the holder with Get-CimInstance Win32_Process git.exe. Only a stale lock may be renamed aside, in the same command as the next git call.', rule: { file: 'docs/skills/git-lfs-traffic-control.md', text: 'Get-CimInstance Win32_Process' } },
  { id: 'disk', pattern: /No space left on device/i, title: 'Disk allowance spent', fix: 'Load .agents/skills/s2-free-disk-space/SKILL.md; never fall back to mutating the shared tree.' },
  { id: 'mixed-tree', pattern: /\bLNK20(01|19)\b/, title: 'Unresolved externals (possible mixed tree)', fix: 'If files were just restored, verify every path against HEAD before building; restore in one batched checkout.' },
  { id: 'ps-redirect', pattern: /NativeCommandError/, title: 'PowerShell wrapped native stderr as an error', fix: 'Do not redirect 2>&1 on native executables in Windows PowerShell 5.1; read the exit code instead.', rule: { file: 'AGENTS.md', text: 'do not redirect `2>&1` on native executables' } },
]

// ---------------------------------------------------------------- skills and Create

// The skills worth one press, by what they are for. Only those present in .agents/skills show.
// A name is a folder under .agents/skills; a path names one elsewhere (the manual library).
export const SKILL_GROUPS = [
  { group: 'Review and proof', names: ['thermo-nuclear-code-quality-review', 'editor-video-walkthrough'] },
  { group: 'Authoring', names: ['unreal-editor-agent-authoring'] },
  { group: 'Agentic testing', names: ['mainchar-test-simulation', 'talab', 'unreal-pie-character-measurement', 'unreal-agent-feature-harness', 'unreal-test-harness', 'unreal-insights-pie-frame-capture'] },
  { group: 'Git and pull requests', names: ['pr-to-main', 'babysit-pr', 's2-github-pr-review', 's2-worktree-cleanup', 'git-poller-storm'] },
  { group: 'Explain it to me', names: ['bro', '.agents/skill-library/visuals/show-me'] },
]

// Making things in the Editor: the skills that build content through MCP, grouped by what is made,
// each led by what it does. The first three of a group show; the rest wait behind More.
export const CREATE_GROUPS = [
  { group: 'VFX and look', items: [
    { name: 'unreal-niagara-mcp', verb: 'Make or tune a Niagara effect' },
    { name: 'sw-environment-preset-from-reference', verb: 'Build a weather and sky preset from a reference image' },
    { name: 'metahuman-groom-wardrobe', verb: 'Turn grooms into MetaHuman wardrobe items' },
    { name: '.agents/skill-library/vfx/arena-pattern-vfx-designer', verb: 'Design arena pattern telegraphs' },
  ] },
  { group: 'Characters and animation', items: [
    { name: 'author-child-visual-montage-sync', verb: 'Sync a child visual montage to its parent' },
    { name: 'author-curve3d-motion-profiles', verb: 'Author a motion profile (Curve3D)' },
    { name: '.agents/skill-library/animation/ninetails-tail-shape-authoring', verb: 'Shape the NineTails tails' },
    { name: '.agents/skill-library/animation/ninetails-tail-animation-bake', verb: 'Bake NineTails tail animation' },
  ] },
  { group: 'AI and encounters', items: [
    { name: 'bt-graph', verb: 'Edit a Behavior Tree' },
    { name: 'boss-bt-authoring', verb: 'Design a boss or elite fight' },
    { name: 'team-move-rule-book-authoring', verb: 'Make a Team Move rule book for a squad' },
    { name: 's2-goai-config-authoring', verb: 'Set up GOAI NPC behaviour' },
    { name: 'qte-content-authoring', verb: 'Add a QTE' },
    { name: '.agents/skill-library/ai-enemy/behavior-tree-pattern-template-authoring', verb: 'Make a reusable Behavior Tree pattern' },
    { name: '.agents/skill-library/testing/map-session-test-setup', verb: 'Set up a boss-room test session' },
  ] },
  { group: 'Enemies', items: [
    { name: '.agents/skill-library/ai-enemy/enemy-qualification-verifier', verb: 'Check an enemy against its GDD' },
    { name: 'maintain-sipher-montage-tools', verb: 'Tune enemy montage frame data' },
  ] },
  { group: 'Levels and cinematics', items: [
    { name: 'level-cinematics-authoring', verb: 'Direct a Level Cinematic' },
    { name: 'traversal-module-authoring', verb: 'Build traversal modules' },
    { name: 'unreal-demo-gym-authoring', verb: 'Make a demo or test gym level' },
    { name: 'sipher-navmesh-bake', verb: 'Bake navmesh for a level' },
    { name: '.agents/skill-library/authoring/sipher-smart-object-mcp-workflow', verb: 'Author Smart Objects' },
  ] },
  { group: 'Audio', items: [{ name: '.agents/skill-library/audio/ability-beat-audio-authoring', verb: 'Time combat SFX to ability beats' }] },
  { group: 'Anything else', items: [{ name: 'unreal-mcp', verb: 'Edit any live asset' }] },
]

// Which groups come first, by role: what each role makes most.
const CREATE_ORDER = {
  techart: ['VFX and look', 'Characters and animation', 'Levels and cinematics', 'AI and encounters', 'Enemies', 'Audio', 'Anything else'],
  designer: ['AI and encounters', 'Enemies', 'Levels and cinematics', 'Characters and animation', 'VFX and look', 'Audio', 'Anything else'],
  engineer: ['AI and encounters', 'Levels and cinematics', 'VFX and look', 'Characters and animation', 'Enemies', 'Audio', 'Anything else'],
}

/** @param {string} name */
const skillFolder = name => (name.includes('/') ? name : `.agents/skills/${name}`)

/** @param {string} verb @param {string} name @param {{ isHeld: boolean, holder: string, until: string }} editor */
const createPrompt = (verb, name, editor) =>
  `I want to ${verb.charAt(0).toLowerCase()}${verb.slice(1)} in the Unreal Editor. Use the ${name.split('/').pop()} skill (${skillFolder(name)}/SKILL.md). First ask me what I want, one question at a time and at most three. Then record it as an intent with the intent skill, take the Editor owner lock as AGENTS.md says${editor.isHeld ? ` (it is held by ${editor.holder || 'another lane'}${editor.until ? ` until ${editor.until}` : ''}: ask that lane for a window first)` : ''}, build it in the Editor, and show me the result.`

/** @param {{ isHeld: boolean, isFree: boolean, holder: string, until: string }} editor */
const createMeta = editor => (editor.isHeld ? `Editor held by ${editor.holder || 'another lane'}${editor.until ? ` until ${editor.until}` : ''}: the session asks for a window first.` : editor.isFree ? 'Editor free: the session takes the lock and starts.' : 'The session checks the Editor lock first.')

// ---------------------------------------------------------------- what the session is asked

/** @param {string} role @param {string} slug */
const briefPrompt = (role, slug) =>
  role !== 'techart' && role !== 'designer'
    ? `Dispatch a background Opus worker for intent ${slug} using .agents/skills/intent/assets/worker-brief.md: exact paths, the acceptance checks it must prove, the shared-tree rule, no commits in the shared checkout.`
    : `Dispatch one background Opus worker for intent ${slug} as the only Editor MCP user: take the Editor owner lock first, read back every write, never save a package that does not compile, release the lock when done. Use .agents/skills/intent/assets/worker-brief.md.`

/** @param {string} role @param {string} slug */
const provePrompt = (role, slug) =>
  role === '' || role === 'engineer'
    ? `Prove intent ${slug}: build S2Editor Development with the output written to a log file, report the build's own Result: line, then run the relevant automation tests and report the counts.`
    : role === 'techart'
      ? `Prove intent ${slug}: record a PIE proof with the map and capture path, and tell me which asset the change never touched to open in the Editor for my own check.`
      : `Prove intent ${slug} in PIE with the MainChar test simulation templates (.agents/skills/mainchar-test-simulation/SKILL.md) and record the proof path.`

/** @param {string} role @param {string} slug */
const shipPrompt = (role, slug) =>
  role === 'designer'
    ? `Summarise intent ${slug} for an owner to land: what changed, the evidence for each checklist item, and what is still owed.`
    : `Prepare intent ${slug} for landing: extract the change onto a clean branch in its own worktree, audit the diff and every binary asset for lost edits, open the PR from .github/pull_request_template.md, then wait for my go before merging.`

export const TOUR_PROMPT = 'Give me the Ather tour: follow .agents/skills/ather-tour/SKILL.md step by step.'

/** @param {string} question */
const askPrompt = question =>
  `I asked Ather: "${question}" Answer briefly in plain words. Ather is this studio's Claude Code mod (docs/design-docs/s2-director-kit.md, section 5): /ather shows what needs me and the next step, /ather tour walks a newcomer through the workflow, /away hands over while I am away. If the question is about my work instead, answer from this checkout.`

/** @type {Pack} */
export const unreal = {
  id: 'unreal',
  roles: ROLES,
  roleLabels: ROLE_LABELS,
  roleDescriptions: { engineer: 'Builds and automation tests.', techart: 'A PIE proof and your own Editor check.', designer: 'A PIE proof.' },
  roleWords: 'designer, tech artist or engineer',
  roleHelp: 'Which role? /ather role designer, /ather role tech artist or /ather role engineer.',
  roleFallback: 'Tour skipped. Say your role any time with /ather role designer, tech artist or engineer.',
  roleKey: '',
  parseRole,
  owners: OWNERS,
  // Owner lines that name a team, not a person: each shown with its lead.
  teams: { Cinematic: 'Tien Dang' },
  // How the studio's git names read (worklist.mjs tidyName): role and studio words at the end, and family names.
  names: {
    suffix: /^(art|artist|vfx|ta|ge|gd|tech|techart|sipher|ather|atherlabs|labs|producer|game|design|designer|engineer|dev|qa)$/i,
    studio: /(sipher|atherlabs|ather)$/i,
    families: ['nguyen', 'huynh', 'hoang', 'truong', 'duong', 'trinh', 'luong', 'tran', 'pham', 'phan', 'dang', 'dinh', 'doan', 'quach', 'than', 'bui', 'ngo', 'lam', 'mai', 'cao', 'le', 'vo', 'vu', 'do', 'ho', 'ly'],
  },
  areas: AREAS,
  normalizeArea,
  rungLabels: RUNG_LABELS,
  proofWords: PROOF_WORDS,
  emptyEvidence,
  requiredRungs,
  isProven,
  anyProofText: 'a PIE proof, or a build that succeeded with passing tests',
  localDir: 'Saved/AtherAutomata',
  debriefPath: slug => `Saved/AtherAutomata/debriefs/${slug}.md`,
  lockFile: 'Saved/EDITOR_OWNER.txt',
  parseLock: parseEditorLock,
  lockLine: editorLockLine,
  lockRoles: ['techart', 'designer'],
  ownCheck: { role: 'techart', after: 'pie', rung: 'editor', label: 'I checked it in the Editor', hint: 'PIE proof ✓ · your own Editor check is the last proof.', proveHint: ' After your own Editor check, type /ather checked.', detail: 'checked by you in the Editor', reply: 'Recorded: you checked it in the Editor.' },
  traps: GOTCHAS,
  held: { labels: HELD_LABELS, nouns: HELD_NOUNS, kinds: ['editor-restart', 'asset-save'], defaults: ['merge', 'push-main'] },
  heldSegment,
  mergePolicy: 'hold',
  isAssetSave,
  readShell,
  mcpKind,
  binaryAssets: /\.(uasset|umap)$/i,
  briefPaths: /[A-Za-z]:[\\/]|\b(Source|Content|Plugins|Config|docs|tools|scripts)\/|\/Game\/|\.(cpp|h|cs|py|md|uasset|umap|ini)\b/,
  skillGroups: SKILL_GROUPS,
  createGroups: CREATE_GROUPS,
  createOrder: CREATE_ORDER,
  createTitle: 'Make it in the Editor',
  createMeta,
  createPrompt,
  prompts: {
    brief: briefPrompt,
    prove: provePrompt,
    ship: shipPrompt,
    shipHint: role => (role === 'designer' ? 'Summarises the work so an owner can land it.' : 'A clean PR; nothing merges without your go.'),
    briefHint: 'A background agent does the work, briefed the studio way for your role.',
    tour: TOUR_PROMPT,
    tourToast: 'Ather: new here? Type /ather tour for a six-step tour of how S2 works with Claude Code.',
    ask: askPrompt,
  },
  mandate: {
    flags: 'keep behaviour changes behind a CVar that defaults to the current behaviour',
    allowed: 'push branches, open draft PRs, open PRs to main',
    merge: 'never merge',
    away: 'The session may push branches and open PRs; nothing merges until you are back.',
    pane: 'The session keeps working; merges and pushes to main wait for your review.',
  },
  statusWhat: 'this S2 session',
  notHere: 'Ather Automata works in S2 checkouts (a docs/intent folder); none here. /ather setup adds the structure.',
  gates: [],
  production: null,
}
