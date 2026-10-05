// Small shared helpers: time ranges, interval math, local dates, ISO weeks.

export const HOUR = 3600 * 1000
export const DAY = 24 * HOUR

export const ymd = d =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// The local-time week containing `now`, shifted by `offset` weeks.
export function weekRange(now, weekStart = 'monday', offset = 0) {
  const s = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dow = s.getDay() // 0 = Sunday
  s.setDate(s.getDate() - (weekStart === 'monday' ? (dow + 6) % 7 : dow) + offset * 7)
  const e = new Date(s)
  e.setDate(e.getDate() + 7)
  return { start: s.getTime(), end: e.getTime(), startDate: ymd(s), endDate: ymd(new Date(e.getTime() - 1)) }
}

// ISO 8601 week label ("2026-W40") of the Monday-start week holding `ms` (local time).
export function isoWeekLabel(ms) {
  const d = new Date(ms)
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const n = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - n)
  const y = t.getUTCFullYear()
  const w = Math.ceil(((t - Date.UTC(y, 0, 1)) / DAY + 1) / 7)
  return `${y}-W${String(w).padStart(2, '0')}`
}

// Merge [start, end] intervals; returns a sorted, non-overlapping list.
export function mergeIntervals(intervals) {
  const xs = intervals.filter(([a, b]) => b > a).map(([a, b]) => [a, b]).sort((p, q) => p[0] - q[0])
  const out = []
  for (const [a, b] of xs) {
    const last = out.at(-1)
    if (last && a <= last[1]) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}

export const totalMs = intervals => mergeIntervals(intervals).reduce((n, [a, b]) => n + (b - a), 0)

export function clip(intervals, lo, hi) {
  return intervals.map(([a, b]) => [Math.max(a, lo), Math.min(b, hi)]).filter(([a, b]) => b > a)
}

// Parts of [lo, hi] not covered by `intervals`.
export function complement(intervals, lo, hi) {
  const out = []
  let cur = lo
  for (const [a, b] of mergeIntervals(clip(intervals, lo, hi))) {
    if (a > cur) out.push([cur, a])
    cur = Math.max(cur, b)
  }
  if (hi > cur) out.push([cur, hi])
  return out
}

// `a` minus `b`.
export function subtract(a, b) {
  const bs = mergeIntervals(b)
  const out = []
  for (const [s, e] of mergeIntervals(a)) {
    let cur = s
    for (const [x, y] of bs) {
      if (y <= cur || x >= e) continue
      if (x > cur) out.push([cur, x])
      cur = Math.max(cur, y)
      if (cur >= e) break
    }
    if (cur < e) out.push([cur, e])
  }
  return out
}

export const hours = ms => +(ms / HOUR).toFixed(2)

// Normalize a path as written in a shell command or a log (git-bash /e/x, E:/x, E:\x) to the OS form.
export function normalizePath(p, platform = process.platform) {
  if (!p) return p
  let s = String(p).trim().replace(/^["']|["']$/g, '')
  if (platform === 'win32') {
    const m = s.match(/^\/([a-zA-Z])(\/.*)?$/)
    if (m) s = `${m[1].toUpperCase()}:${m[2] || '/'}`
    s = s.replace(/\//g, '\\')
  }
  return s
}
