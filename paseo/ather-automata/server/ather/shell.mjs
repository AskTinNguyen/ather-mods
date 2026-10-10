// Ather Automata: how a shell command line reads, for every pack. Its commands
// (split outside quotes, heredoc bodies dropped), the folder each runs in, and
// where a push sends. Pure: no `$`.

// A heredoc's body is text being written, not a command being run.
/** @param {string} command */
export const withoutHeredocs = command => command.replace(/<<-?\s*['"]?(\w+)['"]?[\s\S]*?\n\1\b/g, '')

/** @param {string} command */
export const isPiped = command => /\|\s*(tail|head|grep|Select-String|Select-Object|findstr|tee|sls)\b/i.test(command)

// The commands of a chain: split only outside quotes, heredoc bodies dropped, quotes removed.
// `git commit -m "fix; git push origin main"` is one commit command, not a push.
/** @param {string} command */
export const segments = command => {
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
export const withFolders = command => {
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

export const MAIN = /^(?:refs\/heads\/)?(main|master)$/

// A branch name as a profile or a ref gives it; '' when it does not read as one.
/** @param {unknown} value */
export const branchNamed = value => {
  if (typeof value !== 'string') return ''
  const name = value.trim().replace(/^refs\/heads\//, '')
  return name.length <= 100 && /^[A-Za-z0-9._\/-]+$/.test(name) ? name : ''
}

// A branch a team merges into: main, master, or the checkout's own base when it has another (develop).
/** @param {string} branch @param {string} [base] */
export const isBaseBranch = (branch, base = 'main') => MAIN.test(branch) || (branch !== '' && branch.replace(/^refs\/heads\//, '') === base)

// Where a `git push` sends: its refspec's destination, or the current branch when it names none.
/** @param {string} segment @param {string} branch */
export const pushTarget = (segment, branch) => {
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

// A segment with leading env assignments (`FOO=1 BAR=x cmd`) and runners (`npx`, `npm exec`, `pnpm dlx`) taken off.
/** @param {string} segment */
export const bareCommand = segment =>
  segment
    .replace(/^(?:env\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, '')
    .replace(/^(?:npx(?:\s+--yes|\s+-y)?|npm\s+exec(?:\s+--)?|pnpm\s+(?:dlx|exec)|yarn\s+dlx|bunx)\s+/i, '')
    .trim()
