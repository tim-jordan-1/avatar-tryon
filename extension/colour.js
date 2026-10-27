// A shirt colour (hex) from a shop's colour name: "Dark grey", "Navy blue", "Light beige/Striped". Null when the name
// is not one of these; the caller then tries it as a CSS colour name ("Slate Blue" -> slateblue).
// Fabric tones, a little duller than the pure web colours.
// shortcut: a small table of common fashion words; add a word when a shop's colour shows up as the default blue.
const BASE = {
  black: '#1c1c1e', white: '#f4f4f2', 'off white': '#ede9de', ivory: '#efe9d6', cream: '#f0e6cc', ecru: '#e6dcc3', beige: '#d6c2a3', sand: '#cdb994',
  tan: '#c2a27a', taupe: '#8b7b6e', brown: '#6b4a32', camel: '#b98a55', khaki: '#a89f72', 'khaki green': '#6f7050', olive: '#6b6a2f',
  grey: '#8a8d91', gray: '#8a8d91', 'grey marle': '#a9abae', 'grey melange': '#a9abae', charcoal: '#36393d', silver: '#bfc2c6',
  navy: '#1f2a44', 'navy blue': '#1f2a44', blue: '#3a62a8', denim: '#4a6a94', 'denim blue': '#4a6a94', turquoise: '#2fa6a6', teal: '#2a7f7f',
  green: '#3f7d4e', 'sage green': '#9caf88', sage: '#9caf88', 'forest green': '#2d5a3a', mint: '#a8d5ba',
  red: '#b3262e', burgundy: '#6d1a2c', maroon: '#5c1a22', wine: '#5c1a2f', pink: '#e8a0b4', coral: '#e8705f', rose: '#d98a9a',
  orange: '#e07a2f', rust: '#a8461f', yellow: '#e8c53a', mustard: '#c9a227', gold: '#c9a24a',
  purple: '#6a4a8c', plum: '#6b3a5b', lilac: '#b9a3d1', lavender: '#b9a3d1',
};
const SHADE = { light: ['#ffffff', 0.45], pale: ['#ffffff', 0.6], dark: ['#000000', 0.4], deep: ['#000000', 0.3] };

const mix = (hex, [to, k]) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - k) + parseInt(to.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('');

export function colourFromName(name) {
  // "Black/Striped" or "Beige, Checked": the first colour counts.
  const words = String(name).toLowerCase().split(/[/,&]/)[0].replace(/[^a-z ]/g, ' ').trim().replace(/\s+/g, ' ');
  if (BASE[words]) return BASE[words];
  const [first, ...rest] = words.split(' ');
  return SHADE[first] && BASE[rest.join(' ')] ? mix(BASE[rest.join(' ')], SHADE[first]) : null;
}
