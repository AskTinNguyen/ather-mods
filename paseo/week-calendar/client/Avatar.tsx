import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { Image, View } from "react-native";
import { weekAvatar } from "../shared/contracts";

// A GitHub avatar, round; an empty circle of the same size while it loads or when there is none.
export function Avatar({ login, size, ring }: { login: string | null | undefined; size: number; ring?: string }) {
  const fetchAvatar = useRpc(weekAvatar);
  const query = useQuery({ queryKey: ["week-calendar", "avatar", login], queryFn: () => fetchAvatar({ login: login ?? "" }), enabled: !!login, staleTime: Infinity, gcTime: Infinity, retry: 1 });
  const uri = query.data?.uri ?? null;
  const frame = { width: size, height: size, borderRadius: size / 2, borderWidth: ring ? 1.5 : 0, borderColor: ring };
  return uri ? <Image source={{ uri }} accessibilityLabel={login ?? undefined} accessibilityIgnoresInvertColors style={frame} /> : <View style={frame} />;
}
