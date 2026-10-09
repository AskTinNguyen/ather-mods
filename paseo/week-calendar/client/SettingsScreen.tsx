import { useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsInput, SettingsRow, SettingsSection, SettingsSelect } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Text } from "react-native";
import { calendarSettings, type CalendarSettings } from "../shared/settings";

type TextField = "machineName" | "operator" | "availableHoursPerWeek" | "reportsRepoUrl" | "githubLogin" | "ignoreFolders" | "gitEmails";

const FIELDS: { key: TextField; label: string; hint: string }[] = [
  { key: "machineName", label: "Machine name", hint: "This PC's name in team reports. Empty: the computer name." },
  { key: "operator", label: "Operator", hint: "Who runs this PC. Empty: your global git user.name." },
  { key: "availableHoursPerWeek", label: "Available hours per week", hint: "Hours this PC is available to agents each week; 168 for a dedicated PC." },
  { key: "reportsRepoUrl", label: "Reports repo", hint: "Git URL (or owner/name) of the team's agent-reports repo." },
  { key: "githubLogin", label: "GitHub login", hint: "Tells your merged PRs from teammates' PRs you committed to. Empty: the account gh is signed in as." },
  { key: "ignoreFolders", label: "Ignored folders", hint: "Comma-separated folder fragments whose sessions are left out." },
  { key: "gitEmails", label: "Extra git emails", hint: "Comma-separated commit emails that count as this PC's (e.g. the AI agent account)." },
];

export function SettingsScreen({ theme }: PluginSurfaceProps) {
  const settings = useSettings(calendarSettings);
  const [draft, setDraft] = useState<Record<TextField, string> | null>(null);
  const ready = settings.status === "ready";
  const values = ready ? (settings.values as CalendarSettings) : null;
  useEffect(() => {
    if (values && draft === null) setDraft(Object.fromEntries(FIELDS.map(({ key }) => [key, String(values[key])])) as Record<TextField, string>);
  }, [values, draft]);
  if (!ready || !values || !draft) {
    return (
      <SettingsSection title="Week calendar">
        <SettingsCard>
          <SettingsRow label={settings.status === "loading" || settings.status === "ready" ? "Loading…" : "Settings could not be read"} hint={settings.status === "invalid" || settings.status === "error" ? String(settings.error) : undefined} />
        </SettingsCard>
      </SettingsSection>
    );
  }
  const save = (patch: Partial<CalendarSettings>) => settings.save({ ...values, ...patch }, settings.revision);
  const saveDraft = () => {
    const hours = Number(draft.availableHoursPerWeek);
    void save({ ...draft, availableHoursPerWeek: hours > 0 ? hours : 168 });
  };
  return (
    <>
      <SettingsSection title="Calendar style">
        <SettingsCard>
          <SettingsSelect label="Theme" value={values.theme} options={[{ label: "Dark", value: "dark" }, { label: "Light", value: "light" }]} onValueChange={(theme) => void save({ theme: theme as CalendarSettings["theme"] })} />
          <SettingsSelect label="Colour blocks by" value={values.colorBy} options={[{ label: "Project", value: "project" }, { label: "Task type", value: "task" }]} onValueChange={(colorBy) => void save({ colorBy: colorBy as CalendarSettings["colorBy"] })} />
          <SettingsSelect label="Week starts on" value={values.weekStart} options={[{ label: "Monday", value: "monday" }, { label: "Sunday", value: "sunday" }]} onValueChange={(weekStart) => void save({ weekStart: weekStart as CalendarSettings["weekStart"] })} />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="This PC">
        <SettingsCard>
          {FIELDS.map(({ key, label, hint }) => (
            <SettingsInput key={key} label={label} hint={hint} initialValue={draft[key]} onChangeText={(text) => setDraft({ ...draft, [key]: text })} />
          ))}
          <SettingsAction label="Save" hint="Writes ~/.calendar/config.json for the scripts." actionLabel={settings.saving ? "Saving…" : "Save"} onPress={saveDraft} disabled={settings.saving} />
        </SettingsCard>
      </SettingsSection>
      {settings.saveError ? <Text style={{ color: theme.colors.statusDanger }}>{settings.saveError}</Text> : null}
    </>
  );
}
