// Run an AI-vs-AI match headlessly and print a summary. Usage:
//   bun scripts/headless.ts [seed] [minutes] [factions e.g. CD]
import { World } from "../sim/world";
import { TPS } from "../sim/fixed";

const seed = Number(process.argv[2] ?? 1);
const minutes = Number(process.argv[3] ?? 15);
const fac = (process.argv[4] ?? "CD").split("") as ("C" | "D")[];
const w = new World(
  { seed, mapSize: 72, credits: 10000, startUnits: 3, superweapons: true, shortGame: true },
  fac.map((f, i) => ({ name: `AI ${i + 1}`, faction: f, color: i, team: 0, ai: "hard" as const })),
);
const t0 = performance.now();
let maxTick = 0;
const ticks = minutes * 60 * TPS;
for (let i = 0; i < ticks; i++) {
  const a = performance.now();
  w.step([]);
  const dt = performance.now() - a;
  if (dt > maxTick) maxTick = dt;
  w.events.length = 0;
  if (i % (TPS * 60) === 0) {
    const s = w.players.map((p) => {
      const ents = w.ents.filter((e) => e.owner === p.idx);
      return `${p.name}[${p.faction}] $${p.credits} pw ${p.powerOut}/${p.powerIn} bld ${ents.filter((e) => e.kind === "bld").length} units ${ents.filter((e) => e.kind !== "bld").length} k/l ${p.stats.kills}/${p.stats.losses} harv ${p.stats.harvested}${p.defeated ? " DEFEATED" : ""}`;
    });
    console.log(`t=${Math.floor(i / TPS / 60)}m ents=${w.ents.length} projs=${w.projs.length} | ` + s.join(" | "));
  }
  if (w.winner !== -2) {
    console.log(`Game over at ${(i / TPS / 60).toFixed(1)} min, winners: ${w.winners.map((i) => w.players[i].name).join(", ")}`);
    break;
  }
}
const el = performance.now() - t0;
console.log(`sim ${w.tick} ticks in ${el.toFixed(0)}ms (${((el / w.tick) * 1000).toFixed(0)}µs/tick avg, max ${maxTick.toFixed(1)}ms) hash=${w.hash().toString(16)}`);
