import { Preferences } from "@capacitor/preferences";

const DEFAULTS = { apiKey: "", model: "claude-sonnet-5-5" };

export async function loadRows() {
  const { value } = await Preferences.get({ key: "rows" });
  try { return value ? JSON.parse(value) : []; } catch { return []; }
}
export const saveRows = (rows) => Preferences.set({ key: "rows", value: JSON.stringify(rows) });

export async function loadSettings() {
  const { value } = await Preferences.get({ key: "settings" });
  try { return { ...DEFAULTS, ...(value ? JSON.parse(value) : {}) }; } catch { return { ...DEFAULTS }; }
}
export const saveSettings = (s) => Preferences.set({ key: "settings", value: JSON.stringify(s) });
