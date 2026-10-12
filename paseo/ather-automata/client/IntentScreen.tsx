import { Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import { Pressable, Text, View } from "react-native";
import { type ActKind, type HomeView } from "../shared/contracts";
import { Button, CHANGE_ICONS, FadeIn, type Kit, Row, SectionLabel, WhoLine } from "./ui";

// An intent opened to look at: where it stands (from its files), its proof (by session), who else tracks it, and
// today's lines. Looking never tracks it; Work on this here does, and the tracked one offers Stop tracking.
// Ask about it, and a press on one of today's lines, ask the agent; nothing is decided or tracked.
export function IntentScreen({ kit, who, intent, busy, isSent, run }: { kit: Kit; who: string; intent: NonNullable<HomeView["intentView"]>; busy: boolean; isSent: (id: string) => boolean; run: (kind: ActKind, id: string, text?: string) => void }) {
  const { s, c, compact } = kit;
  return (
    <ScrollView style={s.screen}>
      <View style={s.content}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Button kit={kit} variant="ghost" icon="ArrowLeft" accessibilityLabel="Back" onPress={() => run("back", "")} />
          <Text style={s.brand}>INTENT</Text>
        </View>
        <WhoLine kit={kit} who={who} />
        <FadeIn>
          <Text style={[s.title, { marginTop: 8 }]}>{intent.slug}</Text>
          <Text style={[s.hint, { marginTop: 4 }]}>{[intent.stage, intent.progress, intent.owner].filter(Boolean).join(" · ")}</Text>
          {intent.goal ? <Text style={[s.body, { marginTop: 10 }]}>{intent.goal}</Text> : null}
          {intent.proof ? <Text style={[s.hint, { marginTop: 8 }]}>{`Proof: ${intent.proof}`}</Text> : null}
          {intent.heldBy ? (
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center", marginTop: 6 }}>
              <Icon name="Users" size={14} color={c.statusWarning} />
              <Text style={[s.hint, { color: c.statusWarning, flex: 1 }]}>{intent.heldBy}</Text>
            </View>
          ) : null}
        </FadeIn>

        <FadeIn delay={60} style={[s.buttons, { marginTop: 16 }]}>
          {intent.isHere ? (
            <Button kit={kit} icon="CircleStop" label="Stop tracking" full={compact} disabled={busy} onPress={() => run("untrack", "")} />
          ) : intent.inCheckout ? (
            <Button kit={kit} variant="primary" icon="Play" label="Work on this here" full={compact} disabled={busy} onPress={() => run("track", intent.slug)} />
          ) : null}
          {/* Asking never needs the folder here: the agent reads it from origin if it must. */}
          <Button kit={kit} variant={intent.inCheckout ? "secondary" : "primary"} icon="MessageCircle" label="Ask about it" full={compact} disabled={busy} onPress={() => run("ask", intent.slug)} />
        </FadeIn>
        {!intent.isHere && !intent.inCheckout ? <Text style={[s.hint, { marginTop: 8 }]}>{`Not in this checkout yet: pull ${intent.base} to work on it here.`}</Text> : null}
        {!intent.isHere && intent.inCheckout ? (
          <Text style={[s.hint, { marginTop: 8 }]}>This agent gets its next step, its proof counts for the intent, and other sessions see you on it. /ather untrack undoes it.</Text>
        ) : null}

        {intent.stands.length > 0 ? (
          <FadeIn delay={75} style={s.section}>
            <SectionLabel kit={kit} text="Where it stands" />
            <View style={{ gap: 4, paddingHorizontal: 8 }}>
              {intent.stands.map((line, index) => (
                <Text key={index} style={[s.body, { fontSize: 13, lineHeight: 18 }]}>
                  {line}
                </Text>
              ))}
              <Text style={s.hint}>From its files; what is met is what progress.md says.</Text>
            </View>
          </FadeIn>
        ) : null}

        {intent.next ? (
          <FadeIn delay={90} style={s.section}>
            <SectionLabel kit={kit} text="Next" />
            <View style={[s.card, { borderColor: c.accent, padding: 0 }]}>
              <Row
                kit={kit}
                icon={isSent(intent.next.id) ? "Check" : "ArrowRight"}
                iconColor={isSent(intent.next.id) ? c.foregroundMuted : c.accent}
                quiet={isSent(intent.next.id)}
                title={intent.next.label}
                hint={intent.next.hint}
                accessibilityLabel={isSent(intent.next.id) ? `${intent.next.label}, sent` : intent.next.label}
                disabled={busy}
                onPress={() => run("next", intent.next?.id ?? "")}
              />
            </View>
          </FadeIn>
        ) : null}

        <FadeIn delay={120} style={s.section}>
          <SectionLabel kit={kit} text="Today" />
          {intent.today.length === 0 ? (
            <Text style={[s.hint, { paddingHorizontal: 8 }]}>Nothing recorded yet today.</Text>
          ) : (
            intent.today.map((one, index) => (
              <FadeIn key={`${index}-${one.time}`} delay={Math.min(index, 10) * 30}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Ask about: ${one.text}`}
                  disabled={busy}
                  onPress={() => run("ask", intent.slug, String(index))}
                  style={({ pressed }) => ({ flexDirection: "row", gap: 10, alignItems: "flex-start", paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, opacity: pressed ? 0.6 : 1 })}
                >
                  <View style={{ marginTop: 3 }}>
                    <Icon name={CHANGE_ICONS[one.kind]} size={12} color={one.kind === "done" ? c.statusSuccess : one.kind === "yours" ? c.accent : c.foregroundMuted} />
                  </View>
                  <Text style={[s.body, { flex: 1, fontSize: 13, lineHeight: 18 }]}>{one.text}</Text>
                  <Text style={[s.hint, { fontVariant: ["tabular-nums"] }]}>{one.time}</Text>
                </Pressable>
              </FadeIn>
            ))
          )}
        </FadeIn>
      </View>
    </ScrollView>
  );
}
