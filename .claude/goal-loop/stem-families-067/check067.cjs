// Usage: node check067.cjs <input groups.json> <output.json>  — prints every rule violation, exit 1 if any.
const fs = require('fs');
const [inFile, outFile] = process.argv.slice(2);
const input = JSON.parse(fs.readFileSync(inFile, 'utf8'));
let output; try { output = JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch (e) { console.log('output is not valid JSON: ' + e.message); process.exit(1); }
const errors = [];
const err = (g, m) => errors.push(`group ${g}: ${m}`);
if (!Array.isArray(output) || output.length !== input.length) errors.push(`output must be an array of ${input.length} groups`);
const BAD = /記載なし|不明|未記載|不詳|未確認|なし（記載/;
input.forEach((g, i) => {
  const o = output?.[i];
  if (!o || o.group !== g.group) return err(g.group, 'missing or out of order');
  const listing = new Map(g.listings.map(l => [l.key, l]));
  const store = k => k.split('/')[0];
  const used = new Set();
  const sets = [];
  const checkMembers = (where, members, existing, keys) => {
    for (const m of members) {
      if (!listing.has(m.key)) err(g.group, `${where}: ${m.key} is not a listing of this group`);
      if (used.has(m.key)) err(g.group, `${where}: ${m.key} used twice`); used.add(m.key);
      const l = listing.get(m.key);
      if (l?.variants) { if (!l.variants.some(v => v.offerId === m.offerId)) err(g.group, `${where}: ${m.key} needs an offerId from its variants`); }
      else if (m.offerId != null) err(g.group, `${where}: ${m.key} has no variants, offerId must be null`);
      if (typeof m.variant !== 'string' || !m.variant) err(g.group, `${where}: ${m.key} needs a variant`);
    }
    const all = [...existing, ...members];
    const keySet = JSON.stringify(Object.keys(keys ?? all[0]?.features ?? {}).sort());
    for (const m of all) {
      if (!m.features || JSON.stringify(Object.keys(m.features).sort()) !== keySet) err(g.group, `${where}: ${m.key} feature keys ${JSON.stringify(Object.keys(m.features ?? {}))} differ from ${keySet}`);
      for (const v of Object.values(m.features ?? {})) if (typeof v !== 'string' || !v || BAD.test(v)) err(g.group, `${where}: ${m.key} feature value ${JSON.stringify(v)} is not a concrete fact`);
    }
    for (const a of all) for (const b of all) if (a.key < b.key) {
      const same = JSON.stringify(a.features) === JSON.stringify(Object.fromEntries(Object.keys(a.features ?? {}).map(k => [k, b.features?.[k]])));
      if (a.variant === b.variant && !same) err(g.group, `${where}: ${a.key} and ${b.key} share variant ${a.variant} but not features`);
      if (a.variant !== b.variant && same && store(a.key) !== store(b.key)) err(g.group, `${where}: ${a.key} (${a.variant}) and ${b.key} (${b.variant}) differ in variant but in no feature value`);
    }
    for (const link of g.knownLinks) if (link.kind === 'same_product') {
      const [x, y] = link.products.map(k => all.find(m => m.key === k));
      if (x && y && x.variant !== y.variant) err(g.group, `${where}: same_product ${x.key} and ${y.key} need the same variant`);
    }
    sets.push(new Set(all.map(m => m.key)));
  };
  for (const [n, f] of (o.families ?? []).entries()) {
    const where = `family ${n + 1}`;
    if (!/[ぁ-んァ-ヶ一-龠]/.test(f.label ?? '') || !/[ぁ-んァ-ヶ一-龠]/.test(f.purpose ?? '')) err(g.group, `${where}: label and purpose must be Japanese`);
    if (new Set((f.members ?? []).map(m => store(m.key))).size < 2) err(g.group, `${where}: needs members from at least 2 shops`);
    checkMembers(where, f.members ?? [], [], null);
  }
  for (const x of o.extensions ?? []) {
    const fam = g.existingFamilies.find(f => f.id === x.family);
    if (!fam) { err(g.group, `extension: ${x.family} is not in existingFamilies`); continue; }
    for (const m of x.members ?? []) if (fam.members.some(e => e.key === m.key)) err(g.group, `extension ${x.family}: ${m.key} is already a member`);
    checkMembers(`extension ${x.family}`, x.members ?? [], fam.members, fam.members[0].features);
  }
  const covered = new Map();
  for (const d of o.dismissed ?? []) {
    const lead = g.leads.find(l => l.products[0] === d.products?.[0] && l.products[1] === d.products?.[1]);
    if (!lead) { err(g.group, `dismissed ${JSON.stringify(d.products)} is not a lead (copy products in lead order)`); continue; }
    if (!['different', 'identity'].includes(d.decision)) err(g.group, `dismissed ${d.products.join(' ~ ')}: decision must be different or identity`);
    const head = `類似候補（共通語幹: ${lead.stems.join('、')}）。`;
    if (typeof d.evidence !== 'string' || !d.evidence.startsWith(head) || d.evidence.length < 40) err(g.group, `dismissed ${d.products.join(' ~ ')}: evidence must start ${head} and have 40+ characters`);
    covered.set(lead.products.join(' ~ '), (covered.get(lead.products.join(' ~ ')) ?? 0) + 1);
  }
  for (const l of g.leads) {
    const id = l.products.join(' ~ ');
    const inFamily = sets.some(s => s.has(l.products[0]) && s.has(l.products[1]));
    const n = (covered.get(id) ?? 0) + (inFamily ? 1 : 0);
    if (n !== 1) err(g.group, `lead ${id} is ${n === 0 ? 'neither in a family nor dismissed' : 'covered more than once (family and/or dismissed)'}`);
  }
});
if (errors.length) { console.log(errors.join('\n')); console.log(`${errors.length} violation(s)`); process.exit(1); }
const sum = (f) => output.reduce((a, o) => a + f(o), 0);
console.log(`ok: families ${sum(o => (o.families ?? []).length)} / members ${sum(o => (o.families ?? []).reduce((a, f) => a + f.members.length, 0))} / extended members ${sum(o => (o.extensions ?? []).reduce((a, x) => a + x.members.length, 0))} / dismissed different ${sum(o => (o.dismissed ?? []).filter(d => d.decision === 'different').length)} / dismissed identity ${sum(o => (o.dismissed ?? []).filter(d => d.decision === 'identity').length)}`);
