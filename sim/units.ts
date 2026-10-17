// Unit behaviour: movement, orders, harvesting, aircraft, deploy.
import type { Entity } from "./entity";
import type { World } from "./world";
import { LEP, HALF, dist2, facingDiff, facingTo, isqrt, rotateToward } from "./fixed";
import { FACTION_HUB, GEM_VALUE, HARVEST_TICKS, ORE_VALUE, RULES, UNLOAD_TICKS, WEAPONS, CONSTRUCT_TICKS, locoOf, type Loco, type Weapon } from "./rules";
import { fireWeapon, findTarget, weaponFor, killEntity, versesFor } from "./combat";

const SUB_OFFS = [
  [0, 0],
  [-72, -48],
  [72, -48],
  [-72, 56],
  [72, 56],
];
export const AIR_Z = 640;

// ───────────────────────────── movement primitives ─────────────────────────────

export function setMoveGoal(w: World, e: Entity, cell: number, sub: number) {
  if (cell < 0) return;
  e.resume = -1;
  e.goalCell = cell;
  const [cx, cy] = w.cellCenter(cell);
  if (e.kind === "inf") {
    const o = SUB_OFFS[sub % SUB_OFFS.length];
    e.goalX = cx + o[0];
    e.goalY = cy + o[1];
  } else {
    e.goalX = cx;
    e.goalY = cy;
  }
  e.sub = sub;
  if (e.kind === "air") return;
  if (e.path.length && e.pathI < e.path.length) {
    // keep moving towards current next cell; replace the rest
    e.path.length = e.pathI;
  }
  e.pathPending = true;
  w.pathQueue.push(e.id);
}

export function stopUnit(w: World, e: Entity) {
  e.order = "idle";
  e.waitTicks = 0;
  e.target = 0;
  e.autoTarget = false;
  e.pathPending = false;
  if (e.kind !== "bld") {
    // finish current cell step to keep occupancy consistent
    e.path.length = e.pathI;
    e.goalCell = e.moving ? e.nextCell : e.cell;
    if (e.kind === "inf" && !e.moving) {
      e.goalX = e.x;
      e.goalY = e.y;
    } else if (e.goalCell >= 0) [e.goalX, e.goalY] = w.cellCenter(e.goalCell);
  }
  e.gx = e.gy = -1;
  if (e.r.harvester) e.harv = "idle";
}

function pathDone(e: Entity) {
  return !e.pathPending && !e.moving && e.pathI >= e.path.length && (e.kind !== "inf" || (e.x === e.goalX && e.y === e.goalY));
}

function speedOf(e: Entity) {
  let s = e.r.speed;
  if (e.rank === 1) s = Math.floor((s * 110) / 100);
  else if (e.rank === 2) s = Math.floor((s * 120) / 100);
  return s;
}

function setCell(w: World, e: Entity) {
  const c = w.cellOf(e.x, e.y);
  if (c === e.cell) return;
  if (e.kind === "veh") {
    if (w.vehAt[e.cell] === e.id) w.vehAt[e.cell] = 0;
    w.vehAt[c] = e.id;
    if (e.r.crusher) crushAt(w, e, c);
    else scatterInfantry(w, e, c);
  }
  e.cell = c;
}

function crushAt(w: World, v: Entity, cell: number) {
  if (!w.infAt[cell]) return;
  const [cx, cy] = w.cellCenter(cell);
  w.forNear(cx, cy, HALF + 8, (o) => {
    if (o.kind !== "inf" || o.cell !== cell) return;
    if (w.isEnemy(v.owner, o.owner) && !o.r.uncrushable) {
      w.emit({ e: "crush", x: o.x, y: o.y });
      killEntity(w, o, v, "crush");
    } else if (o.owner === v.owner && !o.moving && o.order === "idle") scatterUnit(w, o);
  });
}

function scatterInfantry(w: World, v: Entity, cell: number) {
  if (!w.infAt[cell]) return;
  const [cx, cy] = w.cellCenter(cell);
  w.forNear(cx, cy, HALF + 8, (o) => {
    if (o.kind === "inf" && o.cell === cell && w.isAlly(o.owner, v.owner) && !o.moving && o.order === "idle" && !o.deployed) scatterUnit(w, o);
  });
}

/** Moves ground unit along its path. */
function moveGround(w: World, e: Entity) {
  if (e.pathPending) return;
  if (!e.moving) {
    if (e.pathI >= e.path.length) {
      if (e.resume >= 0) {
        const g = e.resume;
        e.resume = -1;
        setMoveGoal(w, e, g, e.sub);
        return;
      }
      // final sub-cell approach for infantry
      if (e.kind === "inf" && (e.x !== e.goalX || e.y !== e.goalY)) {
        if (w.cellOf(e.goalX, e.goalY) !== e.cell && e.goalCell !== e.cell) {
          e.goalX = e.x;
          e.goalY = e.y;
          return;
        }
        stepToward(w, e, e.goalX, e.goalY, speedOf(e));
      }
      return;
    }
    const next = e.path[e.pathI];
    if (!e.exiting && !w.canEnter(e, next)) {
      // world changed; repath
      setMoveGoal(w, e, e.goalCell, e.sub);
      return;
    }
    if (e.kind === "veh") {
      const occ = w.vehAt[next];
      if (occ && occ !== e.id) {
        const o = w.get(occ);
        if (o) {
          // blocked by another vehicle: nudge idle friendlies, then repath around stationary
          // blockers (waitTicks > 0 makes the pathfinder avoid them), finally give up.
          e.waitTicks++;
          if (e.waitTicks % 8 === 4 && !o.moving && !o.pathPending && o.owner === e.owner && o.order === "idle" && !o.deployed && !o.r.harvester) scatterUnit(w, o, e.path);
          // mutual jam: both waiting on each other → the higher id yields by side-stepping
          if (e.waitTicks % 10 === 6 && !o.moving && o.waitTicks > 0 && e.id > o.id && sidestep(w, e, o)) return;
          if (next === e.goalCell && e.waitTicks > 10 && !o.moving) {
            // destination taken; stop here
            e.path.length = e.pathI;
            e.goalCell = e.cell;
            [e.goalX, e.goalY] = w.cellCenter(e.cell);
            e.waitTicks = 0;
            return;
          }
          if (e.waitTicks % 14 === 0 && e.waitTicks <= 84) setMoveGoal(w, e, e.goalCell, e.sub);
          if (e.waitTicks > 100) {
            e.path.length = e.pathI;
            e.goalCell = e.cell;
            [e.goalX, e.goalY] = w.cellCenter(e.cell);
            e.waitTicks = 0;
          }
          return;
        }
        w.vehAt[next] = 0;
      }
      w.vehAt[next] = e.id;
    }
    e.nextCell = next;
    e.moving = true;
  }
  // traverse toward next cell
  const last = e.pathI === e.path.length - 1;
  let tx: number, ty: number;
  if (last && e.kind === "inf" && w.cellOf(e.goalX, e.goalY) === e.nextCell) {
    tx = e.goalX;
    ty = e.goalY;
  } else [tx, ty] = w.cellCenter(e.nextCell);
  const want = facingTo(tx - e.x, ty - e.y);
  if (e.kind === "veh") {
    const d = facingDiff(e.facing, want);
    if (tx !== e.x || ty !== e.y) e.facing = rotateToward(e.facing, want, e.r.rot);
    if (Math.abs(d) > 24) return; // turn in place
  } else if (tx !== e.x || ty !== e.y) e.facing = want;
  if (stepToward(w, e, tx, ty, speedOf(e))) {
    e.moving = false;
    e.pathI++;
    e.waitTicks = 0;
    e.tries = 0;
    if (e.exiting && e.pathI >= e.path.length) {
      e.exiting = false;
      // out the door with no new orders: head for the rally point, or just clear the door
      if (e.goalCell === e.cell && !e.r.harvester && (e.order === "idle" || e.order === "move")) {
        const W = w.map.w;
        const rally = e.order === "move" && e.gx >= 0;
        const [c] = rally ? freeSpotNear(w, e, e.gx >> 8, e.gy >> 8) : freeSpotNear(w, e, e.cell % W, ((e.cell / W) | 0) + 2, e.cell);
        if (c >= 0) setMoveGoal(w, e, c, 0);
        else if (rally) e.order = "idle";
      }
    }
  }
}

function stepToward(w: World, e: Entity, tx: number, ty: number, sp: number): boolean {
  const dx = tx - e.x,
    dy = ty - e.y;
  const d = isqrt(dx * dx + dy * dy);
  if (d <= sp) {
    e.x = tx;
    e.y = ty;
    setCell(w, e);
    return true;
  }
  e.x += Math.trunc((dx * sp) / d);
  e.y += Math.trunc((dy * sp) / d);
  setCell(w, e);
  return false;
}

/** BFS for nearest free passable cell to (x,y). */
/** step into a free neighbouring cell that is off the other unit's route, then resume */
function sidestep(w: World, e: Entity, o: Entity): boolean {
  const W = w.map.w;
  const cx = e.cell % W,
    cy = (e.cell / W) | 0;
  const avoid = new Set<number>([o.cell, ...o.path.slice(o.pathI, o.pathI + 4), e.path[e.pathI]]);
  let best = -1,
    bd = 1e9;
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
  ]) {
    const nx = cx + dx,
      ny = cy + dy;
    if (!w.map.inside(nx, ny)) continue;
    const i = ny * W + nx;
    if (avoid.has(i) || !w.canEnter(e, i) || w.vehAt[i]) continue;
    if (dx && dy && (!w.canEnter(e, cy * W + nx) || !w.canEnter(e, ny * W + cx))) continue;
    // prefer cells that don't block the other unit's next steps
    const d = Math.abs(dx) + Math.abs(dy);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  if (best < 0) return false;
  e.resume = e.goalCell;
  e.path = [best];
  e.pathI = 0;
  e.waitTicks = 0;
  return true;
}

export function nearestFreeCell(w: World, x: number, y: number, inf: boolean, exclude?: Set<number>, loco: Loco = inf ? "foot" : "track"): number {
  const m = w.map;
  const W = m.w;
  x = Math.max(0, Math.min(m.w - 1, x));
  y = Math.max(0, Math.min(m.h - 1, y));
  for (let r = 0; r < 12; r++) {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const cx = x + dx,
          cy = y + dy;
        if (!m.inside(cx, cy)) continue;
        const i = cy * W + cx;
        if (!w.passableFor(loco, i)) continue;
        if (exclude && exclude.has(i)) continue;
        if (inf) {
          if (w.infAt[i] < 3 && !w.vehAt[i]) return i;
        } else if (!w.vehAt[i] && !w.infAt[i]) return i;
      }
  }
  return -1;
}

/** sub-cell slot an infantryman is standing on or heading for */
function subOf(w: World, o: Entity): number {
  const [cx, cy] = w.cellCenter(o.goalCell);
  let best = 0,
    bd = Infinity;
  for (let s = 0; s < SUB_OFFS.length; s++) {
    const d = dist2(o.goalX - cx, o.goalY - cy, SUB_OFFS[s][0], SUB_OFFS[s][1]);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

/** nearest spot to (x, y) that no unit stands on or is already heading to, as [cell, sub-slot],
 *  so freshly built units fan out instead of piling onto one point. [-1, 0] if none. */
export function freeSpotNear(w: World, e: Entity, x: number, y: number, avoid = -1): [number, number] {
  const m = w.map;
  const W = m.w;
  const vehClaim = new Set<number>();
  const infClaim = new Map<number, number>(); // cell → bitmask of claimed sub-slots
  for (const o of w.ents) {
    if (o.dead || o === e || o.goalCell < 0) continue;
    if (o.kind === "veh") vehClaim.add(o.goalCell);
    else if (o.kind === "inf") infClaim.set(o.goalCell, (infClaim.get(o.goalCell) ?? 0) | (1 << subOf(w, o)));
  }
  x = Math.max(0, Math.min(m.w - 1, x));
  y = Math.max(0, Math.min(m.h - 1, y));
  for (let r = 0; r < 10; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const cx = x + dx,
          cy = y + dy;
        if (!m.inside(cx, cy)) continue;
        const i = cy * W + cx;
        if (i === avoid || !w.canEnter(e, i) || w.vehAt[i] || vehClaim.has(i)) continue;
        const used = infClaim.get(i) ?? 0;
        if (e.kind !== "inf") {
          if (!used && !w.infAt[i]) return [i, 0];
          continue;
        }
        if (w.infAt[i] >= 3) continue;
        let n = 0;
        for (let s = 0; s < SUB_OFFS.length; s++) if (used & (1 << s)) n++;
        if (n >= 3) continue;
        for (const s of [1, 2, 3, 4, 0]) if (!(used & (1 << s))) return [i, s];
      }
  return [-1, 0];
}

export function groupMove(w: World, units: Entity[], x: number, y: number, order: "move" | "amove") {
  const m = w.map;
  const W = m.w;
  const target = y * W + x;
  const air = units.filter((u) => u.kind === "air");
  const ground = units.filter((u) => u.kind !== "air");
  for (const u of air) {
    u.order = order;
    u.target = 0;
    u.tx = x * LEP + HALF;
    u.ty = y * LEP + HALF;
    u.gx = u.tx;
    u.gy = u.ty;
    if (u.r.jet && u.air === "landed") u.air = "flying";
    if (u.r.jet) u.air = u.air === "returning" ? "flying" : u.air;
  }
  if (!ground.length) return;
  // ground troops, hovercraft and ships each fan out over the cells they can actually reach
  const classes: [Loco, Entity[]][] = [
    ["track", ground.filter((u) => { const l = locoOf(u.r); return l === "foot" || l === "track"; })],
    ["hover", ground.filter((u) => locoOf(u.r) === "hover")],
    ["naval", ground.filter((u) => locoOf(u.r) === "naval")],
  ];
  for (const [loco, list] of classes) if (list.length) assignFormation(w, list, x, y, order, loco);
}

function assignFormation(w: World, ground: Entity[], x: number, y: number, order: "move" | "amove", loco: Loco) {
  const m = w.map;
  const W = m.w;
  const target = y * W + x;
  const tcx = x * LEP + HALF,
    tcy = y * LEP + HALF;
  const vehs = ground.filter((u) => u.kind === "veh").sort((a, b) => dist2(a.x, a.y, tcx, tcy) - dist2(b.x, b.y, tcx, tcy) || a.id - b.id);
  const infs = ground.filter((u) => u.kind === "inf").sort((a, b) => dist2(a.x, a.y, tcx, tcy) - dist2(b.x, b.y, tcx, tcy) || a.id - b.id);
  const groupIds = new Set(ground.map((u) => u.id));
  // BFS over passable cells from target
  const seen = new Set<number>();
  const q: number[] = [];
  let start = target;
  if (!w.passableFor(loco, start)) {
    const alt = nearestFreeCell(w, x, y, false, undefined, loco);
    if (alt < 0) {
      // no reachable cell anywhere near (ships ordered far inland): head that way regardless
      for (const u of ground) {
        prepMove(w, u, order, x, y);
        setMoveGoal(w, u, target, 0);
      }
      return;
    }
    start = alt;
  }
  q.push(start);
  seen.add(start);
  let vi = 0,
    ii = 0;
  for (let h = 0; h < q.length && h < 600 && (vi < vehs.length || ii < infs.length); h++) {
    const c = q[h];
    const occ = w.vehAt[c];
    const freeForVeh = !occ || groupIds.has(occ) || !!w.get(occ)?.moving;
    if (vi < vehs.length && freeForVeh) {
      const u = vehs[vi++];
      prepMove(w, u, order, x, y);
      setMoveGoal(w, u, c, 0);
    } else if (ii < infs.length && vi >= vehs.length) {
      // up to 4 infantry per cell (skip cells claimed by our vehicles)
      for (let s = 1; s <= 4 && ii < infs.length; s++) {
        const u = infs[ii++];
        prepMove(w, u, order, x, y);
        setMoveGoal(w, u, c, infs.length === 1 && vehs.length === 0 ? 0 : s);
      }
    }
    const cx = c % W,
      cy = (c / W) | 0;
    const nb = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, -1],
      [1, -1],
      [-1, 1],
    ];
    for (const [dx, dy] of nb) {
      const nx = cx + dx,
        ny = cy + dy;
      if (!m.inside(nx, ny)) continue;
      const n = ny * W + nx;
      if (seen.has(n) || !w.passableFor(loco, n)) continue;
      seen.add(n);
      q.push(n);
    }
  }
}

function prepMove(w: World, u: Entity, order: "move" | "amove", x: number, y: number) {
  if (u.deployed) undeploy(u);
  u.waitTicks = 0;
  u.tries = 0;
  u.order = order;
  u.target = 0;
  u.autoTarget = false;
  u.gx = x * LEP + HALF;
  u.gy = y * LEP + HALF;
  if (u.r.harvester) u.harv = "idle";
}

export function scatterUnit(w: World, e: Entity, avoid?: number[]) {
  if (e.kind === "air" || e.kind === "bld" || e.deployed) return;
  const W = w.map.w;
  const cx = e.cell % W,
    cy = (e.cell / W) | 0;
  const ex = avoid ? new Set(avoid) : undefined;
  const dirs = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ];
  const k0 = w.rng.int(8);
  for (let k = 0; k < 8; k++) {
    const [dx, dy] = dirs[(k + k0) & 7];
    const nx = cx + dx,
      ny = cy + dy;
    if (!w.map.inside(nx, ny)) continue;
    const i = ny * W + nx;
    if (!w.canEnter(e, i) || (ex && ex.has(i))) continue;
    if (e.kind === "veh" && w.vehAt[i]) continue;
    if (e.kind === "inf" && (w.infAt[i] >= 3 || w.vehAt[i])) continue;
    const ord = e.order;
    setMoveGoal(w, e, i, 1 + w.rng.int(4));
    if (ord === "idle") e.order = "move";
    return;
  }
}

// ───────────────────────────── deploy ─────────────────────────────

function undeploy(e: Entity) {
  e.deployed = false;
  e.deployT = 0;
}

export function deployUnit(w: World, e: Entity) {
  const r = e.r;
  if (e.kind === "bld") {
    // hub packs up into a mobile hub
    if (r.undeploy && e.built >= CONSTRUCT_TICKS && e.selling === 0) {
      const owner = e.owner;
      const cx = e.bx + 1,
        cy = e.by + 1;
      const hp = Math.floor((e.hp * RULES[r.undeploy].hp) / r.hp);
      w.removeStructure(e, true);
      e.dead = true;
      const u = w.spawnUnit(r.undeploy, owner, cx * LEP + HALF, cy * LEP + HALF, 96);
      if (u) u.hp = Math.max(1, hp);
      w.emit({ e: "undeploy", owner, x: cx, y: cy });
    }
    return;
  }
  if (e.type === "mhv") {
    if (e.moving || e.pathPending) return;
    const W = w.map.w;
    const cx = e.cell % W,
      cy = (e.cell / W) | 0;
    const p = w.players[e.owner];
    const hubType = FACTION_HUB[p.faction];
    const bx = cx - 1,
      by = cy - 1;
    if (!canDeployAt(w, e, bx, by)) {
      w.emit({ e: "nodeploy", owner: e.owner, id: e.id });
      w.eva(e.owner, "Cannot deploy here");
      return;
    }
    if (w.vehAt[e.cell] === e.id) w.vehAt[e.cell] = 0;
    e.dead = true;
    w.emit({ e: "deploy", owner: e.owner, x: cx, y: cy });
    w.addStructure(hubType, e.owner, bx, by, false);
    return;
  }
  if (r.deployable && e.kind === "inf") {
    if (e.deployed) undeploy(e);
    else {
      stopUnit(w, e);
      e.deployed = true;
      e.deployT = 0;
    }
  }
}

function canDeployAt(w: World, e: Entity, bx: number, by: number) {
  const m = w.map;
  const W = m.w;
  if (bx < 0 || by < 0 || bx + 3 > m.w || by + 3 > m.h) return false;
  for (let y = by; y < by + 3; y++)
    for (let x = bx; x < bx + 3; x++) {
      const i = y * W + x;
      if (!m.groundOk(i) || w.bldAt[i] || m.oreType[i]) return false;
      if (w.vehAt[i] && w.vehAt[i] !== e.id && w.get(w.vehAt[i])) return false;
      if (w.infAt[i]) return false;
    }
  return true;
}

// ───────────────────────────── per-tick unit update ─────────────────────────────

export function updateUnit(w: World, e: Entity) {
  if (e.cool > 0) e.cool--;
  if (e.deployed && e.deployT < 10) e.deployT++;
  // burst fire continuation
  if (e.burstLeft > 0) {
    if (--e.burstTimer <= 0) {
      const t = w.get(e.burstTarget);
      const wp = t ? weaponFor(e, t) : null;
      if (t && wp) {
        fireWeapon(w, e, wp, t, t.x, t.y, true);
        e.burstLeft--;
        e.burstTimer = wp.burstDelay ?? 5;
      } else e.burstLeft = 0;
    }
  }
  // self-heal for elite / regenerating units
  if ((e.rank === 2 || e.r.selfHeal) && e.hp < e.r.hp && ++e.healT >= 20) {
    e.healT = 0;
    e.hp = Math.min(e.r.hp, e.hp + Math.max(1, Math.floor(e.r.hp / 100)));
  }
  if (e.kind === "air") return updateAir(w, e);
  // blacked out: engines and guns dead until the pulse wears off
  if (e.disabledUntil > w.tick && e.kind === "veh") return;
  if (e.exiting) return moveGround(w, e);
  if (e.r.harvester && e.order === "harvest") {
    updateHarvester(w, e);
    opportunisticFire(w, e);
    return;
  }
  switch (e.order) {
    case "idle":
      moveGround(w, e);
      idleCombat(w, e, false);
      break;
    case "guard":
      moveGround(w, e);
      idleCombat(w, e, true);
      break;
    case "move":
      moveGround(w, e);
      if (pathDone(e)) {
        e.order = "idle";
        e.gx = e.gy = -1;
      }
      opportunisticFire(w, e);
      break;
    case "amove":
      amove(w, e);
      break;
    case "attack":
      attack(w, e);
      break;
    case "ffire":
      forceFire(w, e);
      break;
    case "enter":
      enter(w, e);
      break;
    case "charge":
      chargeCoil(w, e);
      break;
    case "harvest":
      e.order = "idle";
      break;
  }
}

function hasWeapon(e: Entity) {
  return !!(e.r.wGround || e.r.wAir || e.r.deployGround);
}

/** sustained damage of a weapon against a target (for choosing deployed vs mobile weapons) */
function dps(id: string | undefined, t: Entity) {
  if (!id) return 0;
  const wp = WEAPONS[id];
  if (t.flying ? !wp.air : !wp.ground) return 0;
  return (wp.damage * (wp.burst ?? 1) * versesFor(wp.warhead, t)) / wp.rof;
}

/** deployable infantry dig in when an enemy enters range of a better deployed weapon */
function autoDeploy(w: World, e: Entity, t: Entity): boolean {
  if (!e.r.deployable || e.kind !== "inf" || e.deployed || e.moving) return false;
  const id = t.flying ? e.r.deployAir : e.r.deployGround;
  if (!id || w.distTo(e.x, e.y, t) > WEAPONS[id].range) return false;
  const now = dps(t.flying ? e.r.wAir : e.r.wGround, t);
  if (dps(id, t) <= now * 1.2) return false;
  haltForFire(e);
  e.deployed = true;
  e.deployT = 0;
  return true;
}

function idleCombat(w: World, e: Entity, guard: boolean) {
  if (!hasWeapon(e)) return;
  let t = e.target ? w.get(e.target) : undefined;
  if (t && !w.isEnemy(e.owner, t.owner) && e.autoTarget && !t.r.animal) t = undefined;
  if (!t) {
    e.target = 0;
    if ((w.tick + e.id) % 8 !== 0) return;
    const range = guard ? e.r.sight * LEP : 0;
    const found = findTarget(w, e, range);
    if (!found) {
      if (guard && e.gx >= 0 && pathDone(e) && dist2(e.x, e.y, e.gx, e.gy) > 2 * LEP * LEP) setMoveGoal(w, e, w.cellOf(e.gx, e.gy), e.sub);
      return;
    }
    t = found;
    e.target = t.id;
    e.autoTarget = true;
  }
  autoDeploy(w, e, t);
  const wp = weaponFor(e, t);
  if (!wp) {
    e.target = 0;
    return;
  }
  const d = w.distTo(e.x, e.y, t);
  if (d > wp.range) {
    if (guard && !e.deployed && e.gx >= 0 && dist2(t.x, t.y, e.gx, e.gy) < (e.r.sight + 2) * (e.r.sight + 2) * LEP * LEP) {
      chase(w, e, t);
      return;
    }
    // under fire from an out-ranging attacker: close in and return fire
    if (!e.deployed && t.id === e.attackerId && w.tick - e.attackedAt < 80 && d < (e.r.sight + 3) * LEP && t.kind !== "bld") {
      chase(w, e, t);
      return;
    }
    if (e.autoTarget) e.target = 0;
    return;
  }
  if (crushInstead(w, e, t, wp)) return;
  haltForFire(e);
  aimAndFire(w, e, t, wp);
}

function opportunisticFire(w: World, e: Entity) {
  if (!e.r.turret || !hasWeapon(e)) return;
  let t = e.target ? w.get(e.target) : undefined;
  if (!t && (w.tick + e.id) % 8 === 0) {
    const found = findTarget(w, e, 0);
    if (found) {
      t = found;
      e.target = t.id;
      e.autoTarget = true;
    }
  }
  if (!t) {
    e.target = 0;
    e.turret = rotateToward(e.turret, e.facing, e.r.turretRot ?? 8);
    return;
  }
  const wp = weaponFor(e, t);
  if (!wp || w.distTo(e.x, e.y, t) > wp.range) {
    e.target = 0;
    return;
  }
  aimAndFire(w, e, t, wp);
}

function haltForFire(e: Entity) {
  if (e.path.length > e.pathI) e.path.length = e.pathI;
  e.pathPending = false;
}

function chase(w: World, e: Entity, t: Entity) {
  if (e.deployed) return;
  if (e.repathAt <= w.tick || pathDone(e)) {
    e.repathAt = w.tick + 16;
    const W = w.map.w;
    let goal: number;
    if (t.kind === "bld") goal = perimeterCell(w, t, e);
    else if (t.kind === "air") goal = w.cellOf(t.x, t.y);
    else goal = t.cell;
    // nowhere to stand next to it (a ship chasing a target inland): get as close as the terrain allows
    if (goal < 0) goal = w.cellOf(t.x, t.y);
    if (goal >= 0 && goal !== e.goalCell) setMoveGoal(w, e, goal, e.kind === "inf" ? 1 + (e.id % 4) : 0);
    else if (goal >= 0 && pathDone(e) && goal !== e.cell) setMoveGoal(w, e, goal, e.sub);
    void W;
  }
  moveGround(w, e);
}

/** nearest passable cell adjacent to a structure's footprint, from the viewpoint of unit u */
export function perimeterCell(w: World, b: Entity, u: Entity): number {
  const m = w.map;
  const W = m.w;
  let best = -1,
    bd = 1e18;
  for (let y = b.by - 1; y <= b.by + b.r.h; y++)
    for (let x = b.bx - 1; x <= b.bx + b.r.w; x++) {
      if (x >= b.bx && x < b.bx + b.r.w && y >= b.by && y < b.by + b.r.h) continue;
      if (!m.inside(x, y)) continue;
      const i = y * W + x;
      if (!w.canEnter(u, i)) continue;
      if (u.kind === "veh" && w.vehAt[i] && w.vehAt[i] !== u.id) continue;
      const d = dist2(u.x, u.y, x * LEP + HALF, y * LEP + HALF);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
  return best;
}

/** crusher vehicles drive over nearby crushable infantry when their gun is poor against it */
function crushInstead(w: World, e: Entity, t: Entity, wp: Weapon): boolean {
  if (e.kind !== "veh" || !e.r.crusher || t.kind !== "inf" || t.r.uncrushable || !w.isEnemy(e.owner, t.owner)) return false;
  if (versesFor(wp.warhead, t) >= 60) return false;
  if (w.distTo(e.x, e.y, t) > 3 * LEP) return false;
  if ((t.cell !== e.goalCell || pathDone(e)) && e.repathAt <= w.tick) {
    e.repathAt = w.tick + 8;
    setMoveGoal(w, e, t.cell, 0);
  }
  moveGround(w, e);
  if (e.r.turret) aimAndFire(w, e, t, wp);
  return true;
}

function aimAndFire(w: World, e: Entity, t: Entity, wp: Weapon) {
  const want = facingTo(t.x - e.x, t.y - e.y);
  let aimed: boolean;
  if (e.r.turret) {
    e.turret = rotateToward(e.turret, want, e.r.turretRot ?? 8);
    aimed = Math.abs(facingDiff(e.turret, want)) <= 6;
  } else if (e.kind === "inf") {
    if (!e.moving) e.facing = want;
    aimed = !e.moving;
  } else {
    if (e.moving) return;
    e.facing = rotateToward(e.facing, want, e.r.rot);
    aimed = Math.abs(facingDiff(e.facing, want)) <= 6;
  }
  if (!aimed || e.cool > 0) return;
  if (e.deployed && e.deployT < 10) return; // still digging in
  if (wp.minRange && w.distTo(e.x, e.y, t) < wp.minRange) return;
  fireWeapon(w, e, wp, t, t.x, t.y, false);
}

function attack(w: World, e: Entity) {
  const t = w.get(e.target);
  if (!t || (t.owner === e.owner && t.kind !== "bld" && false)) {
    e.target = 0;
    e.order = e.gx >= 0 && e.order === "attack" && e.autoTarget ? "amove" : "idle";
    if (e.order === "amove") setMoveGoal(w, e, w.cellOf(e.gx, e.gy), e.sub);
    else stopUnit(w, e);
    return;
  }
  const wp = weaponFor(e, t);
  if (!wp) {
    stopUnit(w, e);
    return;
  }
  if (autoDeploy(w, e, t)) return;
  const d = w.distTo(e.x, e.y, t);
  if (d > wp.range) {
    if (e.deployed) undeploy(e);
    chase(w, e, t);
    if (e.r.turret) e.turret = rotateToward(e.turret, facingTo(t.x - e.x, t.y - e.y), e.r.turretRot ?? 8);
    return;
  }
  if (crushInstead(w, e, t, wp)) return;
  haltForFire(e);
  if (e.moving) moveGround(w, e);
  aimAndFire(w, e, t, wp);
}

function amove(w: World, e: Entity) {
  if (hasWeapon(e)) {
    let t = e.target ? w.get(e.target) : undefined;
    if (!t && (w.tick + e.id) % 8 === 0) {
      const f = findTarget(w, e, e.r.sight * LEP);
      if (f) {
        t = f;
        e.target = f.id;
        e.autoTarget = true;
      } else if (e.deployed) {
        // area clear: pack up and carry on
        undeploy(e);
        setMoveGoal(w, e, w.cellOf(e.gx, e.gy), e.sub);
      }
    }
    if (e.deployed && !t) return;
    if (t) {
      autoDeploy(w, e, t);
      const wp = weaponFor(e, t);
      if (wp) {
        const d = w.distTo(e.x, e.y, t);
        if (d <= wp.range) {
          if (crushInstead(w, e, t, wp)) return;
          haltForFire(e);
          if (e.moving) moveGround(w, e);
          aimAndFire(w, e, t, wp);
          return;
        }
        if (d < (e.r.sight + 3) * LEP) {
          if (e.deployed) undeploy(e);
          chase(w, e, t);
          return;
        }
      }
      e.target = 0;
      if (e.deployed) undeploy(e);
      // resume path to destination
      setMoveGoal(w, e, w.cellOf(e.gx, e.gy), e.sub);
    }
  }
  if (!e.pathPending && pathDone(e)) {
    const gc = w.cellOf(e.gx, e.gy);
    if (e.gx < 0 || e.cell === gc || dist2(e.x, e.y, e.gx, e.gy) < 4 * LEP * LEP) {
      e.order = "idle";
      e.gx = e.gy = -1;
      return;
    }
    if (e.repathAt <= w.tick) {
      // path was cut short by fighting or blocking: re-plan, give up after repeated failures
      if (++e.tries > 5) {
        e.order = "idle";
        e.gx = e.gy = -1;
        return;
      }
      e.repathAt = w.tick + 30;
      setMoveGoal(w, e, gc, e.sub);
    }
  }
  moveGround(w, e);
}

function forceFire(w: World, e: Entity) {
  const wpId = e.deployed ? e.r.deployGround : e.r.wGround;
  const wp = wpId ? WEAPONS[wpId] : null;
  if (!wp) return stopUnit(w, e);
  const d = isqrt(dist2(e.x, e.y, e.tx, e.ty));
  if (d > wp.range) {
    if (e.deployed) return stopUnit(w, e);
    if (e.repathAt <= w.tick || pathDone(e)) {
      e.repathAt = w.tick + 20;
      const c = w.cellOf(e.tx, e.ty);
      if (c !== e.goalCell) setMoveGoal(w, e, c, e.sub);
    }
    moveGround(w, e);
    return;
  }
  haltForFire(e);
  if (e.moving) return moveGround(w, e);
  const want = facingTo(e.tx - e.x, e.ty - e.y);
  let aimed = true;
  if (e.r.turret) {
    e.turret = rotateToward(e.turret, want, e.r.turretRot ?? 8);
    aimed = Math.abs(facingDiff(e.turret, want)) <= 6;
  } else if (e.kind === "inf") e.facing = want;
  else {
    e.facing = rotateToward(e.facing, want, e.r.rot);
    aimed = Math.abs(facingDiff(e.facing, want)) <= 6;
  }
  if (aimed && e.cool <= 0) {
    if (wp.minRange && d < wp.minRange) return;
    fireWeapon(w, e, wp, null, e.tx, e.ty, false);
  }
}

function enter(w: World, e: Entity) {
  const t = w.get(e.target);
  if (!t) return stopUnit(w, e);
  const d = w.distTo(e.x, e.y, t);
  if (e.r.engineer) {
    if (d <= LEP + 32) {
      engineerAction(w, e, t);
      return;
    }
    chase(w, e, t);
    return;
  }
  if (t.r.repairBay) {
    // drive onto the bay
    const centre = (t.by + 1) * w.map.w + t.bx + 1;
    if (e.cell === centre && pathDone(e)) {
      e.order = "idle";
      return;
    }
    if (e.goalCell !== centre || pathDone(e)) {
      if (e.repathAt <= w.tick) {
        e.repathAt = w.tick + 30;
        setMoveGoal(w, e, centre, 0);
      }
    }
    moveGround(w, e);
    return;
  }
  stopUnit(w, e);
}

function engineerAction(w: World, e: Entity, t: Entity) {
  const r = t.r;
  if (t.owner === e.owner) {
    t.hp = r.hp;
    w.emit({ e: "engrepair", id: t.id, x: t.x, y: t.y });
  } else if (w.isEnemy(e.owner, t.owner) || (t.owner < 0 && r.capturable)) {
    const old = t.owner;
    t.owner = e.owner;
    t.repairing = false;
    t.selling = 0;
    t.swCharge = 0;
    t.revealCell = -2;
    t.dockId = 0;
    w.structVersion++;
    if (old >= 0) w.eva(old, "Structure captured by enemy");
    w.eva(e.owner, "Structure captured");
    w.emit({ e: "capture", id: t.id, owner: e.owner, x: t.x, y: t.y });
    if (r.tags.includes("refinery")) {
      /* captured refinery serves new owner */
    }
  }
  e.dead = true;
  e.hp = 0;
  w.emit({ e: "enterfx", id: e.id, x: e.x, y: e.y });
}

function chargeCoil(w: World, e: Entity) {
  const t = w.get(e.target);
  if (!t || t.owner !== e.owner) return stopUnit(w, e);
  const d = w.distTo(e.x, e.y, t);
  if (d > 2 * LEP) {
    chase(w, e, t);
    return;
  }
  haltForFire(e);
  if (e.moving) return moveGround(w, e);
  e.facing = facingTo(t.x - e.x, t.y - e.y);
  if ((w.tick + e.id) % 10 === 0) {
    t.chargedUntil = w.tick + 30;
    e.lastFire = w.tick;
    w.emit({ e: "fire", id: e.id, fx: "arc", w: "arcBolt", x: e.x, y: e.y, z: 40, tx: t.x, ty: t.y, tz: 200, charge: true });
  }
}

// ───────────────────────────── harvester ─────────────────────────────

function findOre(w: World, e: Entity, from: number): number {
  const m = w.map;
  const W = m.w;
  const fx = from % W,
    fy = (from / W) | 0;
  let best = -1,
    bd = 1e9;
  const R = 28;
  for (let r = 0; r <= R; r++) {
    if (best >= 0 && r * r * 100 > bd) break;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = fx + dx,
          y = fy + dy;
        if (!m.inside(x, y)) continue;
        const i = y * W + x;
        if (!m.oreType[i] || !m.ore[i] || w.solid[i] || e.badOre.includes(i)) continue;
        const claim = w.oreClaim[i];
        let d = (dx * dx + dy * dy) * 100;
        if (claim && claim !== e.id && w.get(claim)) d += 900;
        if (m.oreType[i] === 2) d -= 150;
        if (w.vehAt[i] && w.vehAt[i] !== e.id) d += 400;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
  }
  return best;
}

/** nearest usable refinery, preferring ones whose dock is free; an ordered refinery is kept */
function nearestRefinery(w: World, e: Entity): Entity | null {
  const usable = (b: Entity | undefined) => !!b && b.owner === e.owner && b.built >= CONSTRUCT_TICKS && b.r.tags.includes("refinery") && b.selling === 0;
  const pref = w.get(e.refId);
  if (e.refLock && usable(pref)) return pref!;
  let best: Entity | null = null,
    bd = 1e18;
  for (const b of w.ents) {
    if (b.dead || b.kind !== "bld" || !usable(b)) continue;
    let d = isqrt(dist2(e.x, e.y, b.x, b.y));
    if (b.dockId && b.dockId !== e.id) d += 6 * LEP;
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}

function updateHarvester(w: World, e: Entity) {
  const cap = e.r.harvester!.capacity;
  const m = w.map;
  if (e.teleCool > 0) e.teleCool--;
  switch (e.harv) {
    case "idle":
      moveGround(w, e);
      if ((w.tick + e.id) % 40 === 0) e.harv = e.cargo >= cap ? "toRef" : "toOre";
      break;
    case "toOre": {
      if (e.cargo >= cap) {
        e.harv = "toRef";
        break;
      }
      const here = e.cell;
      if (!e.moving && m.oreType[here] && m.ore[here] > 0 && (pathDone(e) || e.goalCell === here)) {
        e.harv = "mining";
        e.path.length = e.pathI;
        e.harvT = 0;
        w.oreClaim[here] = e.id;
        break;
      }
      if (pathDone(e) || (e.goalCell >= 0 && (!m.oreType[e.goalCell] || !m.ore[e.goalCell]))) {
        if (e.repathAt > w.tick) {
          moveGround(w, e);
          break;
        }
        // arrived short of the target ore: it is unreachable from here, remember and skip it
        if (pathDone(e) && e.goalCell >= 0 && e.cell !== e.goalCell && m.oreType[e.goalCell] && m.ore[e.goalCell]) {
          e.badOre.push(e.goalCell);
          if (e.badOre.length > 12) e.badOre.shift();
        }
        e.repathAt = w.tick + 10;
        const ore = findOre(w, e, e.lastOre >= 0 ? e.lastOre : e.cell);
        if (ore < 0) {
          e.harv = e.cargo > 0 ? "toRef" : "idle";
          break;
        }
        w.oreClaim[ore] = e.id;
        e.lastOre = ore;
        setMoveGoal(w, e, ore, 0);
      }
      moveGround(w, e);
      break;
    }
    case "mining": {
      const here = e.cell;
      if (!m.oreType[here] || !m.ore[here]) {
        e.harv = e.cargo >= cap ? "toRef" : "toOre";
        e.lastOre = here;
        break;
      }
      if (++e.harvT >= HARVEST_TICKS) {
        e.harvT = 0;
        m.ore[here]--;
        e.cargo++;
        if (m.oreType[here] === 2) e.cargoGem++;
        if (m.ore[here] === 0) {
          m.oreType[here] = 0;
          w.oreClaim[here] = 0;
        }
        m.oreVersion++;
        e.facing = (e.facing + 3) & 255;
        if (e.cargo >= cap) e.harv = "toRef";
      }
      break;
    }
    case "toRef": {
      const cur = w.get(e.refId);
      const ref = cur && e.waitTicks === 0 && cur.dockId === 0 && !e.pathPending && e.goalCell === w.dockCell(cur) && cur.owner === e.owner ? cur : nearestRefinery(w, e);
      if (!ref) {
        e.harv = "idle";
        break;
      }
      e.refId = ref.id;
      const dock = w.dockCell(ref);
      if (dock < 0) {
        e.harv = "idle";
        break;
      }
      if (e.cell === dock && !e.moving) {
        e.harv = "dock";
        break;
      }
      if (e.r.harvester!.teleport && e.teleCool === 0 && !e.moving && !w.vehAt[dock]) {
        // phase-shift straight to the dock
        const fromX = e.x,
          fromY = e.y;
        if (w.vehAt[e.cell] === e.id) w.vehAt[e.cell] = 0;
        [e.x, e.y] = w.cellCenter(dock);
        e.px = e.x;
        e.py = e.y;
        e.cell = dock;
        w.vehAt[dock] = e.id;
        e.path = [];
        e.pathI = 0;
        e.goalCell = dock;
        e.goalX = e.x;
        e.goalY = e.y;
        e.teleCool = 200;
        w.emit({ e: "teleport", x: fromX, y: fromY, x2: e.x, y2: e.y });
        e.harv = "dock";
        break;
      }
      if (pathDone(e) && e.repathAt <= w.tick) {
        e.repathAt = w.tick + 20;
        const occ = w.vehAt[dock];
        if (occ && occ !== e.id) {
          // queue: hold position if already close, otherwise approach to a few cells away
          const [dx, dy] = w.cellCenter(dock);
          if (dist2(e.x, e.y, dx, dy) > 6 * 6 * LEP * LEP) {
            const W = w.map.w;
            const near = nearestFreeCell(w, (dock % W) + 3, ((dock / W) | 0) + 2, false);
            if (near >= 0) setMoveGoal(w, e, near, 0);
          }
        } else setMoveGoal(w, e, dock, 0);
      }
      moveGround(w, e);
      break;
    }
    case "dock": {
      const ref = w.get(e.refId);
      if (!ref) {
        e.harv = "toRef";
        break;
      }
      if (ref.dockId && ref.dockId !== e.id) {
        e.harv = "toRef";
        break;
      }
      ref.dockId = e.id;
      e.facing = rotateToward(e.facing, 192, e.r.rot);
      if (e.facing === 192) {
        e.harv = "unload";
        e.harvT = 0;
      }
      break;
    }
    case "unload": {
      const ref = w.get(e.refId);
      if (!ref || ref.owner !== e.owner) {
        e.harv = "toRef";
        break;
      }
      if (++e.harvT >= UNLOAD_TICKS) {
        e.harvT = 0;
        if (e.cargo > 0) {
          const gem = e.cargoGem > 0;
          if (gem) e.cargoGem--;
          e.cargo--;
          const p = w.players[e.owner];
          const v = Math.floor(((gem ? GEM_VALUE : ORE_VALUE) * p.incomeMult) / 100);
          p.credits += v;
          p.stats.harvested += v;
        }
        if (e.cargo <= 0) {
          ref.dockId = 0;
          e.refLock = false;
          e.cargo = 0;
          e.cargoGem = 0;
          e.harv = "toOre";
          // get off the dock
          if (e.lastOre >= 0) setMoveGoal(w, e, e.lastOre, 0);
        }
      }
      break;
    }
  }
}

// ───────────────────────────── aircraft ─────────────────────────────

function flyToward(e: Entity, tx: number, ty: number, sp: number): boolean {
  const dx = tx - e.x,
    dy = ty - e.y;
  const d = isqrt(dx * dx + dy * dy);
  if (d > 4) e.facing = rotateToward(e.facing, facingTo(dx, dy), e.r.rot);
  if (d <= sp) {
    e.x = tx;
    e.y = ty;
    return true;
  }
  e.x += Math.trunc((dx * sp) / d);
  e.y += Math.trunc((dy * sp) / d);
  return false;
}

/** reserve a landing pad: the ordered airfield if it has room, else a pad this jet already
 *  holds, else any free one. Reservations elsewhere are released so they don't block a pad. */
function claimPad(w: World, e: Entity, want: Entity | undefined): Entity | undefined {
  const usable = (b: Entity) => !b.dead && b.owner === e.owner && !!b.r.pads && b.built >= CONSTRUCT_TICKS;
  let home = want && usable(want) && w.freePad(want) >= 0 ? want : undefined;
  if (!home) home = w.ents.find((b) => usable(b) && b.pads.indexOf(e.id) >= 0);
  if (!home) home = w.ents.find((b) => usable(b) && w.freePad(b) >= 0);
  e.home = home ? home.id : 0;
  for (const b of w.ents) {
    if (b === home || !b.r.pads) continue;
    const k = b.pads.indexOf(e.id);
    if (k >= 0) b.pads[k] = 0;
  }
  if (home && home.pads.indexOf(e.id) < 0) home.pads[w.freePad(home)] = e.id;
  return home;
}

function updateAir(w: World, e: Entity) {
  const m = w.map;
  const sp = speedOf(e);
  const clampPos = () => {
    e.x = Math.max(0, Math.min(m.w * LEP - 1, e.x));
    e.y = Math.max(0, Math.min(m.h * LEP - 1, e.y));
    e.cell = w.cellOf(e.x, e.y);
  };
  if (!e.r.jet) {
    // airship: always airborne
    if (e.z < AIR_Z) e.z = Math.min(AIR_Z, e.z + 8);
    let tx = -1,
      ty = -1,
      t: Entity | undefined;
    if (e.order === "attack") {
      t = w.get(e.target);
      if (!t) {
        e.order = "idle";
        e.target = 0;
      } else {
        tx = t.x;
        ty = t.y;
      }
    } else if (e.order === "ffire") {
      tx = e.tx;
      ty = e.ty;
    } else if (e.order === "move" || e.order === "amove") {
      tx = e.tx;
      ty = e.ty;
    }
    if (tx >= 0) {
      const wp = WEAPONS[e.r.wGround!];
      const d = isqrt(dist2(e.x, e.y, tx, ty));
      if ((e.order === "attack" || e.order === "ffire") && d <= wp.range) {
        if (e.cool <= 0) fireWeapon(w, e, wp, t ?? null, tx, ty, false);
      } else if (flyToward(e, tx, ty, sp) && (e.order === "move" || e.order === "amove")) e.order = "idle";
    }
    clampPos();
    return;
  }
  // jets
  if (e.air === "landed") {
    const home = w.get(e.home);
    if (home && e.ammo < (e.r.ammo ?? 1) && ++e.rearmT >= 50) {
      e.rearmT = 0;
      e.ammo++;
    }
    if (!home) e.air = "flying";
    if (e.order === "attack" || e.order === "ffire" || e.order === "move" || e.order === "amove") {
      if (e.order === "attack" || e.order === "ffire") {
        if (e.ammo <= 0) {
          e.order = "idle";
          return;
        }
      }
      e.air = "flying";
    }
    return;
  }
  if (e.air === "returning") {
    let home = w.get(e.home);
    if (!home || home.owner !== e.owner || home.pads.indexOf(e.id) < 0) {
      home = claimPad(w, e, home);
      if (!home) {
        e.air = "flying";
        e.order = "idle";
        return;
      }
    }
    const [px, py] = w.padPos(home, home.pads.indexOf(e.id));
    if (flyToward(e, px, py, sp)) {
      e.z = Math.max(0, e.z - 24);
      if (e.z === 0) {
        e.air = "landed";
        e.order = "idle";
        e.facing = 96;
      }
    } else e.z = Math.min(AIR_Z, e.z + 16);
    clampPos();
    return;
  }
  // flying
  e.z = Math.min(AIR_Z, e.z + 20);
  if (e.order === "attack" || e.order === "ffire") {
    const t = e.order === "attack" ? w.get(e.target) : undefined;
    if ((e.order === "attack" && !t) || e.ammo <= 0) {
      e.order = "idle";
      e.target = 0;
      e.air = "returning";
      return;
    }
    const tx = t ? t.x : e.tx,
      ty = t ? t.y : e.ty;
    const wp = WEAPONS[e.r.wGround!];
    const d = t ? w.distTo(e.x, e.y, t) : isqrt(dist2(e.x, e.y, tx, ty));
    const want = facingTo(tx - e.x, ty - e.y);
    if (d <= wp.range && Math.abs(facingDiff(e.facing, want)) < 20) {
      e.facing = rotateToward(e.facing, want, e.r.rot);
      if (e.cool <= 0 && e.z >= AIR_Z - 100) {
        fireWeapon(w, e, wp, t ?? null, tx, ty, false);
        e.ammo--;
        if (e.ammo <= 0) {
          e.order = "idle";
          e.air = "returning";
        }
      }
      // keep drifting slowly while firing
      flyToward(e, tx, ty, Math.floor(sp / 4));
    } else if (d <= wp.range) {
      // in range but lined up wrong (or right on top of it, where flyToward stops steering): bank round
      e.facing = rotateToward(e.facing, want, e.r.rot);
      flyToward(e, tx, ty, Math.floor(sp / 4));
    } else flyToward(e, tx, ty, sp);
  } else if (e.order === "move" || e.order === "amove") {
    const t = e.order === "amove" && e.ammo > 0 && (w.tick + e.id) % 8 === 0 ? findTarget(w, e, e.r.sight * LEP) : null;
    if (e.order === "amove" && e.ammo <= 0) {
      // nothing left to fight with: rearm first
      e.order = "idle";
      e.air = "returning";
    } else if (t) {
      e.order = "attack";
      e.target = t.id;
      e.autoTarget = true;
    } else if (flyToward(e, e.tx, e.ty, sp)) {
      // jets can't loiter: once there, head back to the airfield
      e.order = "idle";
      e.air = "returning";
    }
  } else if (e.order === "idle" && (w.tick + e.id) % 40 === 0) {
    // stranded in the air (airfield lost, then rebuilt): keep trying to land
    e.air = "returning";
  }
  clampPos();
}
