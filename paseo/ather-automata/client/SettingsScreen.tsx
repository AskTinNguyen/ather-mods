import { useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsSection, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { Text } from "react-native";
import { atherSettings, type AtherSettings } from "../shared/settings";

export function SettingsScreen({ theme }: PluginSurfaceProps) {
  const settings = useSettings(atherSettings);
  if (settings.status !== "ready") {
    return <Text style={{ color: theme.colors.foregroundMuted }}>{settings.status === "loading" ? "Loading…" : `Settings could not be read: ${settings.error}`}</Text>;
  }
  const values = settings.values as AtherSettings;
  const save = (patch: Partial<AtherSettings>) => void settings.save({ ...values, ...patch }, settings.revision);
  return (
    <>
      <SettingsSection title="Guards">
        <SettingsCard>
          <SettingsSelect
            label="Worker brief gate"
            hint="Briefs that lack paths, acceptance checks or the shared-tree rule. Read-only agents (Explore, Plan) are never gated."
            value={values.briefGate}
            options={[
              { label: "Warn: add a note", value: "warn" },
              { label: "Enforce: refuse the Agent call", value: "enforce" },
              { label: "Off", value: "off" },
            ]}
            onValueChange={(briefGate) => save({ briefGate: briefGate as AtherSettings["briefGate"] })}
            disabled={settings.saving}
          />
          <SettingsSwitch
            label="Hold rules for Claude agents"
            hint="New Claude agents in intent checkouts ask before merges, pushes and (web) deploys, so an away window can hold them even in bypass mode. Ather answers those prompts itself."
            value={values.holdRules}
            onValueChange={(holdRules) => save({ holdRules })}
            disabled={settings.saving}
          />
          <SettingsSwitch
            label="Tell the agent at once"
            hint="When a turn's output shows a false build pass or a merge that lost edits, send the agent a follow-up."
            value={values.followUps}
            onValueChange={(followUps) => save({ followUps })}
            disabled={settings.saving}
          />
        </SettingsCard>
      </SettingsSection>
      {settings.saveError ? <Text style={{ color: theme.colors.statusDanger }}>{settings.saveError}</Text> : null}
    </>
  );
}
