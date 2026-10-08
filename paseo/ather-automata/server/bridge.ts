// The model's tools, served to Claude agents as an MCP server. Claude starts a small stdio
// script (written to the plugin's data folder) that forwards each call to this plugin over
// localhost with a per-run token; the agent is named by PASEO_AGENT_ID, which Paseo sets.

import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentInfo, knownAgents, type AgentInfo } from "./agents";
import { DATA_DIR, fwd } from "./io";
import { ctxOf, laneOf } from "./lane";
import { callTool, toolList } from "./tools";

export const MCP_NAME = "ather-automata";
export const BRIDGE_SCRIPT = fwd(join(DATA_DIR, "mcp-bridge.mjs"));
const BRIDGE_FILE = join(DATA_DIR, "bridge.json");

const SCRIPT = String.raw`// Ather Automata MCP bridge (written by the Paseo plugin; do not edit).
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
const BRIDGE = ${JSON.stringify(fwd(BRIDGE_FILE))};
const cwd = process.argv[2] || process.env.PASEO_AGENT_CWD || process.cwd();
const agentId = process.env.PASEO_AGENT_ID || "";
const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");
async function ask(path, body) {
  const { port, token } = JSON.parse(readFileSync(BRIDGE, "utf8"));
  const res = await fetch("http://127.0.0.1:" + port + path, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + token },
    body: JSON.stringify({ ...body, agentId, cwd }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "HTTP " + res.status);
  return json;
}
createInterface({ input: process.stdin }).on("line", async (line) => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (m.id === undefined) return;
  try {
    if (m.method === "initialize") {
      send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "ather-automata", version: "0.1.0" } } });
    } else if (m.method === "tools/list") {
      const { tools } = await ask("/tools/list", {});
      send({ jsonrpc: "2.0", id: m.id, result: { tools } });
    } else if (m.method === "tools/call") {
      const { text, isError } = await ask("/tools/call", { name: m.params?.name, arguments: m.params?.arguments ?? {} });
      send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text }], isError: !!isError } });
    } else if (m.method === "ping") {
      send({ jsonrpc: "2.0", id: m.id, result: {} });
    } else {
      send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "Method not found: " + m.method } });
    }
  } catch (error) {
    if (m.method === "tools/call") send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "Ather Automata is not reachable (is the Paseo plugin running?): " + String(error) }], isError: true } });
    else send({ jsonrpc: "2.0", id: m.id, error: { code: -32603, message: String(error) } });
  }
});
`;

// The agent a bridge speaks for: by id, or the newest one Ather knows in that folder.
async function resolveAgent(agentId: string, cwd: string): Promise<AgentInfo | null> {
  if (agentId) {
    const hit = await agentInfo(agentId);
    if (hit) return hit;
  }
  const folder = fwd(cwd).toLowerCase();
  const matches = knownAgents().filter((one) => fwd(one.cwd).toLowerCase() === folder);
  return matches[matches.length - 1] ?? null;
}

export function startBridge(): { close: () => Promise<void> } {
  writeFileSync(join(DATA_DIR, "mcp-bridge.mjs"), SCRIPT);
  const token = randomBytes(24).toString("hex");
  const server: Server = createServer((req, res) => {
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method !== "POST" || req.headers.authorization !== `Bearer ${token}`) return reply(403, { error: "forbidden" });
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", async () => {
      try {
        const body = JSON.parse(raw) as { agentId?: string; cwd?: string; name?: string; arguments?: Record<string, unknown> };
        const agent = await resolveAgent(String(body.agentId ?? ""), String(body.cwd ?? ""));
        if (!agent) return reply(404, { error: "Ather does not know this agent yet." });
        const ctx = ctxOf(agent);
        if (req.url === "/tools/list") return reply(200, { tools: toolList((await laneOf(ctx)).pack) });
        if (req.url === "/tools/call") {
          try {
            return reply(200, { text: await callTool(ctx, String(body.name ?? "").replace(/^mcp__ather-automata__/, ""), body.arguments ?? {}) });
          } catch (error) {
            return reply(200, { text: String(error), isError: true });
          }
        }
        return reply(404, { error: "unknown path" });
      } catch (error) {
        console.error("[ather] bridge request failed:", error);
        return reply(500, { error: String(error) });
      }
    });
  });
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    writeFileSync(BRIDGE_FILE, JSON.stringify({ port, token, pid: process.pid }));
    console.log(`[ather] tool bridge on 127.0.0.1:${port}`);
  });
  return {
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
