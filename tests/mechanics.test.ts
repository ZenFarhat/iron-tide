import { describe, expect, test } from "bun:test";
import { World } from "../sim/world";
import { LEP } from "../sim/fixed";
import { SUPERWEAPONS } from "../sim/rules";
import type { Command } from "../sim/commands";

const C = (x: number) => x * LEP + LEP / 2;

/** two-player sandbox with everything revealed and no starting units */
function sandbox(seed = 11) {
  const w = new World({ seed, mapSize: 64, credits: 20000, startUnits: 0, superweapons: true, shortGame: false }, [
    { name: "A", faction: "C", color: 0, team: 0, ai: null },
    { name: "B", faction: "D", color: 1, team: 0, ai: null },
  ]);
  for (const e of w.ents) if (e.owner >= 0) e.dead = true;
  w.step([]);
  for (const p of w.players) p.explored.fill(1);
  return w;
}

/** find an open, buildable rectangle */
function openSpot(w: World, wd: number, ht: number, near = [20, 20]): [number, number] {
  for (let r = 0; r < 30; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const x = near[0] + dx,
          y = near[1] + dy;
        let ok = x > 1 && y > 1 && x + wd < w.map.w - 1 && y + ht < w.map.h - 1;
        for (let yy = y - 1; ok && yy <= y + ht; yy++)
          for (let xx = x - 1; ok && xx <= x + wd; xx++) {
            const i = yy * w.map.w + xx;
            if (!w.map.buildableTerrain(i) || w.bldAt[i] || w.vehAt[i]) ok = false;
          }
        if (ok) return [x, y];
      }
  throw new Error("no spot");
}

function run(w: World, n: number, cmds: [number, Command][] = []) {
  w.step(cmds);
  for (let i = 1; i < n; i++) w.step([]);
}

describe("mechanics", () => {
  test("harvester mines ore and unloads credits", () => {
    const w = sandbox();
    // refinery near an ore field
    let ore = -1;
    for (let i = 0; i < w.map.w * w.map.h; i++) if (w.map.oreType[i] === 1 && w.map.ore[i] > 6) (ore = i);
    const ox = ore % w.map.w,
      oy = Math.floor(ore / w.map.w);
    const [bx, by] = openSpot(w, 3, 4, [ox + 4, oy + 4]);
    w.addStructure("c_power", 0, ...openSpot(w, 2, 2, [bx - 4, by]), true);
    const ref = w.addStructure("c_refinery", 0, bx, by, true)!;
    const harv = w.ents.find((e) => e.type === "c_harv" && e.owner === 0)!;
    expect(harv).toBeDefined();
    const before = w.players[0].credits;
    run(w, 20 * 120);
    expect(w.players[0].stats.harvested).toBeGreaterThan(0);
    expect(w.players[0].credits).toBeGreaterThan(before);
    expect(ref.dead).toBe(false);
  });

  test("engineer captures an enemy structure", () => {
    const w = sandbox();
    const [bx, by] = openSpot(w, 2, 2, [30, 30]);
    const b = w.addStructure("d_power", 1, bx, by, true)!;
    const eng = w.spawnUnit("engineer", 0, C(bx - 3), C(by + 1))!;
    run(w, 200, [[0, { c: "enter", ids: [eng.id], t: b.id }]]);
    expect(b.owner).toBe(0);
    expect(w.get(eng.id)).toBeUndefined();
  });

  test("engineer fully repairs own structure", () => {
    const w = sandbox();
    const [bx, by] = openSpot(w, 2, 2, [30, 30]);
    const b = w.addStructure("c_power", 0, bx, by, true)!;
    b.hp = 100;
    const eng = w.spawnUnit("engineer", 0, C(bx - 3), C(by + 1))!;
    run(w, 200, [[0, { c: "enter", ids: [eng.id], t: b.id }]]);
    expect(b.hp).toBe(b.r.hp);
  });

  test("tanks crush enemy infantry", () => {
    const w = sandbox();
    const [x, y] = openSpot(w, 6, 1, [25, 25]);
    const tank = w.spawnUnit("d_bastion", 1, C(x), C(y))!;
    const inf = w.spawnUnit("c_trooper", 0, C(x + 4), C(y))!;
    inf.order = "guard"; // keep it from wandering
    run(w, 200, [[1, { c: "move", ids: [tank.id], x: x + 5, y }]]);
    expect(w.get(inf.id)).toBeUndefined();
  });

  test("deployed trooper switches to its heavy machine gun", () => {
    const w = sandbox();
    const t = w.spawnUnit("c_trooper", 0, C(20), C(20))!;
    run(w, 5, [[0, { c: "deploy", ids: [t.id] }]]);
    expect(t.deployed).toBe(true);
    // fires faster: target dummy
    const dummy = w.spawnUnit("d_levy", 1, C(23), C(20))!;
    dummy.hp = 10000;
    run(w, 100);
    expect(dummy.hp).toBeLessThan(10000 - 15 * 10);
  });

  test("selling refunds half the cost", () => {
    const w = sandbox();
    const [bx, by] = openSpot(w, 2, 2, [30, 30]);
    const b = w.addStructure("c_power", 0, bx, by, true)!;
    const c0 = w.players[0].credits;
    run(w, 40, [[0, { c: "sell", t: b.id }]]);
    expect(w.get(b.id)).toBeUndefined();
    expect(w.players[0].credits - c0).toBe(400);
  });

  test("low power slows production", () => {
    const w = sandbox();
    const [hx, hy] = openSpot(w, 3, 3, [20, 20]);
    w.addStructure("c_hub", 0, hx, hy, true);
    const [bx, by] = openSpot(w, 2, 2, [hx + 5, hy]);
    w.addStructure("c_barracks", 0, bx, by, true);
    w.step([]);
    // barracks drains 10 with no power → low power
    expect(w.players[0].lowPower).toBe(true);
    run(w, 100, [[0, { c: "build", type: "hound" }]]);
    const slow = w.players[0].queues.inf[0]?.progress ?? 1e9;
    const w2 = sandbox();
    const s2 = openSpot(w2, 3, 3, [20, 20]);
    w2.addStructure("c_hub", 0, s2[0], s2[1], true);
    const b2 = openSpot(w2, 2, 2, [s2[0] + 5, s2[1]]);
    w2.addStructure("c_barracks", 0, b2[0], b2[1], true);
    w2.addStructure("c_power", 0, ...openSpot(w2, 2, 2, [s2[0], s2[1] + 5]), true);
    w2.step([]);
    expect(w2.players[0].lowPower).toBe(false);
    run(w2, 100, [[0, { c: "build", type: "hound" }]]);
    const fast = w2.players[0].queues.inf[0]?.progress ?? 0;
    expect(slow).toBeLessThan(fast);
  });

  test("jets fire their ammo and return to rearm", () => {
    const w = sandbox();
    const [hx, hy] = openSpot(w, 3, 3, [15, 15]);
    w.addStructure("c_hub", 0, hx, hy, true);
    w.addStructure("c_power", 0, ...openSpot(w, 2, 2, [hx + 4, hy]), true);
    const ac = w.addStructure("c_aircmd", 0, ...openSpot(w, 3, 3, [hx, hy + 5]), true)!;
    const [tx, ty] = openSpot(w, 2, 2, [40, 40]);
    const target = w.addStructure("d_power", 1, tx, ty, true)!;
    w.step([[0, { c: "build", type: "c_striker" }]]);
    run(w, 1500);
    const jet = w.ents.find((e) => e.type === "c_striker")!;
    expect(jet).toBeDefined();
    expect(ac.pads).toContain(jet.id);
    const hp0 = target.hp;
    run(w, 600, [[0, { c: "attack", ids: [jet.id], t: target.id }]]);
    expect(target.hp).toBeLessThan(hp0);
    expect(jet.air).toBe("landed");
  });

  test("veterancy is earned from kills", () => {
    const w = sandbox();
    const t = w.spawnUnit("c_warden", 0, C(20), C(20))!;
    for (let i = 0; i < 3; i++) {
      const v = w.spawnUnit("d_hauler", 1, C(23), C(20 + i))!;
      v.hp = 1;
    }
    run(w, 200);
    expect(t.rank).toBeGreaterThanOrEqual(1);
  });

  test("nuke charges and devastates the target", () => {
    const w = sandbox();
    const [hx, hy] = openSpot(w, 3, 3, [12, 12]);
    w.addStructure("d_reactor", 1, hx, hy, true);
    const silo = w.addStructure("d_silo", 1, ...openSpot(w, 3, 3, [hx + 5, hy]), true)!;
    silo.swCharge = SUPERWEAPONS.nuke.charge;
    const [tx, ty] = openSpot(w, 2, 2, [45, 45]);
    const victim = w.addStructure("c_power", 0, tx, ty, true)!;
    const inf = w.spawnUnit("c_trooper", 0, C(tx + 3), C(ty))!;
    run(w, 300, [[1, { c: "sw", kind: "nuke", x: tx + 1, y: ty + 1 }]]);
    expect(w.get(victim.id)).toBeUndefined();
    expect(w.get(inf.id)).toBeUndefined();
    expect(silo.swCharge).toBeLessThan(SUPERWEAPONS.nuke.charge);
  });

  test("bulwark field makes vehicles invulnerable and kills infantry", () => {
    const w = sandbox();
    const [hx, hy] = openSpot(w, 3, 3, [12, 12]);
    w.addStructure("d_reactor", 1, hx, hy, true);
    const pj = w.addStructure("d_bulwark", 1, ...openSpot(w, 3, 3, [hx + 5, hy]), true)!;
    pj.swCharge = SUPERWEAPONS.bulwark.charge;
    const tank = w.spawnUnit("d_bastion", 1, C(30), C(30))!;
    const inf = w.spawnUnit("d_levy", 1, C(30), C(31))!;
    run(w, 3, [[1, { c: "sw", kind: "bulwark", x: 30, y: 30 }]]);
    expect(tank.invuln).toBeGreaterThan(w.tick);
    expect(w.get(inf.id)).toBeUndefined();
  });

  test("phase gate teleports vehicles", () => {
    const w = sandbox();
    const [hx, hy] = openSpot(w, 3, 3, [12, 12]);
    w.addStructure("c_power", 0, hx, hy, true);
    w.addStructure("c_power", 0, hx + 3, hy, true);
    const pg = w.addStructure("c_phasegate", 0, ...openSpot(w, 3, 3, [hx, hy + 5]), true)!;
    pg.swCharge = SUPERWEAPONS.phase.charge;
    const [sx, sy] = openSpot(w, 1, 1, [25, 25]);
    const tank = w.spawnUnit("c_warden", 0, C(sx), C(sy))!;
    const [dx, dy] = openSpot(w, 2, 2, [45, 40]);
    run(w, 3, [[0, { c: "sw", kind: "phase", x: sx, y: sy, x2: dx, y2: dy }]]);
    expect(Math.abs((tank.x >> 8) - dx) + Math.abs((tank.y >> 8) - dy)).toBeLessThan(4);
  });

  test("lumen spires relay power into each other", () => {
    const w = sandbox();
    w.addStructure("c_power", 0, ...openSpot(w, 2, 2, [20, 20]), true);
    w.addStructure("c_power", 0, ...openSpot(w, 2, 2, [16, 16]), true);
    const s1 = w.addStructure("c_spire", 0, 30, 30, true)!;
    w.addStructure("c_spire", 0, 32, 30, true);
    w.addStructure("c_spire", 0, 30, 32, true);
    const tank = w.spawnUnit("d_titan", 1, C(36), C(31))!;
    tank.hp = 100000;
    let support = 0;
    for (let i = 0; i < 120; i++) {
      w.step([]);
      support += w.events.filter((e) => e.e === "support").length;
      w.events.length = 0;
    }
    expect(support).toBeGreaterThan(0);
    void s1;
  });

  test("mcv deploys and hub packs back up", () => {
    const w = sandbox();
    const [x, y] = openSpot(w, 3, 3, [20, 20]);
    const mcv = w.spawnUnit("mhv", 0, C(x + 1), C(y + 1))!;
    run(w, 2, [[0, { c: "deploy", ids: [mcv.id] }]]);
    const hub = w.ents.find((e) => e.type === "c_hub")!;
    expect(hub).toBeDefined();
    run(w, 60);
    run(w, 2, [[0, { c: "deploy", ids: [hub.id] }]]);
    expect(w.ents.some((e) => e.type === "mhv" && e.owner === 0)).toBe(true);
  });
});
