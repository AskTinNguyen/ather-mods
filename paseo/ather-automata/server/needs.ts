// Needs you, answered in place (0.2.0): each agent's answering state (decide.mjs AnswerState), the layout the panel
// draws (decide.mjs needsView), and what an answer does to that state. Handing the answer to the agent is
// console.ts's (handOff); this keeps what is opened, unfolded and answered.

import { DECIDED_SHOWN_MS, NONE_OPEN, decidedText, needsView, pruneDecided, withDecided } from "./ather/decide.mjs";
import * as state from "./ather/state.mjs";
import type { HomeView } from "../shared/contracts";
import type { Io } from "./io";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

// The decision pressed open ('' the first that waits, NONE_OPEN none), the intents whose several decisions are
// unfolded, and this agent's answers, newest first.
type Answering = { opened: string; blocks: Set<string>; decided: { id: string; answer: string; at: number }[] };
const answering = new Map<string, Answering>();

const answeringOf = (agentId: string) => {
  let one = answering.get(agentId);
  if (!one) answering.set(agentId, (one = { opened: "", blocks: new Set(), decided: [] }));
  return one;
};

// A Needs you item as the panel draws it.
export const itemRow = (one: Any) => ({ id: one.id, label: one.title || one.label, hint: one.label, detail: one.detail, kind: one.kind });

// What an item is called once answered: "F-10 on fluid-snow-sand-look", or its label.
const answeredName = (one: Any) => String(one.kind === "call" ? (one.question.split(":")[0] ?? one.label) : one.label);

// Opens decision `id` in place ('' or "-": none), and folds or unfolds an intent's several decisions.
export const openDecision = (agentId: string, id: string) => void (answeringOf(agentId).opened = id || NONE_OPEN);
export function toggleBlock(agentId: string, slug: string) {
  const { blocks } = answeringOf(agentId);
  if (!blocks.delete(slug)) blocks.add(slug);
}

// Records an answer: its row shows "✓ Decided" a while, then folds. Returns what settles the item once the row has
// shown (after the agent has it) and what takes the answer back (it never reached the agent).
export function recordAnswer(agentId: string, io: Io, one: Any, answer: string) {
  const answers = answeringOf(agentId);
  answers.opened = "";
  answers.decided = withDecided(answers.decided, { id: one.id, answer, at: Date.now() });
  return {
    settle: async () => void setTimeout(() => void state.settleItem(io as never, one).catch(() => undefined), DECIDED_SHOWN_MS),
    unanswer: async () => void (answers.decided = answers.decided.filter((each) => each.id !== one.id)),
  };
}

// Needs you as decide.mjs lays it out for this agent. Answers are kept until the files read them resolved (the
// call no longer listed); an answer to anything else (a rule) has no file to settle it, so it stays. The panel has
// a text field, so typing is its own.
export function needsOf(agentId: string, built: Any): HomeView["needs"] {
  const answers = answeringOf(agentId);
  const listed = new Set<string>(built.items.map((one: Any) => one.id));
  // The mod prunes against the intent files; the listed items are read from them, so a call no longer listed is resolved.
  answers.decided = pruneDecided(answers.decided, (id: string) => listed.has(id) || !id.startsWith("call:"), Date.now());
  const laid = needsView(built.items, built.open, { opened: answers.opened, typing: "", isFoldOpen: false, decided: answers.decided }, answers.blocks, Date.now(), false);
  const fresh = new Map(laid.fresh.map((one: Any) => [one.id, one.answer]));
  const names = new Map<string, string>(built.items.map((one: Any) => [one.id, answeredName(one)]));
  return {
    open: built.open.filter((one: Any) => one.kind !== "away-end").length,
    decisions: built.open.filter((one: Any) => one.kind === "call").length,
    blocks: laid.blocks.map((block: Any) => ({
      slug: block.slug,
      isOpen: answers.blocks.has(block.slug),
      items: block.items.map((one: Any) => {
        const rowState = laid.states[one.id] ?? "line";
        return {
          ...itemRow(one),
          state: rowState,
          opens: laid.opens.has(one.id),
          decided: rowState === "decided" ? `${decidedText(fresh.get(one.id) ?? "")} · ${answeredName(one)}` : "",
          answers:
            rowState === "opened" && one.answers
              ? { options: one.answers.options.map((option: Any) => ({ letter: option.letter, label: option.label, text: option.text, isRecommended: option.isRecommended === true })), source: String(one.answers.source ?? "") }
              : null,
        };
      }),
    })),
    folded: laid.folded.map((one: Any) => ({ id: one.id, text: `✓ ${names.get(one.id) ?? one.id}: ${one.answer}` })),
  };
}
