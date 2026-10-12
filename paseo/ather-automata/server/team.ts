// The team's intents as origin/main has them (0.1.5; origin/<base> where the team merges into another branch),
// merged with the folders only this checkout has, and the background fetch that keeps origin/<base> fresh: once a
// list is read, then at most every ten minutes, or at once from ↻. The reading and merging are team.mjs's; this
// gives it git and the files, and keeps each checkout's cache and sync state. Every git call reads, never the
// working tree or the index; the fetch writes only the remote-tracking ref.

import { EMPTY_CACHE, GIT_ENV, NO_SYNC, canFetchNow, fetchMain, isFetchDue, readTeam, syncText } from "./ather/team.mjs";
import { list, mtime, readText, run } from "./io";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const caches = new Map<string, Any>();
const syncs = new Map<string, Any>();

const repoOf = (root: string) => ({
  git: async (args: readonly string[], options: { stdin?: string; timeoutMs?: number } = {}) => run(["git", "-C", root, ...args], { cwd: root, env: GIT_ENV, timeoutMs: options.timeoutMs ?? 120000, stdin: options.stdin }),
  read: readText,
  list,
  mtime,
});

// The checkout's intents as files (model.mjs IntentFiles), main's and its own. `pinned` is always read from the checkout.
export async function readTeamIntents(root: string, pinned: string | null, base: string): Promise<Any[]> {
  const team = (await readTeam(repoOf(root), root, { cache: caches.get(root) ?? EMPTY_CACHE, pinned, base })) as Any;
  caches.set(root, team.cache);
  syncs.set(root, { ...(syncs.get(root) ?? NO_SYNC), isRepo: team.isRepo, hasMain: team.cache.main !== null, base });
  return team.intents;
}

// "synced 4 min ago ↻": how fresh the list is ('' outside a git checkout).
export const syncLine = (root: string) => syncText(syncs.get(root) ?? NO_SYNC, Date.now()) as string;

// Fetches origin/<base> when it is due (or at once, `isAsked`: ↻, except after a git lock). `onDone` runs once
// the fetch ended, so the list is read again. False when no fetch started.
export function syncMain(root: string, base: string, onDone: () => Promise<unknown>, isAsked = false): boolean {
  const before = syncs.get(root) ?? NO_SYNC;
  if (!(isAsked ? canFetchNow : isFetchDue)(before, Date.now())) return false;
  syncs.set(root, { ...before, isFetching: true, triedAt: Date.now() });
  void (async () => {
    const { error, lock, moved } = (await fetchMain(repoOf(root), base)) as { error: string; lock: string; moved: boolean };
    console.log(error ? `[ather] ${root}: git fetch failed: ${error}` : `[ather] ${root}: origin/${base} ${moved ? "moved" : "is up to date"}.`);
    syncs.set(root, { ...(syncs.get(root) ?? NO_SYNC), isFetching: false, error, lock, ...(error ? { failedAt: Date.now() } : { fetchedAt: Date.now() }) });
    await onDone().catch(() => undefined);
  })();
  return true;
}
