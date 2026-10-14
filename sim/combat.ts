// Weapons, projectiles, damage, death and superweapons.
import { Proj, type Entity, type Player } from "./entity";
import type { World } from "./world";
import { LEP, HALF, dist2, facingTo, isqrt } from "./fixed";
import { ARMORS, CONSTRUCT_TICKS, RULES, SUPERWEAPONS, WARHEADS, WEAPONS, type Weapon } from "./rules";
import { nearestFreeCell } from "./units";

const ARMOR_IDX: Record<string, number> = {};
ARMORS.forEach((a, i) => (ARMOR_IDX[a] = i));

export function versesFor(warhead: string, t: Entity) {
  return WARHEADS[warhead].verses[ARMOR_IDX[t.r.armor]];
}

export function weaponFor(e: Entity, t: Entity): Weapon | null {
  const air = t.flying;
  let id: string | undefined;
  if (e.r.hero && t.kind === "bld") id = "charge";
  else if (air) id = e.deployed ? e.r.deployAir : e.r.wAir;
  else id = e.deployed ? e.r.deployGround : e.r.wGround;
  if (!id) return null;
  const wp = WEAPONS[id];
  if (air ? !wp.air : !wp.ground) return null;
  if (versesFor(wp.warhead, t) <= 0) return null;
  return wp;
}

function maxRange(e: Entity): number {
  let r = 0;
  const ids = e.deployed ? [e.r.deployGround, e.r.deployAir] : [e.r.wGround, e.r.wAir];
  for (const id of ids) if (id) r = Math.max(r, WEAPONS[id].range);
  return r;
}

function armed(e: Entity) {
  return !!(e.r.wGround || e.r.wAir || e.r.deployGround);
}

/** Find best enemy target. range=0 → only within weapon range. */
export function findTarget(w: World, e: Entity, range: number): Entity | null {
  const wr = maxRange(e);
  const R = Math.max(range, wr);
  if (R <= 0) return null;
  let best: Entity | null = null,
    bs = 1e18;
  w.forNear(e.x, e.y, R, (o) => {
    if (!w.isEnemy(e.owner, o.owner) || o.r.wall) return;
    const wp = weaponFor(e, o);
    if (!wp) return;
    const d = w.distTo(e.x, e.y, o);
    if (range === 0 && d > wp.range) return;
    if (wp.minRange && d < wp.minRange) return;
    let s = d;
    if (o.kind === "bld") s += o.r.wGround || o.r.wAir ? 2 * LEP : 7 * LEP;
    else if (!armed(o)) s += 3 * LEP;
    s -= versesFor(wp.warhead, o) * 2;
    if (o.id === e.attackerId && w.tick - e.attackedAt < 60) s -= 2 * LEP;
    if (s < bs || (s === bs && best && o.id < best.id)) {
      bs = s;
      best = o;
    }
  });
  return best;
}

function vetDamage(e: Entity, dmg: number) {
  return e.rank === 2 ? Math.floor((dmg * 140) / 100) : e.rank === 1 ? Math.floor((dmg * 120) / 100) : dmg;
}
function vetRof(e: Entity, rof: number) {
  return e.rank === 2 ? Math.floor((rof * 80) / 100) : e.rank === 1 ? Math.floor((rof * 90) / 100) : rof;
}

function muzzleZ(e: Entity) {
  if (e.kind === "bld") return e.r.w > 1 ? 200 : 150;
  if (e.kind === "inf") return e.z + 40;
  if (e.kind === "air") return e.z;
  return 64;
}
function hitZ(t: Entity | null) {
  if (!t) return 0;
  if (t.kind === "bld") return 100;
  if (t.kind === "inf") return t.z + 30;
  return t.z + 40;
}

export function fireWeapon(w: World, e: Entity, wp: Weapon, t: Entity | null, tx: number, ty: number, burstCont: boolean, bonus = 0) {
  let dmg = vetDamage(e, wp.damage) + bonus;
  if (e.kind === "bld" && e.chargedUntil > w.tick) dmg = Math.floor((dmg * 150) / 100);
  if (!burstCont) {
    e.cool = vetRof(e, wp.rof);
    if ((wp.burst ?? 1) > 1) {
      e.burstLeft = wp.burst! - 1;
      e.burstTimer = wp.burstDelay ?? 5;
      e.burstTarget = t ? t.id : 0;
    }
  }
  e.lastFire = w.tick;
  const z0 = muzzleZ(e),
    tz = hitZ(t);
  w.emit({ e: "fire", id: e.id, w: wp.id, fx: wp.fx, x: e.x, y: e.y, z: z0, tx, ty, tz, t: t ? t.id : 0, owner: e.owner, bonus });
  switch (wp.proj) {
    case "instant":
    case "beam":
    case "arc":
      if (t) applyDamage(w, t, dmg, wp.warhead, e);
      explode(w, tx, ty, tz, dmg, wp.warhead, e.owner, e.id, t ? t.id : 0, false);
      if (!t || WARHEADS[wp.warhead].spread) w.emit({ e: "hit", fx: wp.fx, w: wp.id, x: tx, y: ty, z: tz });
      break;
    case "shell":
    case "missile":
    case "artillery":
    case "bomb":
    case "charge": {
      const p = new Proj(w.newId(), wp, e.owner, e.id, t ? t.id : 0, e.x, e.y, z0, tx, ty, tz, dmg);
      if (wp.proj === "bomb") {
        p.tx = e.x + (tx - e.x) / 2;
        p.ty = e.y + (ty - e.y) / 2;
        p.tz = 0;
      }
      if (wp.proj === "charge") {
        p.x = p.px = t ? t.x : tx;
        p.y = p.py = t ? t.y : ty;
        p.z = p.pz = 40;
        p.life = 50;
      }
      if (wp.proj === "artillery") {
        const d = isqrt(dist2(e.x, e.y, tx, ty));
        p.life = Math.max(10, Math.floor(d / (wp.speed ?? 40)));
      }
      w.projs.push(p);
      break;
    }
  }
}

export function applyDamage(w: World, t: Entity, dmg: number, warhead: string, attacker: Entity | null) {
  if (t.dead || dmg <= 0) return;
  if (t.invuln > w.tick) {
    w.emit({ e: "deflect", id: t.id });
    return;
  }
  if (t.kind === "bld" && t.r.capturable && t.owner < 0 && warhead !== "nuke" && warhead !== "storm") dmg = Math.floor(dmg / 2);
  const pct = versesFor(warhead, t);
  if (pct <= 0) return;
  let d = Math.floor((dmg * pct) / 100);
  if (t.rank === 1) d = Math.floor((d * 85) / 100);
  else if (t.rank === 2) d = Math.floor((d * 70) / 100);
  if (d < 1) d = 1;
  t.hp -= d;
  t.attackedAt = w.tick;
  t.attackerId = attacker ? attacker.id : 0;
  if (t.owner >= 0 && attacker && w.isEnemy(attacker.owner, t.owner)) {
    const p = w.players[t.owner];
    if (t.kind === "bld" && w.tick - p.alertAt > 300) {
      p.alertAt = w.tick;
      w.eva(t.owner, "Our base is under attack");
      w.emit({ e: "alert", owner: t.owner, x: t.x, y: t.y });
    } else if (t.r.harvester && w.tick - p.harvAlertAt > 300) {
      p.harvAlertAt = w.tick;
      w.eva(t.owner, "Harvester under attack");
      w.emit({ e: "alert", owner: t.owner, x: t.x, y: t.y });
    }
  }
  if (t.hp <= 0) {
    t.hp = 0;
    killEntity(w, t, attacker, WARHEADS[warhead].infDeath ?? "explode");
    return;
  }
  // retaliation
  if (attacker && !attacker.dead && t.kind !== "bld" && (t.order === "idle" || t.order === "guard") && !t.target && w.isEnemy(t.owner, attacker.owner)) {
    if (weaponFor(t, attacker)) {
      t.target = attacker.id;
      t.autoTarget = true;
    }
  }
}

export function killEntity(w: World, e: Entity, killer: Entity | null, death: string) {
  if (e.dead) return;
  const owner = e.owner;
  w.emit({ e: "die", id: e.id, type: e.type, kind: e.kind, x: e.x, y: e.y, z: e.z, owner, death, facing: e.facing });
  if (e.kind === "bld") {
    w.removeStructure(e, false);
    if (e.r.explodes) explode(w, e.x, e.y, 0, e.r.explodes.damage, "blast", owner, e.id, 0, true), w.emit({ e: "bigboom", x: e.x, y: e.y });
  } else {
    e.dead = true;
    if (e.kind === "veh") {
      if (w.vehAt[e.cell] === e.id) w.vehAt[e.cell] = 0;
      if (e.nextCell >= 0 && w.vehAt[e.nextCell] === e.id) w.vehAt[e.nextCell] = 0;
      for (const c of e.path) if (w.vehAt[c] === e.id) w.vehAt[c] = 0;
    }
    if (e.r.harvester) {
      const ref = w.get(e.refId);
      if (ref && ref.dockId === e.id) ref.dockId = 0;
    }
    if (e.home) {
      const h = w.get(e.home);
      if (h) {
        const k = h.pads.indexOf(e.id);
        if (k >= 0) h.pads[k] = 0;
      }
    }
    if (owner >= 0 && e.kind !== "inf" && !w.players[owner].defeated) w.eva(owner, "Unit lost");
  }
  if (owner >= 0) w.players[owner].stats.losses++;
  if (killer && killer.owner >= 0 && w.isEnemy(killer.owner, owner)) {
    w.players[killer.owner].stats.kills++;
    if (!killer.dead && killer.kind !== "bld") {
      killer.xp += e.r.cost;
      const c = Math.max(100, killer.r.cost);
      const nr = killer.xp >= 3 * c ? 2 : killer.xp >= c ? 1 : 0;
      if (nr > killer.rank) {
        killer.rank = nr;
        w.emit({ e: "promote", id: killer.id, rank: nr, owner: killer.owner });
      }
    }
  }
}

export function explode(w: World, x: number, y: number, z: number, dmg: number, warhead: string, owner: number, src: number, direct: number, hitsAll: boolean) {
  const wh = WARHEADS[warhead];
  const spread = wh.spread ?? 0;
  if (spread <= 0) return;
  const falloff = wh.falloff ?? 50;
  const airburst = z > 200;
  const attacker = w.get(src) ?? null;
  const victims: [Entity, number][] = [];
  w.forNear(x, y, spread, (o) => {
    if (o.id === direct) return;
    if (!hitsAll && airburst !== o.flying) return;
    if (!hitsAll && (o.owner === owner || w.isAlly(owner, o.owner))) return;
    if (!hitsAll && o.owner < 0) return;
    const d = w.distTo(x, y, o);
    const pct = 100 - Math.floor(((100 - falloff) * d) / spread);
    victims.push([o, Math.floor((dmg * pct) / 100)]);
  });
  for (const [o, d] of victims) applyDamage(w, o, d, warhead, attacker);
}

// ───────────────────────────── projectiles ─────────────────────────────

export function updateProjectiles(w: World) {
  for (const p of w.projs) {
    if (p.dead) continue;
    p.age++;
    if (p.special === "nuke") {
      const T = p.life;
      const f = Math.min(1, p.age / T);
      p.x = Math.round(p.sx + (p.tx - p.sx) * f);
      p.y = Math.round(p.sy + (p.ty - p.sy) * f);
      p.z = Math.round(4000 * 4 * f * (1 - f)) + (f < 0.5 ? 0 : 0);
      if (p.age >= T) {
        p.dead = true;
        nukeDetonate(w, p);
      }
      continue;
    }
    const wp = p.w;
    switch (wp.proj) {
      case "shell":
      case "missile": {
        const t = p.target ? w.get(p.target) : undefined;
        if (t) {
          p.tx = t.x;
          p.ty = t.y;
          p.tz = hitZ(t);
        }
        const dx = p.tx - p.x,
          dy = p.ty - p.y,
          dz = p.tz - p.z;
        const d = isqrt(dx * dx + dy * dy + dz * dz);
        const sp = wp.speed ?? 80;
        if (d <= sp || p.age > 200) {
          p.x = p.tx;
          p.y = p.ty;
          p.z = p.tz;
          impact(w, p, t ?? null);
        } else {
          p.x += Math.trunc((dx * sp) / d);
          p.y += Math.trunc((dy * sp) / d);
          p.z += Math.trunc((dz * sp) / d);
        }
        break;
      }
      case "artillery": {
        const f = Math.min(1, p.age / p.life);
        p.x = Math.round(p.sx + (p.tx - p.sx) * f);
        p.y = Math.round(p.sy + (p.ty - p.sy) * f);
        const d = isqrt(dist2(p.sx, p.sy, p.tx, p.ty));
        p.z = Math.round(p.sz * (1 - f) + p.tz * f + (d / 2.5) * 4 * f * (1 - f));
        if (f >= 1) impact(w, p, null);
        break;
      }
      case "bomb": {
        const sp = (wp.speed ?? 20) + p.age * 3;
        p.z -= sp;
        p.x += Math.trunc((p.tx - p.x) / 4);
        p.y += Math.trunc((p.ty - p.y) / 4);
        if (p.z <= 0) {
          p.z = 0;
          impact(w, p, null);
        }
        break;
      }
      case "charge": {
        const t = p.target ? w.get(p.target) : undefined;
        if (!t) {
          p.dead = true;
          break;
        }
        if (p.age >= p.life) impact(w, p, t);
        break;
      }
      default:
        p.dead = true;
    }
  }
}

function impact(w: World, p: Proj, t: Entity | null) {
  p.dead = true;
  const src = w.get(p.src) ?? null;
  if (t && w.distTo(p.x, p.y, t) <= 160) applyDamage(w, t, p.damage, p.w.warhead, src);
  explode(w, p.x, p.y, p.z, p.damage, p.w.warhead, p.owner, p.src, t ? t.id : 0, false);
  w.emit({ e: "hit", fx: p.w.fx, w: p.w.id, x: p.x, y: p.y, z: p.z });
}

// ───────────────────────────── structures ─────────────────────────────

export function updateStructureCombat(w: World, b: Entity) {
  if (b.cool > 0) b.cool--;
  if (!b.powered || b.built < CONSTRUCT_TICKS || b.selling) {
    b.target = 0;
    return;
  }
  let t = b.target ? w.get(b.target) : undefined;
  let wp = t ? weaponFor(b, t) : null;
  if (t && (!wp || !w.isEnemy(b.owner, t.owner) || w.distTo(b.x, b.y, t) > wp.range)) {
    t = undefined;
    b.target = 0;
  }
  if (!t) {
    if ((w.tick + b.id) % 6 !== 0) return;
    const f = findTarget(w, b, 0);
    if (!f) return;
    t = f;
    b.target = f.id;
    b.autoTarget = true;
    wp = weaponFor(b, t);
    if (!wp) return;
  }
  b.turret = facingTo(t.x - b.x, t.y - b.y);
  if (b.cool > 0 || !wp) return;
  let bonus = 0;
  if (b.r.support) {
    // nearby idle spires relay their beams into this one
    for (const o of w.ents) {
      if (o === b || o.dead || o.owner !== b.owner || o.type !== b.type || o.cool > 0 || !o.powered || o.built < CONSTRUCT_TICKS || o.selling) continue;
      if (dist2(o.x, o.y, b.x, b.y) > 8 * 8 * LEP * LEP) continue;
      o.cool = wp.rof;
      bonus += 60;
      w.emit({ e: "support", from: o.id, to: b.id, x: o.x, y: o.y, tx: b.x, ty: b.y });
    }
  }
  fireWeapon(w, b, wp, t, t.x, t.y, false, bonus);
}

// ───────────────────────────── superweapons ─────────────────────────────

export function fireSuperweapon(w: World, p: Player, kind: string, x: number, y: number, x2?: number, y2?: number) {
  const sw = SUPERWEAPONS[kind];
  if (!sw || !w.map.inside(x, y)) return;
  let b: Entity | null = null;
  for (const e of w.ents) {
    if (e.dead || e.owner !== p.idx || e.r.superweapon !== kind || e.built < CONSTRUCT_TICKS || e.selling) continue;
    if (e.swCharge >= sw.charge) {
      b = e;
      break;
    }
  }
  if (!b || p.lowPower) return;
  b.swCharge = 0;
  const tx = x * LEP + HALF,
    ty = y * LEP + HALF;
  switch (kind) {
    case "nuke": {
      const pr = new Proj(w.newId(), WEAPONS.siegeRocket, p.idx, b.id, 0, b.x, b.y, 0, tx, ty, 0, 1100);
      pr.special = "nuke";
      pr.life = 140;
      w.projs.push(pr);
      w.emit({ e: "swlaunch", kind, owner: p.idx, x: tx, y: ty, sx: b.x, sy: b.y });
      w.eva(-1, "Warning: Annihilator launch detected");
      break;
    }
    case "storm":
      w.storms.push({ owner: p.idx, x: tx, y: ty, start: w.tick + 60, end: w.tick + 460 });
      w.emit({ e: "swlaunch", kind, owner: p.idx, x: tx, y: ty });
      w.eva(-1, "Warning: Tempest storm approaching");
      break;
    case "phase": {
      if (x2 === undefined || y2 === undefined || !w.map.inside(x2, y2)) {
        b.swCharge = sw.charge;
        return;
      }
      const dx = x2 * LEP + HALF,
        dy = y2 * LEP + HALF;
      const movers: Entity[] = [];
      const doomed: Entity[] = [];
      w.forNear(tx, ty, sw.radius, (o) => {
        if (o.kind === "veh") movers.push(o);
        else if (o.kind === "inf") doomed.push(o);
      });
      movers.sort((a, b2) => a.id - b2.id);
      const used = new Set<number>();
      for (const v of movers) {
        const ox = v.x - tx,
          oy = v.y - ty;
        const cell = nearestFreeCell(w, (dx + ox) >> 8, (dy + oy) >> 8, false, used);
        if (cell < 0) continue;
        used.add(cell);
        if (w.vehAt[v.cell] === v.id) w.vehAt[v.cell] = 0;
        if (v.nextCell >= 0 && w.vehAt[v.nextCell] === v.id) w.vehAt[v.nextCell] = 0;
        const fx = v.x,
          fy = v.y;
        [v.x, v.y] = w.cellCenter(cell);
        v.px = v.x;
        v.py = v.y;
        v.cell = cell;
        v.moving = false;
        v.path = [];
        v.pathI = 0;
        v.pathPending = false;
        v.goalCell = cell;
        v.goalX = v.x;
        v.goalY = v.y;
        if (v.order !== "harvest") v.order = "idle";
        else v.harv = "toOre";
        w.vehAt[cell] = v.id;
        w.emit({ e: "teleport", x: fx, y: fy, x2: v.x, y2: v.y, big: true });
      }
      for (const i of doomed) killEntity(w, i, null, "phase");
      w.emit({ e: "swlaunch", kind, owner: p.idx, x: tx, y: ty, x2: dx, y2: dy });
      w.eva(-1, "Phase shift detected");
      break;
    }
    case "bulwark": {
      const doomed: Entity[] = [];
      w.forNear(tx, ty, sw.radius, (o) => {
        if (o.kind === "inf") doomed.push(o);
        else if (o.kind !== "air") o.invuln = w.tick + 900;
      });
      for (const i of doomed) killEntity(w, i, null, "melt");
      w.emit({ e: "swlaunch", kind, owner: p.idx, x: tx, y: ty });
      w.eva(-1, "Bulwark field activated");
      break;
    }
  }
}

function nukeDetonate(w: World, p: Proj) {
  w.emit({ e: "nuke", x: p.tx, y: p.ty });
  explode(w, p.tx, p.ty, 0, p.damage, "nuke", p.owner, p.src, 0, true);
  w.rads.push({ x: p.tx, y: p.ty, r: 4 * LEP, until: w.tick + 1200 });
  // scorch ore
  const m = w.map;
  const cx = p.tx >> 8,
    cy = p.ty >> 8;
  for (let yy = cy - 2; yy <= cy + 2; yy++)
    for (let xx = cx - 2; xx <= cx + 2; xx++) {
      if (!m.inside(xx, yy)) continue;
      const i = yy * m.w + xx;
      if (m.terrain[i] === 5) m.terrain[i] = 2;
    }
  m.oreVersion++;
}

export function updateSuperweaponEffects(w: World) {
  if (w.storms.length) {
    const r = SUPERWEAPONS.storm.radius;
    for (const s of w.storms) {
      if (w.tick < s.start || w.tick > s.end) continue;
      if ((w.tick - s.start) % 5 !== 0) continue;
      const dx = w.rng.range(-r, r),
        dy = w.rng.range(-r, r);
      if (dx * dx + dy * dy > r * r) continue;
      const bx = Math.max(0, Math.min(w.map.w * LEP - 1, s.x + dx)),
        by = Math.max(0, Math.min(w.map.h * LEP - 1, s.y + dy));
      w.emit({ e: "bolt", x: bx, y: by });
      explode(w, bx, by, 0, 220, "storm", s.owner, 0, 0, true);
    }
    w.storms = w.storms.filter((s) => w.tick <= s.end);
  }
  if (w.rads.length) {
    if (w.tick % 10 === 0)
      for (const rd of w.rads) {
        const victims: Entity[] = [];
        w.forNear(rd.x, rd.y, rd.r, (o) => {
          if (o.kind === "inf") victims.push(o);
        });
        for (const v of victims) applyDamage(w, v, 6, "rad", null);
      }
    w.rads = w.rads.filter((rd) => w.tick < rd.until);
  }
}

export { RULES };
