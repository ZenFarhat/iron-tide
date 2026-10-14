import type { Faction, Kind, Queue, Rule, Weapon } from "./rules";

export type Order =
  | "idle"
  | "move"
  | "amove"
  | "attack"
  | "ffire"
  | "guard"
  | "enter"
  | "harvest"
  | "charge";

export type HarvState = "idle" | "toOre" | "mining" | "toRef" | "dock" | "unload";
export type AirState = "landed" | "flying" | "returning";

export class Entity {
  id: number;
  type: string;
  r: Rule;
  owner: number;
  kind: Kind;
  // position in leptons; z = altitude
  x = 0;
  y = 0;
  z = 0;
  px = 0;
  py = 0;
  pz = 0;
  cell = -1;
  hp: number;
  facing = 0;
  turret = 0;
  dead = false;
  // orders
  order: Order = "idle";
  target = 0;
  autoTarget = false; // target acquired automatically (drop if out of range)
  tx = 0;
  ty = 0;
  gx = -1; // guard / amove destination (leptons)
  gy = -1;
  // pathing
  path: number[] = [];
  pathI = 0;
  goalX = 0;
  goalY = 0;
  goalCell = -1;
  pathPending = false;
  moving = false;
  nextCell = -1;
  waitTicks = 0;
  repathAt = 0;
  tries = 0; // failed attempts to reach an attack-move destination
  resume = -1; // goal to resume after side-stepping out of a jam
  exiting = false;
  sub = 0;
  // combat
  cool = 0;
  burstLeft = 0;
  burstTimer = 0;
  burstTarget = 0;
  lastFire = -1000;
  scanAt = 0;
  xp = 0;
  rank = 0;
  deployed = false;
  deployT = 0;
  attackedAt = -1000;
  attackerId = 0;
  invuln = 0;
  healT = 0;
  // structures
  bx = 0;
  by = 0;
  built = 0;
  selling = 0;
  repairing = false;
  rallyX = -1;
  rallyY = -1;
  powered = true;
  swCharge = 0;
  chargedUntil = 0;
  dockId = 0;
  pads: number[] = [];
  incomeT = 0;
  // harvester
  cargo = 0;
  cargoGem = 0;
  harv: HarvState = "idle";
  lastOre = -1;
  harvT = 0;
  teleCool = 0;
  refId = 0;
  refLock = false; // player explicitly chose this refinery
  badOre: number[] = []; // ore cells this harvester failed to reach
  // aircraft
  ammo = 0;
  home = 0;
  air: AirState = "flying";
  rearmT = 0;
  // misc
  revealCell = -2;
  stamp = 0;

  constructor(id: number, r: Rule, owner: number) {
    this.id = id;
    this.type = r.id;
    this.r = r;
    this.owner = owner;
    this.kind = r.kind;
    this.hp = r.hp;
    this.ammo = r.ammo ?? 0;
  }

  get isBld() {
    return this.kind === "bld";
  }
  get isAir() {
    return this.kind === "air";
  }
  get isInf() {
    return this.kind === "inf";
  }
  get isVeh() {
    return this.kind === "veh";
  }
  get isGround() {
    return this.kind === "inf" || this.kind === "veh";
  }
  get flying() {
    return this.kind === "air" && this.z > 64;
  }
}

export interface QueueItem {
  type: string;
  progress: number;
  spent: number;
  hold: boolean;
}

export interface PlayerInit {
  name: string;
  faction: Faction;
  color: number;
  team: number; // 0 = no team (FFA)
  ai: null | "easy" | "normal" | "hard";
}

export class Player {
  idx: number;
  name: string;
  faction: Faction;
  color: number;
  team: number;
  ai: null | "easy" | "normal" | "hard";
  credits = 0;
  powerOut = 0;
  powerIn = 0;
  lowPower = false;
  radar = false;
  explored: Uint8Array;
  exploredVersion = 0;
  queues: Record<Queue, QueueItem[]> = { bld: [], def: [], inf: [], veh: [], air: [] };
  ready: { bld: string | null; def: string | null } = { bld: null, def: null };
  primary: Record<Queue, number> = { bld: 0, def: 0, inf: 0, veh: 0, air: 0 };
  defeated = false;
  left = false;
  tags = new Set<string>();
  incomeMult = 100;
  alertAt = -10000;
  fundsAlertAt = -10000;
  harvAlertAt = -10000;
  stats = { built: 0, kills: 0, losses: 0, harvested: 0, spent: 0 };
  aiState: any = null;

  constructor(idx: number, init: PlayerInit, cells: number) {
    this.idx = idx;
    this.name = init.name;
    this.faction = init.faction;
    this.color = init.color;
    this.team = init.team;
    this.ai = init.ai;
    this.explored = new Uint8Array(cells);
  }
}

export class Proj {
  id: number;
  w: Weapon;
  owner: number;
  src: number;
  target: number;
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  sx: number;
  sy: number;
  sz: number;
  tx: number;
  ty: number;
  tz: number;
  damage: number;
  age = 0;
  life = 0;
  dead = false;
  special: "" | "nuke" = "";
  constructor(id: number, w: Weapon, owner: number, src: number, target: number, x: number, y: number, z: number, tx: number, ty: number, tz: number, damage: number) {
    this.id = id;
    this.w = w;
    this.owner = owner;
    this.src = src;
    this.target = target;
    this.x = this.px = this.sx = x;
    this.y = this.py = this.sy = y;
    this.z = this.pz = this.sz = z;
    this.tx = tx;
    this.ty = ty;
    this.tz = tz;
    this.damage = damage;
  }
}

export type SimEvent = { e: string; [k: string]: any };
