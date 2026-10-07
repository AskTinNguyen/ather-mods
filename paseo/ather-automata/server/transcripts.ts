// What Claude Code records about each worker an agent dispatched, read from its own transcript:
// <claude config>/projects/<checkout, dashed>/<session id>/subagents/agent-<id>.jsonl, with a
// .meta.json beside it (type, description, model, toolUseId). The original console.mjs had
// this from the engine; Paseo's timeline does not carry it, so it is read from disk.

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { classifyWorker, modelWord, propForTool } from "./ather/squad.mjs";
import { USER_HOME } from "./io";

export type WorkerRecord = {
  id: string;
  toolUseId: string;
  title: string;
  kind: string;
  model: string;
  state: "running" | "done" | "failed" | "waiting";
  // Props the worker went through, in order, each once in a row (read → edit → build).
  props: string[];
  prop: string | null;
  toolCalls: number;
  startedAt: number;
  endedAt: number;
  outcome: string;
};

// A worker that has written nothing for this long is waiting on something (a prompt, a lock).
const QUIET_MS = 3 * 60 * 1000;

const configDir = () => (process.env.CLAUDE_CONFIG_DIR || `${USER_HOME}/.claude`).split("\\").join("/");
// Claude Code names a project folder after its path: every character that is not a letter or digit becomes "-".
export const projectDir = (cwd: string) => `${configDir()}/projects/${cwd.replace(/[^a-zA-Z0-9]/g, "-")}`;

type Cached = { key: string; record: WorkerRecord };
const cache = new Map<string, Cached>();

// One sentence, no Markdown, short enough for a row.
function sentence(text: string, max = 110) {
  const plain = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*_`#>]+/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  const first = /^(.+?[.!?])(\s|$)/.exec(plain)?.[1] ?? plain;
  return first.length <= max ? first : `${first.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}

// The original kinds (squad.mjs), read from the opening of the brief: a long brief mentions
// everything (verify, test, review) and would read as a reviewer. An intent's worker builds its checklist.
function kindOf(agentType: string, brief: string, description: string): string {
  const kind = classifyWorker({ subagentType: agentType, prompt: brief.slice(0, 400), description }) as string;
  if (kind === "general" && /\bworker for the intent|intent-driven feature|acceptance item/i.test(brief.slice(0, 1500))) return "builder";
  return kind;
}

type Block = { type: string; name?: string; input?: Record<string, unknown>; text?: string };
type Line = { type?: string; timestamp?: string; message?: { model?: string; stop_reason?: string | null; content?: string | Block[] } };

async function readWorker(dir: string, base: string): Promise<WorkerRecord | null> {
  const file = join(dir, `${base}.jsonl`);
  const info = await stat(file).catch(() => null);
  if (!info) return null;
  const key = `${info.mtimeMs}:${info.size}`;
  const hit = cache.get(file);
  if (hit && hit.key === key) return refreshState(hit.record, info.mtimeMs);

  const meta = JSON.parse((await readFile(join(dir, `${base}.meta.json`), "utf8").catch(() => "{}")) || "{}") as {
    agentType?: string;
    description?: string;
    toolUseId?: string;
    model?: string;
  };
  const lines = (await readFile(file, "utf8")).split("\n").filter(Boolean);
  const tools: { name: string; input: Record<string, unknown> }[] = [];
  let model = meta.model ?? "";
  let startedAt = 0;
  let endedAt = 0;
  let lastText = "";
  let handback = "";
  let stoppedAt: string | null = null;
  let firstPrompt = "";
  for (const raw of lines) {
    let line: Line;
    try {
      line = JSON.parse(raw) as Line;
    } catch {
      continue; // a line still being written
    }
    const at = line.timestamp ? Date.parse(line.timestamp) : 0;
    if (at) {
      if (!startedAt) startedAt = at;
      endedAt = at;
    }
    const content = line.message?.content;
    if (line.type === "user" && !firstPrompt && typeof content === "string") firstPrompt = content;
    if (line.type !== "assistant" || !Array.isArray(content)) continue;
    if (line.message?.model && !model) model = line.message.model;
    for (const block of content) {
      if (block.type === "tool_use" && block.name) {
        tools.push({ name: block.name, input: block.input ?? {} });
        if (block.name === "SubagentHandback") handback = String(block.input?.message ?? block.input?.summary ?? "");
      }
      if (block.type === "text" && block.text?.trim()) lastText = block.text;
    }
    stoppedAt = line.message?.stop_reason ?? null;
  }

  const props: string[] = [];
  for (const tool of tools) {
    const prop = propForTool(tool.name, tool.input) as string | null;
    if (prop && props[props.length - 1] !== prop) props.push(prop);
  }
  const last = tools[tools.length - 1];
  const finished = handback !== "" || stoppedAt === "end_turn";
  const failed = /\[Request interrupted|API Error|error_during_execution/i.test(lastText) || (finished && /^(failed|stopped|could not|blocked)\b/i.test(handback.trim()));
  const record: WorkerRecord = {
    id: base.replace(/^agent-/, ""),
    toolUseId: meta.toolUseId ?? "",
    title: (meta.description ?? "").trim() || sentence(firstPrompt, 60) || "Worker",
    // The opening of the brief says what the worker is for; a long brief mentions everything (verify, test, review).
    kind: kindOf(meta.agentType ?? "", firstPrompt, meta.description ?? ""),
    model: model ? (modelWord(model) as string) : "",
    state: failed ? "failed" : finished ? "done" : "running",
    props: props.slice(-6),
    prop: last ? ((propForTool(last.name, last.input) as string | null) ?? props[props.length - 1] ?? null) : null,
    toolCalls: tools.length,
    startedAt,
    endedAt,
    outcome: sentence(handback || lastText),
  };
  cache.set(file, { key, record });
  return refreshState(record, info.mtimeMs);
}

// A worker still "running" but silent for minutes is waiting on something.
function refreshState(record: WorkerRecord, mtimeMs: number): WorkerRecord {
  if (record.state === "running" && Date.now() - Math.max(mtimeMs, record.endedAt) > QUIET_MS) return { ...record, state: "waiting" };
  return record;
}

// Every worker a Claude session dispatched, newest first.
export async function workersOf(cwd: string, sessionId: string): Promise<WorkerRecord[]> {
  const dir = `${projectDir(cwd)}/${sessionId}/subagents`;
  const names = await readdir(dir).catch(() => [] as string[]);
  const out: WorkerRecord[] = [];
  for (const name of names) {
    if (!name.endsWith(".meta.json")) continue;
    const record = await readWorker(dir, name.slice(0, -".meta.json".length)).catch(() => null);
    if (record) out.push(record);
  }
  return out.sort((a, b) => b.startedAt - a.startedAt);
}
