import { Icon, TextInput } from "@getpaseo/plugin/client/react-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { type ActKind, type HomeView } from "../shared/contracts";
import { Button, FadeIn, type Kit, PersonName, SectionLabel, personColours } from "./ui";

type WorkList = HomeView["workList"];
type Block = WorkList["groups"][number]["blocks"][number];
type WorkRow = Block["items"][number];
type Run = (kind: ActKind, id: string, text?: string) => void;

const GROUP_ICONS = { mine: "User", issues: "CircleDot", others: "Users" } as const;
// A group of one plain block shows this many rows, and the rest on request.
const GROUP_SHOWN = 4;
// The search goes to the daemon once typing pauses.
const SEARCH_MS = 300;

// What to work on, as server/worklist.ts lays it out: by where it comes from, searched, sorted, the teammates'
// intents grouped by person, area or stage, parked intents folded at each group's end.
export function WorkSection({ kit, view, busy, isSent, run, light }: { kit: Kit; view: HomeView; busy: boolean; isSent: (id: string) => boolean; run: Run; light: boolean }) {
  const { c, s, compact } = kit;
  const list = view.workList;
  const [query, setQuery] = useState(list.query);
  const [focused, setFocused] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Folded groups and blocks keep their heading and count. A block's first state is the server's (startsFolded).
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const search = (text: string) => {
    setQuery(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => run("find", "", text), SEARCH_MS);
  };
  const colourOf = (key: string) => (key === "mine" ? c.accent : key === "issues" ? c.statusWarning : c.statusSuccess);
  // One colour per teammate, from everyone listed (not only what shows), so it holds while searching.
  const peopleColours = personColours(list.people, light);
  const isSearching = list.query !== "";
  const hasOthers = list.groups.some((group) => group.key === "others");
  const toggle = (key: string, initial = false) => setFolded((prev) => ({ ...prev, [key]: !(prev[key] ?? initial) }));
  const row = (one: WorkRow, index: number) => (
    <WorkLine key={one.id} kit={kit} one={one} index={index} quiet={isSent(one.id)} busy={busy} colour={peopleColours[one.who] ?? c.accent} onWho={() => search(one.who)} onPress={() => run("work", one.id)} />
  );

  return (
    <FadeIn delay={160} style={s.section}>
      <SectionLabel kit={kit} text={view.title === "Ather" ? "Pick something" : "Other work"} count={list.total} />

      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.surface2, borderColor: focused ? c.accent : c.border, borderWidth: 1, borderRadius: 8, paddingLeft: 10, minHeight: compact ? 40 : 36 }}>
        <Icon name="Search" size={14} color={c.foregroundMuted} />
        <TextInput
          accessibilityLabel="Search intents and issues"
          placeholder="Search by title, number, area or owner"
          placeholderTextColor={c.foregroundMuted}
          value={query}
          onChangeText={search}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoCapitalize="none"
          autoCorrect={false}
          style={[{ flex: 1, color: c.foreground, fontSize: 14, paddingVertical: 8 }, { outlineStyle: "none" } as object]}
        />
        {query ? <Button kit={kit} variant="ghost" icon="X" accessibilityLabel="Clear search" onPress={() => search("")} /> : null}
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 8, marginBottom: 4 }}>
        <Button kit={kit} variant="ghost" icon="ArrowUpDown" label={`Sort: ${list.sort}`} disabled={busy} onPress={() => run("sort", "")} />
        {hasOthers ? <Button kit={kit} variant="ghost" icon="Group" label={`Group: ${list.groupBy}`} disabled={busy} onPress={() => run("group", "")} /> : null}
        {isSearching ? <Text style={[s.hint, { marginLeft: 4 }]}>{list.shown === 0 ? "Nothing matches." : `${list.shown} of ${list.total}`}</Text> : null}
      </View>

      {list.groups.map((group) => {
        const colour = colourOf(group.key);
        const isFolded = folded[group.key] === true;
        const [only] = group.blocks;
        // One plain block: a few rows, and the rest on request (while searching, every match shows).
        const isShort = group.blocks.length === 1 && only?.kind === "plain" && !isSearching && only.items.length > GROUP_SHOWN && expanded[group.key] !== true;
        let index = 0;
        return (
          <View key={group.key} style={{ marginTop: 12 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${group.title}, ${group.count}`}
              accessibilityState={{ expanded: !isFolded }}
              onPress={() => toggle(group.key)}
              style={({ pressed }) => [
                { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 8, minHeight: compact ? 40 : 34 },
                pressed ? { backgroundColor: c.surface1 } : null,
              ]}
            >
              <Icon name={isFolded ? "ChevronRight" : "ChevronDown"} size={14} color={colour} />
              <Icon name={GROUP_ICONS[group.key]} size={14} color={colour} />
              <Text style={{ flex: 1, color: colour, fontSize: 12, fontWeight: "700", letterSpacing: 1 }}>{group.title.toUpperCase()}</Text>
              {/* The count on a tinted pill: the colour at low strength behind its own number. */}
              <View style={{ minWidth: 26, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, alignItems: "center", overflow: "hidden" }}>
                <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colour, opacity: 0.18 }} />
                <Text style={{ color: colour, fontSize: 12, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{group.count}</Text>
              </View>
            </Pressable>
            {!isFolded ? (
              <FadeIn>
                <View style={{ borderLeftWidth: 2, borderLeftColor: colour, marginLeft: 14, borderRadius: 1 }}>
                  {group.blocks.map((block) => {
                    if (block.kind === "plain") return (isShort ? block.items.slice(0, GROUP_SHOWN) : block.items).map((one) => row(one, index++));
                    // While searching nothing starts folded, so every match shows.
                    const isBlockFolded = !isSearching && (folded[block.key] ?? block.startsFolded);
                    const head =
                      block.kind === "stage" ? (
                        <Text style={[s.subLabel, { paddingHorizontal: 8, marginTop: 6 }]}>{`${block.title.toUpperCase()} · ${block.count}`}</Text>
                      ) : (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${block.title}, ${block.count}`}
                          accessibilityState={{ expanded: !isBlockFolded }}
                          onPress={() => toggle(block.key, block.startsFolded)}
                          style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 6 }, pressed ? { backgroundColor: c.surface1 } : null]}
                        >
                          <Icon name={isBlockFolded ? "ChevronRight" : "ChevronDown"} size={12} color={c.foregroundMuted} />
                          <Text style={[s.subLabel, { flex: 1 }]}>{block.title}</Text>
                          <Text style={[s.hint, { fontVariant: ["tabular-nums"] }]}>{block.count}</Text>
                        </Pressable>
                      );
                    return (
                      <View key={block.key}>
                        {head}
                        {block.kind === "stage" || !isBlockFolded ? <View style={block.kind === "sub" ? { paddingLeft: 10 } : undefined}>{block.items.map((one) => row(one, index++))}</View> : null}
                      </View>
                    );
                  })}
                </View>
                {group.blocks.length === 1 && only?.kind === "plain" && !isSearching && only.items.length > GROUP_SHOWN ? (
                  <View style={{ alignItems: "flex-start", marginLeft: 14 }}>
                    <Button
                      kit={kit}
                      variant="ghost"
                      icon={isShort ? "ChevronDown" : "ChevronUp"}
                      label={isShort ? `More (${only.items.length - GROUP_SHOWN})` : "Fewer"}
                      onPress={() => setExpanded((prev) => ({ ...prev, [group.key]: !prev[group.key] }))}
                    />
                  </View>
                ) : null}
              </FadeIn>
            ) : null}
          </View>
        );
      })}

      {list.shown === 0 && isSearching ? (
        <View style={{ alignItems: "flex-start", marginTop: 4 }}>
          <Button kit={kit} variant="ghost" icon="FilterX" label="Clear search" onPress={() => search("")} />
        </View>
      ) : null}
      {list.groups.some((group) => group.key !== "issues") ? <Text style={[s.hint, { marginTop: 10, paddingHorizontal: 8 }]}>{list.legend}</Text> : null}
    </FadeIn>
  );
}

// One work row's anatomy: stage glyph, title (and a teammate's name), its line, a small progress bar with its
// count, and how long since it changed.
function WorkLine({ kit, one, index, quiet, busy, colour, onWho, onPress }: { kit: Kit; one: WorkRow; index: number; quiet: boolean; busy: boolean; colour: string; onWho: () => void; onPress: () => void }) {
  const { s, c } = kit;
  const [hovered, setHovered] = useState(false);
  const glyphColour = one.stage === "met" ? c.statusSuccess : one.stage === "parked" ? c.foregroundMuted : c.accent;
  return (
    <FadeIn delay={Math.min(index, 10) * 30}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[one.label, one.who, one.total > 0 ? `${one.done} of ${one.total}` : "", one.age ? `changed ${one.age} ago` : ""].filter(Boolean).join(", ")}
        disabled={busy}
        onPress={onPress}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        style={({ pressed }) => [s.row, hovered && !busy ? s.rowHover : null, pressed ? s.rowPressed : null, busy ? { opacity: 0.5 } : null]}
      >
        <Text style={{ width: 14, color: glyphColour, fontSize: 12, textAlign: "center", marginTop: 1 }}>{one.glyph}</Text>
        <View style={s.rowBody}>
          <View style={{ flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", columnGap: 10 }}>
            <Text style={quiet ? [s.rowTitle, { color: c.foregroundMuted, fontWeight: "400" as const }] : s.rowTitle}>{one.label}</Text>
            {one.who ? <PersonName name={one.who} colour={colour} onPress={onWho} /> : null}
          </View>
          {one.hint && one.hint !== one.label ? <Text style={s.hint}>{one.hint}</Text> : null}
          {one.warn ? <Text style={[s.hint, { color: c.statusWarning }]}>{one.warn}</Text> : null}
        </View>
        <View style={{ alignItems: "flex-end", gap: 3, minWidth: 44 }}>
          {one.total > 0 ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <View style={{ width: 28, height: 3, borderRadius: 2, backgroundColor: c.surface2, overflow: "hidden" }}>
                <View style={{ height: 3, width: `${Math.round((100 * one.done) / one.total)}%`, backgroundColor: one.done === one.total ? c.statusSuccess : c.accent }} />
              </View>
              <Text style={[s.hint, { fontVariant: ["tabular-nums"] }]}>{`${one.done}/${one.total}`}</Text>
            </View>
          ) : null}
          {one.age ? <Text style={[s.hint, { fontVariant: ["tabular-nums"] }]}>{one.age}</Text> : null}
        </View>
      </Pressable>
    </FadeIn>
  );
}
