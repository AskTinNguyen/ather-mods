import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";

// One small visual system for the plugin's screens: spacing 4/8/12/16/24/32, five type roles,
// borderless rows, cards only for what is set apart, and three button variants with pressed
// and disabled states. Colours come from the host theme only.

export type Theme = PluginSurfaceProps["theme"];

export function useKit(theme: Theme, compact: boolean) {
  return useMemo(() => {
    const c = theme.colors;
    return {
      c,
      compact,
      mono: Platform.OS === "ios" ? "Menlo" : "monospace",
      s: {
        screen: { flex: 1, backgroundColor: c.surface0 },
        // Padding sits on an inner View (not the scroll container), capped at a readable width.
        content: { width: "100%" as const, maxWidth: 760, padding: compact ? 16 : 24, paddingBottom: 32 },
        brand: { color: c.accent, fontSize: 11, fontWeight: "700" as const, letterSpacing: 1.5 },
        title: { color: c.foreground, fontSize: compact ? 20 : 22, lineHeight: compact ? 26 : 28, fontWeight: "700" as const },
        body: { color: c.foreground, fontSize: 14, lineHeight: 20 },
        rowTitle: { color: c.foreground, fontSize: 14, lineHeight: 20, fontWeight: "600" as const },
        hint: { color: c.foregroundMuted, fontSize: 13, lineHeight: 18 },
        section: { marginTop: compact ? 20 : 28, gap: compact ? 2 : 4 },
        sectionHead: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, marginBottom: 6 },
        label: { color: c.accent, fontSize: 11, fontWeight: "700" as const, letterSpacing: 1.5 },
        subLabel: { color: c.foregroundMuted, fontSize: 11, fontWeight: "700" as const, letterSpacing: 1, marginTop: 8, marginBottom: 2 },
        row: { flexDirection: "row" as const, gap: 10, alignItems: "flex-start" as const, paddingVertical: compact ? 10 : 8, paddingHorizontal: 8, borderRadius: 8, minHeight: compact ? 40 : 36 },
        rowPressed: { backgroundColor: c.surface1 },
        rowIcon: { marginTop: 4 },
        rowBody: { flex: 1, gap: 2 },
        card: { backgroundColor: c.surface1, borderColor: c.border, borderWidth: 1, borderRadius: 10, padding: 12, gap: 8 },
        buttons: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8 },
      },
    };
  }, [theme, compact]);
}

export type Kit = ReturnType<typeof useKit>;

export function SectionLabel({ kit, text, count, children }: { kit: Kit; text: string; count?: number; children?: ReactNode }) {
  const spoken = count ? `${text}, ${count}` : text;
  return (
    <View style={kit.s.sectionHead} accessibilityRole="header" accessibilityLabel={spoken}>
      <Text style={kit.s.label}>{`${text.toUpperCase()}${count ? ` · ${count}` : ""}`}</Text>
      {children}
    </View>
  );
}

type Variant = "primary" | "secondary" | "ghost";

export function Button({
  kit,
  label,
  icon,
  variant = "secondary",
  danger = false,
  full = false,
  disabled = false,
  accessibilityLabel,
  spinning = false,
  onPress,
}: {
  kit: Kit;
  label?: string;
  icon?: string;
  variant?: Variant;
  danger?: boolean;
  full?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  // Turns the icon while work it started is running.
  spinning?: boolean;
  onPress: () => void;
}) {
  const { c, compact } = kit;
  const fg = variant === "primary" ? c.accentForeground : danger ? c.statusDanger : variant === "ghost" ? c.foregroundMuted : c.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={label ? undefined : 8}
      onPress={onPress}
      style={({ pressed }) => [
        {
          flexDirection: "row" as const,
          alignItems: "center" as const,
          justifyContent: "center" as const,
          gap: 6,
          height: compact ? 40 : 36,
          minWidth: label ? undefined : compact ? 40 : 36,
          paddingHorizontal: label ? 12 : 8,
          borderRadius: 8,
        },
        full ? { flexBasis: "100%" as const, flexGrow: 1 } : null,
        variant === "primary" ? { backgroundColor: c.accent } : null,
        variant === "secondary" ? { backgroundColor: c.surface2, borderColor: c.border, borderWidth: 1 } : null,
        pressed && variant === "primary" ? { opacity: 0.85, transform: [{ scale: 0.97 }] } : null,
        pressed && variant !== "primary" ? { backgroundColor: c.surface1, transform: [{ scale: 0.97 }] } : null,
        disabled ? { opacity: 0.5 } : null,
      ]}
    >
      {icon ? (
        <Spin active={spinning}>
          <Icon name={icon} size={label ? 14 : 16} color={fg} />
        </Spin>
      ) : null}
      {label ? <Text style={{ color: fg, fontSize: 13, fontWeight: variant === "primary" ? ("600" as const) : ("500" as const) }}>{label}</Text> : null}
    </Pressable>
  );
}

// A list row: borderless, pressed shows a surface; an optional leading icon sits on the first line.
export function Row({
  kit,
  title,
  hint,
  detail,
  icon,
  iconColor,
  quiet = false,
  trailing,
  disabled = false,
  accessibilityLabel,
  index,
  pulse = false,
  onPress,
}: {
  kit: Kit;
  title: string;
  hint?: string;
  detail?: string;
  icon?: string;
  iconColor?: string;
  quiet?: boolean;
  trailing?: string;
  disabled?: boolean;
  accessibilityLabel?: string;
  // Position in its list: rows cascade in 30ms apart when first shown.
  index?: number;
  // The icon breathes while the row waits on the person.
  pulse?: boolean;
  onPress?: () => void;
}) {
  const { s, c } = kit;
  const body = (
    <>
      {icon ? (
        <View style={s.rowIcon}>
          <Beacon active={pulse} size={12} color={iconColor ?? c.accent} stroke={1.5} maxScale={2.6} duration={4000}>
            <Icon name={icon} size={12} color={iconColor ?? c.accent} />
          </Beacon>
        </View>
      ) : null}
      <View style={s.rowBody}>
        <Text style={quiet ? [s.rowTitle, { color: c.foregroundMuted, fontWeight: "400" as const }] : s.rowTitle}>{title}</Text>
        {hint && hint !== title ? <Text style={s.hint}>{hint}</Text> : null}
        {detail ? <Text style={s.hint}>{detail}</Text> : null}
      </View>
      {trailing ? <Text style={[s.hint, { fontVariant: ["tabular-nums"] }]}>{trailing}</Text> : null}
    </>
  );
  const cascade = (row: ReactNode) => (index === undefined ? row : <FadeIn delay={Math.min(index, 10) * 30}>{row}</FadeIn>);
  if (!onPress) return cascade(<View style={s.row}>{body}</View>);
  return cascade(
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [s.row, pressed ? s.rowPressed : null, disabled ? { opacity: 0.5 } : null]}
    >
      {body}
    </Pressable>,
  );
}

// ---------------------------------------------------------------- motion
// Small and quick: things settle in, never bounce. Everything is still when the system asks for reduced motion.

const NATIVE = Platform.OS !== "web";

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (alive) setReduced(value);
      })
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

// Fades in and rises 6px when first shown; `delay` staggers a list of sections.
export function FadeIn({ children, delay = 0, style }: { children: ReactNode; delay?: number; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) {
      progress.setValue(1);
      return;
    }
    const animation = Animated.timing(progress, { toValue: 1, duration: 360, delay, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE });
    animation.start();
    return () => animation.stop();
  }, [progress, delay, reduced]);
  return (
    <Animated.View style={[style, { opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }]}>{children}</Animated.View>
  );
}

// A slow breathing pulse for what is happening now (the current stage).
export function Pulse({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) {
      value.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: NATIVE }),
        Animated.timing(value, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: NATIVE }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [value, reduced]);
  return (
    <Animated.View style={{ opacity: value.interpolate({ inputRange: [0, 1], outputRange: [1, 0.35] }), transform: [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [1, 1.4] }) }] }}>
      {children}
    </Animated.View>
  );
}

// Rings that expand from `children` and fade out, like a sonar: `count` rings a period apart, so
// there is always one on its way. `size` is the child's box; the rings start at its edge. Still when inactive
// or when the system asks for reduced motion.
export function Beacon({
  children,
  size,
  color,
  active = true,
  count = 1,
  duration = 4800,
  maxScale = 2.8,
  stroke = 2,
}: {
  children: ReactNode;
  size: number;
  color: string;
  active?: boolean;
  count?: number;
  duration?: number;
  maxScale?: number;
  stroke?: number;
}) {
  const reduced = useReducedMotion();
  const phase = useRef(new Animated.Value(0)).current;
  const on = active && !reduced;
  useEffect(() => {
    if (!on) {
      phase.stopAnimation();
      phase.setValue(0);
      return;
    }
    const loop = Animated.loop(Animated.timing(phase, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: NATIVE }));
    loop.start();
    return () => loop.stop();
  }, [phase, duration, on]);
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {on
        ? Array.from({ length: count }, (_, ring) => {
            // Each ring is a step behind the last: the same sweep, shifted by a fraction of the period.
            const progress = Animated.modulo(Animated.add(phase, ring / count), 1);
            return (
              <Animated.View
                key={ring}
                pointerEvents="none"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: size,
                  height: size,
                  borderRadius: size / 2,
                  borderWidth: stroke,
                  borderColor: color,
                  opacity: progress.interpolate({ inputRange: [0, 0.08, 1], outputRange: [0, 0.85, 0] }),
                  transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, maxScale] }) }],
                }}
              />
            );
          })
        : null}
      {children}
    </View>
  );
}

// A bar that fills to `fraction` (0..1) once shown, and eases to new values.
export function FillBar({ kit, fraction }: { kit: Kit; fraction: number }) {
  const reduced = useReducedMotion();
  const target = Math.max(0, Math.min(1, fraction));
  const value = useRef(new Animated.Value(reduced ? target : 0)).current;
  useEffect(() => {
    if (reduced) {
      value.setValue(target);
      return;
    }
    const animation = Animated.timing(value, { toValue: target, duration: 600, delay: 150, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    animation.start();
    return () => animation.stop();
  }, [value, target, reduced]);
  return (
    <View style={{ height: 3, borderRadius: 2, backgroundColor: kit.c.surface2, overflow: "hidden" }}>
      <Animated.View style={{ height: 3, backgroundColor: kit.c.accent, width: value.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }} />
    </View>
  );
}

// Grows from 60% to full size when first shown, after `delay` (the stage circles, one after another).
export function Pop({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const reduced = useReducedMotion();
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) {
      value.setValue(1);
      return;
    }
    const animation = Animated.timing(value, { toValue: 1, duration: 260, delay, easing: Easing.out(Easing.back(1.6)), useNativeDriver: NATIVE });
    animation.start();
    return () => animation.stop();
  }, [value, delay, reduced]);
  return (
    <Animated.View style={{ opacity: value.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] }), transform: [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }}>
      {children}
    </Animated.View>
  );
}

// A line that fills from the left when first shown (`lit`), or stays in the quiet colour.
export function GrowLine({ kit, lit, delay = 0 }: { kit: Kit; lit: boolean; delay?: number }) {
  const reduced = useReducedMotion();
  const value = useRef(new Animated.Value(reduced || !lit ? 1 : 0)).current;
  useEffect(() => {
    if (reduced || !lit) {
      value.setValue(1);
      return;
    }
    value.setValue(0);
    const animation = Animated.timing(value, { toValue: 1, duration: 320, delay, easing: Easing.inOut(Easing.cubic), useNativeDriver: false });
    animation.start();
    return () => animation.stop();
  }, [value, lit, delay, reduced]);
  return (
    <View style={{ flex: 1, height: 2, marginTop: 9, borderRadius: 1, backgroundColor: kit.c.border, overflow: "hidden" }}>
      {lit ? <Animated.View style={{ height: 2, backgroundColor: kit.c.accent, width: value.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }} /> : null}
    </View>
  );
}

// Turns continuously while `active` (the refresh icon while refreshing).
export function Spin({ children, active }: { children: ReactNode; active: boolean }) {
  const reduced = useReducedMotion();
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active || reduced) {
      value.stopAnimation();
      value.setValue(0);
      return;
    }
    const loop = Animated.loop(Animated.timing(value, { toValue: 1, duration: 800, easing: Easing.linear, useNativeDriver: NATIVE }));
    loop.start();
    return () => loop.stop();
  }, [value, active, reduced]);
  return <Animated.View style={{ transform: [{ rotate: value.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }] }}>{children}</Animated.View>;
}

// A number that counts up to `value` when first shown and eases to new values.
export function CountUp({ value, format, style }: { value: number; format: (n: number) => string; style?: StyleProp<import("react-native").TextStyle> }) {
  const reduced = useReducedMotion();
  const anim = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(reduced ? value : 0);
  useEffect(() => {
    if (reduced) {
      setShown(value);
      return;
    }
    const id = anim.addListener(({ value: v }) => setShown(v));
    const animation = Animated.timing(anim, { toValue: value, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    animation.start(() => setShown(value));
    return () => {
      animation.stop();
      anim.removeListener(id);
    };
  }, [anim, value, reduced]);
  return <Text style={style}>{format(shown)}</Text>;
}

// Floats up and down slowly while `active` (a worker that is running).
export function Bob({ children, active }: { children: ReactNode; active: boolean }) {
  const reduced = useReducedMotion();
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active || reduced) {
      value.stopAnimation();
      value.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: NATIVE }),
        Animated.timing(value, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: NATIVE }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [value, active, reduced]);
  return <Animated.View style={{ transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [0, -2.5] }) }] }}>{children}</Animated.View>;
}

// Whether the host theme is light, from its page colour (hex or rgb); dark when it cannot tell.
export function isLight(theme: Theme) {
  const colour = String(theme.colors.surface0);
  const hex = /^#([0-9a-f]{6})/i.exec(colour)?.[1];
  const rgb = hex ? [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16)) : (/rgba?\(([^)]+)\)/i.exec(colour)?.[1] ?? "").split(",").slice(0, 3).map((part) => Number(part.trim()));
  if (rgb.length !== 3 || rgb.some((part) => !Number.isFinite(part))) return false;
  const [r = 0, g = 0, b = 0] = rgb;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150;
}
