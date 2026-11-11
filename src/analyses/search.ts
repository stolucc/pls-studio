// Filtering the Add analysis menu.

/** Lower case and without accents: "anova" finds ANOVA, "mediation" finds Médiation. */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/** Whether every word of the search occurs in the entry's title, description or group (in any order). */
export function matchesSearch(query: string, ...texts: string[]): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = fold(texts.join(' '));
  return words.every((w) => hay.includes(w));
}
