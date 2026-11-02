// Union-find over every same_product review; reports unresolved/rejected reviews whose two rows share a component.
// Usage: node consistency.mjs <repo>
import { readFileSync } from 'node:fs';
const repo = process.argv[2];
const reviews = JSON.parse(readFileSync(`${repo}/data/matching/reviews.json`, 'utf8'));
const keysOf = id => {
  const m = id.match(/^a(.+)-s(.+)$/);
  if (m) return [`akizuki/${m[1]}`, `switch-science/${m[2]}`];
  const [s1, p1, s2, p2] = JSON.parse(id); return [`${s1}/${p1}`, `${s2}/${p2}`];
};
const parent = new Map();
const find = x => { while (parent.has(x) && parent.get(x) !== x) x = parent.get(x); return x; };
const union = (a, b) => { const [ra, rb] = [find(a), find(b)]; if (ra !== rb) parent.set(ra, rb); if (!parent.has(rb)) parent.set(rb, rb); };
for (const r of reviews) if (r.decision === 'same_product') union(...keysOf(r.id));
const conflicts = reviews.filter(r => r.decision !== 'same_product' && (([a, b]) => find(a) === find(b))(keysOf(r.id)));
console.log(JSON.stringify({ reviews: reviews.length, conflicts: conflicts.map(r => `${r.id} ${r.decision}`) }));
