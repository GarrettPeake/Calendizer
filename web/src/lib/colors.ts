// Deterministic color per key so an intent/mode keeps its hue across re-solves.
function hueOf(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function colorFor(key: string): { bg: string; border: string; text: string } {
  const hue = hueOf(key);
  return {
    bg: `hsl(${hue} 70% 92%)`,
    border: `hsl(${hue} 65% 55%)`,
    text: `hsl(${hue} 55% 28%)`,
  };
}

// A blocker's container: a translucent tint + border over its time span —
// enough to read as "occupied", faint enough that events nested inside stay
// legible — plus a label tone for its title/timing.
export function blockerColor(key: string): { wash: string; edge: string; text: string } {
  const hue = hueOf(key);
  return {
    wash: `hsl(${hue} 65% 50% / 0.14)`,
    edge: `hsl(${hue} 60% 50% / 0.55)`,
    text: `hsl(${hue} 55% 45%)`,
  };
}

// A mode's palette: a faint full-column wash for the calendar, plus a saturated
// chip/dot color and a readable text tone for labels. Derived from the mode id so
// renaming a mode keeps its color.
export function modeColor(key: string): { wash: string; chip: string; text: string } {
  const hue = hueOf(key);
  return {
    wash: `hsl(${hue} 70% 50% / 0.09)`,
    chip: `hsl(${hue} 60% 50%)`,
    text: `hsl(${hue} 55% 40%)`,
  };
}
