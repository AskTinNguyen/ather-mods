import { TextInput } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { type ActKind, type HomeView } from "../shared/contracts";
import { Button, FadeIn, type Kit, Row, SectionLabel } from "./ui";

type Needs = HomeView["needs"];
type Item = Needs["blocks"][number]["items"][number];
type Run = (kind: ActKind, id: string, text?: string) => void;

// Needs you, answered in place (0.2.0): the server lays it out (decide.mjs needsView); this draws it. A decision
// opens under its row with its whole question, its options as buttons (the recommended one primary), Explain,
// Type an answer and Open findings; an answer shows "✓ Decided" a while, then folds into "▸ N decided".
export function NeedsYou({ kit, needs, open, busy, isSent, run }: { kit: Kit; needs: Needs; open: number; busy: boolean; isSent: (id: string) => boolean; run: Run }) {
  const { s, c, compact } = kit;
  const [isFoldOpen, setFoldOpen] = useState(false);
  let index = 0;
  return (
    <FadeIn delay={40} style={s.section}>
      <SectionLabel kit={kit} text="Needs you" count={open || undefined} />
      {needs.blocks.map((block) => {
        const [only] = block.items;
        if (block.items.length === 1 && only) return <NeedRow key={only.id} kit={kit} one={only} index={index++} busy={busy} isSent={isSent} run={run} />;
        const waits = block.items.some((one) => !isSent(one.id));
        return (
          <View key={`calls:${block.slug}`}>
            <Row
              kit={kit}
              index={index++}
              pulse={waits}
              icon={block.isOpen ? "ChevronDown" : "ChevronRight"}
              iconColor={waits ? c.accent : c.foregroundMuted}
              quiet={!waits}
              title={`${block.slug} · ${block.items.length} decisions`}
              disabled={busy}
              onPress={() => run("calls", block.slug)}
            />
            {block.isOpen ? (
              <View style={{ paddingLeft: 16 }}>
                {block.items.map((one) => (
                  <NeedRow key={one.id} kit={kit} one={one} slug={block.slug} index={index++} busy={busy} isSent={isSent} run={run} />
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
      {needs.folded.length > 0 ? (
        <View style={{ marginTop: 4 }}>
          <Pressable accessibilityRole="button" onPress={() => setFoldOpen(!isFoldOpen)} style={{ paddingVertical: 4, paddingHorizontal: 8 }}>
            <Text style={s.hint}>{`${isFoldOpen ? "▾" : "▸"} ${needs.folded.length} decided`}</Text>
          </Pressable>
          {isFoldOpen
            ? needs.folded.map((one) => (
                <Text key={one.id} style={[s.hint, { paddingLeft: 24, paddingVertical: 2 }]} numberOfLines={1}>
                  {one.text}
                </Text>
              ))
            : null}
        </View>
      ) : null}
      {open > 1 ? (
        <View style={[s.buttons, { marginTop: 6 }]}>
          <Button kit={kit} icon="ListChecks" label={`Go through all ${open}, one at a time`} full={compact} disabled={busy} onPress={() => run("all", "all")} />
        </View>
      ) : null}
    </FadeIn>
  );
}

// One thing that needs you: "✓ Decided" in place, opened with its answers, or its one line. A row that waits for
// an answer opens (or closes) on a press; any other row keeps its own press.
function NeedRow({ kit, one, slug, index, busy, isSent, run }: { kit: Kit; one: Item; slug?: string; index: number; busy: boolean; isSent: (id: string) => boolean; run: Run }) {
  const { s, c } = kit;
  if (one.state === "decided") {
    return <Text style={[s.body, { color: c.statusSuccess, paddingVertical: 6, paddingHorizontal: 8, fontSize: 13 }]}>{one.decided}</Text>;
  }
  const sent = isSent(one.id);
  const isOpened = one.state === "opened" && one.answers !== null;
  const title = slug ? one.label.replace(`${slug} · `, "") : one.label;
  return (
    <View>
      <Row
        kit={kit}
        index={index}
        pulse={!sent}
        icon={sent ? "Check" : isOpened ? "ChevronDown" : "Diamond"}
        iconColor={sent ? c.foregroundMuted : c.accent}
        quiet={sent}
        title={title}
        hint={isOpened ? undefined : one.hint === one.label ? undefined : one.hint}
        detail={isOpened ? undefined : one.detail}
        accessibilityLabel={sent ? `${title}, sent` : title}
        disabled={busy}
        onPress={() => (one.opens ? run("open", isOpened ? "-" : one.id) : run("item", one.id))}
      />
      {isOpened && one.answers ? <Answers kit={kit} one={one} answers={one.answers} busy={busy} run={run} /> : null}
    </View>
  );
}

// The opened decision: its whole question, each option a button, then Explain, Type an answer and Open findings.
function Answers({ kit, one, answers, busy, run }: { kit: Kit; one: Item; answers: NonNullable<Item["answers"]>; busy: boolean; run: Run }) {
  const { s, c } = kit;
  const [isTyping, setTyping] = useState(false);
  const [words, setWords] = useState("");
  const [isSourceOpen, setSourceOpen] = useState(false);
  return (
    <View style={{ paddingLeft: 32, paddingRight: 8, paddingBottom: 8, gap: 6 }}>
      {one.detail ? <Text style={[s.body, { fontSize: 13, lineHeight: 18 }]}>{one.detail}</Text> : null}
      {answers.options.map((option) => (
        <Button
          key={option.letter}
          kit={kit}
          variant={option.isRecommended ? "primary" : "secondary"}
          label={`${option.letter}: ${option.label}${option.isRecommended ? " (recommended)" : ""}`}
          accessibilityLabel={`${option.letter}: ${option.text}`}
          full
          disabled={busy}
          onPress={() => run("answer", one.id, option.letter)}
        />
      ))}
      <View style={[s.buttons, { gap: 6 }]}>
        <Button kit={kit} variant="ghost" icon="MessageCircle" label="Explain" disabled={busy} onPress={() => run("explain", one.id)} />
        <Button kit={kit} variant="ghost" icon="Pencil" label="Type an answer" disabled={busy} onPress={() => setTyping(!isTyping)} />
        {answers.source ? <Button kit={kit} variant="ghost" icon="FileText" label={isSourceOpen ? "Close findings" : "Open findings ›"} onPress={() => setSourceOpen(!isSourceOpen)} /> : null}
      </View>
      {isTyping ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <TextInput
            accessibilityLabel={`Your answer to ${one.label}`}
            placeholder="Your answer, in your words"
            placeholderTextColor={c.foregroundMuted}
            value={words}
            onChangeText={setWords}
            onSubmitEditing={() => words.trim() && run("typed", one.id, words)}
            autoFocus
            style={[{ flex: 1, color: c.foreground, fontSize: 14, paddingVertical: 8, paddingHorizontal: 10, backgroundColor: c.surface2, borderColor: c.accent, borderWidth: 1, borderRadius: 8 }, { outlineStyle: "none" } as object]}
          />
          <Button kit={kit} variant="primary" icon="Send" accessibilityLabel="Send your answer" disabled={busy || !words.trim()} onPress={() => run("typed", one.id, words)} />
        </View>
      ) : null}
      {isSourceOpen ? (
        <View style={[s.card, { padding: 10 }]}>
          <Text style={[s.body, { fontSize: 12, lineHeight: 17 }]} selectable>
            {answers.source}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
