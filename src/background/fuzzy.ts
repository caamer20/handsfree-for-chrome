export function normalize(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min((next[j - 1] ?? 0) + 1, (row[j] ?? 0) + 1, (row[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length] ?? 0;
}
export function fuzzyScore(query: string, title: string, url: string): number {
  const q = normalize(query).slice(0, 120);
  if (!q) return 0;
  const fields = [normalize(title).slice(0, 500), normalize(url.replace(/^https?:\/\//, '').replace(/^www\./, '')).slice(0, 500)];
  return Math.max(...fields.map((field) => {
    if (field === q) return 1;
    if (field.includes(q)) return 0.9 + Math.min(q.length / Math.max(field.length, 1), 1) * 0.09;
    const words = field.split(' ').filter(Boolean);
    const tokens = q.split(' ');
    if (!tokens.every((token) => words.some((w) => w === token || (token.length >= 4 && w.length >= 4 && distance(token, w) <= (token.length > 6 ? 2 : 1))))) return 0;
    return 0.75;
  }));
}
export function bestMatch<T extends { title?: string; url?: string }>(items: T[], query: string): T | undefined {
  return items.map(item => ({ item, score: fuzzyScore(query, item.title ?? '', item.url ?? '') })).filter(({ score }) => score >= 0.7).sort((a, b) => b.score - a.score)[0]?.item;
}
