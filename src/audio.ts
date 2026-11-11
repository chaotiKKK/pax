/**
 * Public audio facade. The old procedural engine lived here; the game now uses
 * the bundled, bus-routed asset engine in src/audio/engine.ts.
 */
export { AudioEngine } from './audio/engine';
export { FACTION_THEME, foundationFor } from './audio/manifest';
export type { AudioManifest, FoundationId, MotifTrack, MusicTrack, SfxDef } from './audio/manifest';
