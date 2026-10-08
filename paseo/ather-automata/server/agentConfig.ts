import type { PluginBeforeRequests } from "@getpaseo/plugin/server";
// A JSON value, as Paseo's protocol defines it (only host modules may be imported, types included).
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
import { existsSync } from "node:fs";
import { choosePack } from "./ather/packs/index.mjs";
import { BRIDGE_SCRIPT, MCP_NAME } from "./bridge";
import { list, readText, rootOf } from "./io";
import { askRules, heldPrefixes } from "./rules";
import { settings } from "./settingsState";

type CreateRequest = PluginBeforeRequests["agent.create"];
type JsonObject = { [key: string]: JsonValue };

const TOOLS = ["status", "away", "profile"];

const SYSTEM_NOTE = [
  "This checkout runs Ather Automata (a Paseo plugin) for the intent workflow (docs/intent, Plan → Build → Prove → Ship).",
  `Its tools: mcp__${MCP_NAME}__status reads the live lane state (tracked intent and stage, proof read from tool output, peer lanes, the away window and its mandate); read it when you start work here and before any merge.`,
  `mcp__${MCP_NAME}__away opens an autonomy window only when the user says they are going away; mcp__${MCP_NAME}__profile records their role, area or tracked intent.`,
  "While an away window runs, held actions (merges into main, pushes to main and the like) are refused and parked for the user's review, and questions to the user go to the decision ledger instead of waiting: take the recommended option, record it there, and continue.",
].join(" ");

const isObject = (value: JsonValue | undefined): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);
const strings = (value: JsonValue | undefined) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

// Adds ask rules to providerOptions.settings.permissions.ask (Paseo hands it to Claude as --settings).
// Null when the settings are not an inline object and cannot be merged.
function withAskRules(providerOptions: JsonObject | undefined, rules: readonly string[]): JsonObject | null {
  const options = providerOptions ?? {};
  const settings = options.settings ?? {};
  if (!isObject(settings)) return null;
  const permissions = settings.permissions ?? {};
  if (!isObject(permissions)) return null;
  const ask = [...new Set([...strings(permissions.ask), ...rules])];
  return { ...options, settings: { ...settings, permissions: { ...permissions, ask } } };
}

// Whether a folder's checkout runs intents (or names a pack): only those get Ather's tools and rules.
export async function governedRoot(cwd: string): Promise<string | null> {
  const root = await rootOf(cwd);
  return existsSync(`${root}/docs/intent`) || existsSync(`${root}/.ather/profile.json`) ? root : null;
}

export async function applyAgentConfig(request: CreateRequest): Promise<CreateRequest | undefined> {
  const root = await governedRoot(String(request.config.cwd));
  if (!root) return undefined;
  const config = { ...request.config };
  const provider = String(config.provider);

  config.mcpServers = {
    ...config.mcpServers,
    [MCP_NAME]: { type: "stdio", command: "node", args: [BRIDGE_SCRIPT, String(request.config.cwd)] },
  };
  // Ather's own tools never wait for a click.
  const preapproved = config.toolPolicy?.preapproved ?? [];
  config.toolPolicy = {
    ...config.toolPolicy,
    preapproved: [...preapproved.filter((ref) => ref.server !== MCP_NAME), ...TOOLS.map((tool) => ({ kind: "mcp" as const, server: MCP_NAME, tool }))],
  };
  config.systemPrompt = [config.systemPrompt, SYSTEM_NOTE].filter(Boolean).join("\n\n");

  const current = settings();
  if (provider.startsWith("claude") && (current.holdRules || current.briefGate !== "off")) {
    const { pack } = await choosePack({ read: readText, exists: async (path: string) => existsSync(path), list, sessionId: async () => "create" }, root);
    const rules = askRules(current.holdRules ? heldPrefixes(pack) : [], current.briefGate !== "off");
    const providerOptions = withAskRules(config.providerOptions, rules);
    if (providerOptions) config.providerOptions = providerOptions;
    else console.error(`[ather] ${root}: Claude settings are not an inline object; holds rely on Claude asking by itself.`);
  }

  return { ...request, config };
}
