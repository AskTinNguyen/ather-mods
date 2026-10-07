import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { Image, View, type ImageStyle, type StyleProp } from "react-native";
import { atherArt } from "../shared/contracts";

// Pictures come from the daemon as data URIs (plugins cannot draw SVG, and a phone cannot read
// the daemon's files), fetched once per key and kept for the session.
export function useArt(key: string | null) {
  const art = useRpc(atherArt);
  const query = useQuery({
    queryKey: ["ather", "art", key],
    queryFn: () => art({ key: key ?? "" }),
    enabled: key !== null && key !== "",
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  });
  return query.data?.uri ?? null;
}

// An image from useArt; keeps its space while loading so nothing jumps.
export function Art({ artKey, size, round = false, style, label }: { artKey: string | null; size: number | { width: number; height: number }; round?: boolean; style?: StyleProp<ImageStyle>; label?: string }) {
  const uri = useArt(artKey);
  const box = typeof size === "number" ? { width: size, height: size } : size;
  if (!uri) return <View style={[box, round ? { borderRadius: box.width / 2 } : null]} />;
  return (
    <Image
      source={{ uri }}
      accessibilityLabel={label}
      accessibilityIgnoresInvertColors
      resizeMode="contain"
      style={[box, round ? { borderRadius: box.width / 2 } : null, style]}
    />
  );
}
