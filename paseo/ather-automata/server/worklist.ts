// The work list as the panel draws it (0.1.5, 0.1.9): grouped by where it comes from, searched, sorted, the
// teammates' intents sub-grouped by person, area or stage, parked intents folded at each group's end, and one
// row anatomy (stage glyph, title, progress, age, owner). The layout is worklist.mjs's; this keeps each
// agent's search, sort and grouping, and maps the result to the contract.

import { WORK_GROUPS, filterWork, workGroup } from "./ather/home.mjs";
import { GROUP_LABELS, LEGEND, SORT_LABELS, STAGE_GLYPHS, ageText, blocksOf, countText, nextGroup, nextSort } from "./ather/worklist.mjs";
import * as state from "./ather/state.mjs";
import type { HomeView } from "../shared/contracts";
import type { Ctx, Pack } from "./lane";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
type Sort = keyof typeof SORT_LABELS;
type GroupBy = keyof typeof GROUP_LABELS;

// Per agent: the words searched, the sort, and the grouping (null until read: the person's stored choice).
const listings = new Map<string, { query: string; sort: Sort; groupBy: GroupBy | null }>();

const listingOf = (agentId: string) => {
  let one = listings.get(agentId);
  if (!one) listings.set(agentId, (one = { query: "", sort: "recent", groupBy: null }));
  return one;
};

async function groupByOf(ctx: Ctx, me: string): Promise<GroupBy> {
  const listing = listingOf(ctx.agent.id);
  listing.groupBy ??= ((await state.readGroupBy(ctx.io as never, me).catch(() => "person")) as GroupBy) ?? "person";
  return listing.groupBy;
}

// Search, Sort and Group: what a press changes, and what is said of it.
export function setSearch(agentId: string, text: string) {
  const listing = listingOf(agentId);
  listing.query = text.trim();
  return listing.query ? `Searching for "${listing.query}".` : "Showing everything.";
}

export function cycleSort(agentId: string) {
  const listing = listingOf(agentId);
  listing.sort = nextSort(listing.sort) as Sort;
  return `Sorted: ${SORT_LABELS[listing.sort]}.`;
}

// The grouping is remembered for the person, as the Claude Code pane does.
export async function cycleGroup(ctx: Ctx, me: string) {
  const listing = listingOf(ctx.agent.id);
  listing.groupBy = nextGroup(await groupByOf(ctx, me)) as GroupBy;
  void state.setGroupBy(ctx.io as never, me, listing.groupBy).catch(() => undefined);
  return `Teammates' intents grouped by ${GROUP_LABELS[listing.groupBy].toLowerCase()}.`;
}

// A row's title and detail: an intent by its folder name, an issue by its label. A teammate's owner is drawn on
// its own (a name chip), so it leaves the detail.
const titleOf = (one: Any) => String(one.kind === "intent" ? one.slug : one.label);
const detailOf = (one: Any) => {
  const detail = String(one.kind === "intent" ? String(one.hint).replace(`${one.slug} · `, "") : one.hint);
  return one.kind === "intent" && !one.isMine && one.owner ? detail.replace(` · ${one.owner}`, "") : detail;
};

const rowOf = (one: Any, now: number) => ({
  id: String(one.id),
  label: titleOf(one),
  hint: detailOf(one),
  kind: String(one.kind),
  glyph: one.stage ? (STAGE_GLYPHS[one.stage as keyof typeof STAGE_GLYPHS] ?? "") : "",
  stage: String(one.stage ?? ""),
  done: Number(one.done) || 0,
  total: Number(one.total) || 0,
  age: ageText(Number(one.updatedAt) || 0, now),
  who: one.kind === "intent" && !one.isMine ? String(one.who || one.owner || "") : "",
  warn: String(one.warn ?? ""),
});

// The list for one agent. `work`: buildHome's, without what Next or the tracked intent already show.
export async function workListOf(ctx: Ctx, me: string, pack: Pack, work: Any[], now: number): Promise<HomeView["workList"]> {
  const listing = listingOf(ctx.agent.id);
  const groupBy = await groupByOf(ctx, me);
  const shown = filterWork(work, listing.query) as Any[];
  const isSearching = listing.query !== "";
  return {
    total: work.length,
    shown: shown.length,
    query: listing.query,
    sort: SORT_LABELS[listing.sort],
    groupBy: GROUP_LABELS[groupBy],
    legend: LEGEND,
    // Everyone listed, not only what shows, so a person keeps their colour while searching.
    people: [...new Set(work.map((one) => rowOf(one, now).who).filter(Boolean))],
    groups: (WORK_GROUPS as readonly { key: "mine" | "issues" | "others"; title: string }[])
      .map(({ key, title }) => {
        const all = work.filter((one) => workGroup(one) === key);
        const list = shown.filter((one) => workGroup(one) === key);
        const blocks = blocksOf(key, list, all, { sort: listing.sort, groupBy, areas: pack.areas ?? [], isSearching }) as Any[];
        return {
          key,
          title,
          count: countText(list.length, all.length, isSearching) as string,
          blocks: blocks.map((block) => ({
            key: String(block.foldKey),
            title: String(block.title),
            kind: block.kind as "sub" | "stage" | "plain",
            count: countText(block.items.length, block.total, isSearching) as string,
            startsFolded: block.startsFolded === true,
            items: block.items.map((one: Any) => rowOf(one, now)),
          })),
        };
      })
      .filter((group) => group.blocks.length > 0),
  };
}
