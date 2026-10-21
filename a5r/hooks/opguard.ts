// A5R rev 39 (A115, finding F-9): who ends a merge, revert or cherry-pick left half done in the shared checkout (one of
// gitshared's CONFLICT_HEADS). Pure: no `$`; register.ts reads the head file and the owner record, and writes the record.
import { hhmm, type Phase, type SyncFile } from './coord.ts'
import { CONFLICT_HEADS, type HeadFile } from './gitshared.ts'

/** Saved/A5R/head-owner.json: the session that started the operation behind this very head file (its own git command left
 * it) or took it over (/a5r sync takeover). A record for another head file (an older operation) names nobody. */
export const HEAD_OWNER_FILE = 'head-owner.json'
export type HeadOwner = HeadFile & { session: string; id8: string; lane: string; at: number; how: 'started' | 'took over' }
export const headOwner = (h: HeadFile, me: { session: string; id8: string; lane: string }, at: number, how: HeadOwner['how']): HeadOwner =>
  ({ head: h.head, mtimeMs: h.mtimeMs, session: me.session, id8: me.id8, lane: me.lane, at, how })
/** Only A5R writes the record: anything but its full shape is no record. */
export const parseHeadOwner = (text: string | null): HeadOwner | null => {
  try {
    const v = JSON.parse(text ?? '') as Partial<HeadOwner>
    const head = CONFLICT_HEADS.find(x => x === v?.head)
    const { mtimeMs, session, id8, lane, at, how } = v
    return head && typeof mtimeMs === 'number' && typeof session === 'string' && typeof id8 === 'string' && typeof lane === 'string' && typeof at === 'number' && (how === 'started' || how === 'took over')
      ? { head, mtimeMs, session, id8, lane, at, how }
      : null
  } catch {
    return null
  }
}
/** The record names the owner of this very head file (same head, same mtime). */
export const isOwnerOf = (rec: HeadOwner | null, h: HeadFile): rec is HeadOwner => rec !== null && rec.head === h.head && rec.mtimeMs === h.mtimeMs

/** Who may write in the shared checkout while a head file exists, and why: the holder of a sync in its freeze; else the
 * session the owner record names for this very head file; else the last sync's holder (A14 as before 0.23.1). null:
 * nobody known (no sync on file, no record). */
export type Owner = { id8: string; lane: string; why: string }
export const ownerOf = (h: HeadFile, s: SyncFile | null, phase: Phase, rec: HeadOwner | null): Owner | null => {
  if (phase !== 'frozen' && isOwnerOf(rec, h)) return { id8: rec.id8, lane: rec.lane, why: `${rec.lane} ${rec.how} it at ${hhmm(rec.at)}` }
  return s && s.holder.id8 ? { id8: s.holder.id8, lane: s.holder.lane, why: `${s.holder.lane} holds the sync at ${hhmm(s.at)} (${phase})` } : null
}
