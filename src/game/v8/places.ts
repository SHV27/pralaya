/**
 * Every space on the world map is a PLACE with a name (owner: "a map more than a board, a proper world adventure"). Five per land,
 * in the land's own order (three on the coast road, the pass inland, the inner shrine), plus the Burning Heart at the centre.
 * Names follow the land a petal shows, so a Great Rewire carries a place's name with its land.
 */
import type { WorldId } from './types.ts';

export const PLACES: Readonly<Record<WorldId, readonly string[]>> = {
  india: ['Banyan Gate', 'Monsoon Ghats', 'Peacock Ruins', 'Saffron Steps', 'The Lotus Tank', 'Elephant Stair', 'The Spice Road', 'Cobra Well', 'The Sitar Garden'],
  olympus: ['Storm Stair', 'Marble Agora', 'Thunder Forge', 'The Rainbow Bridge', 'Oracle Peak', 'The Labyrinth Gate', 'Valkyrie Rest', 'Olive Grove', 'The Golden Fleece Tree'],
  cosmos: ['Crater Rim', 'Comet Orchard', 'Lost Observatory', 'The Gravity Well', 'Event Horizon', 'Nebula Steps', 'The Satellite Graveyard', 'Moon Dust Flats', 'The Wormhole Door'],
  pirate: ['Shipwreck Cove', 'Lighthouse Rock', 'Smugglers’ Market', 'Kraken Reef', 'Rum Harbour', 'Skull Island', 'The Mermaid Lagoon', 'Cannon Hill', 'The Treasure Pit'],
  night: ['Hollow Wood', 'Lantern Bog', 'The Bell Tower', 'Crow’s Crossroads', 'The Moonwell', 'The Crypt Path', 'Witch’s Hollow', 'The Whispering Mill', 'Gallows Hill'],
  lost: ['The Tar Pits', 'Frost Ford', 'Mammoth Graveyard', 'Fossil Cliffs', 'The Amber Caves', 'Sabre Ridge', 'The Dodo Meadow', 'Ice Bridge', 'The Moa Nest'],
  toon: ['Candy Square', 'Anvil Alley', 'Crooked Chimneys', 'The Bouncy Bridge', 'Doodle Park', 'The Ink Well', 'Pie Factory', 'The Spring Meadow', 'Banana Peel Lane'],
  wild: ['Croc Creek', 'Vine Falls', 'The Lost Camp', 'Canopy Bridge', 'The Serpent Idol', 'Quicksand Hollow', 'The Hidden Temple', 'Gorilla Rock', 'Firefly Glade'],
};
export const HEART_NAME = 'The Burning Heart';
