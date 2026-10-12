import { Icon, TextInput } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { type ActKind, type HomeView } from "../shared/contracts";
import { Button, FadeIn, type Kit, PersonName, Row, SectionLabel, personColours } from "./ui";

// What to work on: grouped by where it comes from, searchable, and filtered by when it last moved.
const GROUPS = [
  { key: "mine", title: "Your intents", icon: "User" },
  { key: "issues", title: "Assigned issues", icon: "CircleDot" },
  { key: "others", title: "Teammates' intents", icon: "Users" },
] as const;
const RANGES = [
  { days: 0, label: "Any time" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
] as const;
const GROUP_SHOWN = 4;
const DAY_MS = 86400000;

export function WorkSection({ kit, view, now, busy, isSent, run, light }: { kit: Kit; view: HomeView; now: number; busy: boolean; isSent: (id: string) => boolean; run: (kind: ActKind, id: string) => void; light: boolean }) {
  const { c, s, compact } = kit;
  const [query, setQuery] = useState("");
  const [days, setDays] = useState<number>(0);
  const [focused, setFocused] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Folded groups keep their heading and count; a group's colour is a theme colour, so it holds in light and dark.
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const colourOf = (key: string) => (key === "mine" ? c.accent : key === "issues" ? c.statusWarning : c.statusSuccess);
  // One colour per teammate, chosen from everyone in the list (not just what is showing), so it holds while filtering.
  const peopleColours = personColours(view.work.map((one) => one.owner).filter(Boolean), light);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const isFiltering = words.length > 0 || days > 0;

  // A row matches when every word is in its title or its detail, and (with a range) it moved in that many days.
  // A row with no known date is kept: hiding it would say it is old when nobody knows.
  const matches = (one: HomeView["work"][number]) => {
    const text = `${one.label} ${one.hint ?? ""} ${one.owner}`.toLowerCase();
    if (!words.every((word) => text.includes(word))) return false;
    return days === 0 || one.updatedAt === 0 || now - one.updatedAt <= days * DAY_MS;
  };
  const shown = view.work.filter(matches);
  const total = view.work.length;
  const title = view.title === "Ather" ? "Pick something" : "Other work";

  return (
    <FadeIn delay={160} style={s.section}>
      <SectionLabel kit={kit} text={title} count={total} />

      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.surface2, borderColor: focused ? c.accent : c.border, borderWidth: 1, borderRadius: 8, paddingLeft: 10, minHeight: compact ? 40 : 36 }}>
        <Icon name="Search" size={14} color={c.foregroundMuted} />
        <TextInput
          accessibilityLabel="Search intents and issues"
          placeholder="Search by title, number, area or owner"
          placeholderTextColor={c.foregroundMuted}
          value={query}
          onChangeText={setQuery}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoCapitalize="none"
          autoCorrect={false}
          style={[{ flex: 1, color: c.foreground, fontSize: 14, paddingVertical: 8 }, { outlineStyle: "none" } as object]}
        />
        {query ? <Button kit={kit} variant="ghost" icon="X" accessibilityLabel="Clear search" onPress={() => setQuery("")} /> : null}
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 8, marginBottom: 4 }}>
        <Icon name="CalendarRange" size={14} color={c.foregroundMuted} />
        {RANGES.map((range) => {
          const on = days === range.days;
          return (
            <Pressable
              key={range.days}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={range.days === 0 ? "Any time" : `Changed in the last ${range.days} days`}
              onPress={() => setDays(range.days)}
              style={({ pressed }) => [
                { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1, borderColor: on ? c.accent : c.border, backgroundColor: on ? c.accent : "transparent" },
                pressed && !on ? { backgroundColor: c.surface1 } : null,
              ]}
            >
              <Text style={{ fontSize: 12, fontWeight: on ? "700" : "500", color: on ? c.accentForeground : c.foregroundMuted }}>{range.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {isFiltering ? <Text style={[s.hint, { paddingHorizontal: 2 }]}>{shown.length === 0 ? "Nothing matches." : `${shown.length} of ${total}`}</Text> : null}

      {GROUPS.map((group) => {
        const rows = shown.filter((one) => one.group === group.key);
        if (rows.length === 0) return null;
        const colour = colourOf(group.key);
        const isFolded = folded[group.key] === true;
        // While searching or filtering every match shows; otherwise a few, and the rest on request.
        const isOpen = isFiltering || expanded[group.key] === true;
        const visible = isOpen ? rows : rows.slice(0, GROUP_SHOWN);
        return (
          <View key={group.key} style={{ marginTop: 12 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${group.title}, ${rows.length}`}
              accessibilityState={{ expanded: !isFolded }}
              onPress={() => setFolded((prev) => ({ ...prev, [group.key]: !prev[group.key] }))}
              style={({ pressed }) => [
                { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 8, minHeight: compact ? 40 : 34 },
                pressed ? { backgroundColor: c.surface1 } : null,
              ]}
            >
              <Icon name={isFolded ? "ChevronRight" : "ChevronDown"} size={14} color={colour} />
              <Icon name={group.icon} size={14} color={colour} />
              <Text style={{ flex: 1, color: colour, fontSize: 12, fontWeight: "700", letterSpacing: 1 }}>{group.title.toUpperCase()}</Text>
              {/* The count on a tinted pill: the colour at low strength behind its own number. */}
              <View style={{ minWidth: 26, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, alignItems: "center", overflow: "hidden" }}>
                <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colour, opacity: 0.18 }} />
                <Text style={{ color: colour, fontSize: 12, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{rows.length}</Text>
              </View>
            </Pressable>
            {!isFolded ? (
              <FadeIn>
                {visible.map((one, index) => (
                  <View key={one.id} style={{ borderLeftWidth: 2, borderLeftColor: colour, marginLeft: 14, borderRadius: 1 }}>
                    <Row
                      kit={kit}
                      index={index}
                      title={one.label}
                      hint={one.hint}
                      quiet={isSent(one.id)}
                      disabled={busy}
                      aside={one.owner ? <PersonName name={one.owner} colour={peopleColours[one.owner] ?? c.accent} onPress={() => setQuery(one.owner)} /> : undefined}
                      onPress={() => run("work", one.id)}
                    />
                  </View>
                ))}
                {!isFiltering && rows.length > GROUP_SHOWN ? (
                  <View style={{ alignItems: "flex-start", marginLeft: 14 }}>
                    <Button
                      kit={kit}
                      variant="ghost"
                      icon={isOpen ? "ChevronUp" : "ChevronDown"}
                      label={isOpen ? "Fewer" : `More (${rows.length - GROUP_SHOWN})`}
                      onPress={() => setExpanded((prev) => ({ ...prev, [group.key]: !prev[group.key] }))}
                    />
                  </View>
                ) : null}
              </FadeIn>
            ) : null}
          </View>
        );
      })}

      {shown.length === 0 && isFiltering ? (
        <View style={{ alignItems: "flex-start", marginTop: 4 }}>
          <Button
            kit={kit}
            variant="ghost"
            icon="FilterX"
            label="Clear filters"
            onPress={() => {
              setQuery("");
              setDays(0);
            }}
          />
        </View>
      ) : null}
    </FadeIn>
  );
}
