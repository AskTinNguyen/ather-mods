// The shared S2 Editor: who may drive it. Pure: no `$`.
// Lock text is read the way Ather Automata's Unreal pack reads it (parseEditorLock), so both agree on
// who holds the Editor; a session proves it is the holder by naming `session <first 8 of its id>`.

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
export const mcpCallKind = (tool: string, input: Record<string, unknown>): ReturnType<typeof mcpKind> => {
  const method = [tool.split('__').pop() ?? '', ...MCP_METHOD_KEYS.map(k => (typeof input[k] === 'string' ? (input[k] as string) : ''))].filter(Boolean).join(' ')
  const kind = mcpKind(method)
  if (kind === 'save-all' || kind === 'pie' || kind === 'write') return kind
  if (/console/i.test(method)) {
    const args = (typeof input.arguments === 'object' && input.arguments !== null ? input.arguments : input) as Record<string, unknown>
    const command = [args.command, args.cmd, args.Command, input.command].filter((v): v is string => typeof v === 'string').join(' ')
    if (command && mcpKind(command) === 'pie') return 'pie'
    return 'write' // re-review: a console command can quit, close or save: it needs the lock
  }
  if (/quit|exit|close|shutdown|save/i.test(method)) return 'write' // re-review: a method that can quit, close or save
  return kind
}

/** A shell command that opens or closes the shared Editor (headless UnrealEditor-Cmd is not it). */
export const isEditorStartStop = (command: string): boolean =>
  /(Stop-Process|taskkill|kill)\b[^\n]*UnrealEditor(?!-Cmd)\b|Start-Process[^\n]*UnrealEditor(?!-Cmd)\b|UnrealEditor(\.exe)?["']?\s+[^\n]*\.uproject/i.test(command)

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
