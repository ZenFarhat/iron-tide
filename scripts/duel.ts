// Equal-cost army duels for balance tuning. Usage: bun scripts/duel.ts typeA typeB [budget]
import { World } from "../sim/world";
import { RULES } from "../sim/rules";
const [ta, tb, budgetS] = process.argv.slice(2);
const budget = Number(budgetS ?? 8000);
function duel(a: string, b: string, seed: number) {
  const w = new World({ seed, mapSize: 64, credits: 0, startUnits: 0, superweapons: false, shortGame: false }, [
    { name: "A", faction: "C", color: 0, team: 0, ai: null },
    { name: "B", faction: "D", color: 1, team: 0, ai: null },
  ]);
  for (const e of w.ents) e.dead = true;
  w.step([]);
  // find open ground band
  const na = Math.max(1, Math.floor(budget / RULES[a].cost)), nb = Math.max(1, Math.floor(budget / RULES[b].cost));
  const place = (t: string, n: number, owner: number, x0: number) => {
    const ids: number[] = [];
    for (let i = 0; i < n; i++) {
      const x = x0 + (i % 3) * (owner ? 1 : -1), y = 22 + Math.floor(i / 3);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const c = (y + dy) * w.map.w + x + dx; w.map.terrain[c] = 0; w.map.oreType[c] = 0; }
      const e = w.spawnUnit(t, owner, x * 256 + 128, y * 256 + 128, owner ? 128 : 0)!;
      if (e.r.deployable && e.kind === "inf") e.deployed = false;
      ids.push(e.id);
    }
    return ids;
  };
  for (let y = 18; y < 34; y++) for (let x = 14; x < 44; x++) { const c = y * w.map.w + x; w.map.terrain[c] = 0; w.map.oreType[c] = 0; }
  const A = place(a, na, 0, 20), B = place(b, nb, 1, 38);
  w.step([[0, { c: "amove", ids: A, x: 38, y: 24 }], [1, { c: "amove", ids: B, x: 20, y: 24 }]]);
  for (let i = 0; i < 20 * 120; i++) {
    w.step([]);
    const la = w.ents.filter((e) => e.owner === 0).length, lb = w.ents.filter((e) => e.owner === 1).length;
    if (!la || !lb) break;
  }
  const hpA = w.ents.filter((e) => e.owner === 0).reduce((s, e) => s + e.r.cost * e.hp / e.r.hp, 0);
  const hpB = w.ents.filter((e) => e.owner === 1).reduce((s, e) => s + e.r.cost * e.hp / e.r.hp, 0);
  return { na, nb, hpA: Math.round(hpA), hpB: Math.round(hpB) };
}
let sa = 0, sb = 0;
for (let s = 1; s <= 5; s++) { const r = duel(ta, tb, s); sa += r.hpA; sb += r.hpB; if (s === 1) console.log(`${r.na}x ${ta} vs ${r.nb}x ${tb}`); }
console.log(`${ta}: ${Math.round(sa / 5)}$ left   ${tb}: ${Math.round(sb / 5)}$ left  → ${sa > sb ? ta : tb}`);
