export type OverviewPreferences = { threeLine: boolean; detailed: boolean };
export const OVERVIEW_PREFERENCES_KEY = 'overview-auto-generate:v1';
export const DEFAULT_OVERVIEW_PREFERENCES: OverviewPreferences = { threeLine: false, detailed: false };

export function parseOverviewPreferences(value: unknown): OverviewPreferences {
  const input = value && typeof value === 'object' ? value as Partial<OverviewPreferences> : {};
  return { threeLine: input.threeLine === true, detailed: input.detailed === true };
}
function storage() {
  type Area = { get: (key: string) => Promise<Record<string, unknown>>; set: (values: Record<string, unknown>) => Promise<void> };
  const globals = globalThis as typeof globalThis & { browser?: { storage?: { local?: Area } }; chrome?: { storage?: { local?: Area } } };
  const area = globals.browser?.storage?.local ?? globals.chrome?.storage?.local;
  if (!area) throw new Error('Extension local storage is unavailable.');
  return area;
}
export async function loadOverviewPreferences(): Promise<OverviewPreferences> {
  return parseOverviewPreferences((await storage().get(OVERVIEW_PREFERENCES_KEY))[OVERVIEW_PREFERENCES_KEY]);
}
export async function saveOverviewPreferences(value: OverviewPreferences): Promise<void> {
  await storage().set({ [OVERVIEW_PREFERENCES_KEY]: parseOverviewPreferences(value) });
}
