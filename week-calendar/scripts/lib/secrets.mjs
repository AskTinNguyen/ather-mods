// Secret scan for reports before they leave the machine: known token shapes are replaced with
// [REDACTED:<kind>] in every string of the report.

export const SECRET_PATTERNS = [
  ['anthropic-key', /sk-ant-[A-Za-z0-9_-]{20,}/g],
  ['openai-key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{30,}/g],
  ['github-pat', /\bgithub_pat_[A-Za-z0-9_]{40,}/g],
  ['aws-key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['google-key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/g],
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ['password', /((?:password|passwd|pwd|secret|api[_-]?key|token)\s*[:=]\s*)(["']?)(?!\[REDACTED)[^\s"',;]{6,}\2/gi],
]

export function redactString(s, counts) {
  let out = s
  for (const [kind, re] of SECRET_PATTERNS) {
    out = out.replace(re, (...m) => {
      counts[kind] = (counts[kind] || 0) + 1
      return kind === 'password' ? `${m[1]}[REDACTED:${kind}]` : `[REDACTED:${kind}]`
    })
  }
  return out
}

// Returns { value, counts }: a deep copy with every string scanned.
export function redact(value) {
  const counts = {}
  const walk = v => {
    if (typeof v === 'string') return redactString(v, counts)
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
    return v
  }
  return { value: walk(value), counts }
}
