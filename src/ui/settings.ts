/**
 * Persistent settings. Audio preferences (enabled, music, sfx) live in the
 * AudioEngine and are already written to localStorage on every change; this
 * module covers the remaining options so they also survive a reload.
 */
export type Quality = 'hoch' | 'mittel' | 'niedrig';

export interface Settings {
  quality: Quality;
}

const KEY = 'pax.settings.v1';

const QUALITIES: Quality[] = ['hoch', 'mittel', 'niedrig'];

export function isQuality(value: unknown): value is Quality {
  return typeof value === 'string' && (QUALITIES as string[]).includes(value);
}

export function loadSettings(): Settings {
  let quality: Quality = 'hoch';
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>;
      if (isQuality(parsed.quality)) quality = parsed.quality;
    }
  } catch {
    /* storage unavailable — defaults apply */
  }
  return { quality };
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable — settings live for this session only */
  }
}
