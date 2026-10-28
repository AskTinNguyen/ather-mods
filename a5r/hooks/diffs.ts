// The pure helpers of A5R acceptance's PR scoring (moved out of register.ts in rev 42, unchanged): a remote's repository
// (A47 b), one file's part of a whole patch and GitHub's diff shape (A52), a branch diff read in batches (A88 a), and the
// added lines per file. Pure: no `$`; register.ts runs git and gh.

/** A47 (b): a repository's remotes from `git remote -v`. */
export const remotesOf = (text: string): { name: string; url: string }[] =>
  [...new Map(text.split(/\r?\n/).map(l => /^(\S+)\s+(\S+)/.exec(l)).filter((m): m is RegExpExecArray => Boolean(m)).map(m => [m[1] ?? '', { name: m[1] ?? '', url: m[2] ?? '' }])).values()]
/** A47 (b): whether a remote URL is `owner/name` (https, ssh or scp form, with or without .git). */
export const urlIsRepo = (url: string, repo: string): boolean => {
  const u = url.replace(/\.git$/i, '').toLowerCase()
  const r = repo.replace(/\.git$/i, '').toLowerCase()
  return u.endsWith(`/${r}`) || u.endsWith(`:${r}`)
}

/** A52: a PR's diff read from GitHub (`gh pr diff`): its file names, its patch, why it could not be read whole, its head. */
export type GivenDiff = { files: string; patch: string; why: string | null; branch: string }

/** A52: one file's part of a whole patch (`diff --git a/<path> b/<path>` to the next file), or ''. */
export const fileDiff = (patch: string, path: string): string => {
  const parts = patch.replace(/\r/g, '').split(/^(?=diff --git )/m)
  return parts.find(p => p.startsWith('diff --git ') && (p.split('\n')[0] ?? '').endsWith(` b/${path}`)) ?? ''
}

/** A88 (a): the -U0 text of a branch diff read in batches of paths (at most 40 paths or 12,000 characters of them per git
 * call); a batch whose output passes 4 MiB is halved and read again, so only a single file can stay unread: its name is
 * the reason, and the score refuses with it (an unread diff never passes). */
export async function diffInBatches(paths: readonly string[], whole: (args: string[]) => Promise<{ out: string; why: string | null }>, range: string): Promise<{ out: string; why: string | null }> {
  const batches: string[][] = []
  let cur: string[] = []
  let size = 0
  for (const p of paths) {
    if (cur.length >= 40 || size + p.length > 12_000) {
      batches.push(cur)
      cur = []
      size = 0
    }
    cur.push(p)
    size += p.length + 1
  }
  if (cur.length) batches.push(cur)
  const outs: string[] = []
  while (batches.length > 0) {
    const b = batches.shift() ?? []
    const r = await whole(['diff', '-U0', '--no-color', range, '--', ...b])
    if (!r.why) {
      outs.push(r.out)
      continue
    }
    if (!r.why.endsWith('passed 4 MiB')) return { out: '', why: r.why }
    if (b.length === 1) return { out: '', why: `git diff -U0 of ${b[0]} alone passed 4 MiB (split it, or open it in a PR of its own)` }
    batches.unshift(b.slice(0, Math.ceil(b.length / 2)), b.slice(Math.ceil(b.length / 2)))
  }
  return { out: outs.join('\n'), why: null }
}

/** Binaries left out of the added-lines diff (they carry no lines to score and make it big). */
export const BINARY_TYPES = ['uasset', 'umap', 'ubulk', 'uexp', 'png', 'jpg', 'jpeg', 'tga', 'exr', 'hdr', 'psd', 'fbx', 'abc', 'wav', 'ogg', 'mp4', 'dll', 'exe', 'pdb', 'lib', 'zip', '7z']
export const BINARY_EXCLUDES = BINARY_TYPES.map(x => `:(exclude,icase)*.${x}`)
export const BINARY_EXT = new RegExp(`\\.(${BINARY_TYPES.join('|')})$`, 'i')

/** The added lines per file of `git diff -U0`. */
export const addedLines = (diff: string): Map<string, string[]> => {
  const out = new Map<string, string[]>()
  let file = ''
  for (const l of diff.replace(/\r/g, '').split('\n')) {
    if (l.startsWith('+++ ')) file = l.replace(/^\+\+\+ (b\/)?/, '').trim()
    else if (l.startsWith('+') && file && file !== '/dev/null') out.set(file, [...(out.get(file) ?? []), l.slice(1)])
  }
  return out
}
