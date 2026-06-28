// Deterministic color per intent id so an intent keeps its hue across re-solves.
export function colorFor(key: string): { bg: string; border: string; text: string } {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return {
    bg: `hsl(${hue} 70% 92%)`,
    border: `hsl(${hue} 65% 55%)`,
    text: `hsl(${hue} 55% 28%)`,
  };
}
