// Game rules: all original unit/structure/weapon definitions.
// Mechanics follow classic late-90s/2000s base-building RTS conventions
// (armor-vs-warhead tables, power, ore economy, veterancy, superweapons),
// but every name, number and design here is original to this project.

import { LEP } from "./fixed";

export type Faction = "C" | "D"; // Concord, Dominion
export const FACTIONS: { id: Faction; name: string; blurb: string }[] = [
  { id: "C", name: "Concord", blurb: "High-tech coalition. Light beams, air power, mobility." },
  { id: "D", name: "Dominion", blurb: "Iron industrial bloc. Heavy armor, arc weapons, rockets." },
];

export const ARMORS = ["none", "flak", "plate", "light", "medium", "heavy", "wood", "steel", "concrete", "air"] as const;
export type Armor = (typeof ARMORS)[number];
const A = (v: number[]) => v; // verses in ARMORS order, in percent

export interface Warhead {
  verses: number[];
  spread?: number; // splash radius (leptons)
  falloff?: number; // % damage at edge of splash
  infDeath?: "shot" | "burn" | "zap" | "explode" | "melt";
}

export const WARHEADS: Record<string, Warhead> = {
  bullet: { verses: A([100, 80, 50, 25, 15, 10, 40, 20, 10, 40]), infDeath: "shot" },
  hollow: { verses: A([125, 100, 60, 25, 15, 10, 50, 15, 10, 40]), infDeath: "shot" },
  ap: { verses: A([30, 30, 40, 80, 100, 100, 75, 85, 60, 0]), spread: 48, falloff: 50, infDeath: "explode" },
  missile: { verses: A([30, 35, 40, 100, 100, 85, 65, 70, 50, 100]), spread: 40, falloff: 50, infDeath: "explode" },
  he: { verses: A([90, 80, 70, 65, 60, 50, 120, 100, 90, 0]), spread: 320, falloff: 25, infDeath: "explode" },
  flak: { verses: A([0, 0, 0, 0, 0, 0, 0, 0, 0, 100]), spread: 64, falloff: 50 },
  flakg: { verses: A([80, 70, 50, 25, 15, 10, 30, 15, 10, 80]), spread: 48, falloff: 50, infDeath: "explode" },
  arc: { verses: A([100, 100, 85, 80, 80, 70, 70, 70, 50, 0]), infDeath: "zap" },
  lens: { verses: A([70, 70, 60, 100, 90, 80, 100, 100, 85, 0]), spread: 128, falloff: 40, infDeath: "burn" },
  fang: { verses: A([100, 100, 100, 0, 0, 0, 0, 0, 0, 0]), infDeath: "shot" },
  snipe: { verses: A([100, 100, 100, 0, 0, 0, 0, 0, 0, 0]), infDeath: "shot" },
  demo: { verses: A([100, 100, 100, 100, 100, 100, 100, 100, 100, 0]), spread: 96, falloff: 50, infDeath: "explode" },
  bomb: { verses: A([100, 90, 80, 70, 70, 60, 120, 110, 100, 0]), spread: 360, falloff: 30, infDeath: "explode" },
  nuke: { verses: A([100, 100, 100, 100, 100, 100, 100, 100, 100, 60]), spread: 1400, falloff: 15, infDeath: "melt" },
  storm: { verses: A([100, 100, 100, 90, 90, 90, 100, 100, 100, 100]), spread: 320, falloff: 30, infDeath: "zap" },
  rad: { verses: A([100, 100, 70, 0, 0, 0, 0, 0, 0, 0]), infDeath: "melt" },
  blast: { verses: A([100, 100, 100, 100, 100, 100, 100, 100, 100, 0]), spread: 1024, falloff: 20, infDeath: "explode" },
};

export type ProjKind = "instant" | "shell" | "missile" | "beam" | "arc" | "artillery" | "bomb" | "charge";
export type Fx = "mg" | "rifle" | "cannon" | "rocket" | "beam" | "arc" | "flak" | "snipe" | "bite" | "bomb" | "artillery" | "charge" | "none";

export interface Weapon {
  id: string;
  damage: number;
  rof: number; // ticks between shots
  range: number; // leptons
  minRange?: number;
  warhead: string;
  proj: ProjKind;
  speed?: number; // projectile leptons per tick
  burst?: number;
  burstDelay?: number;
  air: boolean; // can target aircraft
  ground: boolean; // can target ground
  fx: Fx;
}

const c = (cells: number) => Math.round(cells * LEP);

function W(id: string, w: Omit<Weapon, "id" | "air" | "ground"> & { air?: boolean; ground?: boolean }): Weapon {
  return { id, air: false, ground: true, ...w };
}

export const WEAPONS: Record<string, Weapon> = Object.fromEntries(
  [
    // infantry
    W("rifle", { damage: 15, rof: 20, range: c(5), warhead: "bullet", proj: "instant", fx: "rifle" }),
    W("trooperMG", { damage: 16, rof: 12, range: c(5.5), warhead: "hollow", proj: "instant", fx: "mg" }),
    W("lancerSMG", { damage: 12, rof: 18, range: c(5), warhead: "bullet", proj: "instant", fx: "rifle" }),
    W("lancerRocket", { damage: 42, rof: 42, range: c(7), warhead: "missile", proj: "missile", speed: 70, air: true, fx: "rocket" }),
    W("levyRifle", { damage: 12, rof: 18, range: c(5), warhead: "bullet", proj: "instant", fx: "rifle" }),
    W("flakShot", { damage: 30, rof: 20, range: c(7), warhead: "flak", proj: "instant", air: true, ground: false, fx: "flak" }),
    W("flakGround", { damage: 20, rof: 20, range: c(5), warhead: "flakg", proj: "instant", fx: "flak" }),
    W("arcBolt", { damage: 70, rof: 40, range: c(3.5), warhead: "arc", proj: "arc", fx: "arc" }),
    W("fang", { damage: 200, rof: 20, range: c(1.25), warhead: "fang", proj: "instant", fx: "bite" }),
    W("snipe", { damage: 150, rof: 25, range: c(8), warhead: "snipe", proj: "instant", fx: "snipe" }),
    W("chaingun", { damage: 22, rof: 4, range: c(5), warhead: "hollow", proj: "instant", fx: "mg" }),
    W("charge", { damage: 4000, rof: 40, range: c(1.25), warhead: "demo", proj: "charge", fx: "charge" }),
    // vehicles
    W("wardenGun", { damage: 65, rof: 30, range: c(5.5), warhead: "ap", proj: "shell", speed: 110, fx: "cannon" }),
    W("roverMissile", { damage: 30, rof: 45, range: c(6), warhead: "missile", proj: "missile", speed: 80, burst: 2, burstDelay: 6, fx: "rocket" }),
    W("roverAA", { damage: 40, rof: 35, range: c(8.5), warhead: "flak", proj: "missile", speed: 120, burst: 2, burstDelay: 5, air: true, ground: false, fx: "rocket" }),
    W("lensBeam", { damage: 115, rof: 62, range: c(8), warhead: "lens", proj: "beam", fx: "beam" }),
    W("bastionGun", { damage: 80, rof: 34, range: c(5.75), warhead: "ap", proj: "shell", speed: 110, fx: "cannon" }),
    W("haulerMG", { damage: 12, rof: 8, range: c(5), warhead: "hollow", proj: "instant", fx: "mg" }),
    W("flakCannon", { damage: 30, rof: 12, range: c(8.5), warhead: "flak", proj: "instant", air: true, ground: false, fx: "flak" }),
    W("siegeRocket", { damage: 260, rof: 220, range: c(16), minRange: c(4), warhead: "he", proj: "artillery", speed: 45, fx: "artillery" }),
    W("crawlerBolt", { damage: 70, rof: 34, range: c(4.5), warhead: "arc", proj: "arc", burst: 2, burstDelay: 6, fx: "arc" }),
    W("titanGun", { damage: 95, rof: 42, range: c(6), warhead: "ap", proj: "shell", speed: 110, burst: 2, burstDelay: 5, fx: "cannon" }),
    W("titanAA", { damage: 45, rof: 40, range: c(8), warhead: "flak", proj: "missile", speed: 120, burst: 2, burstDelay: 5, air: true, ground: false, fx: "rocket" }),
    W("harvMG", { damage: 12, rof: 8, range: c(4), warhead: "hollow", proj: "instant", fx: "mg" }),
    W("strikerMissile", { damage: 110, rof: 10, range: c(6), warhead: "missile", proj: "missile", speed: 130, fx: "rocket" }),
    W("dreadBomb", { damage: 300, rof: 40, range: c(0.9), warhead: "bomb", proj: "bomb", speed: 20, fx: "bomb" }),
    // defenses
    W("pillboxMG", { damage: 18, rof: 6, range: c(6), warhead: "hollow", proj: "instant", fx: "mg" }),
    W("sentryMG", { damage: 16, rof: 5, range: c(6), warhead: "hollow", proj: "instant", fx: "mg" }),
    W("lanceSAM", { damage: 50, rof: 30, range: c(11), warhead: "flak", proj: "missile", speed: 140, burst: 2, burstDelay: 6, air: true, ground: false, fx: "rocket" }),
    W("flakBattery", { damage: 40, rof: 15, range: c(11), warhead: "flak", proj: "instant", air: true, ground: false, fx: "flak" }),
    W("spireBeam", { damage: 100, rof: 80, range: c(8), warhead: "lens", proj: "beam", fx: "beam" }),
    W("coilZap", { damage: 220, rof: 60, range: c(7.5), warhead: "arc", proj: "arc", fx: "arc" }),
  ].map((w) => [w.id, w]),
);

export type Kind = "inf" | "veh" | "air" | "bld";
export type Queue = "bld" | "def" | "inf" | "veh" | "air";
export const QUEUES: Queue[] = ["bld", "def", "inf", "veh", "air"];
export const QUEUE_PRODUCER: Record<Queue, string> = { bld: "hub", def: "hub", inf: "barracks", veh: "factory", air: "aircmd" };

export interface Rule {
  id: string;
  name: string;
  desc: string;
  faction: Faction | "*" | "N";
  kind: Kind;
  queue: Queue | null; // null = not buildable
  cost: number;
  hp: number;
  armor: Armor;
  sight: number; // cells
  prereq: string[]; // tags required
  // weapons
  wGround?: string;
  wAir?: string;
  deployGround?: string;
  deployAir?: string;
  // mobile
  speed: number; // leptons per tick
  rot: number; // body turn rate (facing units per tick)
  turret?: boolean;
  turretRot?: number;
  crusher?: boolean;
  uncrushable?: boolean;
  deployable?: boolean; // infantry fortify / mcv deploy
  engineer?: boolean;
  dog?: boolean;
  hero?: boolean;
  harvester?: { capacity: number; teleport: boolean };
  mcv?: string; // structure it deploys into
  ammo?: number;
  selfHeal?: boolean;
  chargesCoil?: boolean;
  jet?: boolean;
  // structure
  w: number;
  h: number;
  power: number;
  tags: string[];
  needsPower?: boolean;
  radar?: boolean;
  freeUnit?: string;
  undeploy?: string;
  superweapon?: string;
  incomeBonus?: number; // percent
  explodes?: { damage: number; radius: number };
  wall?: boolean;
  income?: number; // credits per INCOME_PERIOD (fuel well)
  capturable?: boolean;
  pads?: number;
  support?: boolean; // lumen spire beam support
  chargeable?: boolean; // arc coil
  repairBay?: boolean;
}

const base: Omit<Rule, "id" | "name" | "desc" | "faction" | "kind" | "cost" | "hp" | "armor"> = {
  queue: null,
  sight: 5,
  prereq: [],
  speed: 0,
  rot: 0,
  w: 1,
  h: 1,
  power: 0,
  tags: [],
};

function U(id: string, r: Partial<Rule> & Pick<Rule, "name" | "desc" | "faction" | "kind" | "cost" | "hp" | "armor">): Rule {
  return { ...base, id, ...r } as Rule;
}

export const RULES: Record<string, Rule> = Object.fromEntries(
  [
    // ───────────── Shared infantry ─────────────
    U("engineer", { name: "Engineer", desc: "Captures enemy structures and fuel wells; fully repairs your own.", faction: "*", kind: "inf", queue: "inf", cost: 500, hp: 75, armor: "none", speed: 12, sight: 4, prereq: ["barracks"], engineer: true }),
    U("hound", { name: "Hound", desc: "Fast attack dog. Instantly takes down infantry.", faction: "*", kind: "inf", queue: "inf", cost: 200, hp: 100, armor: "none", speed: 28, sight: 7, prereq: ["barracks"], wGround: "fang", dog: true }),
    // ───────────── Concord infantry ─────────────
    U("c_trooper", { name: "Trooper", desc: "Rifle infantry. Deploy to fortify behind sandbags with a heavy machine gun.", faction: "C", kind: "inf", queue: "inf", cost: 200, hp: 125, armor: "none", speed: 13, sight: 5, prereq: ["barracks"], wGround: "rifle", wAir: "rifle", deployGround: "trooperMG", deployAir: "trooperMG", deployable: true }),
    U("c_lancer", { name: "Lancer", desc: "Deploy to fire anti-armor rockets that also hit aircraft.", faction: "C", kind: "inf", queue: "inf", cost: 400, hp: 150, armor: "plate", speed: 12, sight: 6, prereq: ["barracks"], wGround: "lancerSMG", deployGround: "lancerRocket", deployAir: "lancerRocket", deployable: true }),
    U("c_wraith", { name: "Wraith", desc: "Elite operative. One-shots infantry at range; demolishes structures with charges. Limit 1.", faction: "C", kind: "inf", queue: "inf", cost: 1000, hp: 125, armor: "flak", speed: 15, sight: 9, prereq: ["barracks", "lab"], wGround: "snipe", hero: true, uncrushable: true }),
    // ───────────── Dominion infantry ─────────────
    U("d_levy", { name: "Levy", desc: "Cheap conscript rifleman.", faction: "D", kind: "inf", queue: "inf", cost: 100, hp: 125, armor: "none", speed: 13, sight: 5, prereq: ["barracks"], wGround: "levyRifle" }),
    U("d_flak", { name: "Flak Gunner", desc: "Anti-aircraft infantry; flak bursts also shred infantry.", faction: "D", kind: "inf", queue: "inf", cost: 300, hp: 120, armor: "none", speed: 12, sight: 7, prereq: ["barracks"], wGround: "flakGround", wAir: "flakShot" }),
    U("d_arc", { name: "Arc Trooper", desc: "Armored arc-thrower. Cannot be crushed. Can supercharge Arc Coils.", faction: "D", kind: "inf", queue: "inf", cost: 500, hp: 130, armor: "plate", speed: 10, sight: 5, prereq: ["barracks", "radar"], wGround: "arcBolt", uncrushable: true, chargesCoil: true }),
    U("d_jugg", { name: "Juggernaut", desc: "Heavily armored chaingunner. Demolishes structures with charges. Limit 1.", faction: "D", kind: "inf", queue: "inf", cost: 1000, hp: 220, armor: "plate", speed: 11, sight: 7, prereq: ["barracks", "lab"], wGround: "chaingun", wAir: "chaingun", hero: true, uncrushable: true }),
    // ───────────── Shared vehicles ─────────────
    U("mhv", { name: "Mobile Hub", desc: "Deploys into a Command Hub to establish a new base.", faction: "*", kind: "veh", queue: "veh", cost: 3000, hp: 1000, armor: "heavy", speed: 14, rot: 4, sight: 5, prereq: ["factory", "depot"], deployable: true, crusher: true }),
    // ───────────── Concord vehicles ─────────────
    U("c_warden", { name: "Warden Tank", desc: "Fast main battle tank.", faction: "C", kind: "veh", queue: "veh", cost: 700, hp: 300, armor: "heavy", speed: 26, rot: 6, sight: 6, prereq: ["factory"], wGround: "wardenGun", turret: true, turretRot: 8, crusher: true }),
    U("c_rover", { name: "Skyguard Rover", desc: "Light missile carrier. Strong anti-air, decent versus vehicles.", faction: "C", kind: "veh", queue: "veh", cost: 600, hp: 200, armor: "light", speed: 36, rot: 8, sight: 8, prereq: ["factory"], wGround: "roverMissile", wAir: "roverAA", turret: true, turretRot: 10 }),
    U("c_lens", { name: "Lens Tank", desc: "Focuses a searing light beam that splashes nearby targets. Long range.", faction: "C", kind: "veh", queue: "veh", cost: 1200, hp: 240, armor: "light", speed: 20, rot: 5, sight: 8, prereq: ["factory", "lab"], wGround: "lensBeam" }),
    U("c_harv", { name: "Phase Harvester", desc: "Collects ore, then phase-shifts straight back to the refinery.", faction: "C", kind: "veh", queue: "veh", cost: 1400, hp: 500, armor: "heavy", speed: 20, rot: 5, sight: 4, prereq: ["factory", "refinery"], harvester: { capacity: 20, teleport: true }, crusher: true }),
    U("c_striker", { name: "Striker Jet", desc: "Strike aircraft. Fires two missiles, then returns to Sky Command to rearm.", faction: "C", kind: "air", queue: "air", cost: 1200, hp: 150, armor: "air", speed: 100, rot: 10, sight: 8, prereq: ["aircmd"], wGround: "strikerMissile", ammo: 2, jet: true }),
    // ───────────── Dominion vehicles ─────────────
    U("d_bastion", { name: "Bastion Tank", desc: "Heavy main battle tank. Slower but tougher.", faction: "D", kind: "veh", queue: "veh", cost: 900, hp: 400, armor: "heavy", speed: 22, rot: 5, sight: 6, prereq: ["factory"], wGround: "bastionGun", turret: true, turretRot: 6, crusher: true }),
    U("d_hauler", { name: "Flak Hauler", desc: "Fast flak truck. Shreds aircraft, machine-guns infantry.", faction: "D", kind: "veh", queue: "veh", cost: 500, hp: 180, armor: "light", speed: 36, rot: 8, sight: 8, prereq: ["factory"], wGround: "haulerMG", wAir: "flakCannon", turret: true, turretRot: 10 }),
    U("d_siege", { name: "Siege Launcher", desc: "Long-range rocket artillery. Devastating against structures.", faction: "D", kind: "veh", queue: "veh", cost: 800, hp: 150, armor: "light", speed: 18, rot: 5, sight: 8, prereq: ["factory", "radar"], wGround: "siegeRocket" }),
    U("d_crawler", { name: "Arc Crawler", desc: "Arc-coil tank. Excellent against infantry and light armor.", faction: "D", kind: "veh", queue: "veh", cost: 1200, hp: 380, armor: "medium", speed: 26, rot: 6, sight: 6, prereq: ["factory", "radar"], wGround: "crawlerBolt", turret: true, turretRot: 8, crusher: true }),
    U("d_titan", { name: "Titan Tank", desc: "Super-heavy twin-cannon tank with anti-air missiles. Self-repairs.", faction: "D", kind: "veh", queue: "veh", cost: 1750, hp: 1050, armor: "heavy", speed: 15, rot: 3, sight: 7, prereq: ["factory", "lab"], wGround: "titanGun", wAir: "titanAA", turret: true, turretRot: 4, crusher: true, selfHeal: true }),
    U("d_harv", { name: "Ore Hauler", desc: "Armored ore collector with a defensive machine gun.", faction: "D", kind: "veh", queue: "veh", cost: 1400, hp: 1000, armor: "heavy", speed: 22, rot: 5, sight: 4, prereq: ["factory", "refinery"], harvester: { capacity: 40, teleport: false }, wGround: "harvMG", turret: true, turretRot: 10, crusher: true }),
    U("d_dread", { name: "Dreadnought", desc: "Colossal armored airship. Slow, but its bombs level bases.", faction: "D", kind: "air", queue: "veh", cost: 2000, hp: 1800, armor: "air", speed: 6, rot: 2, sight: 8, prereq: ["factory", "lab"], wGround: "dreadBomb" }),

    // ───────────── Concord structures ─────────────
    U("c_hub", { name: "Command Hub", desc: "Builds structures. Can pack up into a Mobile Hub.", faction: "C", kind: "bld", cost: 3000, hp: 1500, armor: "steel", sight: 7, w: 3, h: 3, tags: ["hub"], undeploy: "mhv" }),
    U("c_power", { name: "Helio Plant", desc: "Provides 200 power.", faction: "C", kind: "bld", queue: "bld", cost: 800, hp: 750, armor: "steel", w: 2, h: 2, power: 200, tags: ["power"] }),
    U("c_barracks", { name: "Barracks", desc: "Trains infantry.", faction: "C", kind: "bld", queue: "bld", cost: 500, hp: 800, armor: "wood", w: 2, h: 2, power: -10, prereq: ["power"], tags: ["barracks"] }),
    U("c_refinery", { name: "Ore Refinery", desc: "Processes ore into credits. Comes with a harvester.", faction: "C", kind: "bld", queue: "bld", cost: 2000, hp: 900, armor: "steel", w: 3, h: 3, power: -50, prereq: ["power"], tags: ["refinery"], freeUnit: "c_harv" }),
    U("c_factory", { name: "Motor Works", desc: "Builds vehicles.", faction: "C", kind: "bld", queue: "bld", cost: 2000, hp: 1000, armor: "steel", w: 3, h: 3, power: -25, prereq: ["barracks", "refinery"], tags: ["factory"] }),
    U("c_aircmd", { name: "Sky Command", desc: "Radar uplink and airfield for up to 4 Striker Jets.", faction: "C", kind: "bld", queue: "bld", cost: 1000, hp: 1000, armor: "steel", sight: 10, w: 3, h: 3, power: -50, prereq: ["refinery"], tags: ["radar", "aircmd"], radar: true, pads: 4 }),
    U("c_depot", { name: "Repair Bay", desc: "Repairs vehicles parked on it. Required for Mobile Hub.", faction: "C", kind: "bld", queue: "bld", cost: 800, hp: 1000, armor: "steel", w: 3, h: 3, power: -25, prereq: ["factory"], tags: ["depot"], repairBay: true }),
    U("c_lab", { name: "Tech Center", desc: "Unlocks advanced units and superweapons.", faction: "C", kind: "bld", queue: "bld", cost: 2000, hp: 1000, armor: "steel", w: 3, h: 3, power: -100, prereq: ["factory", "radar"], tags: ["lab"] }),
    U("c_processor", { name: "Ore Processor", desc: "Increases all ore income by 25%.", faction: "C", kind: "bld", queue: "bld", cost: 2500, hp: 1000, armor: "steel", w: 3, h: 3, power: -50, prereq: ["refinery", "lab"], tags: ["processor"], incomeBonus: 25 }),
    U("c_pillbox", { name: "Pillbox", desc: "Anti-infantry machine-gun nest.", faction: "C", kind: "bld", queue: "def", cost: 500, hp: 400, armor: "concrete", sight: 7, prereq: ["barracks"], wGround: "pillboxMG", tags: ["defense"] }),
    U("c_sam", { name: "Sky Lance", desc: "Long-range anti-aircraft missile battery.", faction: "C", kind: "bld", queue: "def", cost: 1000, hp: 700, armor: "steel", sight: 11, power: -50, prereq: ["radar"], wAir: "lanceSAM", needsPower: true, tags: ["defense"] }),
    U("c_spire", { name: "Lumen Spire", desc: "Beam tower. Nearby spires relay extra power into the shot.", faction: "C", kind: "bld", queue: "def", cost: 1500, hp: 600, armor: "steel", sight: 9, power: -75, prereq: ["lab"], wGround: "spireBeam", needsPower: true, support: true, tags: ["defense"] }),
    U("c_wall", { name: "Barrier Wall", desc: "Blocks movement.", faction: "C", kind: "bld", queue: "def", cost: 100, hp: 300, armor: "concrete", sight: 1, prereq: ["hub"], wall: true, tags: ["wall"] }),
    U("c_tempest", { name: "Tempest Engine", desc: "Superweapon: summons a devastating lightning storm.", faction: "C", kind: "bld", queue: "def", cost: 5000, hp: 1000, armor: "concrete", w: 3, h: 3, power: -200, prereq: ["lab"], superweapon: "storm", tags: ["superweapon"] }),
    U("c_phasegate", { name: "Phase Gate", desc: "Superweapon: teleports a group of vehicles anywhere. Infantry do not survive.", faction: "C", kind: "bld", queue: "def", cost: 2500, hp: 1000, armor: "concrete", w: 3, h: 3, power: -200, prereq: ["lab"], superweapon: "phase", tags: ["superweapon"] }),

    // ───────────── Dominion structures ─────────────
    U("d_hub", { name: "Command Hub", desc: "Builds structures. Can pack up into a Mobile Hub.", faction: "D", kind: "bld", cost: 3000, hp: 1500, armor: "steel", sight: 7, w: 3, h: 3, tags: ["hub"], undeploy: "mhv" }),
    U("d_power", { name: "Coil Reactor", desc: "Provides 150 power.", faction: "D", kind: "bld", queue: "bld", cost: 600, hp: 750, armor: "steel", w: 2, h: 2, power: 150, tags: ["power"] }),
    U("d_barracks", { name: "Barracks", desc: "Trains infantry.", faction: "D", kind: "bld", queue: "bld", cost: 500, hp: 800, armor: "wood", w: 2, h: 2, power: -10, prereq: ["power"], tags: ["barracks"] }),
    U("d_refinery", { name: "Ore Refinery", desc: "Processes ore into credits. Comes with a harvester.", faction: "D", kind: "bld", queue: "bld", cost: 2000, hp: 900, armor: "steel", w: 3, h: 3, power: -50, prereq: ["power"], tags: ["refinery"], freeUnit: "d_harv" }),
    U("d_factory", { name: "War Foundry", desc: "Builds vehicles and airships.", faction: "D", kind: "bld", queue: "bld", cost: 2000, hp: 1000, armor: "steel", w: 3, h: 3, power: -25, prereq: ["barracks", "refinery"], tags: ["factory"] }),
    U("d_radar", { name: "Radar Mast", desc: "Enables the radar minimap.", faction: "D", kind: "bld", queue: "bld", cost: 1000, hp: 1000, armor: "steel", sight: 10, w: 2, h: 2, power: -50, prereq: ["refinery"], tags: ["radar"], radar: true }),
    U("d_depot", { name: "Repair Bay", desc: "Repairs vehicles parked on it. Required for Mobile Hub.", faction: "D", kind: "bld", queue: "bld", cost: 800, hp: 1000, armor: "steel", w: 3, h: 3, power: -25, prereq: ["factory"], tags: ["depot"], repairBay: true }),
    U("d_lab", { name: "Research Lab", desc: "Unlocks advanced units and superweapons.", faction: "D", kind: "bld", queue: "bld", cost: 2000, hp: 1000, armor: "steel", w: 3, h: 3, power: -100, prereq: ["factory", "radar"], tags: ["lab"] }),
    U("d_reactor", { name: "Fission Reactor", desc: "Provides 2000 power. Detonates violently when destroyed.", faction: "D", kind: "bld", queue: "bld", cost: 1000, hp: 1000, armor: "steel", w: 3, h: 3, power: 2000, prereq: ["lab"], tags: ["power"], explodes: { damage: 500, radius: 4 * LEP } }),
    U("d_sentry", { name: "Sentry Gun", desc: "Anti-infantry gun turret.", faction: "D", kind: "bld", queue: "def", cost: 500, hp: 400, armor: "concrete", sight: 7, prereq: ["barracks"], wGround: "sentryMG", tags: ["defense"] }),
    U("d_flakbat", { name: "Flak Battery", desc: "Rapid-fire anti-aircraft cannon.", faction: "D", kind: "bld", queue: "def", cost: 1000, hp: 900, armor: "steel", sight: 11, power: -50, prereq: ["radar"], wAir: "flakBattery", needsPower: true, tags: ["defense"] }),
    U("d_coil", { name: "Arc Coil", desc: "Arc-discharge tower. Arc Troopers can supercharge it, even without power.", faction: "D", kind: "bld", queue: "def", cost: 1500, hp: 600, armor: "steel", sight: 8, power: -75, prereq: ["radar"], wGround: "coilZap", needsPower: true, chargeable: true, tags: ["defense"] }),
    U("d_wall", { name: "Barrier Wall", desc: "Blocks movement.", faction: "D", kind: "bld", queue: "def", cost: 100, hp: 300, armor: "concrete", sight: 1, prereq: ["hub"], wall: true, tags: ["wall"] }),
    U("d_silo", { name: "Annihilator Silo", desc: "Superweapon: launches a city-killing warhead.", faction: "D", kind: "bld", queue: "def", cost: 5000, hp: 1000, armor: "concrete", w: 3, h: 3, power: -200, prereq: ["lab"], superweapon: "nuke", tags: ["superweapon"] }),
    U("d_bulwark", { name: "Bulwark Projector", desc: "Superweapon: renders vehicles and structures invulnerable. Infantry do not survive.", faction: "D", kind: "bld", queue: "def", cost: 2500, hp: 1000, armor: "concrete", w: 3, h: 3, power: -200, prereq: ["lab"], superweapon: "bulwark", tags: ["superweapon"] }),

    // ───────────── Neutral ─────────────
    U("fuelwell", { name: "Fuel Well", desc: "Capture with an Engineer for steady income.", faction: "N", kind: "bld", cost: 1000, hp: 1000, armor: "steel", sight: 4, w: 2, h: 2, tags: ["fuelwell"], income: 25, capturable: true }),
  ].map((r) => [r.id, r]),
);

export interface SuperweaponRule {
  id: string;
  name: string;
  charge: number; // ticks
  radius: number;
  twoStep?: boolean;
}

export const SUPERWEAPONS: Record<string, SuperweaponRule> = {
  nuke: { id: "nuke", name: "Annihilator Warhead", charge: 20 * 60 * 10, radius: 5 * LEP },
  storm: { id: "storm", name: "Tempest Storm", charge: 20 * 60 * 10, radius: 6 * LEP },
  phase: { id: "phase", name: "Phase Shift", charge: 20 * 60 * 7, radius: Math.round(1.5 * LEP), twoStep: true },
  bulwark: { id: "bulwark", name: "Bulwark Field", charge: 20 * 60 * 5, radius: Math.round(1.5 * LEP) },
};

// Economy and misc constants
export const ORE_VALUE = 25;
export const GEM_VALUE = 50;
export const ORE_MAX = 12; // units of ore per cell
export const HARVEST_TICKS = 6; // ticks per unit harvested
export const UNLOAD_TICKS = 2;
export const ORE_GROW_PERIOD = 300;
export const INCOME_PERIOD = 60;
export const ADJACENT = 3; // build radius in cells around own structures
export const BUILD_TIME_PCT = 60; // ticks per 100 credits
export const MULTI_FACTORY_SPEED = [100, 150, 190, 220, 245, 265];
export const CONSTRUCT_TICKS = 40; // structure build-up animation
export const SELL_TICKS = 20;
export const SELL_REFUND_PCT = 50;
export const SURVIVORS: Record<Faction, string> = { C: "c_trooper", D: "d_levy" };
export const VET_COLORS = ["", "veteran", "elite"];

export function buildTicks(cost: number) {
  return Math.max(20, Math.floor((cost * BUILD_TIME_PCT) / 100));
}

export function rule(id: string): Rule {
  const r = RULES[id];
  if (!r) throw new Error("unknown rule " + id);
  return r;
}

/** All buildable items for a faction & queue, in sidebar order. */
export function buildablesFor(faction: Faction, queue: Queue): Rule[] {
  return Object.values(RULES).filter((r) => r.queue === queue && (r.faction === faction || r.faction === "*"));
}

export const FACTION_HUB: Record<Faction, string> = { C: "c_hub", D: "d_hub" };
export const FACTION_STARTERS: Record<Faction, string[]> = {
  C: ["c_trooper", "c_trooper", "c_lancer", "hound", "c_trooper", "c_warden", "c_trooper", "c_lancer", "c_rover", "engineer"],
  D: ["d_levy", "d_levy", "d_flak", "hound", "d_levy", "d_bastion", "d_levy", "d_flak", "d_hauler", "engineer"],
};
