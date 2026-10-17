import { describe, expect, test } from "bun:test";
import { World } from "../sim/world";
import { LEP, facingTo } from "../sim/fixed";
import { AIR_Z } from "../sim/units";
import { SUPERWEAPONS } from "../sim/rules";
import { killEntity } from "../sim/combat";
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

  test("airfield parks four jets on separate pads and replaces lost ones", () => {
    const w = sandbox();
    const [hx, hy] = openSpot(w, 3, 3, [15, 15]);
    w.addStructure("c_hub", 0, hx, hy, true);
    w.addStructure("c_power", 0, ...openSpot(w, 2, 2, [hx + 4, hy]), true);
    w.addStructure("c_power", 0, ...openSpot(w, 2, 2, [hx + 4, hy + 3]), true);
    const ac = w.addStructure("c_aircmd", 0, ...openSpot(w, 3, 3, [hx, hy + 5]), true)!;
    const jets = () => w.ents.filter((e) => !e.dead && e.type === "c_striker");
    w.players[0].credits = 50000;
    w.step([[0, { c: "build", type: "c_striker", n: 5 }]]);
    for (let i = 0; i < 20000 && jets().length < 4; i++) w.step([]);
    expect(jets().length).toBe(4);
    expect(new Set(jets().map((j) => `${j.x},${j.y}`)).size).toBe(4);
    // the fifth waits for a pad, then launches once one frees up
    run(w, 3000);
    expect(jets().length).toBe(4);
    killEntity(w, jets()[0], null, "explode");
    run(w, 5);
    expect(jets().length).toBe(4);
    expect(ac.pads.filter((id) => w.get(id)).length).toBe(4);
  });

  test("jets ordered to another airfield give up their old pad", () => {
    const w = sandbox();
    const [hx, hy] = openSpot(w, 3, 3, [15, 15]);
    w.addStructure("c_hub", 0, hx, hy, true);
    w.addStructure("c_power", 0, ...openSpot(w, 2, 2, [hx + 4, hy]), true);
    w.addStructure("c_power", 0, ...openSpot(w, 2, 2, [hx + 4, hy + 3]), true);
    const a = w.addStructure("c_aircmd", 0, ...openSpot(w, 3, 3, [hx, hy + 5]), true)!;
    const b = w.addStructure("c_aircmd", 0, ...openSpot(w, 3, 3, [hx + 10, hy + 10]), true)!;
    w.step([[0, { c: "build", type: "c_striker" }]]);
    run(w, 1500);
    const jet = w.ents.find((e) => e.type === "c_striker")!;
    expect(a.pads).toContain(jet.id);
    run(w, 600, [[0, { c: "enter", ids: [jet.id], t: b.id }]]);
    expect(jet.air).toBe("landed");
    expect(jet.home).toBe(b.id);
    expect(b.pads).toContain(jet.id);
    expect(a.pads).not.toContain(jet.id);
  });

  test("jets sent somewhere fly back to their pads instead of hovering in a pile", () => {
    const w = sandbox();
    const [hx, hy] = openSpot(w, 3, 3, [15, 15]);
    w.addStructure("c_hub", 0, hx, hy, true);
    w.addStructure("c_power", 0, ...openSpot(w, 2, 2, [hx + 4, hy]), true);
    w.addStructure("c_power", 0, ...openSpot(w, 2, 2, [hx + 4, hy + 3]), true);
    const ac = w.addStructure("c_aircmd", 0, ...openSpot(w, 3, 3, [hx, hy + 5]), true)!;
    const jets = () => w.ents.filter((e) => !e.dead && e.type === "c_striker");
    w.players[0].credits = 50000;
    w.step([[0, { c: "build", type: "c_striker", n: 4 }]]);
    for (let i = 0; i < 20000 && jets().length < 4; i++) w.step([]);
    run(w, 600, [[0, { c: "move", ids: jets().map((j) => j.id), x: ac.bx + 1, y: ac.by + 8 }]]);
    expect(jets().every((j) => j.air === "landed" && ac.pads.includes(j.id))).toBe(true);
    expect(new Set(jets().map((j) => `${j.x},${j.y}`)).size).toBe(4);
  });

  test("a jet that ends up right over its target still turns and fires", () => {
    const w = sandbox();
    const [hx, hy] = openSpot(w, 3, 3, [15, 15]);
    w.addStructure("c_hub", 0, hx, hy, true);
    w.addStructure("c_power", 0, ...openSpot(w, 2, 2, [hx + 4, hy]), true);
    w.addStructure("c_aircmd", 0, ...openSpot(w, 3, 3, [hx, hy + 5]), true)!;
    const target = w.addStructure("d_power", 1, ...openSpot(w, 2, 2, [40, 40]), true)!;
    w.step([[0, { c: "build", type: "c_striker" }]]);
    run(w, 1500);
    const jet = w.ents.find((e) => e.type === "c_striker")!;
    // airborne, directly above the target and facing away from where it wants to aim
    jet.air = "flying";
    jet.x = jet.px = target.x;
    jet.y = jet.py = target.y;
    jet.z = jet.pz = AIR_Z;
    jet.facing = (facingTo(0, 0) + 128) & 255;
    const hp0 = target.hp;
    run(w, 200, [[0, { c: "attack", ids: [jet.id], t: target.id }]]);
    expect(target.hp).toBeLessThan(hp0);
  });

  test("new infantry fan out at the door and at the rally point", () => {
    const w = sandbox();
    const [hx, hy] = openSpot(w, 3, 3, [20, 20]);
    w.addStructure("c_hub", 0, hx, hy, true);
    w.addStructure("c_power", 0, ...openSpot(w, 2, 2, [hx + 4, hy]), true);
    const bar = w.addStructure("c_barracks", 0, ...openSpot(w, 2, 3, [hx - 4, hy + 4]), true)!;
    const troops = () => w.ents.filter((e) => !e.dead && e.type === "c_trooper");
    const spots = (list: typeof w.ents) => new Set(list.map((e) => `${e.x},${e.y}`)).size;
    w.step([[0, { c: "build", type: "c_trooper", n: 5 }]]);
    for (let i = 0; i < 20000 && troops().length < 5; i++) w.step([]);
    run(w, 200);
    expect(spots(troops())).toBe(5);
    const [rx, ry] = openSpot(w, 1, 1, [bar.bx - 3, bar.by + 8]);
    w.step([[0, { c: "rally", t: bar.id, x: rx, y: ry }]]);
    const first = new Set(troops().map((e) => e.id));
    w.step([[0, { c: "build", type: "c_trooper", n: 5 }]]);
    for (let i = 0; i < 20000 && troops().length < 10; i++) w.step([]);
    run(w, 300);
    const rallied = troops().filter((e) => !first.has(e.id));
    expect(spots(rallied)).toBe(5);
    for (const e of rallied) expect(Math.hypot(e.x - C(rx), e.y - C(ry))).toBeLessThan(2.5 * LEP);
  });

  test("vehicles drive to the rally point, each to its own cell", () => {
    const w = sandbox();
    const [hx, hy] = openSpot(w, 3, 3, [20, 20]);
    w.addStructure("c_hub", 0, hx, hy, true);
    w.addStructure("c_power", 0, ...openSpot(w, 2, 2, [hx + 4, hy]), true);
    w.addStructure("c_power", 0, ...openSpot(w, 2, 2, [hx + 4, hy + 3]), true);
    const fac = w.addStructure("c_factory", 0, ...openSpot(w, 3, 3, [hx - 1, hy + 5]), true)!;
    const [rx, ry] = openSpot(w, 1, 1, [fac.bx + 1, fac.by + 9]);
    w.players[0].credits = 50000;
    w.step([[0, { c: "rally", t: fac.id, x: rx, y: ry }]]);
    const tanks = () => w.ents.filter((e) => !e.dead && e.type === "c_warden");
    w.step([[0, { c: "build", type: "c_warden", n: 4 }]]);
    for (let i = 0; i < 20000 && tanks().length < 4; i++) w.step([]);
    run(w, 400);
    expect(new Set(tanks().map((e) => e.cell)).size).toBe(4);
    for (const e of tanks()) expect(Math.hypot(e.x - C(rx), e.y - C(ry))).toBeLessThan(2.5 * LEP);
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
