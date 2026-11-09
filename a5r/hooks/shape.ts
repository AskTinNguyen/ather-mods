// Shape checks for JSON read from files and tool input (a5r-hosts): one definition for every reader. Pure.
export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
/** A JSON field as text ('' when it is not text). */
export const textOf = (v: unknown): string => (typeof v === 'string' ? v : '')
export const isStrs = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string')
