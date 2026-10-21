// The shared S2 Editor: who may drive it. Pure: no `$`.
// Lock text is read the way Ather Automata's Unreal pack reads it (parseEditorLock), so both agree on
// who holds the Editor; a session proves it is the holder by naming `session <first 8 of its id>`.
import { program, programs, type Program } from './a5r.ts'

export type EditorLock = { state: 'free' | 'held' | 'unknown'; holder: string; until: string; isStale: boolean; session: string }

export const parseEditorLock = (raw: string | null, nowMinutes: number): EditorLock => {
  const text = (raw ?? '').replace(/^﻿/, '').trim()
  const session = /\bsession\s+([0-9a-f]{8})/i.exec(text)?.[1]?.toLowerCase() ?? ''
  if (text === '') return { state: 'unknown', holder: '', until: '', isStale: false, session }
  const free = /free\s+since\s+(\d{1,2}:\d{2})/i.exec(text)
  if (free || /^free\b/i.test(text) || /\bfree (for|to use)\b|\bno (agent|one|lane) holds it\b/i.test(text))
    return { state: 'free', holder: '', until: free?.[1] ?? '', isStale: false, session }
  const until = /(?:until|expected end)\s+(\d{1,2}:\d{2})/i.exec(text)?.[1] ?? ''
  const named = /(?:holder|owner)\s*[:=]\s*([^,;\n]+)|held by\s+([^,;\n]+)/i.exec(text)
  const holder = (named?.[1] ?? named?.[2] ?? text.split(/\r?\n/)[0] ?? '').replace(/\buntil\b.*$/i, '').trim()
  const end = /^(\d{1,2}):(\d{2})$/.exec(until)
  const endMinutes = end ? Number(end[1]) * 60 + Number(end[2]) : null
  const isStale = endMinutes !== null && nowMinutes - endMinutes > 30 && nowMinutes - endMinutes < 12 * 60
  return { state: 'held', holder: holder.slice(0, 60), until, isStale, session }
}

/** What an Unreal MCP call does to the Editor, from its arguments as text. */
export const mcpKind = (input: string): 'save-all' | 'pie' | 'write' | 'read' | null => {
  if (/save_all|SaveAll\b|save_dirty|SaveDirty|SaveAllDirty/i.test(input)) return 'save-all'
  if (/StartPIE|PlayInEditor|RunTestSimulation|Sipher\.Bench\.Combo\.Start\b/i.test(input)) return 'pie'
  if (/save_assets|save_asset\b|save_actor|save_level|SaveAssets|SavePackage/i.test(input)) return 'write'
  if (/\b(set_|create_|connect_|break_|add_|delete|remove_|compile|save_|write_|update_|SetRowField|execute_|run_)/i.test(input)) return 'write'
  if (/\b(get_|read_|find_|list_|exists|describe|GetPIEStatus)/i.test(input)) return 'read'
  return null
}

/** A88 (review of 0.17.1): what an Unreal MCP call does to the Editor, read from the MCP tool's own name and the toolset
 * method its input names (`name`, `tool`, …), never from the rest of its arguments: a read whose query or path mentions
 * `set_` or `run_` stays a read. A console command reaches PIE only through a console tool. */
const MCP_METHOD_KEYS = ['name', 'tool', 'tool_name', 'toolName', 'method', 'function', 'action'] as const
export const mcpCallKind = (tool: string, input: Record<string, unknown>): ReturnType<typeof mcpKind> | 'stop' => {
  const method = [tool.split('__').pop() ?? '', ...MCP_METHOD_KEYS.map(k => (typeof input[k] === 'string' ? (input[k] as string) : ''))].filter(Boolean).join(' ')
  const kind = mcpKind(method)
  if (kind === 'save-all' || kind === 'pie' || kind === 'write') return kind
  // Round-2 review: by exact method names and prefixes (the last `.` segment of each name), never substrings, so
  // `find_closest_actor` stays a read.
  const names = method.split(/\s+/).map(n => n.split('.').pop() ?? '').filter(Boolean)
  if (names.some(n => /^(execute_?)?console_?command$/i.test(n))) {
    const args = (typeof input.arguments === 'object' && input.arguments !== null ? input.arguments : input) as Record<string, unknown>
    const command = [args.command, args.cmd, args.Command, input.command].filter((v): v is string => typeof v === 'string').join(' ')
    if (command && mcpKind(command) === 'pie') return 'pie'
    return 'write' // a console command can quit, close or save: it needs the lock
  }
  // Rev 38 (thermo-nuclear review C2): quitting or closing the Editor is a stop (it needs the lock, and a launch:false pass
  // slot may still do it).
  if (names.some(n => /^(quit|exit|shutdown)(_|$)/i.test(n) || /^(quit|exit|shutdown|close)_?editor$/i.test(n))) return 'stop'
  if (names.some(n => /^save_/i.test(n) || /^Save[A-Z]/.test(n))) return 'write'
  return kind
}

/** A shell command's act on an Unreal Editor, read by each segment's program (wrapper verbs stripped, a shell's own command
 * read too): `launch` an Editor (an UnrealEditor* binary given a project, or Start-Process of one), a `headless`
 * UnrealEditor-Cmd run of a project (memory, but not the shared Editor), or `stop` one (Stop-Process, taskkill, kill naming
 * it). Rev 38 (Fable review D7, thermo-nuclear review C1): a read, a diff, an echo or a build (Build.bat, RunUAT) that names
 * one is no act, and no launcher script of one project is named (another way to launch shows in the minute's probe). */
export type EditorAct = 'launch' | 'headless' | 'stop'
const EDITOR_BIN = /^unrealeditor(-[\w-]+)?$/
// Rev 38 (thermo-nuclear review R1, R2): PowerShell's start/saps alias Start-Process; pkill/killall/spps stop by name; a name
// inside `$(pgrep …)`, backticks, quotes or `(Get-Process UnrealEditor).Id` counts (the token is split on non-path characters).
const START_VERBS = new Set(['start-process', 'start', 'saps'])
const STOP_VERBS = new Set(['stop-process', 'spps', 'taskkill', 'kill', 'pkill', 'killall'])
const editorArg = (a: string): boolean => a.split(/[^\w.:\\/-]+/).some(w => EDITOR_BIN.test(program(w)))
const isHeadless = (name: string): boolean => /unrealeditor-cmd/i.test(name)
const actOf = ({ verb, args }: Program): EditorAct | null => {
  if (EDITOR_BIN.test(verb) && args.some(a => /\.uproject$/i.test(a))) return isHeadless(verb) ? 'headless' : 'launch'
  const named = args.find(editorArg)
  if (named && START_VERBS.has(verb)) return isHeadless(named) ? 'headless' : 'launch'
  if (named && !isHeadless(named) && STOP_VERBS.has(verb)) return 'stop'
  return null
}
export const editorShellAct = (command: string): EditorAct | null => programs(command).map(actOf).find(act => act !== null) ?? null

/** A shell command that opens or closes the shared Editor (headless UnrealEditor-Cmd is not it). */
export const isEditorStartStop = (command: string): boolean => {
  const act = editorShellAct(command)
  return act === 'launch' || act === 'stop'
}

/** Why this session may not drive the Editor now, or null when it holds the lock. */
export const lockProblem = (lock: EditorLock, me8: string, take = `Take the lock first: write your slot, 'session ${me8}' and your end time into Saved/EDITOR_OWNER.txt (AGENTS.md), then retry.`, queue = ''): string | null => {
  if (lock.state === 'unknown') return `Saved/EDITOR_OWNER.txt is missing or empty: that means unknown, not free. ${take}`
  if (lock.state === 'free') return `The Editor lock is free, so nobody (this session included) holds it. ${take}`
  if (lock.session === me8) return null
  const when = lock.until ? ` until ${lock.until}` : ''
  const stale = lock.isStale ? ' The lease looks stale, but only a confirmed-gone holder may be replaced.' : ''
  return lock.session
    ? `The Editor is held by ${lock.holder || 'another lane'} (session ${lock.session})${when}. Never drive an Editor another lane holds.${stale}`
    : queue
      ? `The Editor is held by ${lock.holder || 'another lane'}${when}, and the lock does not name this session. Never drive an Editor another lane holds: ${queue}.${stale}` // A84: no step that hand-edits a lock A5R refuses to let you edit
      : `The Editor is held by ${lock.holder || 'another lane'}${when}, and the lock does not name this session. If this session holds it, add 'session ${me8}' to the lock; otherwise wait.${stale}`
}

export const PIE_MIN_FREE_GB = 5
// Free physical memory in GB, as one number on stdout.
export const FREE_RAM_PROBE = ['powershell', '-NoProfile', '-Command', '[math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB, 1)']
