import type { PluginClientContext } from "@getpaseo/plugin/client";
import { NOTE_KIND, NOTE_VERSION, noteSchema } from "./shared/timeline";
import { AtherPanel } from "./client/AtherPanel";
import { contributeCommands } from "./client/commands";
import { NoteRow } from "./client/NoteRow";
import { contributePills } from "./client/pills";
import { SettingsScreen } from "./client/SettingsScreen";

export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({
    id: "ather",
    title: "Ather",
    icon: "Compass",
    context: "agent",
    locations: ["workspace", "explorer"],
    Component: AtherPanel,
  });
  client.addTimelineRenderer({ kind: NOTE_KIND, version: NOTE_VERSION, schema: noteSchema, Component: NoteRow });
  client.addSettingsScreen({ id: "ather", title: "Ather Automata", icon: "Compass", Component: SettingsScreen });
  const stopCommands = contributeCommands(client);
  const stopPills = contributePills(client);
  return () => {
    stopPills();
    stopCommands();
  };
}
