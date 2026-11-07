import { Preferences } from "@capacitor/preferences";

export async function loadRows() {
  const { value } = await Preferences.get({ key: "rows" });
  try { return value ? JSON.parse(value) : []; } catch { return []; }
}
export const saveRows = (rows) => Preferences.set({ key: "rows", value: JSON.stringify(rows) });
