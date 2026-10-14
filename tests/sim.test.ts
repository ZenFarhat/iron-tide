import { describe, expect, test } from "bun:test";
import { World } from "../sim/world";
import { Rng, facingTo, isqrt, isin, icos } from "../sim/fixed";
import type { Command } from "../sim/commands";
import { RULES } from "../sim/rules";

function makeWorld(seed: number, ai = true) {
  return new World(
    { seed, mapSize: 64, credits: 10000, startUnits: 3, superweapons: true, shortGame: true },
    [
      { name: "A", faction: "C", color: 0, team: 0, ai: ai ? "hard" : null },
      { name: "B", faction: "D", color: 1, team: 0, ai: "hard" },
    ],
  );
}

/** pseudo-random but deterministic "human" commands */
function randomCommands(w: World, rng: Rng): [number, Command][] {
  const out: [number, Command][] = [];
  if (rng.int(10) !== 0) return out;
  const mine = w.ents.filter((e) => e.owner === 0 && e.kind !== "bld");
  const ids = mine.filter(() => rng.int(2) === 0).map((e) => e.id);
  const kinds = ["move", "amove", "stop", "deploy", "scatter", "guard", "build"] as const;
  const k = kinds[rng.int(kinds.length)];
  if (k === "build") {
    const opts = Object.values(RULES).filter((r) => r.queue && (r.faction === "C" || r.faction === "*"));
    out.push([0, { c: "build", type: opts[rng.int(opts.length)].id }]);
  } else if (k === "move" || k === "amove") out.push([0, { c: k, ids, x: rng.int(w.map.w), y: rng.int(w.map.h) }]);
  else out.push([0, { c: k, ids }]);
  return out;
}

describe("fixed math", () => {
  test("isqrt exact", () => {
    for (let n = 0; n < 100000; n += 7) expect(isqrt(n)).toBe(Math.floor(Math.sqrt(n)));
    expect(isqrt(2 ** 40)).toBe(2 ** 20);
  });
  test("facingTo quadrants", () => {
    expect(facingTo(1, 0)).toBe(0);
    expect(facingTo(0, 1)).toBe(64);
    expect(facingTo(-1, 0)).toBe(128);
    expect(facingTo(0, -1)).toBe(192);
    expect(facingTo(1, 1)).toBe(32);
  });
  test("sin/cos table", () => {
    expect(isin(64)).toBe(1024);
    expect(icos(0)).toBe(1024);
    expect(icos(128)).toBe(-1024);
  });
});

describe("simulation", () => {
  test("is deterministic across independent worlds", () => {
    const a = makeWorld(42, false),
      b = makeWorld(42, false);
    const ra = new Rng(7),
      rb = new Rng(7);
    for (let i = 0; i < 6000; i++) {
      a.step(randomCommands(a, ra));
      b.step(randomCommands(b, rb));
      if (i % 200 === 0) expect(a.hash()).toBe(b.hash());
    }
    expect(a.hash()).toBe(b.hash());
  });

  test("AI builds a base and earns money", () => {
    const w = makeWorld(3);
    for (let i = 0; i < 20 * 60 * 5; i++) w.step([]);
    for (const p of w.players) {
      const blds = w.ents.filter((e) => e.owner === p.idx && e.kind === "bld");
      expect(blds.length).toBeGreaterThan(4);
      expect(p.stats.harvested).toBeGreaterThan(1000);
    }
  });

  test("mcv deploys and structures can be built and placed", () => {
    const w = makeWorld(5, false);
    const mcv = w.ents.find((e) => e.owner === 0 && e.type === "mhv")!;
    w.step([[0, { c: "deploy", ids: [mcv.id] }]]);
    for (let i = 0; i < 60; i++) w.step([]);
    const hub = w.ents.find((e) => e.owner === 0 && e.type === "c_hub");
    expect(hub).toBeDefined();
    w.step([[0, { c: "build", type: "c_power" }]]);
    for (let i = 0; i < 700 && !w.players[0].ready.bld; i++) w.step([]);
    expect(w.players[0].ready.bld).toBe("c_power");
    const before = w.players[0].credits;
    expect(before).toBe(10000 - 800);
    w.step([[0, { c: "place", type: "c_power", x: hub!.bx + 4, y: hub!.by }]]);
    expect(w.ents.some((e) => e.type === "c_power" && e.owner === 0)).toBe(true);
  });

  test("ownership is enforced", () => {
    const w = makeWorld(9, false);
    const enemy = w.ents.find((e) => e.owner === 1 && e.type === "mhv")!;
    const x0 = enemy.x;
    w.step([[0, { c: "move", ids: [enemy.id], x: 1, y: 1 }]]);
    for (let i = 0; i < 40; i++) w.step([]);
    // AI may have deployed it; either way player 0 must not have moved it to 1,1
    const e = w.ents.find((q) => q.id === enemy.id);
    if (e) expect(Math.abs(e.x - x0)).toBeLessThan(256 * 4);
  });
});
