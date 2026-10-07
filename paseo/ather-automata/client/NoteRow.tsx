import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo } from "react";
import { Text, View } from "react-native";
import type { Note } from "../shared/timeline";

// Ather's pop-ups in the agent timeline: a trap with its fix, a held action, a lost merge, a reply.
// The tone colours only the icon and, for warnings, a thin rail, so text keeps its contrast.
export function NoteRow({ item, theme, layout }: PluginTimelineItemProps<Note>) {
  const c = theme.colors;
  const { tone, text } = item.data;
  const look = {
    info: { icon: "Sparkles", color: c.foregroundMuted },
    ok: { icon: "CircleCheck", color: c.statusSuccess },
    warn: { icon: "TriangleAlert", color: c.statusWarning },
    bad: { icon: "OctagonAlert", color: c.statusDanger },
  }[tone];
  const hasRail = tone === "warn" || tone === "bad";
  const styles = useMemo(
    () => ({
      row: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: 8, paddingVertical: layout.compact ? 4 : 6 },
      rail: { width: 2, alignSelf: "stretch" as const, borderRadius: 1, backgroundColor: look.color },
      icon: { marginTop: 2 },
      text: { color: c.foreground, fontSize: 13, lineHeight: 18, flexShrink: 1 },
      label: { color: c.foreground, fontWeight: "600" as const },
    }),
    [c, look.color, layout.compact],
  );
  return (
    <View style={styles.row} accessibilityRole="text" accessibilityLabel={`Ather ${tone === "bad" ? "alert" : tone === "warn" ? "warning" : "note"}: ${text}`}>
      {hasRail ? <View style={styles.rail} /> : null}
      <View style={styles.icon}>
        <Icon name={look.icon} size={14} color={look.color} />
      </View>
      <Text style={styles.text}>
        <Text style={styles.label}>Ather </Text>
        {text}
      </Text>
    </View>
  );
}
