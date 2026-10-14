// A63 clean-up, kept by A83: A5R has no decision convention any more (decisions are Ather's), but a session title may
// still carry a mark from before 0.17.0; when Hai types in that session the mark is taken off. Pure: no `$`.

const MARKS = /^\s*(?:\[\s*)?(?:🟥|⏯️|⏯)(?:\s*\])?\s*/u

/** The title without an old leading mark. */
export const bareTitle = (title: string): string => title.replace(MARKS, '').trim()
/** Whether a title still starts with an old mark (only the clean-up reads it). */
export const hasMark = (title: string): boolean => MARKS.test(title)
