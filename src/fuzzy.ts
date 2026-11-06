// Matching for the command bar: punctuation-insensitive, every typed word must match.
const norm = (t: string) => t.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9:]+/g, " ").replace(/:/g, " ").replace(/\s+/g, " ").trim();

/**
 * Score how well a query matches a text: every query word must appear (word starts rank highest,
 * then substrings); failing that, a loose in-order letter match scores low. -1 means no match.
 */
export function score(query: string, text: string) {
  const q = norm(query);
  if (!q) return 0;
  const t = norm(text);
  const words = t.split(" ");
  let total = 0;
  for (const w of q.split(" ")) {
    if (words.some((x) => x === w)) total += 40;
    else if (words.some((x) => x.startsWith(w))) total += 30;
    else if (t.includes(w)) total += 12;
    else {
      total = -1;
      break;
    }
  }
  if (total >= 0) return total + (t.startsWith(q) ? 15 : 0) - t.length * 0.05;
  // loose fallback: letters in order
  let ti = 0;
  for (const ch of q.replace(/ /g, "")) {
    const f = t.indexOf(ch, ti);
    if (f < 0) return -1;
    ti = f + 1;
  }
  return 4;
}

