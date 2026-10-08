import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { atherBands } from "../shared/contracts";

const REFRESH_MS = 10000;

// The icon carries the state, so the label stays plain words.
const ICONS = { away: "Moon", review: "ClipboardCheck", tour: "Sparkles", needs: "BellDot", stage: "Compass" } as const;

// The band above the prompt, as a composer pill per agent: what needs you, a running window,
// or where the work is. Hidden outside checkouts that run intents. Pressing it opens the pane.
export function contributePills(client: PluginClientContext): () => void {
  const agents = new Map<string, { workspaceId: string; cwd: string; pill: PluginButtonRegistration }>();
  const lifetime = new AbortController();
  let stopped = false;

  const register = (agent: { id: string; workspaceId?: string | null; cwd?: string | null }) => {
    if (stopped || !agent.workspaceId || !agent.cwd) return;
    agents.get(agent.id)?.pill.remove();
    const workspaceId = agent.workspaceId;
    const agentId = agent.id;
    const pill = client.addComposerPill({
      id: "ather",
      workspaceId,
      agentId,
      button: {
        title: "Ather: what needs you and what is next",
        icon: "Compass",
        label: "Ather",
        visible: false,
        behavior: {
          kind: "action",
          onPress() {
            client.openPanel("ather", { workspaceId, agentId });
          },
        },
      },
    });
    agents.set(agentId, { workspaceId, cwd: agent.cwd, pill });
  };

  const remove = (agentId: string) => {
    agents.get(agentId)?.pill.remove();
    agents.delete(agentId);
  };

  const refresh = async () => {
    if (agents.size === 0) return;
    let bands: Record<string, { label: string; urgent: boolean; kind: keyof typeof ICONS }>;
    try {
      ({ bands } = await client.rpc(atherBands, { agents: [...agents].map(([agentId, one]) => ({ agentId, cwd: one.cwd })) }));
    } catch {
      return; // Host offline or plugin reloading; the next tick tries again.
    }
    for (const [agentId, one] of agents) {
      const band = bands[agentId];
      one.pill.update(band ? { visible: true, label: band.label, icon: ICONS[band.kind] } : { visible: false });
    }
  };

  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      subscription.subscribe({
        snapshot: ({ entries }) => {
          for (const one of agents.values()) one.pill.remove();
          agents.clear();
          for (const { agent } of entries) register(agent);
          void refresh();
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "remove") remove(update.agentId);
          else if (!agents.has(update.agent.id)) {
            register(update.agent);
            void refresh();
          }
        },
      });
      return undefined;
    })
    .catch((error: unknown) => {
      if (!stopped) console.error("[ather] agent observation failed", error);
    });

  const timer = setInterval(() => void refresh(), REFRESH_MS);

  return () => {
    stopped = true;
    lifetime.abort();
    clearInterval(timer);
    for (const one of agents.values()) one.pill.remove();
    agents.clear();
  };
}
