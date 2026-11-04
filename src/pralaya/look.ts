/** PRALAYA's look tokens shared by every screen: art paths and the six seat colours (also in style.css). */
export const ART = `${import.meta.env.BASE_URL}art/`;
export const art = (id: string): string => `${ART}${id}.webp`;
/** Six seat colours, distinct for colour-blind players too (hue + lightness apart). */
export const SEAT = ['#f2b53b', '#4fc3f7', '#ef5d8a', '#8bd36b', '#c08bff', '#ff8a4c'];

/** v10 forms on the painted fighters: a tint and a size (the card shows the same form as a badge and a CSS filter). */
export const FORM_LOOK: Record<string, { tint: number; scale: number }> = {
  plain: { tint: 0xffffff, scale: 1 },
  ancient: { tint: 0xe6d6b0, scale: 1.05 },
  young: { tint: 0xffffff, scale: 0.84 },
  feral: { tint: 0xffb8a6, scale: 1 },
  cursed: { tint: 0xc0a6ff, scale: 1 },
  celestial: { tint: 0xc6ecff, scale: 1.02 },
  colossal: { tint: 0xffffff, scale: 1.2 },
  shadow: { tint: 0x9a90b8, scale: 1 },
  blazing: { tint: 0xffc890, scale: 1 },
  frost: { tint: 0xd2f0ff, scale: 1 },
  wise: { tint: 0xf4ead0, scale: 0.96 },
  wounded: { tint: 0xd0a8a8, scale: 0.94 },
  exalted: { tint: 0xfff2c0, scale: 1.1 },
};
