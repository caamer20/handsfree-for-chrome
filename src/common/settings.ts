import { defaultSettings, settingsSchema, type Settings } from './schema';

/** Upgrade older settings independently so one obsolete field cannot erase preferences. */
export function migrateSettings(value: unknown): Settings {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const next: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(settingsSchema.shape)) {
    const parsed = schema.safeParse(input[key]);
    next[key] = parsed.success ? parsed.data : defaultSettings[key as keyof Settings];
  }
  if (input.aiProvider !== undefined && !settingsSchema.shape.aiProvider.safeParse(input.aiProvider).success) next.aiEnabled = false;
  return settingsSchema.parse(next);
}
