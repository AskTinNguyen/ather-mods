// Shape checks for JSON read from files and tool input (a5r-hosts): one definition for every reader. Pure.
export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
export const isStrs = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string')
