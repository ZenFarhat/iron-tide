import { describe, expect, test } from "bun:test";
import { World, type GameSettings } from "../sim/world";
import { LEP } from "../sim/fixed";
import { MAPS } from "../sim/maps";
import { THEMES, T_ICE, T_WATER, type Theme } from "../sim/map";
import { RULES, SUPERWEAPONS } from "../sim/rules";
import type { Entity } from "../sim/entity";
import type { Command } from "../sim/commands";

const C = (x: number) => x * LEP + LEP / 2;

function world(settings: Partial<GameSettings>, factions = "SC", ai = false) {
  const w = new World({ seed: 7, mapSize: 64, credits: 20000, startUnits: 0, superweapons: true, shortGame: false, wildlife: false, ...settings }, [
    ...factions.split("").map((f, i) => ({ name: "P" + i, faction: f as any, color: i, team: 0, ai: ai ? ("hard" as const) : null })),
  ]);
  return w;
}

/** empty sandbox: everything revealed, starting units removed */
function sandbox(settings: Partial<GameSettings> = {}, factions = "SC") {
  const w = world(settings, factions);
  for (const e of w.ents) if (e.owner >= 0) e.dead = true;
  w.step([]);
  for (const p of w.players) p.explored.fill(1);
  return w;
}

function run(w: World, n: number, cmds: [number, Command][] = []) {
  w.step(cmds);
  for (let i = 1; i < n; i++) w.step([]);
}

/** a w×h rectangle whose cells all satisfy ok() */
function findRect(w: World, wd: number, ht: number, ok: (i: number) => boolean, near = [0, 0]): [number, number] {
  const m = w.map;
  let best: [number, number] | null = null,
    bd = Infinity;
  for (let y = 1; y + ht < m.h - 1; y++)
    for (let x = 1; x + wd < m.w - 1; x++) {
      let good = true;
      for (let yy = y; good && yy < y + ht; yy++) for (let xx = x; good && xx < x + wd; xx++) good = ok(yy * m.w + xx) && !w.bldAt[yy * m.w + xx];
      const d = (x - near[0]) ** 2 + (y - near[1]) ** 2;
      if (good && d < bd) {
        bd = d;
        best = [x, y];
      }
    }
  if (!best) throw new Error("no rect");
  return best;
}

describe("maps & biomes", () => {
  for (const def of MAPS)
    test(`${def.name} builds fair and connected`, () => {
      for (const n of def.sym === 4 ? [2, 3, 4] : [2]) {
        const w = world({ map: def.id, seed: 3 }, "CDSC".slice(0, n));
        const m = w.map;
        expect(m.theme).toBe(def.theme);
        expect(m.starts.length).toBeGreaterThanOrEqual(n);
        // every start can reach every other on foot
        const s0 = m.starts[0];
        const seen = new Uint8Array(m.w * m.h);
        const q = [s0.y * m.w + s0.x];
        seen[q[0]] = 1;
        for (let h = 0; h < q.length; h++) {
          const i = q[h];
          for (const k of [i - 1, i + 1, i - m.w, i + m.w]) {
            if (k < 0 || k >= seen.length || seen[k] || Math.abs((k % m.w) - (i % m.w)) > 1 || !m.groundOk(k)) continue;
            seen[k] = 1;
            q.push(k);
          }
        }
        for (const s of m.starts) expect(seen[s.y * m.w + s.x]).toBe(1);
        // same ore on every side
        const ore = m.starts.map((s) => {
          let n = 0;
          for (let y = s.y - 16; y <= s.y + 16; y++) for (let x = s.x - 16; x <= s.x + 16; x++) if (m.inside(x, y) && m.oreType[y * m.w + x]) n++;
          return n;
        });
        expect(Math.max(...ore) - Math.min(...ore)).toBeLessThanOrEqual(2);
      }
    });

  test("hand-made maps are identical for the same seed", () => {
    for (const def of MAPS) {
      const a = world({ map: def.id, seed: 11 }),
        b = world({ map: def.id, seed: 11 });
      expect(Buffer.from(a.map.terrain).equals(Buffer.from(b.map.terrain))).toBe(true);
      expect(Buffer.from(a.map.ore).equals(Buffer.from(b.map.ore))).toBe(true);
    }
  });

  test("every biome generates; frozen biomes have ice, wild biomes have herds", () => {
    for (const { id } of THEMES) {
      let ice = 0,
        herds = 0;
      for (let seed = 1; seed <= 4; seed++) {
        const w = world({ theme: id as Theme, seed, mapSize: 72, wildlife: true });
        ice += w.map.terrain.filter((t) => t === T_ICE).length;
        herds += w.ents.filter((e) => e.r.animal).length;
      }
      if (id === "snow" || id === "tundra") expect(ice).toBeGreaterThan(0);
      else expect(ice).toBe(0);
      if (id === "temperate") expect(herds).toBe(0);
      else expect(herds).toBeGreaterThan(8);
    }
  });

  test("wildlife can be switched off", () => {
    const w = world({ map: "serengeti", wildlife: false });
    expect(w.ents.some((e) => e.r.animal)).toBe(false);
  });
});

describe("naval & hover", () => {
  test("naval yards only go on water and launch ships that stay afloat", () => {
    const w = sandbox({ map: "twin_rivers" }, "CD");
    const p = w.players[0];
    const W = w.map.w;
    const [wx, wy] = findRect(w, 3, 3, (i) => w.map.terrain[i] === T_WATER, [27, 52]);
    // anchor buildings on the shore so the yard is within build radius
    const [lx, ly] = findRect(w, 3, 3, (i) => w.map.buildableTerrain(i), [wx, wy]);
    w.addStructure("c_hub", 0, lx, ly, true);
    const [px, py] = findRect(w, 2, 2, (i) => w.map.buildableTerrain(i), [lx, ly]);
    w.addStructure("c_power", 0, px, py, true);
    w.step([]);
    expect(w.placementOk(p, "c_navyard", wx, wy)).toBe(true);
    expect(w.placementOk(p, "c_navyard", lx + 4, ly)).toBe(false); // dry land
    const yard = w.addStructure("c_navyard", 0, wx, wy, true)!;
    p.credits = 50000;
    w.step([[0, { c: "build", type: "c_cutter", n: 2 }]]);
    for (let i = 0; i < 4000 && w.ents.filter((e) => e.type === "c_cutter").length < 2; i++) w.step([]);
    const ships = w.ents.filter((e) => e.type === "c_cutter");
    expect(ships.length).toBe(2);
    // ordered onto dry land, they stop at the water's edge
    run(w, 600, [[0, { c: "move", ids: ships.map((s) => s.id), x: lx + 1, y: ly + 1 }]]);
    for (const s of ships) expect(w.map.waterOk(s.cell)).toBe(true);
    void yard;
    void W;
  });

  test("hovercraft cross water that tanks cannot", () => {
    const w = sandbox({ map: "twin_rivers" }, "SD");
    // a hovertank on the player-0 bank of the river, ordered across to the middle strip
    const from = [14, 50],
      to = [36, 44];
    const hov = w.spawnUnit("s_corsair", 0, C(from[0]), C(from[1]))!;
    const tank = w.spawnUnit("d_bastion", 1, C(from[0] + 1), C(from[1] + 1))!;
    let crossed = false;
    w.step([
      [0, { c: "move", ids: [hov.id], x: to[0], y: to[1] }],
      [1, { c: "move", ids: [tank.id], x: to[0], y: to[1] }],
    ]);
    for (let i = 0; i < 900; i++) {
      w.step([]);
      if (w.map.terrain[hov.cell] === T_WATER) crossed = true;
      expect(w.map.terrain[tank.cell]).not.toBe(T_WATER);
    }
    expect(crossed).toBe(true);
  });
});

describe("syndicate", () => {
  test("salvage pays out for every enemy destroyed", () => {
    const w = sandbox({}, "SC");
    const p = w.players[0];
    const before = p.credits;
    const [x, y] = findRect(w, 6, 3, (i) => w.map.buildableTerrain(i), [30, 30]);
    const tank = w.spawnUnit("s_corsair", 0, C(x), C(y))!;
    const victim = w.spawnUnit("c_rover", 1, C(x + 4), C(y))!;
    victim.hp = 1;
    run(w, 200, [[0, { c: "attack", ids: [tank.id], t: victim.id }]]);
    expect(w.get(victim.id)).toBeUndefined();
    expect(p.credits - before).toBe(Math.floor(RULES.c_rover.cost / 4));
    expect(p.stats.salvage).toBe(Math.floor(RULES.c_rover.cost / 4));
  });

  test("blackout freezes enemy vehicles and defenses, not our own", () => {
    const w = sandbox({}, "SC");
    const [x, y] = findRect(w, 8, 4, (i) => w.map.buildableTerrain(i), [32, 32]);
    const mast = w.addStructure("s_blackout", 0, x, y, true)!;
    mast.swCharge = SUPERWEAPONS.blackout.charge;
    for (let k = 0; k < 2; k++) w.addStructure("s_power", 0, ...findRect(w, 2, 2, (i) => w.map.buildableTerrain(i), [x - 4, y]), true);
    const foe = w.spawnUnit("c_warden", 1, C(x + 5), C(y + 1))!;
    // unarmed, so it can't finish off the frozen tank before the pulse wears off
    const mine = w.spawnUnit("mhv", 0, C(x + 6), C(y + 2))!;
    run(w, 2, [[0, { c: "sw", kind: "blackout", x: x + 5, y: y + 1 }]]);
    expect(foe.disabledUntil).toBeGreaterThan(w.tick);
    expect(mine.disabledUntil).toBe(0);
    const fx = foe.x,
      fy = foe.y;
    run(w, 100, [[1, { c: "move", ids: [foe.id], x: x + 7, y: y + 3 }]]);
    expect([foe.x, foe.y]).toEqual([fx, fy]);
    run(w, 400);
    expect(foe.dead).toBe(false);
    expect(foe.x !== fx || foe.y !== fy).toBe(true);
  });

  test("the barrage array shells the target area", () => {
    const w = sandbox({}, "SC");
    const [x, y] = findRect(w, 3, 3, (i) => w.map.buildableTerrain(i), [12, 12]);
    const arr = w.addStructure("s_barrage", 0, x, y, true)!;
    arr.swCharge = SUPERWEAPONS.barrage.charge;
    for (let k = 0; k < 2; k++) w.addStructure("s_power", 0, ...findRect(w, 2, 2, (i) => w.map.buildableTerrain(i), [x + 4, y]), true);
    const [tx, ty] = findRect(w, 2, 2, (i) => w.map.buildableTerrain(i), [44, 44]);
    const target = w.addStructure("c_power", 1, tx, ty, true)!;
    const hp0 = target.hp;
    run(w, 400, [[0, { c: "sw", kind: "barrage", x: tx, y: ty }]]);
    expect(target.dead || target.hp < hp0).toBe(true);
  });
});

describe("wildlife", () => {
  function safari() {
    const w = world({ map: "serengeti", wildlife: true, seed: 5 }, "CD");
    for (const e of w.ents) if (e.owner >= 0) e.dead = true;
    w.step([]);
    return w;
  }

  test("herds graze and wander around their range", () => {
    const w = safari();
    const zebras = w.ents.filter((e) => e.type === "a_zebra");
    expect(zebras.length).toBeGreaterThan(0);
    const start = zebras.map((z) => [z.x, z.y]);
    run(w, 1200);
    const moved = zebras.filter((z, i) => z.x !== start[i][0] || z.y !== start[i][1]).length;
    expect(moved).toBeGreaterThan(zebras.length / 2);
  });

  test("lions hunt nearby infantry, and the infantry fights back", () => {
    const w = safari();
    const lion = w.ents.find((e) => e.type === "a_lion")!;
    const herd = w.herds[lion.herd];
    const cell = (herd.y + 1) * w.map.w + herd.x + 2;
    const prey = w.spawnUnit("c_trooper", 0, C(herd.x + 2), C(herd.y + 1))!;
    void cell;
    let hunted = false,
      shotBack = false;
    for (let i = 0; i < 600 && !(hunted && shotBack); i++) {
      w.step([]);
      for (const ev of w.events) {
        if (ev.e === "fire" && ev.owner < 0 && ev.t === prey.id) hunted = true;
        if (ev.e === "fire" && ev.owner === 0) shotBack = true;
      }
      w.events.length = 0;
    }
    expect(hunted).toBe(true);
    expect(shotBack).toBe(true);
  });

  test("grazers bolt when shot, elephants charge", () => {
    const w = safari();
    const zebra = w.ents.find((e) => e.type === "a_zebra")!;
    const ele = w.ents.find((e) => e.type === "a_elephant")!;
    const near = (a: Entity) => w.spawnUnit("c_warden", 0, a.x + 3 * LEP, a.y)!;
    const t1 = near(zebra),
      t2 = near(ele);
    const z0 = [zebra.x, zebra.y];
    w.step([
      [0, { c: "attack", ids: [t1.id], t: zebra.id }],
      [0, { c: "attack", ids: [t2.id], t: ele.id }],
    ]);
    for (let i = 0; i < 60; i++) w.step([]);
    // the zebra is running (or already dead); the elephant is charging its attacker
    expect(zebra.dead || zebra.order === "move" || Math.hypot(zebra.x - z0[0], zebra.y - z0[1]) > LEP).toBe(true);
    expect(ele.dead || (ele.order === "attack" && ele.target === t2.id)).toBe(true);
  });
});

describe("determinism with everything on", () => {
  test("two worlds stay in lockstep across new factions, navies and wildlife", () => {
    for (const map of ["archipelago", "serengeti"]) {
      const mk = () => world({ map, wildlife: true, seed: 21, credits: 10000, startUnits: 3 }, "SDCS", true);
      const a = mk(),
        b = mk();
      for (let i = 0; i < 20 * 60 * 4; i++) {
        a.step([]);
        b.step([]);
        a.events.length = b.events.length = 0;
        if (i % 400 === 0) expect(a.hash()).toBe(b.hash());
      }
      expect(a.hash()).toBe(b.hash());
    }
  });
});
