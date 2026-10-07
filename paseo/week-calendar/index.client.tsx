import type { PluginClientContext } from "@getpaseo/plugin/client";
import { weekRule } from "./shared/contracts";
import { SettingsScreen } from "./client/SettingsScreen";
import { WeekSurface } from "./client/WeekSurface";

export default function contribute(client: PluginClientContext) {
  client.addSurface("week", WeekSurface);
  client.addSidebarItem({ id: "week", title: "Week calendar", icon: "CalendarDays", surface: "week" });
  client.addSettingsScreen({ id: "calendar", title: "Week calendar", icon: "CalendarDays", Component: SettingsScreen });
  const removers = [
    // "What did I do this week": hands the weekly-report steps to the agent.
    client.addSlashCommand({
      name: "weekly",
      description: "Week calendar: rebuild this week, write the three-line report, ask the weekly survey",
      argumentHint: "",
      context: "agent",
      async onSubmit({ agent, rpc, paseo }) {
        const { text } = await rpc(weekRule, {});
        await paseo.agents.ref(agent.id).send(text);
      },
    }),
    client.addCommandCenterItem({
      id: "open-week",
      title: "Week calendar",
      icon: "CalendarDays",
      keywords: ["week", "report", "calendar", "productive"],
      context: "global",
      onSelect({ openSurface }) {
        openSurface("week");
      },
    }),
  ];
  return () => {
    for (const remove of removers) remove();
  };
}
