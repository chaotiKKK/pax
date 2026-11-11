import {
  canBuildBuilding,
  canBuildShip,
  colonize,
  diplo,
  orderHalt,
  orderMove,
  planetById,
  queueBuilding,
  queueShip,
} from './sim';
import { TECH_BY_ID } from './data';
import type { Command, Game } from './types';

export interface CommandResult {
  ok: boolean;
  msg: string;
}

/**
 * Single entry point for every order, whether it came from the local UI or from
 * a LAN peer. Ownership is always checked against the acting faction, so a
 * client can never issue orders for somebody else's empire.
 */
export function applyCommand(g: Game, faction: string, cmd: Command): CommandResult {
  const empire = g.empires[faction];
  if (!empire) return { ok: false, msg: 'Unbekannte Macht.' };
  if (!empire.alive) return { ok: false, msg: 'Dieses Reich existiert nicht mehr.' };

  switch (cmd.kind) {
    case 'building': {
      const planet = planetById(g, cmd.planetId);
      if (!planet || planet.owner !== faction) return { ok: false, msg: 'Keine eigene Kolonie.' };
      if (!canBuildBuilding(g, faction, cmd.building)) return { ok: false, msg: 'Technologie fehlt.' };
      return queueBuilding(g, cmd.planetId, cmd.building);
    }
    case 'ship': {
      const planet = planetById(g, cmd.planetId);
      if (!planet || planet.owner !== faction) return { ok: false, msg: 'Keine eigene Kolonie.' };
      if (!canBuildShip(g, faction, cmd.ship)) return { ok: false, msg: 'Technologie fehlt.' };
      return queueShip(g, cmd.planetId, cmd.ship);
    }
    case 'move': {
      const fleet = g.fleets.find((f) => f.id === cmd.fleetId);
      if (!fleet || fleet.owner !== faction) return { ok: false, msg: 'Flotte nicht verfügbar.' };
      return orderMove(g, cmd.fleetId, cmd.target);
    }
    case 'halt': {
      const fleet = g.fleets.find((f) => f.id === cmd.fleetId);
      if (!fleet || fleet.owner !== faction) return { ok: false, msg: 'Flotte nicht verfügbar.' };
      return orderHalt(g, cmd.fleetId);
    }
    case 'colonize': {
      const fleet = g.fleets.find((f) => f.id === cmd.fleetId);
      if (!fleet || fleet.owner !== faction) return { ok: false, msg: 'Flotte nicht verfügbar.' };
      return colonize(g, cmd.fleetId, cmd.planetId);
    }
    case 'research': {
      const def = TECH_BY_ID[cmd.techId];
      if (!def || def.branch !== cmd.branch) return { ok: false, msg: 'Unbekanntes Projekt.' };
      if (empire.techs.includes(cmd.techId)) return { ok: false, msg: 'Bereits abgeschlossen.' };
      empire.active[cmd.branch] = cmd.techId;
      empire.progress[cmd.branch] = 0;
      return { ok: true, msg: `Forschung auf „${def.name}“ umgestellt.` };
    }
    case 'diplo': {
      if (cmd.other === faction) return { ok: false, msg: 'Keine Verhandlung mit sich selbst.' };
      if (!g.empires[cmd.other]?.alive) return { ok: false, msg: 'Diese Macht existiert nicht mehr.' };
      return diplo(g, faction, cmd.other, cmd.action);
    }
    default:
      return { ok: false, msg: 'Unbekannter Befehl.' };
  }
}
