// Wildlife: neutral animals (owner -1) that live inside the simulation. Grazers wander around
// their herd's home range and bolt together when shot; big animals turn on attackers; predators
// hunt infantry that strays into their range but give up the chase beyond a leash. Herd homes
// drift slowly, so herds migrate across the map over a match. Uses the world RNG, so it stays
// in lockstep like everything else.
import type { Entity } from "./entity";
import type { Herd, World } from "./world";
import { LEP, dist2 } from "./fixed";
import { nearestFreeCell, setMoveGoal, stopUnit } from "./units";

const THINK = 15; // ticks between decisions for each animal
const ROAM = 5; // cells a herd member wanders from home
const LEASH = 9; // cells from home a predator will chase prey
const PANIC = 60; // ticks a hit keeps an animal alarmed
const DRIFT = 1200; // ticks between herd migrations

export function updateWildlife(w: World) {
  if (w.tick % DRIFT === DRIFT / 2) for (const h of w.herds) drift(w, h);
  for (const e of w.ents) {
    if (e.dead || !e.r.animal || (w.tick + e.id) % THINK !== 0) continue;
    think(w, e);
  }
}

function homeOf(w: World, e: Entity): [number, number] {
  const h = w.herds[e.herd];
  return h ? [h.x, h.y] : [e.cell % w.map.w, (e.cell / w.map.w) | 0];
}

function think(w: World, e: Entity) {
  const a = e.r.animal!;
  const W = w.map.w;
  const [hx, hy] = homeOf(w, e);
  const cx = e.cell % W,
    cy = (e.cell / W) | 0;

  // 1. under attack: fight back or bolt, and the herd reacts with it
  const attacker = w.tick - e.attackedAt < PANIC ? w.get(e.attackerId) : undefined;
  if (attacker && attacker.kind !== "air" && !attacker.r.animal) {
    if (a.diet === "predator" || a.big) {
      charge(e, attacker);
      for (const o of herdMates(w, e)) if (o.r.animal!.big || o.r.animal!.diet === "predator") charge(o, attacker);
    } else {
      flee(w, e, attacker);
      for (const o of herdMates(w, e)) if (o.order !== "attack" && !o.r.animal!.big) flee(w, o, attacker);
    }
    return;
  }

  // 2. on the hunt (or charging): break off once the quarry leaves the home range
  if (e.order === "attack") {
    const t = w.get(e.target);
    if (!t || dist2(t.x >> 8, t.y >> 8, hx, hy) > LEASH * LEASH) {
      stopUnit(w, e);
      roam(w, e, hx, hy, 2);
    }
    return;
  }

  // 3. predators stalk infantry that wanders into their territory
  if (a.diet === "predator") {
    let prey: Entity | null = null,
      bd = Infinity;
    w.forNear(e.x, e.y, e.r.sight * LEP, (o) => {
      if (o.kind !== "inf" || o.owner < 0 || o.r.animal) return;
      if (dist2(o.x >> 8, o.y >> 8, hx, hy) > LEASH * LEASH) return;
      const d = dist2(o.x, o.y, e.x, e.y);
      if (d < bd || (d === bd && prey && o.id < prey.id)) {
        bd = d;
        prey = o;
      }
    });
    if (prey) {
      charge(e, prey);
      for (const o of herdMates(w, e)) if (o.order !== "attack") charge(o, prey);
      return;
    }
  }

  // 4. graze: drift around home, and head back if the herd has moved on
  if (e.order !== "idle") return;
  if (dist2(cx, cy, hx, hy) > (ROAM + 3) * (ROAM + 3)) roam(w, e, hx, hy, 2);
  else if (w.rng.int(100) < 22) roam(w, e, hx, hy, ROAM);
}

function herdMates(w: World, e: Entity): Entity[] {
  if (e.herd < 0) return [];
  const out: Entity[] = [];
  w.forNear(e.x, e.y, 8 * LEP, (o) => {
    if (o !== e && o.herd === e.herd && o.r.animal) out.push(o);
  });
  return out;
}

function charge(e: Entity, t: Entity) {
  if (!e.r.wGround) return;
  if (e.order === "attack" && e.target === t.id) return;
  e.order = "attack";
  e.target = t.id;
  e.autoTarget = false;
  e.repathAt = 0;
}

function flee(w: World, e: Entity, from: Entity) {
  const dx = e.x - from.x,
    dy = e.y - from.y;
  const m = Math.max(Math.abs(dx), Math.abs(dy), 1);
  const W = w.map.w;
  const tx = (e.cell % W) + Math.trunc((dx * 7) / m),
    ty = ((e.cell / W) | 0) + Math.trunc((dy * 7) / m);
  const cell = nearestFreeCell(w, Math.max(0, Math.min(W - 1, tx)), Math.max(0, Math.min(w.map.h - 1, ty)), true);
  if (cell < 0) return;
  e.target = 0;
  setMoveGoal(w, e, cell, w.rng.int(5));
  e.order = "move";
}

function roam(w: World, e: Entity, hx: number, hy: number, r: number) {
  const m = w.map;
  const x = hx + w.rng.range(-r, r),
    y = hy + w.rng.range(-r, r);
  if (!m.inside(x, y)) return;
  const i = y * m.w + x;
  if (!w.canEnter(e, i) || w.vehAt[i] || w.infAt[i] >= 3 || w.bldAt[i]) return;
  setMoveGoal(w, e, i, w.rng.int(5));
  e.order = "move";
}

/** shift a herd's home a few cells, steering clear of anyone's base */
function drift(w: World, h: Herd) {
  const m = w.map;
  for (let tries = 0; tries < 4; tries++) {
    const x = h.x + w.rng.range(-4, 4),
      y = h.y + w.rng.range(-4, 4);
    if (!m.inside(x, y) || !m.groundOk(y * m.w + x)) continue;
    let nearBase = false;
    w.forNear(x * LEP, y * LEP, 10 * LEP, (o) => {
      if (o.kind === "bld" && o.owner >= 0) nearBase = true;
    });
    if (nearBase) continue;
    h.x = x;
    h.y = y;
    return;
  }
}
