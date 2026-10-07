import type { PluginClientContext } from "@getpaseo/plugin/client";
import { atherCommand } from "../shared/contracts";

// /ather and /away in the composer, and the pane in the Command Center. The reply lands in the
// agent's timeline and on the pane; the pane opens for anything to pick from.
export function contributeCommands(client: PluginClientContext) {
  const removers = [
    client.addSlashCommand({
      name: "ather",
      description: "Ather Automata: what needs you, and what is next",
      argumentHint: "[tour | skip | pick | issues | issue <number> | role <role> | checked | intent <name>]",
      context: "agent",
      async onSubmit({ args, agent, rpc, openPanel }) {
        openPanel("ather");
        if (args.trim() !== "") await rpc(atherCommand, { agentId: agent.id, cwd: agent.cwd, command: "ather", args });
      },
    }),
    client.addSlashCommand({
      name: "away",
      description: "Ather Automata: going away? hand over with full autonomy, decisions recorded",
      argumentHint: "[tonight | 8h | 30m | until 9am | until done] [goal] | stop",
      context: "agent",
      async onSubmit({ args, agent, rpc, openPanel }) {
        await rpc(atherCommand, { agentId: agent.id, cwd: agent.cwd, command: "away", args });
        if (args.trim() === "") openPanel("ather");
      },
    }),
    client.addCommandCenterItem({
      id: "open-ather",
      title: "Ather: what needs you and what is next",
      icon: "Compass",
      keywords: ["ather", "intent", "next", "away"],
      context: "agent",
      onSelect({ openPanel }) {
        openPanel("ather");
      },
    }),
  ];
  return () => {
    for (const remove of removers) remove();
  };
}
