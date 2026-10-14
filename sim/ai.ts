// Deterministic skirmish AI. Runs inside the simulation on every client, issuing the same
// commands a human would, so AI opponents work in multiplayer lockstep too.
import type { Entity, Player } from "./entity";
import type { World } from "./world";
import { LEP, dist2 } from "./fixed";
import { CONSTRUCT_TICKS, RULES, SUPERWEAPONS } from "./rules";

interface AIState {
  baseX: number;
  baseY: number;
  waveSize: number;
  nextWave: number;
  attackers: number[];
  targetId: number;
  engineerSent: number[];
  thinkEvery: number;
  lastThink: number;
}

const PLAN: Record<string, string[]> = {
  C: ["c_power", "c_refinery", "c_barracks", "c_power", "c_factory", "c_refinery", "c_aircmd", "c_power", "c_depot", "c_power", "c_lab", "c_power", "c_processor", "c_power", "c_tempest", "c_power", "c_phasegate", "c_factory"],
  D: ["d_power", "d_refinery", "d_barracks", "d_power", "d_factory", "d_refinery", "d_radar", "d_power", "d_depot", "d_power", "d_lab", "d_reactor", "d_silo", "d_bulwark", "d_factory"],
};
const DEFENSE: Record<string, [string, number][]> = {
  C: [["c_pillbox", 2], ["c_sam", 1], ["c_spire", 3]],
  D: [["d_sentry", 2], ["d_flakbat", 1], ["d_coil", 3]],
};
const INF: Record<string, [string, number][]> = {
  C: [["c_trooper", 6], ["c_lancer", 4], ["hound", 1], ["c_wraith", 1]],
  D: [["d_levy", 6], ["d_flak", 2], ["d_arc", 3], ["hound", 1], ["d_jugg", 1]],
};
const VEH: Record<string, [string, number][]> = {
  C: [["c_warden", 6], ["c_rover", 2], ["c_lens", 3]],
  D: [["d_bastion", 6], ["d_hauler", 1], ["d_siege", 2], ["d_crawler", 2], ["d_titan", 3], ["d_dread", 1]],
};

export function aiInit(w: World, p: Player) {
  const mcv = w.ents.find((e) => e.owner === p.idx && e.type === "mhv");
  const diff = p.ai ?? "normal";
  const st: AIState = {
    baseX: mcv ? mcv.x >> 8 : 0,
    baseY: mcv ? mcv.y >> 8 : 0,
    waveSize: diff === "easy" ? 4 : diff === "hard" ? 8 : 6,
    nextWave: diff === "easy" ? 20 * 60 * 6 : diff === "hard" ? 20 * 60 * 3 : 20 * 60 * 4,
    attackers: [],
    targetId: 0,
    engineerSent: [],
    thinkEvery: diff === "easy" ? 3 : 1,
    lastThink: 0,
  };
  p.aiState = st;
}

function own(w: World, p: Player) {
  return w.ents.filter((e) => !e.dead && e.owner === p.idx);
}

function count(list: Entity[], type: string) {
  let n = 0;
  for (const e of list) if (e.type === type) n++;
  return n;
}

function pickWeighted(w: World, opts: [string, number][], p: Player, ents: Entity[]): string | null {
  const ok = opts.filter(([t]) => w.canBuild(p, t) && !(RULES[t].hero && count(ents, t) > 0));
  if (!ok.length) return null;
  let total = 0;
  for (const [, wt] of ok) total += wt;
  let r = w.rng.int(total);
  for (const [t, wt] of ok) {
    if (r < wt) return t;
    r -= wt;
  }
  return ok[0][0];
}

export function aiThink(w: World, p: Player) {
  const st = p.aiState as AIState;
  if (!st) return;
  st.lastThink++;
  if (st.lastThink % st.thinkEvery !== 0) return;
  const ents = own(w, p);
  const blds = ents.filter((e) => e.kind === "bld");
  const hub = blds.find((e) => e.r.tags.includes("hub"));
  if (hub) {
    st.baseX = hub.bx + 1;
    st.baseY = hub.by + 1;
  }
  // 1. deploy MCV
  if (!hub) {
    const mcv = ents.find((e) => e.type === "mhv");
    if (mcv && !mcv.moving && !mcv.pathPending) {
      const before = w.ents.length;
      w.applyCommand(p.idx, { c: "deploy", ids: [mcv.id] });
      if (w.ents.length === before && w.tick % 40 === 0) {
        // could not deploy: nudge
        const W = w.map.w;
        const cx = mcv.cell % W,
          cy = (mcv.cell / W) | 0;
        w.applyCommand(p.idx, { c: "move", ids: [mcv.id], x: cx + w.rng.range(-3, 3), y: cy + w.rng.range(-3, 3) });
      }
    }
  }
  // 2. place ready structures
  for (const q of ["bld", "def"] as const) {
    const t = p.ready[q];
    if (!t) continue;
    const spot = findSpot(w, p, t, st);
    if (spot) w.applyCommand(p.idx, { c: "place", type: t, x: spot[0], y: spot[1] });
    else w.applyCommand(p.idx, { c: "cancel", type: t });
  }
  if (!hub && !blds.length) return;
  // 3. structures
  if (!p.queues.bld.length && !p.ready.bld && hub) {
    const next = nextStructure(w, p, ents);
    if (next) w.applyCommand(p.idx, { c: "build", type: next });
  }
  // 4. defenses
  if (!p.queues.def.length && !p.ready.def && hub && p.credits > 1200 && p.tags.has("factory")) {
    for (const [t, n] of DEFENSE[p.faction]) {
      if (count(ents, t) < n && w.canBuild(p, t)) {
        w.applyCommand(p.idx, { c: "build", type: t });
        break;
      }
    }
    if (!p.queues.def.length && p.credits > 6000) {
      const sw = ["c_tempest", "c_phasegate", "d_silo", "d_bulwark"].find((t) => w.canBuild(p, t) && count(ents, t) === 0);
      if (sw) w.applyCommand(p.idx, { c: "build", type: sw });
    }
  }
  // 5. harvesters
  const refs = blds.filter((e) => e.r.tags.includes("refinery") && e.built >= CONSTRUCT_TICKS).length;
  const harvType = p.faction === "C" ? "c_harv" : "d_harv";
  const harvs = count(ents, harvType) + p.queues.veh.filter((i) => i.type === harvType).length;
  const wantHarv = Math.min(6, refs + (p.ai === "hard" ? 2 : 1));
  if (harvs < wantHarv && w.canBuild(p, harvType) && p.queues.veh.length < 3) w.applyCommand(p.idx, { c: "build", type: harvType });
  // 6. army production — adapt to what the enemy fields
  const reserve = p.queues.bld.length ? 400 : 0;
  let eAir = 0,
    eVeh = 0,
    eInf = 0;
  for (const e of w.ents) {
    if (e.dead || !w.isEnemy(p.idx, e.owner)) continue;
    if (e.kind === "air") eAir++;
    else if (e.kind === "veh" && !e.r.harvester) eVeh++;
    else if (e.kind === "inf") eInf++;
  }
  const adapt = (opts: [string, number][]) =>
    opts.map(([t, wt]): [string, number] => {
      const r = RULES[t];
      const aa = !!(r.wAir || r.deployAir) && !(r.wGround && r.wAir === r.wGround);
      if (t === "d_flak" || t === "c_rover" || t === "d_hauler") return [t, eAir > 0 ? wt * 3 + eAir : Math.max(1, wt >> 1)];
      if (t === "c_lancer") return [t, wt + (eVeh > eInf ? 3 : 0) + (eAir ? 2 : 0)];
      if (aa && eAir === 0) return [t, wt];
      return [t, wt];
    });
  let infValue = 0,
    armyValue = 1;
  for (const e of ents) {
    if (e.kind === "bld" || e.r.harvester || e.type === "mhv" || e.r.engineer) continue;
    armyValue += e.r.cost;
    if (e.kind === "inf") infValue += e.r.cost;
  }
  const infCap = p.faction === "D" ? 0.4 : 0.55;
  const infOk = infValue / armyValue < infCap || !p.tags.has("factory") || p.credits > 3000;
  if (p.queues.inf.length < 2 && p.credits > 400 + reserve && infOk) {
    // capture fuel wells with engineers
    const engNeeded = w.ents.some((e) => !e.dead && e.type === "fuelwell" && e.owner < 0 && dist2(e.bx, e.by, st.baseX, st.baseY) < 30 * 30) && count(ents, "engineer") === 0 && st.engineerSent.length < 3;
    const t = engNeeded && w.canBuild(p, "engineer") ? "engineer" : pickWeighted(w, adapt(INF[p.faction]), p, ents);
    if (t) w.applyCommand(p.idx, { c: "build", type: t });
  }
  if (p.queues.veh.length < 2 && p.credits > (p.faction === "D" ? 700 : 900) + reserve) {
    const t = pickWeighted(w, adapt(VEH[p.faction]), p, ents);
    if (t) w.applyCommand(p.idx, { c: "build", type: t });
  }
  if (p.faction === "C" && p.queues.air.length < 1 && p.credits > 2000 && count(ents, "c_striker") < 4 && w.canBuild(p, "c_striker")) w.applyCommand(p.idx, { c: "build", type: "c_striker" });
  // 7. engineers → fuel wells
  for (const e of ents) {
    if (e.type !== "engineer" || e.order !== "idle") continue;
    let best: Entity | null = null,
      bd = 1e18;
    for (const o of w.ents) {
      if (o.dead || o.type !== "fuelwell" || o.owner === p.idx || (o.owner >= 0 && !w.isEnemy(p.idx, o.owner))) continue;
      const d = dist2(e.x, e.y, o.x, o.y);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    if (best) {
      w.applyCommand(p.idx, { c: "enter", ids: [e.id], t: best.id });
      st.engineerSent.push(e.id);
    }
  }
  // 8. repair
  if (p.credits > 800)
    for (const b of blds) if (!b.repairing && b.hp < (b.r.hp * 60) / 100 && b.built >= CONSTRUCT_TICKS) w.applyCommand(p.idx, { c: "repair", t: b.id });
  // 9. superweapons
  if (w.settings.superweapons)
    for (const b of blds) {
      const swId = b.r.superweapon;
      if (!swId || b.swCharge < SUPERWEAPONS[swId].charge) continue;
      const tgt = bestSwTarget(w, p, swId);
      if (!tgt) continue;
      if (swId === "phase") {
        // teleport a tank group into the enemy base
        const army = ents.filter((e) => e.kind === "veh" && !e.r.harvester && e.type !== "mhv");
        if (army.length < 4) continue;
        const a = army[0];
        w.applyCommand(p.idx, { c: "sw", kind: swId, x: a.x >> 8, y: a.y >> 8, x2: tgt[0], y2: tgt[1] });
      } else if (swId === "bulwark") {
        const army = ents.filter((e) => e.kind === "veh" && !e.r.harvester && (e.order === "amove" || e.order === "attack") && e.target);
        if (army.length < 3) continue;
        w.applyCommand(p.idx, { c: "sw", kind: swId, x: army[0].x >> 8, y: army[0].y >> 8 });
      } else w.applyCommand(p.idx, { c: "sw", kind: swId, x: tgt[0], y: tgt[1] });
    }
  // 10. army control
  const army = ents.filter((e) => e.kind !== "bld" && !e.r.harvester && !e.r.engineer && e.type !== "mhv" && (e.r.wGround || e.r.wAir || e.r.deployGround));
  // defend base
  let threat: Entity | null = null;
  for (const b of blds) {
    if (w.tick - b.attackedAt < 60) {
      const a = w.get(b.attackerId);
      if (a && w.isEnemy(p.idx, a.owner)) {
        threat = a;
        break;
      }
    }
  }
  if (!threat) {
    // enemy units near base
    w.forNear(st.baseX * LEP, st.baseY * LEP, 14 * LEP, (o) => {
      if (!threat && o.kind !== "bld" && w.isEnemy(p.idx, o.owner) && !o.flying) threat = o;
    });
  }
  const t0 = threat as Entity | null;
  if (t0) {
    const defenders = army.filter((e) => (e.order === "idle" || e.order === "guard") && dist2(e.x, e.y, t0.x, t0.y) < 30 * 30 * LEP * LEP && !st.attackers.includes(e.id));
    if (defenders.length) w.applyCommand(p.idx, { c: "amove", ids: defenders.map((e) => e.id), x: t0.x >> 8, y: t0.y >> 8 });
  }
  // attack waves
  st.attackers = st.attackers.filter((id) => w.get(id));
  const idle = army.filter((e) => e.order === "idle" && !e.deployed && !st.attackers.includes(e.id));
  if (w.tick >= st.nextWave && idle.length >= st.waveSize) {
    const target = enemyTarget(w, p, st);
    if (target) {
      const ids = idle.map((e) => e.id);
      st.attackers.push(...ids);
      st.targetId = target.id;
      w.applyCommand(p.idx, { c: "amove", ids, x: target.x >> 8, y: target.y >> 8 });
      st.waveSize = Math.min(24, st.waveSize + (p.ai === "hard" ? 3 : 2));
      st.nextWave = w.tick + (p.ai === "easy" ? 2400 : 1400);
    }
  }
  // keep attackers going
  if (st.attackers.length) {
    const tgt = w.get(st.targetId);
    const lazy = st.attackers.map((id) => w.get(id)!).filter((e) => e && e.order === "idle" && !e.deployed);
    if (lazy.length) {
      const nt = tgt && w.isEnemy(p.idx, tgt.owner) ? tgt : enemyTarget(w, p, st);
      if (nt) {
        st.targetId = nt.id;
        w.applyCommand(p.idx, { c: "amove", ids: lazy.map((e) => e.id), x: nt.x >> 8, y: nt.y >> 8 });
      }
    }
  }
  // gather idle army at rally
  if ((w.tick / 10) % 30 === 0) {
    const rx = st.baseX + Math.sign(w.map.w / 2 - st.baseX) * 6,
      ry = st.baseY + Math.sign(w.map.h / 2 - st.baseY) * 6;
    const loiter = idle.filter((e) => dist2(e.x >> 8, e.y >> 8, rx, ry) > 36 && e.kind !== "air");
    if (loiter.length) w.applyCommand(p.idx, { c: "move", ids: loiter.map((e) => e.id), x: rx, y: ry });
  }
  // jets: strike
  for (const j of ents) {
    if (!j.r.jet || j.air !== "landed" || j.ammo < (j.r.ammo ?? 1) || j.order !== "idle") continue;
    const tgt = w.get(st.targetId) ?? enemyTarget(w, p, st);
    if (tgt) w.applyCommand(p.idx, { c: "attack", ids: [j.id], t: tgt.id });
  }
}

function nextStructure(w: World, p: Player, ents: Entity[]): string | null {
  const plan = PLAN[p.faction];
  const seen: Record<string, number> = {};
  for (const t of plan) {
    seen[t] = (seen[t] ?? 0) + 1;
    if (count(ents, t) >= seen[t]) continue;
    if (!w.canBuild(p, t)) continue;
    const r = RULES[t];
    if (r.cost > p.credits + 600 && r.power <= 0) return null;
    // power check
    if (r.power < 0 && p.powerOut - p.powerIn + r.power < 0) {
      const pw = p.faction === "C" ? "c_power" : "d_power";
      return w.canBuild(p, pw) ? pw : null;
    }
    return t;
  }
  // late game: more power if low, otherwise extra refinery/factory occasionally
  if (p.powerOut - p.powerIn < 100) return p.faction === "C" ? "c_power" : "d_power";
  return null;
}

function findSpot(w: World, p: Player, type: string, st: AIState): [number, number] | null {
  const r = RULES[type];
  const m = w.map;
  const W = m.w;
  const ex = w.map.w / 2,
    ey = w.map.h / 2; // general enemy direction ~ map centre
  let best: [number, number] | null = null,
    bs = 1e18;
  const isRef = r.tags.includes("refinery");
  const isDef = r.queue === "def" && !r.superweapon;
  for (let rad = 2; rad <= 16; rad++) {
    for (let dy = -rad; dy <= rad; dy++)
      for (let dx = -rad; dx <= rad; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
        const bx = st.baseX + dx - (r.w >> 1),
          by = st.baseY + dy - (r.h >> 1);
        if (!w.placementOk(p, type, bx, by)) continue;
        // keep a 1-cell gap around footprint (except tiny defenses) so units never get boxed in
        const busy = r.tags.includes("refinery") || r.tags.includes("factory") || r.tags.includes("hub");
        if (!isDef && !gapOk(w, bx, by, r.w, r.h, busy ? 2 : 1)) continue;
        if (blocksDoor(w, p, bx, by, r.w, r.h)) continue;
        if (isRef && !w.map.inside(bx + 1, by + r.h)) continue;
        if (isRef && !w.groundPassable((by + r.h) * W + bx + 1)) continue;
        let s = rad * 10;
        if (isRef) s = oreDist(w, bx + 1, by + 1) * 12 + rad * 2;
        if (isDef) {
          const d = Math.floor(Math.sqrt((bx - ex) * (bx - ex) + (by - ey) * (by - ey)));
          s = d * 6 + Math.abs(rad - 6) * 8;
        }
        if (s < bs) {
          bs = s;
          best = [bx, by];
        }
      }
    if (best && rad > 8) break;
  }
  return best;
}

function gapOk(w: World, bx: number, by: number, bw: number, bh: number, gap = 1) {
  const m = w.map;
  const W = m.w;
  for (let y = by - gap; y < by + bh + gap; y++)
    for (let x = bx - gap; x < bx + bw + gap; x++) {
      if (x >= bx && x < bx + bw && y >= by && y < by + bh) continue;
      if (!m.inside(x, y)) continue;
      const id = w.bldAt[y * W + x];
      if (id) {
        const b = w.get(id);
        if (b && !b.r.wall && b.r.w > 1) return false;
      }
    }
  return true;
}

/** would this footprint sit within 2 cells in front of an existing dock or factory door? */
function blocksDoor(w: World, p: Player, bx: number, by: number, bw: number, bh: number) {
  for (const e of w.ents) {
    if (e.dead || e.owner !== p.idx || e.kind !== "bld") continue;
    if (!e.r.tags.includes("refinery") && !e.r.tags.includes("factory") && !e.r.tags.includes("barracks")) continue;
    const dx = e.r.tags.includes("refinery") ? e.bx + 1 : e.bx + Math.floor(e.r.w / 2),
      dy = e.by + e.r.h;
    if (dx + 1 >= bx && dx - 1 < bx + bw && dy + 2 >= by && dy < by + bh) return true;
  }
  return false;
}

function oreDist(w: World, x: number, y: number) {
  const m = w.map;
  for (let r = 0; r < 20; r++) {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const cx = x + dx,
          cy = y + dy;
        if (m.inside(cx, cy) && m.oreType[cy * m.w + cx]) return r;
      }
  }
  return 20;
}

function enemyTarget(w: World, p: Player, st: AIState): Entity | null {
  let best: Entity | null = null,
    bd = 1e18;
  for (const e of w.ents) {
    if (e.dead || !w.isEnemy(p.idx, e.owner)) continue;
    if (e.kind === "bld" && e.r.wall) continue;
    const d = dist2(e.x >> 8, e.y >> 8, st.baseX, st.baseY) + (e.kind === "bld" ? 0 : 200);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}

function bestSwTarget(w: World, p: Player, sw: string): [number, number] | null {
  let best: [number, number] | null = null,
    bs = 0;
  for (const e of w.ents) {
    if (e.dead || e.kind !== "bld" || !w.isEnemy(p.idx, e.owner)) continue;
    let s = 0;
    w.forNear(e.x, e.y, 4 * LEP, (o) => {
      if (w.isEnemy(p.idx, o.owner)) s += o.r.cost;
    });
    if (sw === "phase") s = -dist2(e.x, e.y, w.map.w * 128, w.map.h * 128) + s;
    if (s > bs) {
      bs = s;
      best = [e.x >> 8, e.y >> 8];
    }
  }
  return best;
}
