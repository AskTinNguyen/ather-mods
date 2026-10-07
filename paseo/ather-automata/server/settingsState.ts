import { DEFAULT_SETTINGS, type AtherSettings } from "../shared/settings";

// The host's Ather settings as last read; hooks read them synchronously.
let current: AtherSettings = DEFAULT_SETTINGS;

export const settings = () => current;

export function setSettings(next: AtherSettings) {
  current = { ...DEFAULT_SETTINGS, ...next };
}
