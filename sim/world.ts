// The deterministic simulation world. Every client runs an identical copy and feeds it the
// same command stream (lockstep), so all state changes must be deterministic.

import { Entity, Player, Proj, type PlayerInit, type QueueItem, type SimEvent } from "./entity";
import { Hasher, LEP, HALF, Rng, dist2, isqrt } from "./fixed";
import { GameMap, generateMap } from "./map";
import { PathFinder } from "./path";
import {
  ADJACENT,
  CONSTRUCT_TICKS,
  FACTION_HUB,
  FACTION_STARTERS,
  INCOME_PERIOD,
  MULTI_FACTORY_SPEED,
  ORE_GROW_PERIOD,
  ORE_MAX,
  QUEUES,
  QUEUE_PRODUCER,
  RULES,
  SELL_REFUND_PCT,
  SELL_TICKS,
  SUPERWEAPONS,
  SURVIVORS,
  buildTicks,
  rule,
  type Queue,
  type Rule,
} from "./rules";
import { sanitizeCommand, type Command } from "./commands";
import { updateUnit, setMoveGoal, groupMove, stopUnit, scatterUnit, nearestFreeCell, deployUnit } from "./units";
import { updateProjectiles, updateStructureCombat, killEntity, explode, updateSuperweaponEffects, fireSuperweapon } from "./combat";
import { aiThink, aiInit } from "./ai";

export interface GameSettings {
  seed: number;
  mapSize: number;
  credits: number;
  startUnits: number;
  superweapons: boolean;
  shortGame: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  seed: 1,
  mapSize: 72,
  credits: 10000,
  startUnits: 3,
  superweapons: true,
  shortGame: true,
};

export interface Storm {
  owner: number;
  x: number;
  y: number;
  start: number;
  end: number;
}
export interface Rad {
  x: number;
  y: number;
  r: number;
  until: number;
}

const RULE_INDEX: Record<string, number> = {};
Object.keys(RULES).forEach((k, i) => (RULE_INDEX[k] = i));

const BUCKET = 8;
const MAX_PATHS_PER_TICK = 24;

export class World {
  tick = 0;
  settings: GameSettings;
  rng: Rng;
  map: GameMap;
  players: Player[] = [];
  ents: Entity[] = [];
  byId = new Map<number, Entity>();
  projs: Proj[] = [];
  nextId = 1;
  events: SimEvent[] = [];
  bldAt: Int32Array; // structure id per cell
  solid: Uint8Array; // 1 = blocked by structure
  vehAt: Int32Array; // vehicle occupying / reserving each cell
  infAt: Uint8Array; // infantry count per cell
  oreClaim: Int32Array;
  pf: PathFinder;
  pathQueue: number[] = [];
  buckets: Entity[][];
  bw: number;
  bh: number;
  stampGen = 0;
  storms: Storm[] = [];
  rads: Rad[] = [];
  winner = -2; // -2 ongoing, -1 draw, else winning team key (player idx of a survivor)
  winners: number[] = [];
  structVersion = 0;

  constructor(settings: GameSettings, players: PlayerInit[]) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.rng = new Rng(this.settings.seed);
    this.map = generateMap({ seed: this.settings.seed, size: this.settings.mapSize, players: Math.max(2, players.length) });
    const n = this.map.w * this.map.h;
    this.bldAt = new Int32Array(n);
    this.solid = new Uint8Array(n);
    this.vehAt = new Int32Array(n);
    this.infAt = new Uint8Array(n);
    this.oreClaim = new Int32Array(n);
    this.pf = new PathFinder(this.map.w, this.map.h);
    this.bw = Math.ceil(this.map.w / BUCKET);
    this.bh = Math.ceil(this.map.h / BUCKET);
    this.buckets = Array.from({ length: this.bw * this.bh }, () => []);
    players.forEach((p, i) => this.players.push(new Player(i, p, n)));
    this.setup();
  }

  // ───────────────────────────── setup ─────────────────────────────
  private setup() {
    const m = this.map;
    // neutral fuel wells
    for (const w of m.wells) {
      const e = this.addStructure("fuelwell", -1, w.x, w.y, true);
      if (!e) continue;
    }
    // shuffle start positions deterministically
    const starts = m.starts.slice();
    for (let i = starts.length - 1; i > 0; i--) {
      const j = this.rng.int(i + 1);
      [starts[i], starts[j]] = [starts[j], starts[i]];
    }
    this.players.forEach((p, i) => {
      const s = starts[i % starts.length];
      p.credits = this.settings.credits;
      const mcv = this.spawnUnit("mhv", i, s.x * LEP + HALF, s.y * LEP + HALF, 32);
      if (mcv) mcv.facing = 32;
      const list = FACTION_STARTERS[p.faction].slice(0, this.settings.startUnits);
      let k = 0;
      for (const t of list) {
        const cell = nearestFreeCell(this, s.x + 2 + (k % 3), s.y - 2 + Math.floor(k / 3), RULES[t].kind === "inf");
        k++;
        if (cell < 0) continue;
        const [cx, cy] = this.cellCenter(cell);
        this.spawnUnit(t, i, cx, cy, 32);
      }
      this.revealCircle(p, s.x, s.y, 10);
      if (p.ai) aiInit(this, p);
    });
  }

  // ───────────────────────────── helpers ─────────────────────────────
  cellOf(x: number, y: number) {
    const cx = Math.max(0, Math.min(this.map.w - 1, x >> 8));
    const cy = Math.max(0, Math.min(this.map.h - 1, y >> 8));
    return cy * this.map.w + cx;
  }
  cellCenter(i: number): [number, number] {
    const W = this.map.w;
    return [(i % W) * LEP + HALF, ((i / W) | 0) * LEP + HALF];
  }
  get(id: number): Entity | undefined {
    const e = this.byId.get(id);
    return e && !e.dead ? e : undefined;
  }
  emit(ev: SimEvent) {
    this.events.push(ev);
  }
  eva(owner: number, msg: string) {
    this.events.push({ e: "eva", owner, msg });
  }
  isEnemy(a: number, b: number): boolean {
    if (a < 0 || b < 0 || a === b) return false;
    const ta = this.players[a].team,
      tb = this.players[b].team;
    return !(ta !== 0 && ta === tb);
  }
  isAlly(a: number, b: number): boolean {
    if (a < 0 || b < 0) return false;
    if (a === b) return true;
    const ta = this.players[a].team;
    return ta !== 0 && ta === this.players[b].team;
  }
  groundPassable(i: number) {
    return this.map.groundOk(i) && !this.solid[i];
  }

  newId() {
    return this.nextId++;
  }

  spawnUnit(type: string, owner: number, x: number, y: number, facing = 0): Entity | null {
    const r = rule(type);
    const e = new Entity(this.newId(), r, owner);
    e.x = e.px = x;
    e.y = e.py = y;
    e.facing = e.turret = facing & 255;
    e.cell = this.cellOf(x, y);
    e.goalX = x;
    e.goalY = y;
    e.goalCell = e.cell;
    if (r.kind === "veh" && !this.vehAt[e.cell]) this.vehAt[e.cell] = e.id;
    if (r.kind === "air") {
      e.z = e.pz = 0;
      e.air = r.jet ? "landed" : "flying";
    }
    if (r.harvester) e.order = "harvest";
    this.ents.push(e);
    this.byId.set(e.id, e);
    return e;
  }

  addStructure(type: string, owner: number, bx: number, by: number, complete: boolean): Entity | null {
    const r = rule(type);
    const e = new Entity(this.newId(), r, owner);
    e.bx = bx;
    e.by = by;
    e.x = e.px = bx * LEP + (r.w * LEP) / 2;
    e.y = e.py = by * LEP + (r.h * LEP) / 2;
    e.cell = this.cellOf(e.x, e.y);
    e.built = complete ? CONSTRUCT_TICKS : 0;
    e.facing = e.turret = 96;
    const W = this.map.w;
    for (let y = by; y < by + r.h; y++)
      for (let x = bx; x < bx + r.w; x++) {
        const i = y * W + x;
        this.bldAt[i] = e.id;
        if (!r.repairBay) this.solid[i] = 1;
      }
    this.ents.push(e);
    this.byId.set(e.id, e);
    this.structVersion++;
    if (complete) this.onStructureComplete(e);
    return e;
  }

  footprintCells(e: Entity): number[] {
    const out: number[] = [];
    const W = this.map.w;
    for (let y = e.by; y < e.by + e.r.h; y++) for (let x = e.bx; x < e.bx + e.r.w; x++) out.push(y * W + x);
    return out;
  }

  /** distance (leptons) from point to entity's body (footprint edge for structures) */
  distTo(x: number, y: number, t: Entity): number {
    if (t.kind === "bld") {
      const x0 = t.bx * LEP,
        y0 = t.by * LEP,
        x1 = x0 + t.r.w * LEP,
        y1 = y0 + t.r.h * LEP;
      const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
      const dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
      return isqrt(dx * dx + dy * dy);
    }
    return isqrt(dist2(x, y, t.x, t.y));
  }

  /** iterate entities whose position is within r leptons of (x,y) (structures by footprint) */
  forNear(x: number, y: number, r: number, fn: (e: Entity) => void) {
    const stamp = ++this.stampGen;
    const bs = BUCKET * LEP;
    const x0 = Math.max(0, Math.floor((x - r - 2 * LEP) / bs)),
      x1 = Math.min(this.bw - 1, Math.floor((x + r + 2 * LEP) / bs));
    const y0 = Math.max(0, Math.floor((y - r - 2 * LEP) / bs)),
      y1 = Math.min(this.bh - 1, Math.floor((y + r + 2 * LEP) / bs));
    for (let by = y0; by <= y1; by++)
      for (let bx = x0; bx <= x1; bx++) {
        const b = this.buckets[by * this.bw + bx];
        for (let k = 0; k < b.length; k++) {
          const e = b[k];
          if (e.stamp === stamp || e.dead) continue;
          e.stamp = stamp;
          if (this.distTo(x, y, e) <= r) fn(e);
        }
      }
  }

  private rebuildBuckets() {
    for (const b of this.buckets) b.length = 0;
    const W = this.map.w;
    this.infAt.fill(0);
    for (const e of this.ents) {
      if (e.dead) continue;
      if (e.kind === "bld") {
        const bx0 = Math.floor(e.bx / BUCKET),
          bx1 = Math.floor((e.bx + e.r.w - 1) / BUCKET);
        const by0 = Math.floor(e.by / BUCKET),
          by1 = Math.floor((e.by + e.r.h - 1) / BUCKET);
        for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) this.buckets[by * this.bw + bx].push(e);
      } else {
        const c = e.cell;
        const bx = Math.floor((c % W) / BUCKET),
          by = Math.floor(((c / W) | 0) / BUCKET);
        this.buckets[by * this.bw + bx].push(e);
        if (e.kind === "inf") this.infAt[c]++;
      }
    }
  }

  // ───────────────────────────── shroud ─────────────────────────────
  private circleCache = new Map<number, number[]>();
  circle(r: number): number[] {
    let c = this.circleCache.get(r);
    if (!c) {
      c = [];
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + r) c.push(dx, dy);
      this.circleCache.set(r, c);
    }
    return c;
  }
  revealCircle(p: Player, cx: number, cy: number, r: number) {
    const c = this.circle(r);
    const W = this.map.w,
      H = this.map.h;
    let changed = false;
    for (const q of this.players) {
      if (q !== p && !this.isAlly(p.idx, q.idx)) continue;
      const ex = q.explored;
      for (let k = 0; k < c.length; k += 2) {
        const x = cx + c[k],
          y = cy + c[k + 1];
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = y * W + x;
        if (!ex[i]) {
          ex[i] = 1;
          changed = true;
        }
      }
      if (changed) q.exploredVersion++;
    }
  }
  private updateShroud() {
    const W = this.map.w;
    for (const e of this.ents) {
      if (e.dead || e.owner < 0) continue;
      if (e.revealCell === e.cell) continue;
      e.revealCell = e.cell;
      const p = this.players[e.owner];
      const r = e.kind === "bld" ? e.r.sight + Math.floor(Math.max(e.r.w, e.r.h) / 2) : e.r.sight;
      this.revealCircle(p, e.cell % W, (e.cell / W) | 0, r);
    }
  }

  // ───────────────────────────── commands ─────────────────────────────
  applyCommand(pi: number, raw: Command) {
    const cmd = sanitizeCommand(raw);
    if (!cmd) return;
    const p = this.players[pi];
    if (!p || p.defeated) return;
    if ("ids" in cmd) {
      const units: Entity[] = [];
      for (const id of cmd.ids) {
        const e = this.get(id);
        if (e && e.owner === pi && (e.kind !== "bld" || cmd.c === "deploy")) units.push(e);
      }
      if (!units.length) return;
      this.unitCommand(p, units, cmd);
      return;
    }
    switch (cmd.c) {
      case "build":
        for (let k = 0; k < (cmd.n ?? 1); k++) this.queueBuild(p, cmd.type);
        break;
      case "hold": {
        const r = RULES[cmd.type];
        if (!r || !r.queue) return;
        const q = p.queues[r.queue];
        const it = q.find((i) => i.type === cmd.type);
        if (it) {
          it.hold = !it.hold;
          this.eva(pi, it.hold ? "On hold" : "Building");
        }
        break;
      }
      case "cancel":
        this.cancelBuild(p, cmd.type, !!cmd.all);
        break;
      case "place":
        this.placeStructure(p, cmd.type, cmd.x, cmd.y);
        break;
      case "sell": {
        const e = this.get(cmd.t);
        if (e && e.owner === pi && e.kind === "bld" && e.selling === 0 && e.built >= CONSTRUCT_TICKS) {
          e.selling = 1;
          e.repairing = false;
          this.emit({ e: "sell", id: e.id, owner: pi });
        }
        break;
      }
      case "repair": {
        const e = this.get(cmd.t);
        if (e && e.owner === pi && e.kind === "bld" && e.selling === 0) {
          e.repairing = !e.repairing && e.hp < e.r.hp;
        }
        break;
      }
      case "primary": {
        const e = this.get(cmd.t);
        if (e && e.owner === pi && e.kind === "bld") {
          for (const q of QUEUES) if (e.r.tags.includes(QUEUE_PRODUCER[q]) && q !== "bld" && q !== "def") p.primary[q] = e.id;
          this.eva(pi, "Primary building selected");
        }
        break;
      }
      case "rally": {
        const e = this.get(cmd.t);
        if (e && e.owner === pi && e.kind === "bld" && this.map.inside(cmd.x, cmd.y)) {
          e.rallyX = cmd.x;
          e.rallyY = cmd.y;
        }
        break;
      }
      case "sw":
        if (this.settings.superweapons) fireSuperweapon(this, p, cmd.kind, cmd.x, cmd.y, cmd.x2, cmd.y2);
        break;
      case "leave":
        p.left = true;
        this.defeat(p);
        break;
    }
  }

  private unitCommand(p: Player, units: Entity[], cmd: Command) {
    const W = this.map.w;
    switch (cmd.c) {
      case "move":
      case "amove": {
        if (!this.map.inside(cmd.x, cmd.y)) return;
        groupMove(this, units, cmd.x, cmd.y, cmd.c);
        break;
      }
      case "attack": {
        const t = this.get(cmd.t);
        if (!t) return;
        for (const u of units) {
          if (u.r.harvester && !u.r.wGround) continue;
          if (u.r.engineer) continue;
          if (u.deployed && !u.r.deployGround) continue;
          u.order = "attack";
          u.target = t.id;
          u.autoTarget = false;
          u.repathAt = 0;
          if (u.kind === "air" && u.r.jet && u.air === "landed") u.air = "flying";
        }
        break;
      }
      case "ffire": {
        if (!this.map.inside(cmd.x, cmd.y)) return;
        for (const u of units) {
          if (!u.r.wGround) continue;
          u.order = "ffire";
          u.target = 0;
          u.tx = cmd.x * LEP + HALF;
          u.ty = cmd.y * LEP + HALF;
          u.repathAt = 0;
          if (u.kind === "air" && u.r.jet && u.air === "landed") u.air = "flying";
        }
        break;
      }
      case "stop":
        for (const u of units) stopUnit(this, u);
        break;
      case "guard":
        for (const u of units) {
          stopUnit(this, u);
          u.order = "guard";
          u.gx = u.x;
          u.gy = u.y;
        }
        break;
      case "scatter":
        for (const u of units) scatterUnit(this, u);
        break;
      case "deploy":
        for (const u of units) deployUnit(this, u);
        break;
      case "enter": {
        const t = this.get(cmd.t);
        if (!t) return;
        for (const u of units) this.orderEnter(u, t);
        break;
      }
      case "harvest": {
        if (!this.map.inside(cmd.x, cmd.y)) return;
        const cell = cmd.y * W + cmd.x;
        for (const u of units) {
          if (!u.r.harvester) continue;
          stopUnit(this, u);
          u.order = "harvest";
          u.harv = "toOre";
          u.lastOre = cell;
        }
        break;
      }
    }
  }

  orderEnter(u: Entity, t: Entity) {
    const r = t.r;
    if (u.r.engineer && t.kind === "bld" && !r.wall) {
      if (this.isEnemy(u.owner, t.owner) || (t.owner < 0 && r.capturable) || (t.owner === u.owner && t.hp < r.hp)) {
        stopUnit(this, u);
        u.order = "enter";
        u.target = t.id;
        return;
      }
    }
    if (u.r.harvester && t.owner === u.owner && r.tags.includes("refinery")) {
      stopUnit(this, u);
      u.order = "harvest";
      u.harv = u.cargo > 0 ? "toRef" : "toOre";
      u.refId = t.id;
      u.refLock = true;
      return;
    }
    if (u.kind === "veh" && t.owner === u.owner && r.repairBay) {
      stopUnit(this, u);
      u.order = "enter";
      u.target = t.id;
      return;
    }
    if (u.r.jet && t.owner === u.owner && r.pads) {
      u.order = "idle";
      u.air = "returning";
      u.home = t.id;
      return;
    }
    if (u.r.chargesCoil && t.owner === u.owner && r.chargeable) {
      stopUnit(this, u);
      u.order = "charge";
      u.target = t.id;
      return;
    }
    if (this.isEnemy(u.owner, t.owner)) {
      // fall back to attack
      u.order = "attack";
      u.target = t.id;
      u.autoTarget = false;
    }
  }

  // ───────────────────────────── production ─────────────────────────────
  canBuild(p: Player, type: string): boolean {
    const r = RULES[type];
    if (!r || !r.queue) return false;
    if (r.faction !== "*" && r.faction !== p.faction) return false;
    for (const t of r.prereq) if (!p.tags.has(t)) return false;
    if (!p.tags.has(QUEUE_PRODUCER[r.queue])) return false;
    if (r.superweapon && !this.settings.superweapons) return false;
    if (r.hero) {
      if (this.ents.some((e) => !e.dead && e.owner === p.idx && e.type === type)) return false;
      if (p.queues[r.queue].some((i) => i.type === type)) return false;
    }
    return true;
  }

  private queueBuild(p: Player, type: string) {
    if (!this.canBuild(p, type)) return;
    const r = RULES[type];
    const q = r.queue!;
    const list = p.queues[q];
    if (q === "bld" || q === "def") {
      if (list.length > 0 || p.ready[q]) return;
    } else if (list.length >= 15) return;
    list.push({ type, progress: 0, spent: 0, hold: false });
    if (list.length === 1) this.eva(p.idx, q === "bld" || q === "def" ? "Building" : "Training");
  }

  private cancelBuild(p: Player, type: string, all: boolean) {
    const r = RULES[type];
    if (!r || !r.queue) return;
    const q = r.queue;
    if ((q === "bld" || q === "def") && p.ready[q] === type) {
      p.ready[q] = null;
      p.credits += r.cost;
      this.eva(p.idx, "Cancelled");
      return;
    }
    const list = p.queues[q];
    for (let k = list.length - 1; k >= 0; k--) {
      if (list[k].type !== type) continue;
      p.credits += list[k].spent;
      list.splice(k, 1);
      this.eva(p.idx, "Cancelled");
      if (!all) break;
    }
  }

  private updateProduction(p: Player) {
    for (const q of QUEUES) {
      const list = p.queues[q];
      if (!list.length) continue;
      const it = list[0];
      if (it.hold) continue;
      if ((q === "bld" || q === "def") && p.ready[q]) continue;
      const r = RULES[it.type];
      // lost prerequisites → keep paused
      if (!this.canBuildContinue(p, r)) continue;
      const producers = this.countProducers(p, QUEUE_PRODUCER[q]);
      if (producers === 0) continue;
      let speed = MULTI_FACTORY_SPEED[Math.min(producers, MULTI_FACTORY_SPEED.length) - 1];
      if (p.lowPower) {
        const ratio = p.powerIn > 0 ? Math.floor((p.powerOut * 100) / p.powerIn) : 100;
        speed = Math.floor((speed * Math.max(30, ratio)) / 100);
      }
      const total = buildTicks(r.cost) * 100;
      if (it.progress < total) {
        const np = Math.min(total, it.progress + speed);
        const owed = Math.floor((r.cost * np) / total) - it.spent;
        if (owed > p.credits) {
          if (this.tick - p.fundsAlertAt > 200) {
            p.fundsAlertAt = this.tick;
            this.eva(p.idx, "Insufficient funds");
          }
          continue;
        }
        p.credits -= owed;
        p.stats.spent += owed;
        it.spent += owed;
        it.progress = np;
      }
      if (it.progress >= total) {
        if (q === "bld" || q === "def") {
          p.ready[q] = it.type;
          list.shift();
          this.emit({ e: "ready", owner: p.idx, type: it.type, queue: q });
          this.eva(p.idx, "Construction complete");
        } else {
          if (this.deliverUnit(p, it.type, q)) {
            list.shift();
            this.emit({ e: "ready", owner: p.idx, type: it.type, queue: q });
            this.eva(p.idx, "Unit ready");
          }
        }
      }
    }
  }

  private canBuildContinue(p: Player, r: Rule) {
    for (const t of r.prereq) if (!p.tags.has(t)) return false;
    return true;
  }

  private countProducers(p: Player, tag: string) {
    let n = 0;
    for (const e of this.ents) if (!e.dead && e.owner === p.idx && e.kind === "bld" && e.built >= CONSTRUCT_TICKS && e.selling === 0 && e.r.tags.includes(tag)) n++;
    return n;
  }

  private pickProducer(p: Player, q: Queue): Entity | null {
    const tag = QUEUE_PRODUCER[q];
    const prim = this.get(p.primary[q]);
    if (prim && prim.owner === p.idx && prim.built >= CONSTRUCT_TICKS && prim.selling === 0 && prim.r.tags.includes(tag)) {
      if (q !== "air" || prim.pads.length < (prim.r.pads ?? 0)) return prim;
    }
    for (const e of this.ents) {
      if (e.dead || e.owner !== p.idx || e.kind !== "bld" || e.built < CONSTRUCT_TICKS || e.selling || !e.r.tags.includes(tag)) continue;
      if (q === "air" && e.pads.length >= (e.r.pads ?? 0)) continue;
      return e;
    }
    return null;
  }

  exitCell(b: Entity): number {
    const W = this.map.w;
    const ex = b.bx + Math.floor(b.r.w / 2),
      ey = b.by + b.r.h;
    if (this.map.inside(ex, ey) && this.groundPassable(ey * W + ex)) return ey * W + ex;
    return nearestFreeCell(this, ex, ey, false);
  }

  private deliverUnit(p: Player, type: string, q: Queue): boolean {
    const r = RULES[type];
    // airships come out of the factory but fly
    const b = this.pickProducer(p, r.jet ? "air" : q);
    if (!b) return false;
    if (r.jet) {
      const slot = this.freePad(b);
      if (slot < 0) return false;
      const [px, py] = this.padPos(b, slot);
      const e = this.spawnUnit(type, p.idx, px, py, 96)!;
      e.home = b.id;
      b.pads[slot] = e.id;
      e.air = "landed";
      p.stats.built++;
      return true;
    }
    const exit = this.exitCell(b);
    if (exit < 0) return false;
    const W = this.map.w;
    let e: Entity;
    if (r.kind === "inf") {
      const [x, y] = this.cellCenter(exit);
      e = this.spawnUnit(type, p.idx, x, y, 96)!;
    } else if (r.kind === "air") {
      e = this.spawnUnit(type, p.idx, b.x, b.y, 96)!;
      e.z = 0;
    } else {
      // vehicles drive out of the door; nudge loiterers, or use another cell along the door side
      let out = exit;
      if (this.vehAt[out]) {
        const o = this.get(this.vehAt[out]);
        if (o && o.owner === p.idx && !o.moving && !o.pathPending && (o.order === "idle" || o.order === "guard")) scatterUnit(this, o);
        out = -1;
        const y = b.by + b.r.h;
        for (let x = b.bx - 1; x <= b.bx + b.r.w && out < 0; x++) {
          if (!this.map.inside(x, y)) continue;
          const i = y * W + x;
          if (this.groundPassable(i) && !this.vehAt[i]) out = i;
        }
        if (out < 0) return false;
      }
      const ox = out % W;
      const doorX = Math.max(b.bx, Math.min(b.bx + b.r.w - 1, ox)) * LEP + HALF,
        doorY = (b.by + b.r.h - 1) * LEP + HALF;
      e = this.spawnUnit(type, p.idx, doorX, doorY, 96)!;
      this.vehAt[e.cell] = 0;
      e.exiting = true;
      e.path = [out];
      e.pathI = 0;
      e.goalCell = out;
      [e.goalX, e.goalY] = this.cellCenter(out);
      this.vehAt[out] = e.id;
    }
    p.stats.built++;
    if (b.rallyX >= 0 && !r.harvester) {
      e.gx = b.rallyX;
      e.gy = b.rallyY;
      if (!e.exiting) setMoveGoal(this, e, b.rallyY * W + b.rallyX, 0), (e.order = "move");
    }
    return true;
  }

  freePad(b: Entity): number {
    const n = b.r.pads ?? 0;
    for (let i = 0; i < n; i++) {
      const id = b.pads[i];
      if (!id || !this.get(id)) {
        b.pads[i] = 0;
        return i;
      }
    }
    return -1;
  }
  padPos(b: Entity, slot: number): [number, number] {
    const ox = slot & 1 ? 2.25 : 0.75,
      oy = slot & 2 ? 2.25 : 0.75;
    return [Math.round((b.bx + ox) * LEP), Math.round((b.by + oy) * LEP)];
  }

  // ───────────────────────────── placement ─────────────────────────────
  placementOk(p: Player, type: string, bx: number, by: number): boolean {
    const r = RULES[type];
    if (!r) return false;
    const W = this.map.w;
    if (bx < 0 || by < 0 || bx + r.w > this.map.w || by + r.h > this.map.h) return false;
    for (let y = by; y < by + r.h; y++)
      for (let x = bx; x < bx + r.w; x++) {
        const i = y * W + x;
        if (!this.map.buildableTerrain(i) || this.bldAt[i] || !p.explored[i]) return false;
        if (this.vehAt[i]) {
          const v = this.get(this.vehAt[i]);
          if (v) return false;
        }
        if (this.infAt[i]) return false;
      }
    // keep refinery docks and factory doors clear
    for (const e of this.ents) {
      if (e.dead || e.kind !== "bld" || e.owner !== p.idx) continue;
      let k = -1;
      if (e.r.tags.includes("refinery")) k = this.primaryDock(e);
      else if (e.r.tags.includes("factory") || e.r.tags.includes("barracks")) {
        const ex = e.bx + Math.floor(e.r.w / 2),
          ey = e.by + e.r.h;
        if (this.map.inside(ex, ey)) k = ey * W + ex;
      }
      if (k >= 0) {
        const kx = k % W,
          ky = (k / W) | 0;
        if (kx >= bx && kx < bx + r.w && ky >= by && ky < by + r.h) return false;
      }
    }
    // adjacency
    const adj = ADJACENT;
    for (const e of this.ents) {
      if (e.dead || e.kind !== "bld" || e.owner !== p.idx || e.r.wall) continue;
      if (bx <= e.bx + e.r.w - 1 + adj && bx + r.w - 1 >= e.bx - adj && by <= e.by + e.r.h - 1 + adj && by + r.h - 1 >= e.by - adj) return true;
    }
    return false;
  }

  private placeStructure(p: Player, type: string, bx: number, by: number) {
    const r = RULES[type];
    if (!r || !r.queue || (r.queue !== "bld" && r.queue !== "def")) return;
    if (p.ready[r.queue] !== type) return;
    if (!this.placementOk(p, type, bx, by)) return;
    p.ready[r.queue] = null;
    const e = this.addStructure(type, p.idx, bx, by, false);
    if (e) this.emit({ e: "placed", owner: p.idx, id: e.id, type });
  }

  onStructureComplete(e: Entity) {
    if (e.owner < 0) return;
    const p = this.players[e.owner];
    if (e.r.freeUnit) {
      const dock = this.dockCell(e);
      const cell = dock >= 0 && !this.vehAt[dock] ? dock : nearestFreeCell(this, e.bx + 1, e.by + e.r.h, false);
      if (cell >= 0) {
        const [x, y] = this.cellCenter(cell);
        const h = this.spawnUnit(e.r.freeUnit, e.owner, x, y, 96);
        if (h) {
          h.order = "harvest";
          h.harv = "toOre";
          h.refId = e.id;
        }
      }
    }
    // first factory becomes primary
    for (const q of QUEUES) {
      if (q === "bld" || q === "def") continue;
      if (e.r.tags.includes(QUEUE_PRODUCER[q]) && !this.get(p.primary[q])) p.primary[q] = e.id;
    }
  }

  /** primary dock cell of a refinery (in front of its unloading ramp) */
  primaryDock(ref: Entity): number {
    const x = ref.bx + 1,
      y = ref.by + ref.r.h;
    return this.map.inside(x, y) ? y * this.map.w + x : -1;
  }

  /** dock cell, falling back to any passable cell around the footprint if the ramp is blocked */
  dockCell(ref: Entity): number {
    const p = this.primaryDock(ref);
    if (p >= 0 && this.groundPassable(p)) return p;
    const W = this.map.w;
    for (let y = ref.by - 1; y <= ref.by + ref.r.h; y++)
      for (let x = ref.bx - 1; x <= ref.bx + ref.r.w; x++) {
        if (x >= ref.bx && x < ref.bx + ref.r.w && y >= ref.by && y < ref.by + ref.r.h) continue;
        if (!this.map.inside(x, y)) continue;
        const i = y * W + x;
        if (this.groundPassable(i)) return i;
      }
    return -1;
  }

  // ───────────────────────────── structures ─────────────────────────────
  private updateStructure(e: Entity) {
    const r = e.r;
    if (e.built < CONSTRUCT_TICKS) {
      e.built++;
      if (e.built >= CONSTRUCT_TICKS) {
        this.onStructureComplete(e);
        if (e.owner >= 0) this.players[e.owner].stats.built++;
      }
      return;
    }
    if (e.owner < 0) return;
    const p = this.players[e.owner];
    if (e.selling > 0) {
      e.selling++;
      if (e.selling >= SELL_TICKS) {
        p.credits += Math.floor((((r.cost * SELL_REFUND_PCT) / 100) * e.hp) / r.hp);
        this.eva(p.idx, "Structure sold");
        this.removeStructure(e, true);
      }
      return;
    }
    if (e.repairing) {
      if (e.hp >= r.hp) e.repairing = false;
      else if ((this.tick + e.id) % 6 === 0) {
        const heal = Math.max(1, Math.floor((r.hp * 2) / 100));
        const cost = Math.max(1, Math.floor((r.cost * heal) / r.hp / 4));
        if (p.credits >= cost) {
          p.credits -= cost;
          e.hp = Math.min(r.hp, e.hp + heal);
        }
      }
    }
    e.powered = !(r.needsPower && p.lowPower) || e.chargedUntil > this.tick;
    if (r.wGround || r.wAir) updateStructureCombat(this, e);
    if (r.superweapon && this.settings.superweapons) {
      const sw = SUPERWEAPONS[r.superweapon];
      if (!p.lowPower && e.swCharge < sw.charge) {
        e.swCharge++;
        if (e.swCharge === sw.charge) {
          this.emit({ e: "swready", owner: p.idx, kind: sw.id });
          this.eva(p.idx, sw.name + " ready");
        }
      }
    }
    if (r.income && ++e.incomeT >= INCOME_PERIOD) {
      e.incomeT = 0;
      p.credits += r.income;
      this.emit({ e: "income", owner: p.idx, id: e.id, amount: r.income });
    }
    if (r.repairBay && (this.tick + e.id) % 5 === 0) {
      for (const c of this.footprintCells(e)) {
        const v = this.get(this.vehAt[c]);
        if (!v || v.owner !== e.owner || v.moving || v.hp >= v.r.hp) continue;
        const heal = Math.max(1, Math.floor((v.r.hp * 3) / 100));
        const cost = Math.max(1, Math.floor((v.r.cost * heal) / v.r.hp / 3));
        if (p.credits < cost) continue;
        p.credits -= cost;
        v.hp = Math.min(v.r.hp, v.hp + heal);
        this.emit({ e: "repairfx", x: v.x, y: v.y });
      }
    }
    if (e.dockId && !this.get(e.dockId)) e.dockId = 0;
  }

  /** Remove a structure from the map (sold or destroyed). */
  removeStructure(e: Entity, sold: boolean) {
    if (e.dead) return;
    e.dead = true;
    const W = this.map.w;
    for (let y = e.by; y < e.by + e.r.h; y++)
      for (let x = e.bx; x < e.bx + e.r.w; x++) {
        const i = y * W + x;
        if (this.bldAt[i] === e.id) {
          this.bldAt[i] = 0;
          this.solid[i] = 0;
        }
      }
    this.structVersion++;
    // survivors
    if (e.owner >= 0 && !e.r.wall && e.built >= CONSTRUCT_TICKS) {
      const p = this.players[e.owner];
      if (!p.defeated) {
        const n = sold ? (e.r.cost >= 1000 ? 1 : 0) : Math.min(3, Math.floor(e.r.cost / 900));
        for (let k = 0; k < n; k++) {
          const cell = nearestFreeCell(this, e.bx + (k % e.r.w), e.by + e.r.h - 1, true);
          if (cell < 0) break;
          const [x, y] = this.cellCenter(cell);
          const s = this.spawnUnit(sold && k === 0 && e.r.cost >= 2000 ? "engineer" : SURVIVORS[p.faction], e.owner, x + ((k * 37) % 80) - 40, y + ((k * 53) % 80) - 40, 96);
          if (s) s.goalX = s.x, s.goalY = s.y;
        }
      }
    }
    for (const id of e.pads) {
      const j = this.get(id);
      if (j && j.home === e.id) j.home = 0;
    }
  }

  // ───────────────────────────── power & tags ─────────────────────────────
  private updatePower(p: Player) {
    let out = 0,
      inp = 0,
      radar = false,
      bonus = 100;
    p.tags.clear();
    for (const e of this.ents) {
      if (e.dead || e.owner !== p.idx || e.kind !== "bld") continue;
      if (e.built < CONSTRUCT_TICKS) continue;
      const r = e.r;
      if (e.selling === 0) for (const t of r.tags) p.tags.add(t);
      if (r.power > 0) out += Math.floor((r.power * Math.max(e.hp, r.hp >> 1)) / r.hp);
      else inp -= r.power;
      if (r.radar) radar = true;
      if (r.incomeBonus) bonus += r.incomeBonus;
    }
    const was = p.lowPower;
    p.powerOut = out;
    p.powerIn = inp;
    p.lowPower = inp > out;
    p.radar = radar && !p.lowPower;
    p.incomeMult = Math.min(bonus, 150);
    if (p.lowPower && !was) this.eva(p.idx, "Low power");
  }

  // ───────────────────────────── ore ─────────────────────────────
  private growOre() {
    const m = this.map;
    const W = m.w,
      H = m.h;
    let changed = false;
    for (let i = 0; i < W * H; i++) {
      if (m.oreType[i] !== 1) continue;
      if (m.ore[i] < ORE_MAX) {
        m.ore[i]++;
        changed = true;
      }
      if (m.ore[i] >= ORE_MAX - 2 && this.rng.int(100) < 6) {
        const d = this.rng.int(4);
        const x = (i % W) + (d === 0 ? 1 : d === 1 ? -1 : 0),
          y = ((i / W) | 0) + (d === 2 ? 1 : d === 3 ? -1 : 0);
        if (!m.inside(x, y)) continue;
        const j = y * W + x;
        if (m.oreType[j] === 0 && m.groundOk(j) && !this.bldAt[j] && m.terrain[j] !== 3) {
          m.oreType[j] = 1;
          m.ore[j] = 1;
          changed = true;
        }
      }
    }
    if (changed) m.oreVersion++;
  }

  // ───────────────────────────── defeat ─────────────────────────────
  defeat(p: Player) {
    if (p.defeated) return;
    p.defeated = true;
    p.queues = { bld: [], def: [], inf: [], veh: [], air: [] };
    p.ready = { bld: null, def: null };
    for (const e of this.ents) {
      if (e.dead || e.owner !== p.idx) continue;
      if (e.kind === "bld") {
        this.emit({ e: "die", id: e.id, type: e.type, kind: e.kind, x: e.x, y: e.y, z: e.z, owner: e.owner, death: "explode" });
        this.removeStructure(e, false);
      } else killEntity(this, e, null, "explode");
    }
    this.emit({ e: "defeat", owner: p.idx });
    this.eva(-1, `${p.name} has been defeated`);
  }

  private checkDefeat() {
    for (const p of this.players) {
      if (p.defeated) continue;
      let alive = false;
      for (const e of this.ents) {
        if (e.dead || e.owner !== p.idx) continue;
        if (e.kind === "bld" ? !e.r.wall : e.r.mcv !== undefined || e.type === "mhv" || !this.settings.shortGame) {
          alive = true;
          break;
        }
      }
      if (!alive) this.defeat(p);
    }
    if (this.winner !== -2) return;
    const alive = this.players.filter((p) => !p.defeated);
    if (alive.length === 0) {
      this.winner = -1;
      this.emit({ e: "gameover", winners: [] });
      return;
    }
    const first = alive[0];
    if (alive.every((p) => p === first || this.isAlly(p.idx, first.idx))) {
      if (this.players.length === 1 && this.tick < 100) return;
      this.winner = first.idx;
      this.winners = alive.map((p) => p.idx);
      this.emit({ e: "gameover", winners: this.winners });
    }
  }

  // ───────────────────────────── main loop ─────────────────────────────
  step(cmds: [number, Command][]) {
    this.tick++;
    for (const e of this.ents) {
      e.px = e.x;
      e.py = e.y;
      e.pz = e.z;
    }
    for (const pr of this.projs) {
      pr.px = pr.x;
      pr.py = pr.y;
      pr.pz = pr.z;
    }
    this.rebuildBuckets();
    for (const p of this.players) if (!p.defeated) this.updatePower(p);
    for (const [pi, c] of cmds) this.applyCommand(pi, c);
    for (const p of this.players) if (p.ai && !p.defeated && (this.tick + p.idx * 7) % 10 === 0) aiThink(this, p);
    for (const p of this.players) if (!p.defeated) this.updateProduction(p);
    // path requests
    let budget = MAX_PATHS_PER_TICK;
    while (budget > 0 && this.pathQueue.length) {
      const id = this.pathQueue.shift()!;
      const e = this.get(id);
      if (!e || !e.pathPending) continue;
      computePath(this, e);
      budget--;
    }
    const n = this.ents.length;
    for (let k = 0; k < n; k++) {
      const e = this.ents[k];
      if (e.dead) continue;
      if (e.kind === "bld") this.updateStructure(e);
      else updateUnit(this, e);
    }
    updateProjectiles(this);
    updateSuperweaponEffects(this);
    if (this.tick % 4 === 0) this.updateShroud();
    if (this.tick % ORE_GROW_PERIOD === 0) this.growOre();
    if (this.tick % 20 === 0) this.checkDefeat();
    // compact
    if (this.ents.some((e) => e.dead)) {
      for (const e of this.ents) if (e.dead) this.byId.delete(e.id);
      this.ents = this.ents.filter((e) => !e.dead);
    }
    if (this.projs.some((p) => p.dead)) this.projs = this.projs.filter((p) => !p.dead);
  }

  hash(): number {
    const h = new Hasher();
    h.add(this.tick);
    h.add(this.rng.s);
    h.add(this.nextId);
    for (const e of this.ents) {
      h.add(e.id);
      h.add(RULE_INDEX[e.type]);
      h.add(e.owner);
      h.add(e.x);
      h.add(e.y);
      h.add(e.z);
      h.add(e.hp);
      h.add(e.facing);
    }
    for (const p of this.players) {
      h.add(p.credits);
      h.add(p.defeated ? 1 : 0);
    }
    h.add(this.projs.length);
    return h.value;
  }

  explode(x: number, y: number, z: number, dmg: number, warhead: string, owner: number, src: number, direct: number, hitsAll = false) {
    explode(this, x, y, z, dmg, warhead, owner, src, direct, hitsAll);
  }
}

function computePath(w: World, e: Entity) {
  e.pathPending = false;
  const start = e.moving && e.nextCell >= 0 ? e.nextCell : e.cell;
  const goal = e.goalCell;
  if (goal < 0) {
    e.path = [];
    e.pathI = 0;
    return;
  }
  const isVeh = e.kind === "veh";
  const self = e.id;
  const avoid = e.waitTicks > 0;
  const m = w.map;
  const cost = (i: number) => {
    if (!m.groundOk(i) || w.solid[i]) return -1;
    if (isVeh && avoid) {
      const o = w.vehAt[i];
      if (o && o !== self && i !== goal) {
        const v = w.byId.get(o);
        if (v && !v.dead && !v.moving) return 60;
      }
    }
    return 0;
  };
  e.path = w.pf.find(start, goal, cost, 5000);
  e.pathI = 0;
}

export type { QueueItem };
