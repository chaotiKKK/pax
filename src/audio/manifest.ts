export type FoundationId = 'civic' | 'hive' | 'dominion' | 'bazaar';

export interface MusicTrack {
  name?: string;
  file?: string;
  stems?: Record<string, string>;
  bpm: number;
  bars: number;
  loop: boolean;
  gainDb: number;
}

export interface MotifTrack {
  file: string;
  bpm: number;
  bars: number;
  loop: boolean;
  gainDb: number;
  theme: FoundationId;
}

export interface SfxDef {
  files: string[];
  bus: 'sfx' | 'ui';
  gainDb: number;
  cooldownMs: number;
}

export interface AudioManifest {
  version: number;
  meta: Record<string, string | number | boolean>;
  music: Record<string, MusicTrack>;
  motifs: Record<string, MotifTrack>;
  sfx: Record<string, SfxDef>;
}

export const FACTION_THEME: Record<string, FoundationId> = {
  concord: 'civic',
  ashani: 'civic',
  drell: 'civic',
  tessen: 'civic',
  quorum: 'civic',
  lumen: 'civic',
  vhel: 'hive',
  myrr: 'hive',
  korrath: 'dominion',
  vaal: 'dominion',
  hollis: 'dominion',
  sable: 'dominion',
  verrick: 'dominion',
  sylith: 'bazaar',
  oryx: 'bazaar',
  nyx: 'bazaar',
};

export function foundationFor(faction: string | null | undefined): FoundationId {
  return (faction && FACTION_THEME[faction]) || 'civic';
}
