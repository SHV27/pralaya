/**
 * PRALAYA's content besides creatures (from research/v8/chief-review-design-v8.md): 12 heroes, 24 fate cards, 8 disasters, 12 riddles,
 * the AMBER boons (by grace only), the Wonders (the heart bet's prize), 4 flips and the verses. Every entry carries an exact effect key
 * that rules.ts implements; the words are for the screen (classy, witty, English).
 */
import type { Gift, Type, WorldId } from './types.ts';
import type { Stat } from './stats.ts';

// ── Heroes: one rule-bending gift + one funny public weakness, both real rules. No gift adds power. ───────────────────────
/** v9 (owner Q9 + follow-up "every 3 turns"): every hero has one ACTIVE power, ready every few turns, used before the roll. */
export type HeroGift =
  | 'measure' //   choose your roll (1–6)
  | 'flex' //      roll, then add 3
  | 'sleep' //     until your next turn, nothing takes your hearts
  | 'twoDice' //   roll two dice, keep either
  | 'dig' //       dig up a creature from the land you stand on
  | 'lions' //     a wild pack attacks a player of your choice
  | 'swapAny' //   swap places with any player, then roll
  | 'jar' //       take a random creature from a player within 3 steps
  | 'switch' //    swap your weakest creature for a rival's random one
  | 'slipper' //   a player of your choice skips their next turn
  | 'moonJump' //  roll, then double it
  | 'plunder'; //  take the top creature from a player within 3 steps
export type HeroWeak =
  | 'measures' //    choosing at a fork costs a step
  | 'showOff' //    a lost wild fight takes his strongest fighter, not his weakest (v16)
  | 'leadsBest' //   your strongest picked creature must stand in lane 1 (shown to PvP rivals)
  | 'victoryNap' //  the turn after a clash you win, draw one fewer fate card
  | 'tellsEveryone' // your unkept fate cards join the next player's draw
  | 'pigDecides' //  at every place a move passes, one in six the pig stops it there (v16)
  | 'showGoesOn' //  a player ending within 1 space of you may pull you into a PvP clash
  | 'riddlesBore' // your riddle choices are made at random
  | 'labels' //      a PvP winner steals from your whole collection
  | 'wanted' //      the world's grudge counts you one heart higher
  | 'badKnees' //    you never move more than 4 steps
  | 'floaty' //      pushes you did not choose carry you 2 steps further
  | 'seasick'; //    you cannot keep a fate card that ends in Pirate Seas
export interface Hero {
  id: string;
  name: string;
  gift: HeroGift;
  giftName: string;
  giftText: string;
  weak: HeroWeak;
  weakName: string;
  weakText: string;
  joke: string;
  art: string;
}
export const HEROES: readonly Hero[] = [
  {
    id: 'hero-geometry',
    name: 'The Geometry Professor',
    gift: 'measure',
    giftName: 'Measure It',
    giftText: "Choose your roll, from 1 to 6.",
    weak: 'measures',
    weakName: 'Measures Twice',
    weakText: 'After a roll, you choose between only two of the places it reaches.',
    joke: 'Measured the angle. Missed the turn.',
    art: 'an absent-minded professor in a tweed jacket with elbow patches, chalk dust on his sleeves, holding a giant brass protractor like a shield, round wire spectacles pushed up on his forehead, mid-stride',
  },
  {
    id: 'hero-strongman',
    name: 'The Mirror Strongman',
    gift: 'flex',
    giftName: 'Flex',
    giftText: "Roll, then add 3, and train a creature: +4 to every number, for good (once each).",
    weak: 'showOff',
    weakName: 'Show-Off',
    weakText: 'Lose a fight against the wild and your strongest fighter falls, not your weakest.',
    joke: 'Flexed at a black hole. It flexed back.',
    art: 'a vain circus strongman in a white toga-style leotard, bald head, curled moustache, flexing one huge arm while admiring himself in a small gilded hand mirror',
  },
  {
    id: 'hero-sleepwalker',
    name: 'The Sleepwalking Prodigy',
    gift: 'sleep',
    giftName: 'Sleep It Off',
    giftText: "Until your next turn, the first heart you would lose is kept.",
    weak: 'victoryNap',
    weakName: 'Victory Nap',
    weakText: 'After a win, your next roll is at most 3.',
    joke: 'Slept through the apocalypse. Twice.',
    art: 'a sleepy child genius in striped blue pyjamas sleepwalking with arms outstretched, a pillow strapped to his back with a belt, one eye half open, holding a thick science book',
  },
  {
    id: 'hero-palmreader',
    name: 'The Palm Reader',
    gift: 'twoDice',
    giftName: 'Saw It Coming',
    giftText: "Roll two dice. Keep either. Recharges every 2 turns.",
    weak: 'tellsEveryone',
    weakName: 'Tells Everyone',
    weakText: 'Every chance card you draw, the next player draws too.',
    joke: 'Read your future. Told the whole street.',
    art: 'a theatrical fortune teller in a fringed velvet shawl and stacks of silver bangles, peering through a large brass magnifying glass at an open palm, a crystal pendant',
  },
  {
    id: 'hero-baron',
    name: 'The Truffle Baron',
    gift: 'dig',
    giftName: 'The Pig Digs',
    giftText: "Dig up a creature from this land.",
    weak: 'pigDecides',
    weakName: 'The Pig Decides',
    weakText: 'At every place your move passes, the pig may stop you there (one in six).',
    joke: 'The pig decides. The Baron agrees.',
    art: 'a pompous aristocrat in a burgundy velvet coat and a monocle, top hat, holding the leash of a determined little truffle pig that is pulling him forward',
  },
  {
    id: 'hero-ringmaster',
    name: 'The Ringmaster',
    gift: 'lions',
    giftName: 'Release the Lions',
    giftText: "A wild pack attacks the rival you choose. If it wins, one of its beasts stays with you. Recharges every 2 turns.",
    weak: 'showGoesOn',
    weakName: 'The Show Must Go On',
    weakText: 'Anyone ending next to you may challenge you.',
    joke: 'Tamed a lion. The lion wants a refund.',
    art: 'a dramatic circus ringmaster in a red-and-gold striped tailcoat, holding a brass megaphone and a wooden chair raised like a shield, confident grin',
  },
  {
    id: 'hero-escapologist',
    name: 'The Escapologist',
    gift: 'swapAny',
    giftName: 'Not Here, Over There',
    giftText: "Swap places with anyone, then roll.",
    weak: 'riddlesBore',
    weakName: 'Riddles Bore Him',
    weakText: 'He answers riddles with his eyes shut.',
    joke: 'Escaped everything. Except his own trunk.',
    art: 'a dashing escape artist wrapped in loose iron chains with a padlock necklace, climbing out of an old leather travel trunk, smug expression, vintage stage costume',
  },
  {
    id: 'hero-jars',
    name: 'The Jar Collector',
    gift: 'jar',
    giftName: 'One More Jar',
    giftText: "Jar a random creature from a rival within 3 steps (roll 3+ or the jar shatters).",
    weak: 'labels',
    weakName: 'Labels Everything',
    weakText: 'A rival who beats you steals from all you hold.',
    joke: 'Labelled the jar. Lost the jar.',
    art: 'an eager naturalist in a khaki pith helmet with a belt of twelve labelled glass jars and a long butterfly net, magnifying monocle, field notebook',
  },
  {
    id: 'hero-salesman',
    name: 'The Snake-Oil Salesman',
    gift: 'switch',
    giftName: 'Bait and Switch',
    giftText: "Swap your weakest creature for a random one of a rival's.",
    weak: 'wanted',
    weakName: 'WANTED',
    weakText: 'Lose a duel and the winner takes two of your creatures, not one.',
    joke: 'Sold a black hole a vacuum cleaner.',
    art: 'a fast-talking travelling salesman in a frontier frock coat and bowler hat, holding open a wooden case of glowing coloured tonic bottles, wide salesman grin',
  },
  {
    id: 'hero-grandmother',
    name: 'The Grandmother with the Slipper',
    gift: 'slipper',
    giftName: 'The Slipper',
    giftText: "The rival you choose skips their next turn.",
    weak: 'badKnees',
    weakName: 'Bad Knees',
    weakText: 'You never move more than four steps.',
    joke: 'Chased a dinosaur. Slipper first.',
    art: 'a fearless little grandmother in a knitted shawl and reading glasses on a chain, one fluffy slipper raised high like a weapon, stern loving glare',
  },
  {
    id: 'hero-astronaut',
    name: 'The Astronaut on the Wrong Planet',
    gift: 'moonJump',
    giftName: 'Moon Jump',
    giftText: "Roll, then double it. Land on a 5 or 6 and a creature rides the star down with you. Recharges every 2 turns.",
    weak: 'floaty',
    weakName: 'Floaty',
    weakText: 'Unwanted pushes carry you two steps further.',
    joke: 'Planted his flag. Wrong planet. Again.',
    art: 'a confused retro astronaut in a white puffy spacesuit with a round fishbowl helmet, planting a small flag, holding a tin lunch box, looking around lost',
  },
  {
    id: 'hero-captain',
    name: 'The Seasick Pirate Captain',
    gift: 'plunder',
    giftName: 'Plunder',
    giftText: "Grab a creature, blind, from a rival within 2 steps.",
    weak: 'seasick',
    weakName: 'Seasick',
    weakText: 'Ending a move in Pirate Seas costs a creature overboard.',
    joke: 'Captain of seven seas. Sick on all.',
    art: 'a grand pirate captain in an enormous feathered tricorn hat and long navy coat, face visibly green with seasickness, clutching a wooden bucket, sword at his hip',
  },
];

// ── Fate cards: draw two, keep one. Every card shows its ghost trail before the pick. ───────────────────────────────────
export type FateFx =
  | {
      k: 'move';
      steps: number;
      /** The player chooses the number of steps in [min, steps]. */
      min?: number;
      rule?: 'leftChooses' | 'backward' | 'outerRing' | 'inward' | 'toUnseen' | 'leaveWorld' | 'chord';
      /** Next turn you draw one card (the comet). */
      slow?: boolean;
    }
  | { k: 'portal'; to: 'named' | 'elsewhere' | 'inner' | 'mirror' }
  | { k: 'unleash' }
  | { k: 'swap' }
  | { k: 'parrot' }
  | { k: 'sky' }
  | { k: 'unknown' }
  | { k: 'jar' }
  | { k: 'tea' };
export type FateKind = 'story' | 'portal' | 'nasty' | 'gamble' | 'quiet';
export interface Fate {
  id: string;
  kind: FateKind;
  text: string;
  /** The effect in four words (under the card). */
  how: string;
  fx: FateFx;
}
export const FATES: readonly Fate[] = [
  {
    id: 'monsoon',
    kind: 'story',
    text: 'A monsoon carries you downstream. Mind the rocks.',
    how: 'Move 4',
    fx: { k: 'move', steps: 4 },
  },
  {
    id: 'luggage',
    kind: 'story',
    text: 'An elephant mistakes you for luggage.',
    how: 'Move 6',
    fx: { k: 'move', steps: 6 },
  },
  {
    id: 'footprints',
    kind: 'story',
    text: 'Follow the glowing footprints. Probably fine.',
    how: 'Move 1 to 3',
    fx: { k: 'move', steps: 3, min: 1 },
  },
  {
    id: 'moa',
    kind: 'story',
    text: 'A moa bolts with you. Steering optional.',
    how: 'Move 5 · your left steers',
    fx: { k: 'move', steps: 5, rule: 'leftChooses' },
  },
  {
    id: 'upside',
    kind: 'story',
    text: 'The map was upside down all along.',
    how: 'Move 3 back',
    fx: { k: 'move', steps: 3, rule: 'backward' },
  },
  {
    id: 'ghostship',
    kind: 'story',
    text: 'A ghost ship offers a lift. No questions.',
    how: 'Up to 5 on the outer ring',
    fx: { k: 'move', steps: 5, min: 1, rule: 'outerRing' },
  },
  {
    id: 'drums',
    kind: 'story',
    text: 'The drums call you to the fire.',
    how: 'Up to 3 inward',
    fx: { k: 'move', steps: 3, min: 1, rule: 'inward' },
  },
  {
    id: 'sniff',
    kind: 'story',
    text: 'Your creature sniffs something. It drools.',
    how: 'To the nearest unknown',
    fx: { k: 'move', steps: 4, rule: 'toUnseen' },
  },
  {
    id: 'yawn',
    kind: 'story',
    text: 'Something enormous yawned behind you. Run.',
    how: 'Move 5 · leave this world',
    fx: { k: 'move', steps: 5, rule: 'leaveWorld' },
  },
  {
    id: 'slide',
    kind: 'story',
    text: 'A slide appears from nowhere. Enjoy it.',
    how: 'Move 4',
    fx: { k: 'move', steps: 4 },
  },
  {
    id: 'comet',
    kind: 'story',
    text: 'Hitch a ride on a passing comet.',
    how: 'Move 7 · one card next turn',
    fx: { k: 'move', steps: 7, slow: true },
  },
  {
    id: 'twist',
    kind: 'story',
    text: 'Take the twisting road. Trust the twist.',
    how: 'Up to 4 · take the bridge',
    fx: { k: 'move', steps: 4, min: 1, rule: 'chord' },
  },
  {
    id: 'sleepwalk',
    kind: 'story',
    text: 'Sleepwalk two steps. Wake up confused.',
    how: 'Move 2',
    fx: { k: 'move', steps: 2 },
  },
  {
    id: 'treedoor',
    kind: 'portal',
    text: 'A door in a tree. Naturally.',
    how: 'Portal to a named world',
    fx: { k: 'portal', to: 'named' },
  },
  {
    id: 'hiccup',
    kind: 'portal',
    text: 'The black hole hiccups. You are elsewhere.',
    how: 'Portal to another world',
    fx: { k: 'portal', to: 'elsewhere' },
  },
  {
    id: 'milkyway',
    kind: 'portal',
    text: 'Wrong turn at the Milky Way.',
    how: 'Portal to the inner ring',
    fx: { k: 'portal', to: 'inner' },
  },
  {
    id: 'mirror',
    kind: 'portal',
    text: 'Step through the mirror. Mind your reflection.',
    how: 'Portal across the mandala',
    fx: { k: 'portal', to: 'mirror' },
  },
  {
    id: 'welcome',
    kind: 'nasty',
    text: 'Send someone a welcome party.',
    how: 'A wild team hits a friend',
    fx: { k: 'unleash' },
  },
  {
    id: 'monkeys',
    kind: 'nasty',
    text: 'The monkeys rearrange the guests.',
    how: 'Swap places with anyone',
    fx: { k: 'swap' },
  },
  {
    id: 'parrot',
    kind: 'nasty',
    text: 'Your parrot has defected. Settle it.',
    how: 'Duel a friend · no hearts',
    fx: { k: 'parrot' },
  },
  {
    id: 'sky',
    kind: 'nasty',
    text: 'Point at the hungry sky.',
    how: 'Name the next world eaten',
    fx: { k: 'sky' },
  },
  {
    id: 'unknown',
    kind: 'gamble',
    text: 'Step into the unknown. Hum bravely.',
    how: 'Somewhere unknown · a coin',
    fx: { k: 'unknown' },
  },
  {
    id: 'jar',
    kind: 'gamble',
    text: 'A stranger offers a sealed jar.',
    how: 'A creature · or a loss',
    fx: { k: 'jar' },
  },
  {
    id: 'tea',
    kind: 'quiet',
    text: 'Tea. Even the apocalypse can wait.',
    how: 'Stay · your ground holds',
    fx: { k: 'tea' },
  },
];

// ── World disasters: dodge with a type in your collection or a map gift (a gift tires its creature) ───────────────────────
export type DisasterFx =
  | 'washInward3'
  | 'stoneStrongest'
  | 'pullCentre2'
  | 'dragBack3'
  | 'darkAll'
  | 'stampede'
  | 'anvilStrongest'
  | 'vines';
export interface Disaster {
  world: WorldId;
  name: string;
  caption: string;
  fx: DisasterFx;
  dodgeType?: Type;
  dodgeGift?: Gift;
}
export const DISASTERS: readonly Disaster[] = [
  {
    world: 'india',
    name: 'The Monsoon Breaks',
    caption: 'The monsoon breaks. Swim.',
    fx: 'washInward3',
    dodgeGift: 'SWIM',
  },
  {
    world: 'olympus',
    name: "The Gorgon's Glance",
    caption: 'Don’t look. Do not look.',
    fx: 'stoneStrongest',
    dodgeType: 'TRICKSTER',
  },
  {
    world: 'cosmos',
    name: 'The Black Hole Pull',
    caption: 'The dark pulls. Hold on.',
    fx: 'pullCentre2',
    dodgeType: 'SHADOW',
  },
  {
    world: 'pirate',
    name: 'The Kraken Grab',
    caption: 'Eight arms. All for you.',
    fx: 'dragBack3',
    dodgeGift: 'FLY',
  },
  {
    world: 'night',
    name: 'The Long Eclipse',
    caption: 'The lights go out. Everywhere.',
    fx: 'darkAll',
    dodgeGift: 'SCENT',
  },
  {
    world: 'lost',
    name: 'The Stampede',
    caption: 'Mammoths. Running. Toward you.',
    fx: 'stampede',
    dodgeGift: 'DIG',
  },
  {
    world: 'toon',
    name: 'The Falling Anvil',
    caption: 'Look up. Too late.',
    fx: 'anvilStrongest',
    dodgeGift: 'BLINK',
  },
  {
    world: 'wild',
    name: 'The Strangler Vines',
    caption: 'The vines remember you.',
    fx: 'vines',
    dodgeType: 'MYTHIC',
  },
];

// ── Riddles and dilemmas: two doors, exact outcomes; the default is B ──────────────────────────────────────────────────
export type RiddleFx =
  | 'ferryGive'
  | 'walkOn'
  | 'roarDoor'
  | 'silentDoor'
  | 'rubLamp'
  | 'polishLamp'
  | 'mirrorTrade'
  | 'lookCloser'
  | 'oath'
  | 'refuseOath'
  | 'burnMap'
  | 'keepMap'
  | 'merchant'
  | 'wakeGiant'
  | 'tiptoe'
  | 'littleCup'
  | 'greatCup'
  | 'payTroll'
  | 'fightTroll'
  | 'feedGiant'
  | 'fightGiant'
  | 'grabSafe';
export interface Riddle {
  id: string;
  world: WorldId | 'any';
  name: string;
  verse: string;
  a: string;
  b: string;
  fa: RiddleFx;
  fb: RiddleFx;
}
export const RIDDLES: readonly Riddle[] = [
  {
    id: 'ferryman',
    world: 'night',
    name: 'The Ferryman',
    verse: 'A coin to cross the silent tide; / or walk the shore, and stay outside.',
    a: 'Pay a creature · cross to the inner ring',
    b: 'Walk on',
    fa: 'ferryGive',
    fb: 'walkOn',
  },
  {
    id: 'doors',
    world: 'wild',
    name: 'The Two Doors',
    verse: 'One door roars and one is still; / choose your fear, and pay its bill.',
    a: 'The roaring door · fight two',
    b: 'The silent door · a coin',
    fa: 'roarDoor',
    fb: 'silentDoor',
  },
  {
    id: 'lamp',
    world: 'pirate',
    name: 'The Brass Lamp',
    verse: 'Rub me once and wishes start; / every wish will cost a part.',
    a: 'Rub it · a rare creature, for your best',
    b: 'Polish it · +2 to your next roll',
    fa: 'rubLamp',
    fb: 'polishLamp',
  },
  {
    id: 'pool',
    world: 'olympus',
    name: 'The Mirror Pool',
    verse: 'The pool will show you what you are; / the weak may borrow from a star.',
    a: 'Trade your weakest for a reflection',
    b: 'Look closer · something in the water joins you',
    fa: 'mirrorTrade',
    fb: 'lookCloser',
  },
  {
    id: 'oath',
    world: 'any',
    name: 'The Oath of Rivals',
    verse: 'Name the one you’d face at dawn; / the oath is sworn, the line is drawn.',
    a: 'Name a rival · winner takes two',
    b: 'Refuse · walk on',
    fa: 'oath',
    fb: 'refuseOath',
  },
  {
    id: 'map',
    world: 'lost',
    name: 'The Old Map',
    verse: 'Burn the map and all may see; / keep it close, and see for free.',
    a: 'Burn it · every omen tells the truth',
    b: 'Keep it · see down every fork',
    fa: 'burnMap',
    fb: 'keepMap',
  },
  {
    id: 'storms',
    world: 'cosmos',
    name: 'The Merchant of Storms',
    verse: 'I sell the storm, I name its place; / the price, a creature. Name the space.',
    a: 'Pay a creature · choose what is eaten next',
    b: 'Refuse',
    fa: 'merchant',
    fb: 'walkOn',
  },
  {
    id: 'giant',
    world: 'india',
    name: 'The Sleeping Giant',
    verse: 'He sleeps for half of every year; / wake him, and he’ll fight for you here.',
    a: 'Wake him with drums · he joins you',
    b: 'Tiptoe past · move 2',
    fa: 'wakeGiant',
    fb: 'tiptoe',
  },
  {
    id: 'cups',
    world: 'olympus',
    name: 'The Two Cups',
    verse: 'A little cup, a cup of gold; / the brave drink deep, the wise drink old.',
    a: 'The little cup · a common creature',
    b: 'The great cup · a legend, or a loss',
    fa: 'littleCup',
    fb: 'greatCup',
  },
  {
    id: 'troll',
    world: 'olympus',
    name: 'The Troll Bridge',
    verse: 'Pay the troll or fight the troll; / the bridge collects its daily toll.',
    a: 'Pay a creature · cross the bridge',
    b: 'Fight the troll',
    fa: 'payTroll',
    fb: 'fightTroll',
  },
  {
    id: 'cart',
    world: 'india',
    name: 'The Cart-Eater',
    verse: 'Feed me well or be my meal; / the hungry giant makes a deal.',
    a: 'Feed him · your next roll is at most 3',
    b: 'Fight him',
    fa: 'feedGiant',
    fb: 'fightGiant',
  },
  {
    id: 'safe',
    world: 'toon',
    name: 'The Hanging Safe',
    verse: 'Treasure waits beneath a rope; / a safe hangs there. Do you hope?',
    a: 'Grab it · a treasure, and the safe drops',
    b: 'Walk around',
    fa: 'grabSafe',
    fb: 'walkOn',
  },
];

// ── Boons. AMBER (sacred) only by grace: the shrine, the Final Turns, Kamadhenu. Never a wager's prize. ────────────────
export type BoonKey =
  | 'garuda'
  | 'airavata'
  | 'kamadhenu'
  | 'sanjeevani'
  | 'brahmastra'
  | 'patra'
  | 'vimana'
  | 'kalpavriksha'
  // The Wonders (non-sacred): the heart bet's prize and the caches' treasure.
  | 'phoenix'
  | 'fleece'
  | 'boots'
  | 'purse'
  | 'stone';
export interface Boon {
  key: BoonKey;
  name: string;
  caption: string;
  text: string;
  sacred: boolean;
}
export const BOONS: readonly Boon[] = [
  {
    key: 'garuda',
    name: 'Garuda, King of Birds',
    caption: 'The King of Birds descends.',
    text: 'Fly away, wherever the wind takes you.',
    sacred: true,
  },
  {
    key: 'airavata',
    name: 'Airavata, the White Elephant',
    caption: 'The white elephant stands guard.',
    text: 'No creature of yours can be lost until your next turn ends.',
    sacred: true,
  },
  {
    key: 'kamadhenu',
    name: 'Kamadhenu, the Wish-Granting Cow',
    caption: 'One wish. Choose with care.',
    text: 'A heart, a creature, or rest: +2 on your next roll.',
    sacred: true,
  },
  {
    key: 'sanjeevani',
    name: 'Sanjeevani, the Healing Mountain',
    caption: 'The healing mountain arrives.',
    text: 'Your last lost creature returns; all rest.',
    sacred: true,
  },
  {
    key: 'brahmastra',
    name: 'Brahmastra',
    caption: 'A light no beast survives.',
    text: 'Once, undo a wild team, a disaster, or falling ground.',
    sacred: true,
  },
  {
    key: 'patra',
    name: 'Akshaya Patra, the Bottomless Vessel',
    caption: 'The vessel never empties.',
    text: 'Your next three rolls: two dice, keep the higher.',
    sacred: true,
  },
  {
    key: 'vimana',
    name: 'Pushpaka Vimana, the Flying Palace',
    caption: 'Always room for one more.',
    text: 'Fly to a place on the inner ring (the palace picks it).',
    sacred: true,
  },
  {
    key: 'kalpavriksha',
    name: 'Kalpavriksha, the Wish-Fulfilling Tree',
    caption: 'A tree that grants shelter.',
    text: 'Your space cannot be eaten; no clash there.',
    sacred: true,
  },
  {
    key: 'phoenix',
    name: 'The Phoenix Feather',
    caption: 'Rise again. Once.',
    text: 'A heart back (or your last heart saved).',
    sacred: false,
  },
  {
    key: 'fleece',
    name: 'The Golden Fleece',
    caption: 'Nothing gets through the gold.',
    text: 'No creature of yours can be lost until your next turn ends.',
    sacred: false,
  },
  {
    key: 'boots',
    name: 'The Seven-League Boots',
    caption: 'One step. Seven leagues.',
    text: 'One giant step, somewhere far: the boots decide.',
    sacred: false,
  },
  {
    key: 'purse',
    name: 'The Bottomless Purse',
    caption: 'It never runs dry.',
    text: 'Your next three rolls: two dice, keep the higher.',
    sacred: false,
  },
  {
    key: 'stone',
    name: "The Philosopher's Stone",
    caption: 'Lead into gold. A legend is born.',
    text: 'A rare creature turns to gold and joins you.',
    sacred: false,
  },
];
export const BOON: Record<BoonKey, Boon> = Object.fromEntries(BOONS.map((b) => [b.key, b])) as Record<
  BoonKey,
  Boon
>;

// ── Flips (two per match) ──────────────────────────────────────────────────────────────────────────────────────────────
export type FlipKind = 'rewire' | 'tide' | 'starfall' | 'mirror';
export interface Flip {
  kind: FlipKind;
  name: string;
  text: string;
  verse: string;
}
export const FLIPS: readonly Flip[] = [
  {
    kind: 'rewire',
    name: 'The Great Rewire',
    text: 'Two worlds swap places. The bridges move.',
    verse: 'The roads untie, the bridges stray; / the world you knew is moved away.',
  },
  {
    kind: 'tide',
    name: 'The Tide Turns',
    text: 'Everyone passes their weakest creature left.',
    verse: 'What’s weakest flows from hand to hand; / pass it left, as tides command.',
  },
  {
    kind: 'starfall',
    name: 'Star Fall',
    text: 'The stars fall. A legend wakes.',
    verse: 'The sky lets go of all it keeps: / the stars come down, a legend leaps.',
  },
  {
    kind: 'mirror',
    name: 'The Mirror Age',
    text: 'The circle runs backwards for a round.',
    verse: 'The mirror wakes, the circle spins: / what used to lose, this round it wins.',
  },
];

export const VERSES = {
  opening:
    'Eight worlds bloom where old stars burn, / and every path has teeth in turn. / Tame what roars, and hold them near: / the last with four walks out of here.',
  flip1: 'You have walked far; the world has fed. / Now hold your breath: it turns instead.',
  flip2: 'Twice the drums and twice the dread: / what stood behind now stands ahead.',
  finalTurns: 'The light grows thin, the ring grows small; / one drawn by fate may take it all.',
  lastLight: 'The light runs thin where worlds once burned. / Step to the flame: the light is earned.',
  out: 'Your hearts are spent, your road is done; / now be the world, and hunt someone.',
  escape: 'Four at your side, the door swings wide; / the world still hungers. You’re outside.',
} as const;

/** ENCOUNTERS (owner, 2026-10-30: "a witch shows three potions…"): pick one of three; one blesses, one harms, one is nothing.
 *  Pure luck, rare, and always read aloud before the choice so everyone knows the stakes. */
export interface Encounter {
  id: string;
  world: WorldId | 'any';
  name: string;
  /** The stakes, one line, in the land's voice. */
  verse: string;
  /** The three things on offer (the same look: you cannot tell them apart). */
  items: readonly [string, string, string];
  good: string;
  bad: string;
  none: string;
}
export const ENCOUNTERS: readonly Encounter[] = [
  { id: 'witch', world: 'any', name: 'The Witch of the Crossroads', verse: 'Three potions. One heals, one kills, one is only tea.', items: ['The green potion', 'The violet potion', 'The amber potion'], good: 'Elixir! You feel immortal.', bad: 'Poison. It burns all the way down.', none: 'Tea. Quite nice, actually.' },
  { id: 'chests', world: 'pirate', name: "The Captain's Three Chests", verse: 'One holds a treasure, one a curse, one holds the sea.', items: ['The iron chest', 'The oak chest', 'The bone chest'], good: 'Treasure, and it is alive.', bad: 'A curse leaps out and bites.', none: 'Seawater. Just seawater.' },
  { id: 'eggs', world: 'lost', name: 'Three Eggs in the Snow', verse: 'One will hatch a friend. One has a mother nearby.', items: ['The speckled egg', 'The blue egg', 'The giant egg'], good: 'It hatches, and it thinks you are its mother.', bad: 'The mother has returned.', none: 'An empty shell. Breakfast, perhaps.' },
  { id: 'cups', world: 'toon', name: 'The Shell Game', verse: 'Three cups. One hides a prize, one hides an anvil.', items: ['The left cup', 'The middle cup', 'The right cup'], good: 'A prize! The crowd goes wild.', bad: 'Anvil. Of course it was the anvil.', none: 'Nothing. The magician looks smug.' },
  { id: 'coins', world: 'night', name: "The Ferryman's Three Coins", verse: 'Pay with the right coin and the river is kind.', items: ['The silver coin', 'The copper coin', 'The black coin'], good: 'The river carries you, gently, home.', bad: 'Wrong coin. The river takes its due.', none: 'The ferryman shrugs and rows on.' },
  { id: 'fruits', world: 'wild', name: 'Three Fruits on the Idol', verse: 'One is sweet, one is sleep forever, one is merely a fruit.', items: ['The red fruit', 'The golden fruit', 'The black fruit'], good: 'Sweet! Strength floods back.', bad: 'Bitter. Very, very bitter.', none: 'A fruit. Delicious and pointless.' },
  { id: 'doors', world: 'cosmos', name: 'Three Doors in the Dark', verse: 'One opens on a star, one on the void, one on a cupboard.', items: ['The first door', 'The second door', 'The third door'], good: 'A star falls into your hands.', bad: 'The void looks back, and takes a bite.', none: 'A cupboard. Full of brooms.' },
  { id: 'lyres', world: 'olympus', name: "The Muses' Three Lyres", verse: 'Play the true lyre and the gods will listen.', items: ['The golden lyre', 'The ivory lyre', 'The cedar lyre'], good: 'The gods applaud. A gift descends.', bad: 'A string snaps, and so does the sky.', none: 'A pleasant tune. Nobody notices.' },
  { id: 'lamps', world: 'india', name: 'Three Lamps in the Temple', verse: 'Light the right lamp and the dark gives back.', items: ['The brass lamp', 'The clay lamp', 'The silver lamp'], good: 'The flame blesses you.', bad: 'The flame flares and scorches.', none: 'A warm glow. That is all.' },
];

// ── v9 CHANCE CARDS (owner, 2026-10-31: "bahut kamaal ki… bets… majboori mein kisko denge… dusre ki baari bhi dhyaan se dekhein").
// Every place without a lair, disaster, riddle or cache deals one, and it must be obeyed (Monopoly's Chance, Mario Party's Chance
// Time). Mostly hard and hostile; rarely kind. Bets resolve on SOMEONE ELSE's next battle, so every turn matters to everyone.
export type ChanceKind = 'bet' | 'give' | 'trial' | 'battle' | 'luck' | 'chaos';
export interface Chance {
  id: string;
  kind: ChanceKind;
  name: string;
  /** The rule, one line, plain. */
  text: string;
  /** Read aloud as it turns (rhymes: owner Q16). */
  verse: string;
  /** Copies in the deck. */
  w: number;
}
export const CHANCES: readonly Chance[] = [
  { id: 'longOdds', kind: 'bet', w: 1, name: 'The Long Odds', text: "A bet AGAINST the next player's next battle. They win: they take your top creature. They lose: you take theirs.", verse: 'Your fate is tied to another’s blade. Watch them closely: the bet is laid.' },
  { id: 'unholy', kind: 'bet', w: 1, name: 'Unholy Alliance', text: "You ride the next player's next battle. They win: you gain too (a creature; rarely a heart). They lose: you lose your top creature.", verse: 'Cheer for the one you want to fall: their victory feeds you after all.' },
  { id: 'hitch', kind: 'bet', w: 1, name: "Hitch a Ride on the Crown", text: "Choose a rival and ride their next battle. They win: you gain too (a creature; rarely a heart). They lose: your top creature goes to THEM.", verse: 'Climb on the back of the one on top. Pray they win. Pray they never stop.' },
  { id: 'shared', kind: 'bet', w: 1, name: 'Shared Fate', text: "Your fate is tied to the next player's next battle. Whatever they win, you win a creature. Whatever they lose, you lose one.", verse: 'One rope, two necks, a single knot. Their luck is yours, like it or not.' },
  { id: 'vulture', kind: 'bet', w: 1, name: 'The Vulture', text: 'Until your next turn, whoever loses a heart also loses their top creature, to you.', verse: 'Circle high and circle slow. Someone bleeds. You eat. You know.' },
  { id: 'bloodWager', kind: 'bet', w: 1, name: 'Blood Wager', text: "A bet on the next player's next battle. They win: you lose a heart. They lose: you gain one.", verse: 'Blood for blood, the wager’s cast. Pray their battle is their last.' },
  { id: 'prophet', kind: 'bet', w: 1, name: "The Prophet's Wager", text: 'Pick anyone and call it: will they WIN or LOSE their next battle? Right: a rare creature. Wrong: lose your top creature.', verse: 'Read the stars and name the end, of foe or fool or faithless friend.' },
  { id: 'cutCrown', kind: 'bet', w: 1, name: 'Cut the Crown', text: "Choose a rival and bet against their next battle. They lose: they lose a heart too. They win: you lose one.", verse: 'The tallest tree attracts the storm. Bet against the crown’s proud form.' },
  { id: 'doubleNothing', kind: 'bet', w: 1, name: 'Double or Nothing', text: 'Your own next battle. Win: steal the top creature of anyone you choose. Lose: lose a heart.', verse: 'All or nothing, sword in hand. Win it all, or lose your stand.' },
  { id: 'bomb', kind: 'give', w: 1, name: 'The Ticking Bomb', text: 'Hand it to another player. It explodes at the end of next round: one heart. Whoever holds it must pass it to anyone they end a turn near.', verse: 'Tick and tock, it isn’t yours. Pass it on through deadly doors.' },
  { id: 'curse', kind: 'give', w: 1, name: 'The Crooked Curse', text: 'Give it to another player. Their next roll moves them 2 steps at most.', verse: 'A crooked word, a crooked road: their legs will drag a heavy load.' },
  { id: 'scent', kind: 'give', w: 1, name: "The Hunter's Scent", text: 'Mark another player. The beasts of the world now hunt them.', verse: 'Smear the scent and step away. The pack will find another prey.' },
  { id: 'kingmaker', kind: 'give', w: 1, name: 'Kingmaker', text: 'Choose a player. Their top creature goes to another player of your choice. Never you.', verse: 'You crown a king you did not choose. Someone wins, and someone loses.' },
  { id: 'toll', kind: 'give', w: 1, name: 'The Toll', text: 'Choose a player. Their top creature is lost to the void.', verse: 'The bridge demands its silver due. Choose who pays it. Never you.' },
  { id: 'chalice', kind: 'give', w: 1, name: 'The Poisoned Chalice', text: 'Lose a heart, or give your top creature to a player of your choice.', verse: 'Drink the poison, pay the price, or gift your best. You choose. Not twice.' },
  { id: 'giftMust', kind: 'give', w: 1, name: 'A Gift You Must Give', text: 'A rare creature appears. You must give it to another player.', verse: 'A treasure falls into your hand. It was never yours. Choose who will stand.' },
  { id: 'heartTax', kind: 'give', w: 1, name: 'The Heart Tax', text: 'Give one of your hearts to another player. On your last heart: your top creature instead.', verse: 'The world takes from you to give. Choose which rival gets to live.' },
  { id: 'robin', kind: 'chaos', w: 1, name: 'Robin of the Woods', text: "Choose a rival who gives and another who receives: the giver's top creature changes hands. Never you.", verse: 'From the rich unto the poor, an arrow knocks upon the door.' },
  { id: 'ropeBridge', kind: 'trial', w: 1, name: 'The Rope Bridge Snaps', text: 'Time your leap. Miss: lose a heart. Perfect: a rare creature.', verse: 'The ropes give way beneath your feet. Leap now, or the stones you meet.' },
  { id: 'stampede', kind: 'trial', w: 1, name: 'Stampede!', text: 'Dodge three charging beasts. Each one that hits takes a creature.', verse: 'The ground is shaking, horns are near. Dodge them now, or disappear.' },
  { id: 'quickDraw', kind: 'trial', w: 1, name: 'Quick Draw', text: "Choose a rival. You both draw at the signal. The better shot takes the other's top creature.", verse: 'High noon, the dust, the silent stare. The faster hand walks out of there.' },
  { id: 'fallingSky', kind: 'trial', w: 1, name: 'The Sky Falls', text: 'Everyone on your land must dodge the falling stars. A miss costs a creature.', verse: 'The heavens crack and stars rain down. Run, every soul in this town.' },
  { id: 'feather', kind: 'trial', w: 1, name: 'The Burning Feather', text: 'Catch it as it falls. Perfect: a heart, or a rare creature if you are whole.', verse: 'A burning feather drifting slow. Catch it right, and feel the glow.' },
  { id: 'ambush', kind: 'battle', w: 1, name: 'Ambush!', text: 'Wild beasts burst out of the ground. Fight.', verse: 'The earth splits open, claws come through. The jungle’s hungry, and it wants you.' },
  { id: 'duelCall', kind: 'battle', w: 1, name: 'The Duel Call', text: 'Challenge any player within 4 steps to a battle.', verse: 'A glove is thrown upon the ground. Who dares to stand, who backs down?' },
  { id: 'arena', kind: 'battle', w: 1, name: 'Arena of the Gods', text: 'Choose two other players. They must battle each other. You watch.', verse: 'The gods are bored and want a show. You choose who fights. Let them go.' },
  { id: 'unleash', kind: 'battle', w: 1, name: 'Release the Beasts', text: 'A wild pack attacks a player of your choice.', verse: 'Open the cage and point the way. The beasts will feast on someone today.' },
  { id: 'bossCall', kind: 'battle', w: 1, name: 'The Beast Hears You', text: 'The beast charges straight at you.', verse: 'You called too loud, you said its name. Now it comes to end your game.' },
  { id: 'rollAgain', kind: 'luck', w: 1, name: 'Second Wind', text: 'Roll and move again.', verse: 'The wind is kind, your legs are new. The road is calling. Off with you.' },
  { id: 'portal', kind: 'luck', w: 1, name: 'A Portal Opens', text: 'Step through to any land you name.', verse: 'A door of light where none should be. Step through, and see what you will see.' },
  { id: 'swap', kind: 'luck', w: 1, name: 'Wrong Place, Right Time', text: 'Swap places with any player.', verse: 'Here is there and there is here. Swap your boots and disappear.' },
  { id: 'jar', kind: 'luck', w: 1, name: 'The Jar', text: 'Open it. A creature joins you, unless it is weaker than all you hold: then it bites, and your weakest flees.', verse: 'A rattling jar, a muffled growl. Is it a friend, or something foul?' },
  { id: 'unknown', kind: 'luck', w: 1, name: 'Into the Unknown', text: 'You vanish to unseen ground. Win or lose a creature, by luck.', verse: 'Close your eyes and take the fall. Luck decides it, after all.' },
  { id: 'tea', kind: 'luck', w: 1, name: 'Tea for One', text: 'Nothing happens. Your creatures rest. Breathe.', verse: 'The kettle sings, the world can wait. A cup of tea, a lighter weight.' },
  { id: 'passLeft', kind: 'chaos', w: 1, name: 'Pass to the Left', text: 'Everyone passes their top creature to the player on their left.', verse: 'Round and round the treasures go. Who ends up rich, nobody can know.' },
  { id: 'shuffle', kind: 'chaos', w: 1, name: 'The Great Shuffle', text: "Every hero jumps to the next hero's place.", verse: 'The world spins once and all is moved: your road is gone, your plan disproved.' },
  { id: 'sky', kind: 'chaos', w: 1, name: 'Point at the Sky', text: 'Name a land. The world eats it next.', verse: 'You point, the hungry sky obeys. One land will not see other days.' },
  // v10 (owner: "chance cards ke through direct boons and curses… relic which we can give to one of our creatures… curse se top
  // card ka kuch kam ho jaye… fate jud jaye… pure chaos, kabhi bhi kuch bhi aake game palat sakta hai").
  { id: 'relic', kind: 'luck', w: 1, name: 'A Relic in the Dust', text: 'A relic of the old world. Give it to one of your creatures: every stat rises.', verse: 'Brush the dust from what was lost. Power waits, whatever the cost.' },
  { id: 'hex', kind: 'chaos', w: 1, name: 'The Hex', text: 'A hex lands on your top creature: every stat falls by 12.', verse: 'A whisper, a mark, a crooked sign. Your best grows weak, and none is fine.' },
  { id: 'hexGive', kind: 'give', w: 1, name: 'The Cursed Idol', text: "You must place the hex on a rival's top creature: every stat falls by 12. Choose who.", verse: 'The idol grins and will not keep. Choose whose champion shall weep.' },
  { id: 'relicGive', kind: 'give', w: 1, name: "The Dragon's Hoard", text: "A relic you cannot keep. It goes to a rival's creature of your choice: every stat rises.", verse: 'Gold you found but cannot hold. Choose the rival made more bold.' },
  { id: 'rope', kind: 'bet', w: 1, name: 'Bound by Rope', text: 'Tie yourself to a rival. Through your next turn, whenever one of you loses a creature, so does the other.', verse: 'One rope, two climbers, one long fall. If one goes down, it takes you all.' },
  { id: 'quake', kind: 'chaos', w: 1, name: 'The World Quakes', text: 'Every hero outside the Burning Heart rolls one die. Roll a 1 and the ground under you falls: a heart.', verse: 'The world shrugs once from end to end. Pray the ground you stand on bends.' },
  { id: 'mutiny', kind: 'chaos', w: 1, name: 'Mutiny', text: "Every hero loses a random creature to the hero on their left.", verse: 'The crews rise up on every deck. Some lose a hand, some keep their neck.' },
  // v10 cruelty (owner: "very cruel… super hard choices… khudke nuksaan se dusre ka nuksaan juda ho and fayeda se fayeda… directly life le
  // sakein by exploiting their weakness… apna loss likha ho chance card pe and xyz player ka fayeda").
  { id: 'ransom', kind: 'give', w: 1, name: "The King's Ransom", text: "Choose a rival. Then choose: lose a heart and their top creature is destroyed. Or keep your heart, and they take your top creature.", verse: 'A crown of bone, a heart of red. Pay with one, or feed the head.' },
  { id: 'devil', kind: 'give', w: 1, name: "The Devil's Bargain", text: "Choose a rival. Then choose: gain a heart, and they gain a legendary creature. Or lose a heart, and they lose their top creature.", verse: 'The devil smiles and shakes your hand. Who grows strong, and who will stand?' },
  { id: 'heel', kind: 'battle', w: 1, name: "The Achilles' Heel", text: "Choose a rival. Your top creature strikes their top creature's WEAKEST stat. Beat it: they lose a heart. Miss: you lose your top creature.", verse: 'Every giant has a seam. Strike it true, or lose the dream.' },
  { id: 'bloodPrice', kind: 'give', w: 1, name: 'The Blood Price', text: 'Take a heart from any rival. They take your top creature in return.', verse: 'Blood for gold and gold for blood. Someone sinks into the mud.' },
  { id: 'sinking', kind: 'chaos', w: 1, name: 'The Sinking Ship', text: 'Choose a rival. You both lose a heart.', verse: 'One ship, two crews, a single hole. The sea will take a double toll.' },
  { id: 'feast', kind: 'luck', w: 1, name: 'The Feast', text: 'Choose a rival. You both gain a creature.', verse: 'A table set for only two. Choose the guest who dines with you.' },
  { id: 'tribute', kind: 'give', w: 1, name: 'The Tribute', text: "Written in stone: your top creature goes to a rival drawn by lot.", verse: 'The weak shall eat what the strong once held. It is written. It is spelled.' },
  { id: 'legendFalls', kind: 'chaos', w: 1, name: 'The Legend Falls', text: "One legendary creature, drawn by lot among all held, falls.", verse: 'The tallest tower meets the ground. The mighty fall without a sound.' },
  { id: 'loadedDie', kind: 'luck', w: 1, name: 'The Loaded Die', text: 'Roll. A six: a legendary creature joins you. A one: lose a heart. Anything else: nothing.', verse: 'One die, six faces, one of gold. One of blood. Now roll it bold.' },
  // v12 (owner: "meri jeet se tumhari haar link kar di, haar se haar, haar se jeet, jeet se jeet… 100x karo"): every link has a name,
  // and each one ties a different pair of fates. The Empty-Handed Wager is never drawn: it comes to a hero with no creature left.
  { id: 'empty', kind: 'bet', w: 0, name: 'The Last Gamble: a Heart', text: "No creature left. You staked a heart on a rival's next battle. Right: a creature comes to you (call LOSE and it is THEIR top one). Wrong: you lose a heart.", verse: 'Empty hands and one last call. Stake a heart and watch them fall.' },
  { id: 'emptyLife', kind: 'bet', w: 0, name: 'The Last Gamble: a Life', text: "No creature left. You staked your whole life on a rival's next battle. Right: two creatures and a heart. Wrong: you are out of the game (only Death's Door can answer).", verse: 'Nothing left but breath and nerve. All of it rides on how they swerve.' },
  { id: 'mirror', kind: 'bet', w: 1, name: 'The Mirror', text: 'Name a rival. Your next battle is reflected on them. You win: they lose their top creature. You lose: they gain one.', verse: 'What you suffer, they enjoy. What you win, they lose. A cruel toy.' },
  { id: 'pact', kind: 'bet', w: 1, name: 'The Blood Pact', text: 'Name a rival. You share your next battle. Win: a creature each. Lose: a heart each.', verse: 'Two hands cut and pressed as one. Win together, or be undone.' },
  { id: 'bounty', kind: 'give', w: 1, name: 'Wanted, Dead or Alive', text: 'Put a price on a rival. Whoever beats them in a duel claims it: a heart, or a rare creature if they are whole.', verse: 'A face is nailed to every door. Who will collect? Who wants more?' },
  { id: 'deadman', kind: 'luck', w: 1, name: "The Dead Man's Switch", text: 'Until your next turn ends, whoever takes a heart from you loses one too.', verse: 'Strike me down and hear the click. The blade turns back, and it is quick.' },
  // v13 (owner: "challenges, luck based challenges, bets… bahut zyada alag alag type ke… mere ideas se bahut aage"): games of
  // nerve for the whole table, an auction, the card game War, dice, an oracle, a volcano, the crowd's bets, a pot, a policy, a loan.
  { id: 'teeth', kind: 'trial', w: 1, name: "The Dragon's Teeth", text: 'Six teeth, one bites. Everyone in turn pulls one, or pays their weakest creature to pass. Whoever pulls the wrong one loses a heart.', verse: 'Six white teeth in a sleeping jaw. Pull one gently. Hear the roar.' },
  { id: 'market', kind: 'give', w: 1, name: 'The Black Market', text: 'A legend for sale. Everyone bids in creatures, one more each time. The last bidder pays and takes it.', verse: 'Behind the curtain, gold and greed. How much is a legend worth, indeed?' },
  { id: 'war', kind: 'battle', w: 1, name: "The Champion's War", text: "Choose a rival. You each turn a random creature; a random stat decides. The higher takes the other's. A tie: both fall.", verse: 'One card each and one blind call. Winner takes it. Loser, all.' },
  { id: 'crowd', kind: 'bet', w: 0, name: 'The Crowd Calls It', text: "A call on a hero's battle in the Colosseum. Right: a creature. Wrong: your weakest runs off.", verse: 'The stands are full, the crowd must choose. They win with you, or lose with you.' },
  { id: 'colosseum', kind: 'bet', w: 1, name: 'The Colosseum', text: 'Your next battle is a show. Every other hero must call it: WIN or LOSE. Right: a creature. Wrong: their weakest runs off.', verse: 'The stands are full, the crowd must choose. They win with you, or lose with you.' },
  { id: 'sweepstake', kind: 'chaos', w: 1, name: 'The Sweepstake', text: 'Everyone throws their weakest creature into the pot. The next hero to win a battle, anywhere, takes the whole pot.', verse: 'Into the pot the weak ones go. Who takes it all? Nobody knows.' },
  { id: 'insurance', kind: 'luck', w: 1, name: 'The Insurance', text: 'Pay your weakest creature now. The next heart you would lose, the policy pays instead.', verse: 'Pay the man and sign the line. When the blade falls, you will be fine.' },
  { id: 'loan', kind: 'bet', w: 1, name: 'The Loan Shark', text: 'Take a rare creature now. Win your next battle, or the shark takes a heart.', verse: 'Easy money, sharp white grin. Lose your next fight, he takes it in.' },
  { id: 'oracleDie', kind: 'luck', w: 1, name: "The Oracle's Number", text: 'Name the die. Exact: a legend. One off: a creature. Further: your weakest is lost.', verse: 'Six faces, one true sight. Name the number. Are you right?' },
  { id: 'stairs', kind: 'luck', w: 1, name: "The Gambler's Stairs", text: 'Roll 2+, then 3+, then 4+, then 5+. Stop on any step for its prize: a creature, two, a rare, a legend. A miss loses it all, and your weakest.', verse: 'Every step a little higher. One slip down into the fire.' },
  { id: 'volcano', kind: 'luck', w: 1, name: 'Feed the Volcano', text: 'Throw your weakest creature into the fire? Roll 4+ and it gives back a rare creature. Less: gone.', verse: 'Give the mountain what it craves. It may return you something brave.' },
  { id: 'diceDuel', kind: 'battle', w: 1, name: 'The Dice Duel', text: "Choose a rival. You both roll two dice. The higher total takes the other's top creature.", verse: 'Four dice tumble, two by two. The bigger number comes for you.' },
  { id: 'miracle', kind: 'luck', w: 1, name: 'A Miracle', text: 'The rarest card in the deck. A heart, and a legendary creature.', verse: 'Once in a thousand moons it falls. The sky itself answers your calls.' },
  { id: 'pharaoh', kind: 'chaos', w: 1, name: "The Pharaoh's Curse", text: 'As rare as a miracle. The tomb keeps every creature you hold, except your best.', verse: 'You woke the king who wanted rest. He keeps it all, except your best.' },
  // v14 (owner, 2026-11-02: "add bahut saari cheezein… tasks, challenges, duels, chance cards… boss wali cheez ko interesting
  // banao… like a hunter"): the beast you can whistle at, a melee for the whole table, a deal at the crossroads, a coin, a hill,
  // a pickpocket, and the last chip on the table.
  { id: 'whistle', kind: 'battle', w: 1, name: "The Beast's Whistle", text: 'Name a rival. The beast rolls its die and runs at them now (if it is resting, its next hunt is theirs). No beast awake: a wild pack hunts them instead.', verse: 'One shrill note across the land. The beast now hunts the one you planned.' },
  { id: 'melee', kind: 'chaos', w: 1, name: 'The Grand Melee', text: 'Every hero throws in their top creature. One stat is drawn blind: the highest claims the best of the rest. A tie at the top: everyone keeps their own.', verse: 'Into the ring the champions go. One stat, one draw, one overthrow.' },
  { id: 'demon', kind: 'luck', w: 1, name: 'The Crossroads Demon', text: 'Take a legendary creature now, or walk away. Two rounds later the demon returns: roll 4 or more, or it takes a heart.', verse: 'A handshake at the crossroads, cold. A legend now. The bill comes old.' },
  { id: 'coin', kind: 'luck', w: 1, name: 'Heads or Tails', text: 'Call the coin. Right: a creature of this land joins you. Wrong: your weakest runs off.', verse: 'A thumb, a flick, a silver spin. Call it right and luck walks in.' },
  { id: 'hill', kind: 'chaos', w: 1, name: 'King of the Hill', text: 'Every hero rolls one die. The highest takes the top creature of the lowest.', verse: 'Everyone climbs, but one stands tall. The lowest pays. The highest takes all.' },
  { id: 'pickpocket', kind: 'give', w: 1, name: 'The Pickpocket', text: "Choose a rival. You both roll: the higher lifts the other's top creature. A tie, and nobody moves.", verse: 'Light of finger, quick of eye. Get caught, and wave your best goodbye.' },
  { id: 'allIn', kind: 'luck', w: 1, name: 'All In', text: 'Stake a heart on one die, or walk away. 4 or more: gain a heart (a legend if you are whole). 3 or less: the heart is gone.', verse: 'One heart in the pot, one die to throw. All in, or fold. You have to know.' },
  // v15 (owner: "saamne wale ke fayde se tumhara nuksaan… hidden agenda… betrayal… bluff… sab combinations"): a chain you forge
  // yourself, a secret contract, a chest only you can see into, and a mind game for two.
  { id: 'darkPact', kind: 'bet', w: 1, name: 'The Dark Pact', text: "Take a creature now, or chain yourself to a rival's next battle: if they lose it, they lose a second heart, and so do you.", verse: 'One chain, two throats, one battle to come. If they fall, you fall. Is it worth the sum?' },
  { id: 'contract', kind: 'bet', w: 1, name: "The Assassin's Contract", text: 'In secret, name a mark. If they lose a heart before your next turn, any way at all, you gain a heart (a rare creature if you are whole).', verse: 'A name in ink that no one reads. It pays in blood, if fortune bleeds.' },
  { id: 'liarChest', kind: 'give', w: 1, name: "The Liar's Chest", text: 'Only you see inside: a rare creature, or a curse that costs a heart. Offer it to a rival: they take it, or it comes back to you.', verse: 'Smile and swear the gold is real. Your face is all the lock and seal.' },
  { id: 'bss', kind: 'battle', w: 1, name: 'Blade, Shield, Spell', text: "Challenge a rival. Both choose in secret: Blade beats Shield, Shield beats Spell, Spell beats Blade. The winner takes the other's top creature.", verse: 'Read the eyes and not the hand. Who blinks first will lose their stand.' },
  { id: 'underdog', kind: 'luck', w: 1, name: "The Underdog's Hour", text: "Choose a rival: you swap your top creatures.", verse: 'The small dog bites when the moon is high. The big dog bleeds. Nobody knows why.' },
];
export const CHANCE: Record<string, Chance> = Object.fromEntries(CHANCES.map((c) => [c.id, c]));

// ── v10 THE LAND STRIKES (owner, 2026-10-31: "beech beech mein before a person plays his baari uspe rarely random attack hon,
// for example meteor shower… based upon the land he is in… deck shuffle… top card… judge if it can stop that attack… rok liya
// toh you get a creature from that land, else yours will be taken"). One attack per land; it tests one stat of the top card.
export interface LandAttack {
  world: WorldId;
  name: string;
  stat: Stat;
  /** What the land does (one line), and the rhyme read as it lands. */
  text: string;
  verse: string;
}
export const ATTACKS: Readonly<Record<WorldId, LandAttack>> = {
  india: { world: 'india', name: 'The Monsoon Flood', stat: 'POWER', text: 'A wall of brown water. Only raw POWER stands against it.', verse: 'The river climbs the temple stair. Stand your ground, if you dare.' },
  olympus: { world: 'olympus', name: 'The Thunderbolt', stat: 'MAGIC', text: 'The sky takes aim. Only MAGIC turns the bolt.', verse: 'A flash, a crack, a mountain’s shout. Turn the bolt, or be put out.' },
  cosmos: { world: 'cosmos', name: 'The Meteor Shower', stat: 'SPEED', text: 'Fire falls from the dark. Only SPEED outruns it.', verse: 'The stars come down in burning rain. Run, or never run again.' },
  pirate: { world: 'pirate', name: 'The Rogue Wave', stat: 'SIZE', text: 'The sea stands up. Only SIZE holds against it.', verse: 'The ocean rises, green and tall. The small are swept beyond recall.' },
  night: { world: 'night', name: "The Banshee's Wail", stat: 'TERROR', text: 'A scream that freezes blood. Only TERROR screams back.', verse: 'A cry that makes the candles die. Scream louder, or say goodbye.' },
  lost: { world: 'lost', name: 'The Avalanche', stat: 'POWER', text: 'The glacier lets go. Only POWER digs out.', verse: 'The mountain sighs, the snow comes down. Dig, or sleep beneath the town.' },
  toon: { world: 'toon', name: 'The Falling Piano', stat: 'SPEED', text: 'A shadow grows on the ground. Only SPEED gets clear.', verse: 'A tinkle, a whistle, a shadow, a crash. Move your feet, and move them fast.' },
  wild: { world: 'wild', name: 'The Quicksand', stat: 'CUNNING', text: 'The ground swallows. Only CUNNING finds the root.', verse: 'The jungle floor begins to drink. Think fast. Faster than you think.' },
};

/** Relics of the old world (chance cards, caches): one goes onto one creature and lifts every stat. */
export const RELICS: readonly { name: string; bonus: number }[] = [
  { name: 'The Aegis Shard', bonus: 12 },
  { name: "Draupnir's Ring", bonus: 10 },
  { name: 'The Eye of Horus', bonus: 10 },
  { name: 'A Dragon Pearl', bonus: 14 },
  { name: "The Kraken's Tooth", bonus: 12 },
  { name: 'Sky-Iron Armour', bonus: 14 },
  { name: 'The Moonstone', bonus: 8 },
  { name: 'A Feather of the Simurgh', bonus: 12 },
  { name: "The Minotaur's Horn", bonus: 10 },
  { name: 'The Golden Fleece Thread', bonus: 16 },
  // v15 (owner: "relics… kaafi saare… +16, +26… main character"): twenty more, from every corner of the old world.
  { name: "Mjolnir's Splinter", bonus: 18 },
  { name: 'The Ankh of Dawn', bonus: 12 },
  { name: "Medusa's Last Glance", bonus: 20 },
  { name: 'A Scale of Jormungandr', bonus: 16 },
  { name: "The Cyclops' Lens", bonus: 10 },
  { name: 'The Tear of Isis', bonus: 14 },
  { name: "A Valkyrie's Plume", bonus: 12 },
  { name: 'The Horn of Gjallar', bonus: 18 },
  { name: "Anansi's Silver Thread", bonus: 8 },
  { name: 'The Jade of the Dragon King', bonus: 22 },
  { name: "A Phoenix's Ember", bonus: 16 },
  { name: 'The Skull Lantern', bonus: 10 },
  { name: 'The Crown of the Drowned', bonus: 20 },
  { name: "Gilgamesh's Arm-Ring", bonus: 14 },
  { name: "The Thunderbird's Talon", bonus: 18 },
  { name: 'A Shard of the Bifrost', bonus: 24 },
  { name: "The Kitsune's Pearl", bonus: 12 },
  { name: 'The Black Compass', bonus: 6 },
  { name: "Excalibur's Scabbard", bonus: 16 },
  { name: 'The Heart of the Volcano', bonus: 26 },
];

/** v10 places (owner: "jahaan land karein wahaan ka anokha kuch ho… challenge poora karke sahi guesses karke creature unlock"). */
export const PLACES_V10 = {
  hilo: { name: "The Oracle's Ladder", text: 'Guess higher or lower, three times in a row. All three right: the last creature joins you.' },
  tame: { name: 'A Lone Beast', text: 'One creature, alone. Beat it one on one and it follows you. Lose and yours runs away.' },
  altar: { name: 'The Altar of Bargains', text: 'Offer a creature for a heart, or a heart for a rare creature. Or walk away.' },
  trader: { name: 'The Masked Trader', text: 'Swap one of your creatures for one you cannot see. Or walk away.' },
  heart: { name: 'The Burning Heart', text: 'The fire at the centre of the world. It throws you to a random place: a safe land, or one already falling.' },
  golden: { name: 'A Golden Card', text: 'A big moment, lying in the dust. Play it now.' },
  wheel: { name: 'The Wheel of Pralaya', text: 'Three reels: who, what, and with whom. Anything can happen to anyone.' },
  cave: { name: 'The Cave of Echoes', text: 'Go deeper for a creature at every step. The deeper, the likelier the roof comes down: then all you found is buried, with your weakest.' },
  gauntlet: { name: 'The Gauntlet', text: 'Lone beasts, one at a time, one on one. Beat one and it follows you; then step out, or face the next. Lose and your fighter runs.' },
  // v14 tasks and duels on the ground.
  ring: { name: 'The Challenge Ring', text: 'Call any rival, wherever they stand, into the ring for a duel. Or walk away.' },
  pier: { name: 'The Fishing Pier', text: 'Cast a line and roll. 6: a rare creature. 4 or 5: a creature. 2 or 3: nothing. 1: your best creature is dragged under.' },
  oathStone: { name: 'The Oath Stone', text: 'Offer a rival an alliance: sworn allies share every battle won. Meet on one place, and each chooses in secret: keep the oath, or betray.' },
  shrine: { name: "The Beast's Shrine", text: 'Ring the bell and name a rival: the beast hunts them on its next hunt. If the beast sleeps, the bell wakes it.' },
  trust: { name: 'The Bridge of Trust', text: 'Name a rival. You both choose in secret: SHARE or TAKE. Both share: a creature each. One takes: two for the taker, and the other loses a creature. Both take: each loses a creature.' },
} as const;
