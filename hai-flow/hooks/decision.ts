// 🟥 / ⏯️ markers (human-decision-marker.md): read off the final answer of a turn. Pure: no `$`.
// 🟥 = blocked on Hai, with a default; ⏯️ = this step is done and waits. The title carries the marker.

export type Marker = { kind: 'decision'; question: string; fallback: string } | { kind: 'waiting' } | null

const strip = (s: string): string => s.replace(/^[>\s]+/gm, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim()

export const readMarker = (text: string): Marker => {
  const at = text.search(/🟥\s*\**\s*NEEDS DECISION/i)
  if (at >= 0) {
    const block = text.slice(at).replace(/^🟥\s*\**\s*NEEDS DECISION\**\s*[—–:-]*\s*/i, '')
    const cut = block.search(/(Default if no answer|Mặc định nếu không trả lời|default)\s*:/i)
    const question = strip(cut >= 0 ? block.slice(0, cut) : block.split(/\n\s*\n/)[0] ?? '').replace(/[\s/·|-]+$/, '')
    const fallback = cut >= 0 ? strip((block.slice(cut).replace(/^[^:]*:/, '').split(/\n\s*\n/)[0] ?? '')) : ''
    return { kind: 'decision', question: question.slice(0, 300), fallback: fallback.slice(0, 200) || 'none given' }
  }
  if (/^\s*⏯/m.test(text)) return { kind: 'waiting' }
  return null
}

const MARKS = /^\s*(?:\[\s*)?(?:🟥|⏯️|⏯)(?:\s*\])?\s*/u

/** The title without a leading marker. */
export const bareTitle = (title: string): string => title.replace(MARKS, '').trim()
export const markedTitle = (title: string, mark: '🟥' | '⏯️'): string => `${mark} ${bareTitle(title)}`
export const hasMark = (title: string): boolean => MARKS.test(title)

/** PENDING.md line (human-decision-marker.md:52). */
export const pendingLine = (stamp: string, where: string, question: string, fallback: string): string =>
  `- [ ] ${stamp} · ${where} · ${question} · default: ${fallback}`

/** An intent's findings file (docs/intent/<slug>/findings.md). */
export const isFindingsFile = (path: string): boolean => /(^|\/)docs\/intent\/[^/]+\/findings\.md$/i.test(path.replace(/\\/g, '/'))

/** A findings heading Ather lists under Needs you (model.mjs parseFindings): an open F-<n> owned by the
 * director (or the user, design, production), or a blocking one. */
export const isDirectorCallLine = (line: string): boolean => {
  const m = /^\s*##\s+F[\w-]*\d(.*)$/.exec(line)
  if (!m) return false
  const rest = m[1] ?? ''
  const status = /status:\s*(\w+)(?:\s*\(([^)]*)\))?/i.exec(rest)
  if (status && (status[1] ?? '').toLowerCase() !== 'open') return false
  return /director|producer|design|production|user/i.test(status?.[2] ?? '') || /blocking:\s*yes/i.test(rest)
}

/** True when PENDING.md already has this open question (a decision is asked once). */
export const isPending = (pending: string, question: string): boolean =>
  pending.split(/\r?\n/).some(line => line.startsWith('- [ ]') && line.includes(question.slice(0, 80)))
