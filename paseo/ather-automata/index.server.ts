import type { PluginServerContext } from "@getpaseo/plugin/server";
import { atherAct, atherArt, atherBands, atherCommand, atherHome } from "./shared/contracts";
import { atherSettings, type AtherSettings } from "./shared/settings";
import { remember } from "./server/agents";
import { applyAgentConfig } from "./server/agentConfig";
import { startBridge } from "./server/bridge";
import { act, bandOf, homeView, runCommand, type Band } from "./server/console";
import { store } from "./server/io";
import { artFor } from "./server/squad";
import { setSettings } from "./server/settingsState";
import { detectTz, onCreated, onGone, onPermission, onTurnEnded, onTurnStarted, tick } from "./server/watch";

// Ather Automata for Paseo. The original Claude Code mod's two halves, on Paseo's hooks:
// server/watch.ts protects work (holds, the decision ledger, proof from tool output),
// server/console.ts builds what the panel, the pill and /ather show. Both share state only
// through server/ather/state.mjs, as in the original.

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(atherSettings);
  void settings
    .read()
    .then((current) => {
      if (current.status === "ready") setSettings(current.values as AtherSettings);
      else console.error("[ather] settings invalid, using defaults:", current.error);
    })
    .catch((error: unknown) => console.error("[ather] settings read failed, using defaults:", error));
  const stopSettings = settings.subscribe((next) => {
    if (next.status === "ready") setSettings(next.values as AtherSettings);
  });

  const bridge = startBridge();

  server.before("agent.create", ({ request }) => applyAgentConfig(request));
  server.on("agent.created", (event, context) => onCreated(event, context));
  server.on("agent.permission_requested", (event, context) => onPermission(event, context));
  server.on("agent.turn_started", (event, context) => onTurnStarted(event, context));
  server.on("agent.turn_ended", (event, context) => onTurnEnded(event, context));
  server.on("agent.archived", (event) => onGone(event));

  server.handle(atherHome, async ({ agentId, cwd, refresh }, { paseo }) => {
    remember(paseo);
    return homeView(agentId, cwd, refresh === true);
  });
  server.handle(atherAct, async ({ agentId, cwd, kind, id, text }, { paseo }) => {
    remember(paseo);
    return { message: await act(agentId, cwd, kind, id, text) };
  });
  server.handle(atherCommand, async ({ agentId, cwd, command, args }, { paseo }) => {
    remember(paseo);
    return { message: await runCommand(agentId, cwd, command, args) };
  });
  server.handle(atherBands, async ({ agents }, { paseo }) => {
    remember(paseo);
    const bands: Record<string, Band> = {};
    for (const { agentId, cwd } of agents.slice(0, 50)) {
      const band = await bandOf(agentId, cwd).catch(() => null);
      if (band) bands[agentId] = band;
    }
    return { bands };
  });

  server.handle(atherArt, async ({ key }) => ({ uri: await artFor(key) }));

  void detectTz().catch(() => undefined);
  const timer = setInterval(() => void tick().catch(() => undefined), 30000);
  console.log("[ather] Ather Automata started");

  return async () => {
    clearInterval(timer);
    stopSettings();
    await bridge.close();
    store.flush();
  };
}
