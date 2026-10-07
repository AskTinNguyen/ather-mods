// A45 / A46 (rev 14): which shell commands open a pull request, and what the PR call itself names. One quote-aware
// reading of the command for both, so a PR is found however the command is written (env prefixes, wrappers, `&`,
// PowerShell `if (…) { … }`, `{ …; }`, `bash -c`, `cmd /c`, `powershell -Command`, a here-document fed to a shell) and
// its refs come from the gh call's own tokens (a `;` inside a quoted body never cuts `--head` off). Pure: no `$`.
//
// The adversary review of 0.11.2 (2026-10-07) MEASURED these as "no PR" on that version: `GH_TOKEN=x gh pr create`,
// `git push; if ($?) { gh pr create }`, `& gh pr create`, `bash -c "gh pr create"`; and refs that lost `--head` behind a
// quoted `;`. tests/prcmd.test.ts holds every form.

/** Words that run the next word as the command (`env A=1 gh …`, `time gh …`, `& gh …`, `then gh …`). */
const LEADS = new Set(['env', 'time', 'nohup', 'sudo', 'command', 'builtin', 'exec', 'xargs', 'call', '&', '.', '!', 'then', 'do', 'else', 'elif', 'if', 'while', 'until', 'start', 'start-process', 'invoke-expression', 'iex'])
/** Shells whose `-c` / `-Command` / `/c` argument, or whose here-document, is itself a command line. */
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'powershell', 'pwsh', 'cmd'])
/** Words that change the folder for the commands after them. */
const CHDIRS = new Set(['cd', 'pushd', 'chdir', 'set-location', 'sl'])

/** A here-document a command line opens: its terminator word, whether `<<-` (leading tabs stripped), and whether the
 * command owning it is a shell reading it as commands. */
type Heredoc = { word: string; tabs: boolean; isShell: boolean }

/** Splits a command line into its commands, outside quotes: on `&&`, `||`, `;`, `|`, `&` at the end, newlines, and the
 * grouping marks `{`, `}`, `(`, `)` (PowerShell `if ($?) { … }`, bash `{ …; }`, subshells, `$( … )`); `${name}` stays
 * whole. A `#` that starts a word begins a comment to the end of its line. */
export const splitCommands = (line: string): string[] => {
  const out: string[] = []
  let cur = ''
  let quote = ''
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i] ?? ''
    if (quote) {
      cur += c
      if (c === '\\' && quote === '"' && i + 1 < line.length) {
        cur += line[i + 1]
        i += 1
      } else if (c === quote) quote = ''
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      cur += c
    } else if (c === '#' && (cur === '' || /\s$/.test(cur))) {
      while (i < line.length && line[i] !== '\n') i += 1
      out.push(cur)
      cur = ''
    } else if (line.startsWith('&&', i) || line.startsWith('||', i)) {
      out.push(cur)
      cur = ''
      i += 1
    } else if (c === ';' || c === '|' || c === '\n' || c === '}' || c === ')' || c === '(') {
      out.push(cur)
      cur = ''
    } else if (c === '{' && line[i - 1] !== '$' && line[i - 1] !== '@') {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out.map(s => s.trim()).filter(Boolean)
}

/** Splits one command into words, quote-aware: quotes removed, their content kept whole (`--body="a; b"` is one word). */
export const words = (cmd: string): string[] => {
  const out: string[] = []
  let cur = ''
  let has = false
  let quote = ''
  for (let i = 0; i < cmd.length; i += 1) {
    const c = cmd[i] ?? ''
    if (quote) {
      if (c === '\\' && quote === '"' && (cmd[i + 1] === '"' || cmd[i + 1] === '\\')) {
        cur += cmd[i + 1]
        i += 1
      } else if (c === quote) quote = ''
      else cur += c
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      has = true
    } else if (/\s/.test(c)) {
      if (has || cur) out.push(cur)
      cur = ''
      has = false
    } else cur += c
  }
  if (has || cur) out.push(cur)
  return out
}

/** The command's verb and its arguments: env assignments and lead words skipped; the verb lowercased, its path and
 * `.exe` dropped (`& "C:\…\gh.exe" pr create` is gh). */
export const verbOf = (ws: string[]): [string, string[]] => {
  let i = 0
  while (i < ws.length && (/^[A-Za-z_][\w]*=/.test(ws[i] ?? '') || LEADS.has((ws[i] ?? '').toLowerCase()) || (i > 0 && (ws[i - 1] ?? '').toLowerCase() === 'env' && /^-/.test(ws[i] ?? '')))) i += 1
  if (i >= ws.length) return ['', []]
  const verb = (ws[i] ?? '').split(/[\\/]/).pop()?.toLowerCase() ?? ''
  return [verb.endsWith('.exe') ? verb.slice(0, -4) : verb, ws.slice(i + 1)]
}

/** The command line a shell is handed by `-c`, `-Command`, `/c` (the rest of its words). */
const nested = (verb: string, args: string[]): string | null => {
  for (let n = 0; n < args.length; n += 1) {
    const low = (args[n] ?? '').toLowerCase()
    if ((verb === 'cmd' && (low === '/c' || low === '/k')) || ((verb === 'powershell' || verb === 'pwsh') && (low === '-command' || low === '-c')) || (['bash', 'sh', 'zsh', 'dash', 'ksh'].includes(verb) && /^-\w*c$/.test(low))) return args.slice(n + 1).join(' ')
  }
  return null
}

/** A46: here-documents read exactly: the terminator is the word itself on a line of its own (leading tabs stripped only
 * for `<<-`); a `<<` inside quotes or after a `#` comment opens none; `<<<` is a here-string. Returns the command lines
 * (bodies removed) and the bodies a shell reads as commands (`bash <<EOF`, `pwsh <<EOF`); any other body is data. */
export const heredocs = (cmd: string): { text: string; fed: string[] } => {
  const lines = cmd.split(/\r?\n/)
  const kept: string[] = []
  const fed: string[] = []
  const queue: Heredoc[] = []
  let body: string[] = []
  for (const line of lines) {
    const open = queue[0]
    if (open) {
      if ((open.tabs ? line.replace(/^\t+/, '') : line) === open.word) {
        if (open.isShell) fed.push(body.join('\n'))
        body = []
        queue.shift()
      } else body.push(line)
      continue
    }
    kept.push(line)
    // The here-documents this line opens, in order, outside quotes and comments.
    let quote = ''
    let cur = ''
    for (let i = 0; i < line.length; i += 1) {
      const c = line[i] ?? ''
      if (quote) {
        if (c === quote) quote = ''
        cur += c
        continue
      }
      if (c === '"' || c === "'") {
        quote = c
        cur += c
        continue
      }
      if (c === '#' && (cur === '' || /\s$/.test(cur))) break
      if (line.startsWith('<<<', i)) {
        i += 2
        cur += '<<<'
        continue
      }
      const m = /^<<(-?)\s*(['"]?)([A-Za-z_][\w.-]*)\2/.exec(line.slice(i))
      if (m) {
        const owner = splitCommands(cur).pop() ?? ''
        const [verb, args] = verbOf(words(owner))
        queue.push({ word: m[3] ?? '', tabs: m[1] === '-', isShell: SHELLS.has(verb) && nested(verb, args) === null })
        i += m[0].length - 1
        cur += ' '
        continue
      }
      if (c === ';' || c === '|' || c === '&') cur = ''
      else cur += c
    }
  }
  return { text: kept.join('\n'), fed }
}

/** One gh call that opens a PR: its words after `gh`, and the folder a `cd` before it moved to. */
export type PrCall = { args: string[]; dir?: string }

const isPr = (args: string[]): boolean => {
  const [sub, act] = [args[0]?.toLowerCase(), args[1]?.toLowerCase()]
  if (sub === 'pr' && act === 'create') return true
  if (sub !== 'api') return false
  const path = args.slice(1).find(a => !a.startsWith('-') && /(^|\/)repos\/[^/]+\/[^/]+\/pulls\/?$/.test(a))
  if (!path) return false
  const method = args.findIndex(a => a === '-X' || a === '--method' || /^--method=|^-X\w/.test(a))
  const m = method >= 0 ? (/^--method=(.+)$/.exec(args[method] ?? '')?.[1] ?? /^-X(\w+)$/.exec(args[method] ?? '')?.[1] ?? args[method + 1] ?? '') : ''
  if (m) return m.toUpperCase() === 'POST'
  return args.some(a => /^(-f|-F|--field|--raw-field|--input)$/.test(a) || /^--(raw-)?field=|^-[fF]\S/.test(a))
}

/** A45: every gh call in a command line that opens a PR, however it is written. */
export const prCalls = (cmd: string, depth = 0): PrCall[] => {
  if (depth > 4) return []
  const { text, fed } = heredocs(cmd)
  const out: PrCall[] = []
  let dir: string | undefined
  for (const seg of splitCommands(text)) {
    const [verb, args] = verbOf(words(seg))
    if (CHDIRS.has(verb)) dir = args.find(a => !a.startsWith('-') && a !== '/d') ?? dir
    else if (verb === 'gh' && isPr(args)) out.push({ args, ...(dir ? { dir } : {}) })
    else if (SHELLS.has(verb)) {
      const inner = nested(verb, args)
      if (inner) out.push(...prCalls(inner, depth + 1).map(c => (c.dir || !dir ? c : { ...c, dir })))
    }
  }
  for (const body of fed) out.push(...prCalls(body, depth + 1))
  return out
}

/** What a PR call names: repository, head and base, the folder, and a reason it cannot be read (a `@file` value). */
export type PrRefsRead = { repo?: string; head?: string; base?: string; dir?: string; problem?: string }

/** A46: the refs from the gh call's own words, every flag form gh accepts: `-R o/r`, `-Ro/r`, `-R=o/r`, `--repo o/r`,
 * `--repo=o/r`, the same for `-H/--head` and `-B/--base`; for `gh api`, the `repos/<o>/<r>/pulls` path and
 * `-f/-F/--field/--raw-field head=… / base=…` in any form (`-F head=x`, `--field=head=x`, `-fhead=x`). A `@file` value
 * cannot be read here: a problem, so the score is "not scored". */
export const prRefs = (call: PrCall): PrRefsRead => {
  const out: PrRefsRead = { ...(call.dir ? { dir: call.dir } : {}) }
  const a = call.args
  const flag = (i: number, short: string, long: string): string | undefined => {
    const w = a[i] ?? ''
    if (w === short || w === long) return a[i + 1]
    if (w.startsWith(`${long}=`)) return w.slice(long.length + 1)
    if (w.startsWith(`${short}=`)) return w.slice(short.length + 1)
    if (w.startsWith(short) && w.length > short.length && !w.startsWith('--')) return w.slice(short.length)
    return undefined
  }
  const field = (i: number): string | undefined => {
    const w = a[i] ?? ''
    if (/^(-f|-F|--field|--raw-field)$/.test(w)) return a[i + 1]
    const m = /^--(?:raw-)?field=(.+)$/.exec(w) ?? /^-[fF](.+)$/.exec(w)
    return m?.[1]
  }
  // `gh pr create` names its refs with flags; `gh api` with its path and fields (its -H is a header, its -F a field).
  const isApi = (a[0] ?? '').toLowerCase() === 'api'
  // gh pr create's other flags that take a value: their value is never read as a flag (a body may start with "-H").
  const VALUED = new Set(['-t', '--title', '-b', '--body', '-F', '--body-file', '-a', '--assignee', '-l', '--label', '-m', '--milestone', '-p', '--project', '-r', '--reviewer', '-T', '--template', '--recover'])
  for (let i = 0; i < a.length; i += 1) {
    if (!isApi && VALUED.has(a[i] ?? '')) {
      i += 1
      continue
    }
    const repo = isApi ? undefined : flag(i, '-R', '--repo')
    const head = isApi ? undefined : flag(i, '-H', '--head')
    const base = isApi ? undefined : flag(i, '-B', '--base')
    const kv = isApi ? field(i) : undefined
    if (repo !== undefined) out.repo = repo
    else if (head !== undefined) out.head = head
    else if (base !== undefined) out.base = base
    else if (kv !== undefined) {
      const m = /^(head|base)=(.*)$/.exec(kv)
      if (m) {
        if ((m[2] ?? '').startsWith('@')) out.problem = `the PR's ${m[1]} is read from a file (${m[2]}), which a5 cannot read before the call`
        else if (m[1] === 'head') out.head = m[2]
        else out.base = m[2]
      }
    } else {
      const api = /^\/?repos\/([^/\s]+\/[^/\s]+)\/pulls\/?$/.exec(a[i] ?? '')
      if (api?.[1]) out.repo = api[1]
    }
  }
  return out
}
