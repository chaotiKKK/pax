import { SHIP_CLASSES } from '../../src/data';
import { createGame, emptyHp, emptyShips } from '../../src/galaxy';
import { endCycle, planetById, relationKey } from '../../src/sim';

/**
 * Engine-level regression test: the normal endCycle path must be able to
 * produce a conquest victory by taking the last rival capital. The setup only
 * removes unrelated rivals and places a fleet; the capture, capitulation and
 * victory check all run through the production engine.
 */
const winner = 'concord';
const loser = 'vhel';
const game = createGame(20261111, winner, null, null);

for (const id of Object.keys(game.empires)) {
  if (id === winner || id === loser) continue;
  game.empires[id].alive = false;
  game.empires[id].eliminated = true;
}

const capital = planetById(game, game.empires[loser].capital);
if (!capital) throw new Error('test setup: loser capital is missing');
const system = game.systems[capital.systemId];
if (!system) throw new Error('test setup: loser capital system is missing');
const fleet = game.fleets.find((entry) => entry.owner === winner);
if (!fleet) throw new Error('test setup: winner fleet is missing');

fleet.system = system.id;
fleet.path = [];
fleet.step = 0;
fleet.wait = 0;
fleet.ships = emptyShips();
fleet.hp = emptyHp();
fleet.ships.corvette = 100;
fleet.hp.corvette = 100 * SHIP_CLASSES.corvette.hull;
game.fleets = [fleet];
capital.owner = loser;
capital.siege = 0;
capital.buildings.bastion = 0;
game.states[relationKey(winner, loser)] = 'war';
game.cycle = 1;

endCycle(game, { aiPlayer: true, allVictories: true });

if (game.empires[loser].alive) {
  throw new Error('conquest test: loser survived the capital capture');
}
if (!game.victory || game.victory.faction !== winner) {
  throw new Error(`conquest test: expected winner ${winner}, got ${JSON.stringify(game.victory)}`);
}
if (game.victory.kind !== 'Alleinherrschaft — kein Rivale mehr') {
  throw new Error(`conquest test: unexpected end kind ${game.victory.kind}`);
}
if (capital.owner !== winner) {
  throw new Error(`conquest test: capital owner is ${String(capital.owner)}, expected ${winner}`);
}
console.log(`PASS conquest-engine: ${winner} captured ${loser}'s capital and won by capitulation`);
