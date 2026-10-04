// @ts-check
// Ather Automata: what tool calls and their output mean. Shell commands that
// must wait while the director is away, builds and tests read from their own
// output, MCP calls that count as evidence, thin worker briefs, known traps.
// Pure: no `$`.

export const HELD_LABELS = { merge: 'Merges', 'push-main': 'Pushes to main', 'editor-restart': 'Editor restarts', 'asset-save': 'Asset saves through MCP' }
// For one held action in a sentence: "held a merge until you are back".
export const HELD_NOUNS = { merge: 'a merge', 'push-main': 'a push to main', 'editor-restart': 'an Editor restart', 'asset-save': 'an asset save' }
/** @typedef {keyof typeof HELD_LABELS} HeldKind */
export const HELD_KINDS = /** @type {HeldKind[]} */ (Object.keys(HELD_LABELS))

const GIT_REWRITE = /\bgit\b(?:\s+-[cC]\s+\S+)*\s+(stash(?!\s+(list|show)\b)|clean\b|reset\s+--hard|sparse-checkout(?!\s+(list|disable)\b)|checkout\b|switch\b|restore\b|rebase\b)/i

// Why a refused tree-rewriting git command was refused, and the safe way.
/** @param {string} command */
export const explainGuard = command => {
  const kind = GIT_REWRITE.exec(command)?.[1]?.split(/\s+/)[0]
  if (!kind) return null
  const safe = /\bgit\s+-C\s+\S+/.test(command)
    ? 'Run it from a separate worktree (git worktree add, then git -C <worktree path> ...), never in the shared checkout.'
    : 'Pin it: git -C <absolute worktree path> ..., with the path read back from git worktree list. Never after a cd.'
  return `git ${kind} rewrites the working tree that other sessions share. ${safe}`
}

// A heredoc's body is text being written, not a command being run.
/** @param {string} command */
const withoutHeredocs = command => command.replace(/<<-?\s*['"]?(\w+)['"]?[\s\S]*?\n\1\b/g, '')

/** @param {string} command */
export const isBuildCommand = command => /Build\.(bat|sh|cmd)\b|UnrealBuildTool|RunUAT|Wait-ForS2EditorCloseAndBuild|\bbuild\.cmd\b/i.test(withoutHeredocs(command))

// Only a build of the Editor target is evidence for an intent; a tool or shader build is not.
/** @param {string} command */
export const isEditorBuild = command => isBuildCommand(command) && /\bS2Editor\b/i.test(command)

/** @param {string} command */
export const isPiped = command => /\|\s*(tail|head|grep|Select-String|Select-Object|findstr|tee|sls)\b/i.test(command)

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

/** @param {string} command */
// A merge or a pull (which merges); never `merge-base` or `merge --abort`.
export const isMergeCommand = command => /\bgit\b(?:\s+-C\s+\S+)?\s+(merge(?![-\w])|pull\b)(?!.*--abort)/i.test(command)

// The commands of a chain: split only outside quotes, heredoc bodies dropped, quotes removed.
// `git commit -m "fix; git push origin main"` is one commit command, not a push.
/** @param {string} command */
const segments = command => {
  const text = withoutHeredocs(command)
  const out = []
  let current = ''
  let quote = ''
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at] ?? ''
    if (quote !== '') {
      if (char === quote) quote = ''
      else current += char
    } else if (char === '"' || char === "'") quote = char
    else if (text.startsWith('&&', at) || text.startsWith('||', at)) {
      out.push(current)
      current = ''
      at += 1
    } else if (char === ';' || char === '|' || char === '\n') {
      out.push(current)
      current = ''
    } else current += char
  }
  out.push(current)
  return out.map(part => part.trim()).filter(Boolean)
}

// Each segment with the folder it runs in: its own `git -C`, else the last `cd` before it, else null (the session's folder).
/** @param {string} command */
const withFolders = command => {
  /** @type {string | null} */
  let cwd = null
  return segments(command).map(segment => {
    const cd = /^(?:cd|Set-Location|pushd)\s+(\S+)/i.exec(segment)
    if (cd?.[1]) cwd = cd[1]
    return { segment, folder: /^git\s+-C\s+(\S+)/i.exec(segment)?.[1] ?? cwd }
  })
}

// The folders a command's git segments run in, for the caller to look up their branches.
/** @param {string} command */
export const gitFolders = command => [...new Set(withFolders(command).filter(one => /^git\b/i.test(one.segment)).map(one => one.folder))]

const MAIN = /^(?:refs\/heads\/)?(main|master)$/

// Where a `git push` sends: its refspec's destination, or the current branch when it names none.
/** @param {string} segment @param {string} branch */
const pushTarget = (segment, branch) => {
  const words = segment.split(/\s+/)
  const refspec = words.slice(words.indexOf('push') + 1).filter(word => !word.startsWith('-'))[1]
  if (refspec === undefined) return branch
  const destination = refspec.replace(/^\+/, '').split(':').pop() ?? ''
  return destination === 'HEAD' ? branch : destination
}

// Searches over source and docs: a trap's text in their output is someone looking it up, not hitting it.
// Reading a build log is different: that is where the traps show up.
const SEARCHERS = /^(grep|rg|ag|ack|findstr|Select-String|sls)\b/i

/** @param {string} command */
export const isSearchCommand = command => segments(command).every(segment => SEARCHERS.test(segment))

// Reading a build's log file, where its Result line is.
/** @param {string} command */
export const isLogRead = command => /\.log\b/i.test(command) && !isBuildCommand(command)

// A shell command the window holds, if any. `branchOf` gives the branch checked out in a folder
// (null: the session's folder), or '' when it cannot be told; then only an explicit main is held.
/** @param {string} command @param {readonly string[]} held @param {(folder: string | null) => string} branchOf @returns {HeldKind | null} */
export const heldShell = (command, held, branchOf) => {
  for (const { segment, folder } of withFolders(command)) {
    const branch = branchOf(folder)
    const isPrMerge = /^gh\s+pr\s+merge\b/i.test(segment) || /^gh\s+api\b.*\bpulls\/\d+\/merge\b/i.test(segment)
    // A local merge matters only into main; merging main into a feature branch is ordinary work.
    const isMainMerge = /^git\b(?:\s+-C\s+\S+)?\s+merge\s+(?!--abort)/i.test(segment) && MAIN.test(branch)
    if (held.includes('merge') && (isPrMerge || isMainMerge)) return 'merge'
    if (held.includes('push-main') && /^git\b(?:\s+-C\s+\S+)?\s+push\b/i.test(segment) && MAIN.test(pushTarget(segment, branch))) return 'push-main'
    if (held.includes('editor-restart') && /(Stop-Process|taskkill|kill)\b.*UnrealEditor|Start-Process.*UnrealEditor|UnrealEditor(\.exe)?\s+.*\.uproject/i.test(segment)) return 'editor-restart'
  }
  return null
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

// "mcp__unreal-mcp__get_actor" → "unreal-mcp": a readback must read from the server that was written to.
/** @param {string} tool */
export const mcpServer = tool => tool.split('__')[1] ?? tool

// Only briefs for workers that will change files or the Editor are checked.
/** @param {string} prompt @param {string | undefined} type */
export const briefIssues = (prompt, type) => {
  if (type !== undefined && /^(Explore|Plan|statusline-setup|claude-code-guide)$/i.test(type)) return []
  if (!/\b(edit|write|implement|fix|change|modify|refactor|add|create|delete|remove|rename|commit|save|build|compile|wire|author)\b/i.test(prompt) || /\bread-only\b|do not (edit|modify|change)|no edits/i.test(prompt)) return []
  const issues = []
  if (!/[A-Za-z]:[\\/]|\b(Source|Content|Plugins|Config|docs|tools|scripts)\/|\/Game\/|\.(cpp|h|cs|py|md|uasset|umap|ini)\b/.test(prompt)) issues.push('exact paths')
  if (!/acceptance|accept when|done when|success criteria|verify|evidence|proof|report format|deliverable|final (message|report)|report back|return (a|the) (list|report|summary)/i.test(prompt)) issues.push('acceptance checks')
  // A worker kept to its own folder, or told to leave git alone, already respects the shared tree.
  if (!/shared (checkout|tree|worktree)|git -C|worktree|no commits|do not commit|don't commit|never (stash|switch|clean)|no git (changes|commands)|work only in|edit nothing (else|outside)/i.test(prompt)) issues.push('the shared-tree rule')
  return issues
}

// ---------------------------------------------------------------- known traps

const GOTCHAS = [
  { id: 'live-coding', pattern: /Unable to build while Live Coding is active/i, title: 'A running Editor blocks the build (Live Coding)', fix: 'Close the Editor, or use Wait-ForS2EditorCloseAndBuild.ps1 when another lane holds it. UHT success at the top of the log means nothing here.' },
  { id: 'port-8000', pattern: /HttpListener unable to bind/i, title: 'MCP port 8000 still held (TIME_WAIT)', fix: 'Stop the Editor, wait until Get-NetTCPConnection -LocalPort 8000 returns nothing in any state, then relaunch and check the listener PID.' },
  { id: 'restore-packages', pattern: /Restore Packages/i, title: 'Restore Packages dialog blocks startup', fix: 'Stop the Editor and move Saved/Autosaves/PackageRestoreData.json aside (rename, never delete) before relaunching.' },
  { id: 'mcp-session', pattern: /Unknown session id|no session id/i, title: 'Stale MCP session id', fix: 'Delete the cached MCP session file after an Editor relaunch, and run MCP clients one at a time.' },
  { id: 'asset-missing', pattern: /Asset does not exist/i, title: '"Asset does not exist" from every Editor tool', fix: 'Check McpPieTools GetPIEStatus first: a harness that threw before StopPIE leaves PIE running. In a fresh Editor verify saves by mtime and git.' },
  { id: 'index-lock', pattern: /index\.lock/i, title: 'Git index.lock in the shared checkout', fix: 'Find the holder with Get-CimInstance Win32_Process git.exe. Only a stale lock may be renamed aside, in the same command as the next git call.' },
  { id: 'disk', pattern: /No space left on device/i, title: 'Disk allowance spent', fix: 'Load .agents/skills/s2-free-disk-space/SKILL.md; never fall back to mutating the shared tree.' },
  { id: 'mixed-tree', pattern: /\bLNK20(01|19)\b/, title: 'Unresolved externals (possible mixed tree)', fix: 'If files were just restored, verify every path against HEAD before building; restore in one batched checkout.' },
  { id: 'ps-redirect', pattern: /NativeCommandError/, title: 'PowerShell wrapped native stderr as an error', fix: 'Do not redirect 2>&1 on native executables in Windows PowerShell 5.1; read the exit code instead.' },
]

/** @typedef {{ id: string, title: string, fix: string }} Trap */
/** @typedef {Record<string, { title: string, fix: string, count: number }>} TrapHits */

/** @param {string} text */
export const matchGotchas = text => GOTCHAS.filter(rule => rule.pattern.test(text))

// A trap hit in this many separate sessions becomes a "Needs you" item: make it a rule?
const RULE_AFTER_SESSIONS = 3

/** @param {TrapHits} hits @param {Trap} rule @returns {TrapHits} */
export const countGotcha = (hits, rule) => ({ ...hits, [rule.id]: { title: rule.title, fix: rule.fix, count: (hits[rule.id]?.count ?? 0) + 1 } })

/** @param {TrapHits} hits @param {readonly string[]} ruled */
export const recurringGotchas = (hits, ruled) =>
  Object.entries(hits)
    .filter(([id, hit]) => hit.count >= RULE_AFTER_SESSIONS && !ruled.includes(id))
    .map(([id, hit]) => ({ id, ...hit }))
    .sort((a, b) => b.count - a.count)
