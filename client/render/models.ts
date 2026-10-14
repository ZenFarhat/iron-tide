// Original procedural 3D models for every unit, structure and prop.
// Units: origin at centre, forward = +x, z up (units = cells).
// Structures: footprint spans [0,w]×[0,h] with origin at the footprint's top corner.
import { Model, type Col } from "./model3d";

// palette
const CW = "#d6dbe1",
  CS = "#8c98a5",
  CD = "#545e69",
  CGLOW = "!#8ff7ff",
  GLASS = "#5ea7d6";
const DI = "#6c6e61",
  DD = "#3e403a",
  DC = "#9b968b",
  DR = "#81442a",
  DGLOW = "!#ffb04a";
const TRACK = "#2b2c2f",
  TIRE = "#232427",
  BLACK = "#1c1d20",
  SAND = "#c4ad80",
  HAZ = "#d9b43a",
  COPPER = "#b8732f";

export interface UnitModel {
  body: Model;
  turret?: Model;
  pivot?: [number, number, number];
  tip: [number, number, number]; // muzzle position (in turret space if turret, else body)
  shadow: [number, number]; // ellipse radii in cells
}

function tracks(m: Model, len: number, sep: number, w = 0.13, h = 0.13) {
  for (const s of [-1, 1]) {
    m.box(0, s * sep, 0, len, w, h, TRACK, "#3a3b40");
    for (let i = 0; i < 4; i++) m.wheel(-len / 2 + 0.1 + (i * (len - 0.2)) / 3, s * (sep + w / 2 + 0.006), 0.065, 0.05, 0.012, "#4c4d53");
  }
}
function wheels(m: Model, xs: number[], sep: number, r = 0.07, w = 0.06) {
  for (const x of xs) for (const s of [-1, 1]) m.wheel(x, s * sep, r, r, w, TIRE, "#5a5d63");
}

const unitBuilders: Record<string, () => UnitModel> = {
  c_warden() {
    const b = new Model();
    tracks(b, 0.8, 0.2);
    b.taper(0, 0, 0.05, 0.76, 0.36, 0.13, 0.62, 0.3, "team");
    b.wedge(0.33, 0, 0.18, 0.1, 0.28, 0.02, 0.0, "team2");
    b.box(-0.06, 0, 0.18, 0.44, 0.28, 0.02, CS);
    b.box(-0.31, 0, 0.18, 0.1, 0.24, 0.03, CD);
    const t = new Model();
    t.taper(0, 0, 0, 0.32, 0.26, 0.1, 0.24, 0.19, "team");
    t.box(-0.07, 0.04, 0.1, 0.09, 0.09, 0.03, CS);
    t.barrel(0.13, 0, 0.05, 0.34, 0.024, CD);
    t.barrel(0.43, 0, 0.05, 0.06, 0.034, CD);
    return { body: b, turret: t, pivot: [-0.04, 0, 0.2], tip: [0.5, 0, 0.05], shadow: [0.42, 0.28] };
  },
  c_rover() {
    const b = new Model();
    wheels(b, [-0.22, 0, 0.22], 0.17);
    b.box(0, 0, 0.06, 0.66, 0.3, 0.12, "team");
    b.wedge(0.25, 0, 0.18, 0.16, 0.28, 0.08, 0.02, CS);
    b.box(0.31, 0, 0.2, 0.03, 0.24, 0.035, GLASS);
    b.box(-0.2, 0, 0.18, 0.2, 0.26, 0.03, CD);
    const t = new Model();
    t.cyl(0, 0, 0, 0.1, 0.04, CD, 8);
    t.box(0, 0, 0.04, 0.22, 0.22, 0.1, CS, CW);
    t.box(0, 0, 0.14, 0.22, 0.06, 0.006, "team");
    for (const y of [-0.055, 0.055]) for (const z of [0.065, 0.11]) t.barrel(0.1, y, z, 0.03, 0.022, BLACK);
    return { body: b, turret: t, pivot: [-0.08, 0, 0.18], tip: [0.14, 0, 0.09], shadow: [0.38, 0.24] };
  },
  c_lens() {
    const b = new Model();
    tracks(b, 0.74, 0.19);
    b.taper(0, 0, 0.05, 0.7, 0.34, 0.12, 0.56, 0.28, "team");
    b.box(-0.06, 0, 0.17, 0.14, 0.1, 0.14, CS);
    b.tube(-0.12, 0, 0.33, 1, 0, 0.2, 0.24, 0.09, CW, 10, 0.07);
    b.tube(-0.12, 0, 0.33, -1, 0, -0.2, 0.06, 0.09, CD, 10);
    b.sphere(0.13, 0, 0.385, 0.062, "!#c6fbff", 8, 5);
    b.box(-0.2, 0, 0.17, 0.2, 0.26, 0.02, CD);
    return { body: b, tip: [0.16, 0, 0.39], shadow: [0.4, 0.26] };
  },
  c_harv() {
    const b = new Model();
    tracks(b, 0.86, 0.22, 0.14, 0.14);
    b.box(-0.06, 0, 0.06, 0.62, 0.42, 0.2, "team");
    b.box(0.31, 0.11, 0.06, 0.18, 0.18, 0.24, CW);
    b.box(0.4, 0.11, 0.2, 0.01, 0.14, 0.06, GLASS);
    b.wedge(0.39, -0.09, 0.02, 0.14, 0.22, 0.1, 0.03, CD);
    b.taper(-0.1, 0, 0.26, 0.5, 0.38, 0.06, 0.44, 0.32, CS);
    b.cyl(-0.22, 0, 0.32, 0.07, 0.035, CGLOW, 10);
    b.cyl(0.0, 0, 0.32, 0.07, 0.035, CGLOW, 10);
    return { body: b, tip: [0.4, 0, 0.1], shadow: [0.48, 0.32] };
  },
  mhv() {
    const b = new Model();
    wheels(b, [-0.36, -0.16, 0.14, 0.34], 0.22, 0.08, 0.07);
    b.box(0, 0, 0.07, 0.94, 0.42, 0.06, CD);
    b.box(0.36, 0, 0.13, 0.2, 0.4, 0.18, "team");
    b.box(0.462, 0, 0.22, 0.012, 0.32, 0.06, GLASS);
    b.box(-0.12, 0, 0.13, 0.62, 0.4, 0.2, CS, CW);
    b.box(-0.12, 0, 0.33, 0.5, 0.3, 0.06, "team");
    b.box(-0.1, 0, 0.39, 0.52, 0.06, 0.04, HAZ);
    b.box(-0.38, 0.14, 0.33, 0.02, 0.02, 0.16, CD);
    b.box(0.1, -0.14, 0.33, 0.12, 0.08, 0.05, CD);
    return { body: b, tip: [0.5, 0, 0.2], shadow: [0.55, 0.32] };
  },
  c_striker() {
    const b = new Model();
    b.latheX(0, 0, [[-0.42, 0.028], [-0.3, 0.05], [0.08, 0.058], [0.3, 0.038], [0.46, 0.004]], "team", 8);
    b.dome(0.17, 0, 0.035, 0.05, "#62b5ea", 8, 3, 0.8);
    b.plate([[0.12, 0.02], [-0.22, 0.36], [-0.3, 0.36], [-0.24, 0.02]], -0.005, CS);
    b.plate([[-0.24, -0.02], [-0.3, -0.36], [-0.22, -0.36], [0.12, -0.02]], -0.005, CS);
    b.plate([[-0.3, 0.02], [-0.42, 0.14], [-0.46, 0.14], [-0.43, 0.02]], 0.0, "team2");
    b.plate([[-0.43, -0.02], [-0.46, -0.14], [-0.42, -0.14], [-0.3, -0.02]], 0.0, "team2");
    b.wedge(-0.37, 0, 0.03, 0.12, 0.014, 0.12, 0.02, "team2");
    b.barrel(-0.06, 0.18, -0.02, 0.15, 0.014, CW, 5);
    b.barrel(-0.06, -0.18, -0.02, 0.15, 0.014, CW, 5);
    b.tube(-0.42, 0, 0, -1, 0, 0, 0.02, 0.026, "!#ffcf6a", 8);
    return { body: b, tip: [0.1, 0.18, -0.02], shadow: [0.4, 0.34] };
  },
  d_bastion() {
    const b = new Model();
    tracks(b, 0.88, 0.23, 0.15, 0.14);
    b.taper(0, 0, 0.05, 0.84, 0.42, 0.14, 0.68, 0.36, "team");
    b.wedge(0.37, 0, 0.12, 0.12, 0.38, 0.07, 0.0, DI);
    b.box(-0.34, 0, 0.19, 0.12, 0.3, 0.05, DD);
    b.cyl(-0.38, 0.1, 0.19, 0.022, 0.09, DD, 6);
    b.cyl(-0.38, -0.1, 0.19, 0.022, 0.09, DD, 6);
    const t = new Model();
    t.taper(0, 0, 0, 0.38, 0.32, 0.12, 0.28, 0.24, "team");
    t.box(-0.12, 0, 0.12, 0.1, 0.14, 0.03, DI);
    t.barrel(0.16, 0, 0.06, 0.38, 0.032, DD);
    t.barrel(0.5, 0, 0.06, 0.07, 0.044, DD);
    return { body: b, turret: t, pivot: [-0.03, 0, 0.21], tip: [0.57, 0, 0.06], shadow: [0.46, 0.3] };
  },
  d_hauler() {
    const b = new Model();
    wheels(b, [-0.24, -0.04, 0.22], 0.17);
    b.box(0, 0, 0.06, 0.7, 0.3, 0.06, DD);
    b.box(0.24, 0, 0.12, 0.2, 0.3, 0.15, "team");
    b.box(0.342, 0, 0.19, 0.012, 0.24, 0.05, "#6b8ca0");
    b.box(-0.12, 0, 0.12, 0.44, 0.3, 0.05, DI);
    const t = new Model();
    t.cyl(0, 0, 0, 0.1, 0.05, DD, 8);
    t.box(0, 0, 0.05, 0.15, 0.15, 0.07, "team");
    t.tube(0.03, 0.035, 0.09, 1, 0, 0.8, 0.22, 0.017, DD, 5);
    t.tube(0.03, -0.035, 0.09, 1, 0, 0.8, 0.22, 0.017, DD, 5);
    return { body: b, turret: t, pivot: [-0.12, 0, 0.17], tip: [0.18, 0, 0.22], shadow: [0.38, 0.24] };
  },
  d_siege() {
    const b = new Model();
    wheels(b, [-0.3, -0.12, 0.1, 0.3], 0.18);
    b.box(0, 0, 0.06, 0.86, 0.34, 0.06, DD);
    b.box(0.33, 0, 0.12, 0.18, 0.32, 0.16, "team");
    b.box(0.425, 0, 0.19, 0.012, 0.26, 0.05, "#6b8ca0");
    b.box(-0.1, 0, 0.12, 0.5, 0.3, 0.04, DI);
    b.tube(-0.36, 0, 0.17, 1, 0, 0.32, 0.6, 0.028, DI, 5);
    b.tube(-0.33, 0, 0.22, 1, 0, 0.32, 0.46, 0.048, "#cfc8b4", 8);
    b.tube(0.106, 0, 0.36, 1, 0, 0.32, 0.12, 0.048, DR, 8, 0.0);
    b.tube(-0.3, 0, 0.23, 1, 0, 0.32, 0.06, 0.05, "team", 8);
    return { body: b, tip: [0.2, 0, 0.42], shadow: [0.48, 0.26] };
  },
  d_crawler() {
    const b = new Model();
    tracks(b, 0.8, 0.21);
    b.taper(0, 0, 0.05, 0.76, 0.38, 0.13, 0.6, 0.32, "team");
    b.box(-0.3, 0, 0.18, 0.12, 0.26, 0.03, DD);
    const t = new Model();
    t.cyl(0, 0, 0, 0.14, 0.08, DD, 10, 0.12);
    for (const y of [-0.07, 0.07]) {
      t.cyl(0.04, y, 0.08, 0.024, 0.16, DI, 6);
      t.cyl(0.04, y, 0.11, 0.042, 0.02, COPPER, 8);
      t.cyl(0.04, y, 0.16, 0.038, 0.02, COPPER, 8);
      t.sphere(0.04, y, 0.26, 0.036, "!#9fd8ff", 8, 5);
    }
    return { body: b, turret: t, pivot: [-0.04, 0, 0.18], tip: [0.04, 0, 0.26], shadow: [0.42, 0.28] };
  },
  d_titan() {
    const b = new Model();
    for (const x of [-0.25, 0.25]) for (const y of [-0.27, 0.27]) b.box(x, y, 0, 0.44, 0.16, 0.16, TRACK, "#3a3b40");
    b.taper(0, 0, 0.08, 0.98, 0.5, 0.16, 0.8, 0.42, "team");
    b.wedge(0.45, 0, 0.14, 0.12, 0.44, 0.09, 0.0, DI);
    b.box(-0.4, 0, 0.24, 0.12, 0.34, 0.05, DD);
    const t = new Model();
    t.taper(0, 0, 0, 0.5, 0.42, 0.15, 0.38, 0.32, "team");
    t.box(-0.15, 0, 0.15, 0.12, 0.16, 0.03, DI);
    for (const y of [-0.07, 0.07]) {
      t.barrel(0.2, y, 0.075, 0.44, 0.034, DD);
      t.barrel(0.6, y, 0.075, 0.07, 0.045, DD);
    }
    for (const y of [-0.25, 0.25]) {
      t.box(-0.06, y, 0.04, 0.22, 0.08, 0.1, DI);
      t.barrel(0.05, y, 0.09, 0.02, 0.02, BLACK, 5);
    }
    return { body: b, turret: t, pivot: [-0.06, 0, 0.24], tip: [0.67, 0, 0.075], shadow: [0.56, 0.38] };
  },
  d_harv() {
    const b = new Model();
    tracks(b, 0.9, 0.24, 0.15, 0.15);
    b.box(-0.06, 0, 0.07, 0.66, 0.46, 0.22, "team");
    b.box(0.32, -0.11, 0.07, 0.2, 0.2, 0.24, DI);
    b.box(0.421, -0.11, 0.2, 0.012, 0.14, 0.06, "#6b8ca0");
    b.wedge(0.42, 0.09, 0.02, 0.14, 0.26, 0.11, 0.03, DD);
    b.taper(-0.12, 0, 0.29, 0.52, 0.42, 0.07, 0.46, 0.36, DI);
    b.box(-0.12, 0, 0.36, 0.3, 0.2, 0.02, DR);
    const t = new Model();
    t.cyl(0, 0, 0, 0.05, 0.04, DD, 8);
    t.barrel(0.02, 0, 0.03, 0.13, 0.012, BLACK, 5);
    return { body: b, turret: t, pivot: [0.3, -0.11, 0.31], tip: [0.15, 0, 0.03], shadow: [0.5, 0.34] };
  },
  d_dread() {
    const b = new Model();
    const prof: [number, number][] = [
      [-0.92, 0.0],
      [-0.84, 0.13],
      [-0.64, 0.25],
      [-0.3, 0.31],
      [0.1, 0.31],
      [0.5, 0.26],
      [0.78, 0.15],
      [0.92, 0.0],
    ];
    b.latheX(0, 0.0, prof, (k) => (k === 2 || k === 5 ? "team" : k === 3 || k === 4 ? DI : DD), 14);
    b.box(0.08, 0, -0.38, 0.52, 0.16, 0.1, DD);
    b.box(0.3, 0, -0.35, 0.08, 0.14, 0.06, "#6b8ca0");
    b.wedge(-0.78, 0, 0.12, 0.24, 0.02, 0.32, 0.08, "team2");
    b.plate([[-0.62, 0.02], [-0.84, 0.36], [-0.94, 0.36], [-0.88, 0.02]], 0, "team2");
    b.plate([[-0.88, -0.02], [-0.94, -0.36], [-0.84, -0.36], [-0.62, -0.02]], 0, "team2");
    for (const y of [-0.37, 0.37]) {
      b.tube(-0.24, y, -0.12, 1, 0, 0, 0.26, 0.06, DD, 8);
      b.tube(-0.25, y, -0.12, -1, 0, 0, 0.012, 0.11, "#77797f", 10);
    }
    return { body: b, tip: [0.08, 0, -0.4], shadow: [0.9, 0.4] };
  },
};

// ───────────────────────────── infantry ─────────────────────────────

interface Kit {
  uniform: Col;
  pants: Col;
  helmet: Col;
  skin?: Col;
  gun: "rifle" | "smg" | "rocket" | "sniper" | "flak" | "arc" | "chain" | "tool" | "none";
  bulk?: number;
  hat?: "helmet" | "cap" | "fur" | "hard" | "visor";
  pack?: Col;
}

const KITS: Record<string, Kit> = {
  c_trooper: { uniform: "team", pants: "#4b5563", helmet: "#5c6b4e", gun: "rifle" },
  c_lancer: { uniform: "team", pants: "#3f4652", helmet: "#4e5a66", gun: "rocket", bulk: 1.12, pack: CD },
  c_wraith: { uniform: "#2a2e36", pants: "#22252b", helmet: "team", gun: "sniper", hat: "visor" },
  engineer: { uniform: "team", pants: "#6b5d3e", helmet: "#f0c530", gun: "tool", hat: "hard", pack: "#e0b030" },
  d_levy: { uniform: "team", pants: "#4f4a3a", helmet: "#5b4a35", gun: "rifle", hat: "fur" },
  d_flak: { uniform: "team", pants: "#4f4a3a", helmet: "#4d5040", gun: "flak", pack: DI },
  d_arc: { uniform: "team", pants: "#3c3e38", helmet: "#3c3e38", gun: "arc", bulk: 1.18, hat: "visor", pack: COPPER },
  d_jugg: { uniform: "team", pants: "#3a3b36", helmet: "#55574e", gun: "chain", bulk: 1.35, hat: "visor", pack: DD },
};

export const INF_FRAMES = 7; // 0 stand, 1-4 walk, 5 fire, 6 deployed

function soldier(k: Kit, frame: number): Model {
  const m = new Model();
  const s = k.bulk ?? 1;
  const skin = k.skin ?? "#d6a77f";
  const walk = frame >= 1 && frame <= 4 ? Math.sin(((frame - 1) / 4) * Math.PI * 2) : 0;
  const deployed = frame === 6;
  const kneel = deployed ? 0.07 : 0;
  // legs
  const lx = walk * 0.05;
  if (deployed) {
    m.box(0.04, 0.035 * s, 0, 0.12, 0.045 * s, 0.07, k.pants);
    m.box(-0.02, -0.035 * s, 0, 0.05, 0.045 * s, 0.13, k.pants);
  } else {
    m.box(lx, 0.036 * s, 0, 0.05 * s, 0.045 * s, 0.2, k.pants);
    m.box(-lx, -0.036 * s, 0, 0.05 * s, 0.045 * s, 0.2, k.pants);
  }
  const tz = 0.19 - kneel;
  m.box(0, 0, tz, 0.085 * s, 0.13 * s, 0.17, k.uniform);
  if (k.pack) m.box(-0.06 * s, 0, tz + 0.03, 0.05, 0.1 * s, 0.12, k.pack);
  // head
  m.box(0.005, 0, tz + 0.17, 0.06, 0.06, 0.06, skin);
  const hz = tz + 0.215;
  switch (k.hat ?? "helmet") {
    case "helmet":
      m.box(0, 0, hz, 0.078, 0.078, 0.035, k.helmet);
      break;
    case "fur":
      m.box(0, 0, hz, 0.08, 0.08, 0.05, k.helmet);
      break;
    case "hard":
      m.box(0, 0, hz, 0.085, 0.085, 0.03, k.helmet);
      m.box(0.03, 0, hz, 0.04, 0.07, 0.008, k.helmet);
      break;
    case "visor":
      m.box(0, 0, tz + 0.16, 0.08, 0.08, 0.09, k.helmet);
      m.box(0.041, 0, tz + 0.19, 0.005, 0.06, 0.025, "!#7ff4ff");
      break;
    case "cap":
      m.box(0, 0, hz, 0.07, 0.07, 0.025, k.helmet);
  }
  // arms + weapon
  const az = tz + 0.1;
  const aim = frame === 5 ? 0.015 : 0;
  const swing = walk * 0.03;
  switch (k.gun) {
    case "rifle":
    case "smg":
      m.box(0.05, 0.065 * s, az, 0.09, 0.035, 0.035, k.uniform);
      m.box(0.06 - swing, -0.065 * s, az, 0.07, 0.035, 0.035, k.uniform);
      m.box(0.11 + aim, -0.02, az + 0.02, k.gun === "smg" ? 0.12 : 0.17, 0.022, 0.028, BLACK);
      break;
    case "sniper":
      m.box(0.05, 0.065, az, 0.09, 0.035, 0.035, k.uniform);
      m.box(0.06, -0.065, az, 0.08, 0.035, 0.035, k.uniform);
      m.box(0.14 + aim, -0.02, az + 0.025, 0.26, 0.018, 0.024, BLACK);
      m.box(0.1, -0.02, az + 0.05, 0.06, 0.015, 0.015, "#444");
      break;
    case "rocket":
      m.box(0.03, 0.07 * s, az, 0.07, 0.035, 0.035, k.uniform);
      m.tube(-0.12, -0.04, tz + 0.18, 1, 0, 0, 0.3, 0.032, "#5a6650", 6);
      m.tube(0.18, -0.04, tz + 0.18, 1, 0, 0, 0.012, 0.036, BLACK, 6);
      break;
    case "flak":
      m.box(0.03, 0.07, az, 0.07, 0.035, 0.035, k.uniform);
      m.tube(-0.06, -0.05, tz + 0.12, 1, 0, 0.6, 0.24, 0.03, DI, 6);
      break;
    case "arc":
      m.box(0.07, 0.08 * s, az, 0.12, 0.05, 0.05, DI);
      m.box(0.07, -0.08 * s, az, 0.12, 0.05, 0.05, DI);
      m.sphere(0.14, 0.08 * s, az + 0.025, 0.03, "!#9fd8ff", 6, 4);
      m.sphere(0.14, -0.08 * s, az + 0.025, 0.03, "!#9fd8ff", 6, 4);
      break;
    case "chain":
      m.box(0.05, 0.07 * s, az, 0.09, 0.05, 0.05, k.uniform);
      m.box(0.08, -0.06 * s, az - 0.01, 0.12, 0.06, 0.06, DD);
      m.tube(0.14, -0.06 * s, az + 0.02, 1, 0, 0, 0.14, 0.025, "#2f3034", 6);
      break;
    case "tool":
      m.box(0.03, 0.065, az - 0.02, 0.06, 0.035, 0.035, k.uniform);
      m.box(0.04 - swing, -0.065, az - 0.02, 0.06, 0.035, 0.035, k.uniform);
      m.box(0.05, -0.1, 0.08, 0.08, 0.04, 0.05, "#b23a2a");
      break;
    case "none":
      break;
  }
  if (deployed) {
    // sandbag ring
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI * 0.75 + (i / 6) * Math.PI * 1.5;
      m.boxR(Math.cos(a) * 0.17, Math.sin(a) * 0.17, 0, 0.1, 0.06, 0.08, a + Math.PI / 2, SAND, "#d2bd90");
    }
  }
  return m;
}

function hound(frame: number): Model {
  const m = new Model();
  const walk = frame >= 1 && frame <= 4 ? Math.sin(((frame - 1) / 4) * Math.PI * 2) : 0;
  const fur = "#7d5f42";
  for (const [x, y, ph] of [
    [0.08, 0.035, 1],
    [0.08, -0.035, -1],
    [-0.08, 0.035, -1],
    [-0.08, -0.035, 1],
  ]) m.box(x + walk * 0.03 * ph, y, 0, 0.03, 0.025, 0.1, fur);
  m.box(0, 0, 0.09, 0.24, 0.08, 0.08, fur);
  m.box(0.14, 0, 0.13, 0.08, 0.065, 0.07, fur);
  m.box(0.2, 0, 0.135, 0.06, 0.04, 0.035, "#5a4430");
  m.box(0.12, 0.02, 0.2, 0.02, 0.015, 0.03, fur);
  m.box(0.12, -0.02, 0.2, 0.02, 0.015, 0.03, fur);
  m.box(0.1, 0, 0.11, 0.025, 0.085, 0.04, "team");
  m.tube(-0.12, 0, 0.15, -1, 0, 0.7, 0.1, 0.012, fur, 4);
  return m;
}

export function infantryModel(type: string, frame: number): Model {
  if (type === "hound") return hound(frame);
  return soldier(KITS[type] ?? KITS.c_trooper, frame);
}

// ───────────────────────────── structures ─────────────────────────────

export interface StructModel {
  body: Model;
  turret?: Model;
  pivot?: [number, number, number];
  tip?: [number, number, number];
  height: number; // approx, in cells (for picking / bars)
}

function slab(m: Model, w: number, h: number, col: Col, top?: Col, z = 0.06) {
  m.box(w / 2, h / 2, 0, w - 0.1, h - 0.1, z, col, top);
}
function light(m: Model, x: number, y: number, z: number, c = CGLOW) {
  m.box(x, y, z, 0.05, 0.05, 0.05, c);
}

const structBuilders: Record<string, () => StructModel> = {
  c_hub() {
    const m = new Model();
    slab(m, 3, 3, CS, "#a8b2bc", 0.08);
    m.box(1.3, 1.35, 0.08, 1.8, 1.6, 0.42, CW);
    m.box(1.3, 1.35, 0.44, 1.84, 1.64, 0.06, "team");
    m.box(1.1, 1.2, 0.5, 1.0, 0.9, 0.3, CW, "#e6eaee");
    m.dome(1.1, 1.2, 0.8, 0.34, "#7fb6dd", 12, 4, 0.7);
    m.box(1.62, 2.16, 0.08, 0.72, 0.02, 0.3, CD);
    m.box(1.62, 2.17, 0.38, 0.8, 0.02, 0.04, HAZ);
    m.box(2.45, 0.55, 0.08, 0.12, 0.12, 0.95, HAZ);
    m.box(2.05, 0.55, 0.99, 0.95, 0.08, 0.06, HAZ);
    m.box(1.62, 0.55, 0.8, 0.02, 0.02, 0.2, CD);
    m.box(0.55, 2.35, 0.08, 0.5, 0.5, 0.18, CD, CS);
    light(m, 0.3, 0.5, 0.5);
    light(m, 2.2, 2.2, 0.5);
    m.box(0.7, 0.6, 0.8, 0.02, 0.02, 0.3, CD);
    m.sphere(0.7, 0.6, 1.12, 0.03, "!#ff5050", 6, 4);
    return { body: m, height: 1.2 };
  },
  c_power() {
    const m = new Model();
    slab(m, 2, 2, CS);
    for (const [x, y] of [
      [0.5, 0.5],
      [1.5, 0.5],
      [0.5, 1.5],
      [1.5, 1.5],
    ]) {
      m.box(x, y, 0.06, 0.06, 0.06, 0.12, CD);
      m.wedge(x, y, 0.16, 0.66, 0.66, 0.02, 0.24, "#1f3b66", "#2f5c9e");
    }
    m.cyl(1, 1, 0.06, 0.2, 0.62, CW, 10, 0.14);
    m.cyl(1, 1, 0.36, 0.23, 0.05, "team", 10);
    m.sphere(1, 1, 0.76, 0.1, "!#8ff7ff", 8, 5);
    return { body: m, height: 0.9 };
  },
  c_barracks() {
    const m = new Model();
    slab(m, 2, 2, CS);
    m.box(1, 0.9, 0.06, 1.5, 1.3, 0.3, CW);
    m.taper(1, 0.9, 0.36, 1.56, 1.36, 0.16, 1.56, 0.12, "team");
    m.box(1.0, 1.56, 0.06, 0.4, 0.02, 0.22, CD);
    m.box(1.78, 1.72, 0.06, 0.02, 0.02, 0.62, CS);
    m.box(1.78, 1.64, 0.5, 0.01, 0.16, 0.1, "team");
    m.box(0.35, 1.78, 0.06, 0.44, 0.12, 0.08, SAND);
    for (const x of [0.5, 0.8, 1.2, 1.5]) m.box(x, 1.555, 0.24, 0.12, 0.012, 0.06, GLASS);
    return { body: m, height: 0.7 };
  },
  c_refinery() {
    const m = new Model();
    slab(m, 3, 3, CS);
    m.cyl(0.62, 0.62, 0.06, 0.42, 0.78, CW, 12);
    m.cyl(0.62, 0.62, 0.84, 0.42, 0.08, "team", 12, 0.3);
    m.cyl(0.62, 1.55, 0.06, 0.34, 0.6, CW, 12);
    m.cyl(0.62, 1.55, 0.66, 0.34, 0.06, "team", 12, 0.24);
    m.box(2.0, 1.15, 0.06, 1.4, 1.5, 0.48, CW, "#c3cbd3");
    m.box(2.0, 1.15, 0.4, 1.42, 1.52, 0.05, "team");
    m.box(2.0, 1.92, 0.06, 0.6, 0.02, 0.3, CD);
    m.box(1.5, 2.55, 0.06, 0.8, 0.7, 0.04, CD);
    m.box(1.5, 2.3, 0.06, 0.12, 0.12, 0.42, CD);
    m.box(1.5, 2.55, 0.44, 0.12, 0.6, 0.07, HAZ);
    m.tube(1.0, 0.62, 0.5, 1, 0.4, 0, 0.6, 0.05, CS, 6);
    light(m, 2.65, 0.5, 0.56);
    return { body: m, height: 1.0 };
  },
  c_factory() {
    const m = new Model();
    slab(m, 3, 3, CS);
    m.box(1.5, 1.25, 0.06, 2.6, 2.2, 0.55, CW);
    m.taper(1.5, 1.25, 0.61, 2.64, 2.24, 0.16, 2.4, 1.5, "team");
    m.box(1.5, 2.36, 0.06, 1.0, 0.02, 0.45, CD);
    m.box(1.5, 2.37, 0.51, 1.1, 0.02, 0.05, HAZ);
    for (const x of [0.8, 1.5, 2.2]) m.box(x, 1.25, 0.775, 0.3, 0.9, 0.01, "!#a8e6ff");
    m.cyl(0.45, 0.4, 0.61, 0.1, 0.36, CS, 8);
    m.cyl(0.75, 0.4, 0.61, 0.08, 0.28, CS, 8);
    light(m, 0.3, 2.3, 0.5);
    light(m, 2.7, 2.3, 0.5);
    return { body: m, height: 1.0 };
  },
  c_aircmd() {
    const m = new Model();
    slab(m, 3, 3, "#7d8791", "#8a949e", 0.04);
    for (const [x, y] of [
      [0.75, 0.75],
      [2.25, 0.75],
      [0.75, 2.25],
      [2.25, 2.25],
    ]) {
      m.box(x, y, 0.04, 1.2, 1.2, 0.02, "#5b646d");
      m.box(x, y, 0.06, 0.6, 0.06, 0.004, HAZ);
      m.box(x, y, 0.06, 0.06, 0.6, 0.004, HAZ);
      light(m, x + 0.5, y + 0.5, 0.06);
    }
    m.cyl(1.5, 1.5, 0.04, 0.16, 0.72, CW, 8);
    m.cyl(1.5, 1.5, 0.76, 0.26, 0.14, GLASS, 10, 0.3);
    m.cyl(1.5, 1.5, 0.9, 0.3, 0.03, "team", 10);
    const t = new Model();
    t.box(0, 0, 0, 0.04, 0.04, 0.12, CD);
    t.tube(0.0, 0, 0.12, 1, 0, 0.4, 0.04, 0.16, CW, 10, 0.2);
    return { body: m, turret: t, pivot: [1.5, 1.5, 0.93], height: 1.2 };
  },
  c_depot() {
    const m = new Model();
    slab(m, 3, 3, "#77818b", "#838d97", 0.05);
    m.box(1.5, 1.5, 0.05, 2.2, 0.06, 0.004, "team");
    m.box(1.5, 1.5, 0.05, 0.06, 2.2, 0.004, "team");
    m.box(1.5, 1.5, 0.05, 1.6, 1.6, 0.003, "#6a737c");
    for (const y of [0.25, 2.75]) {
      m.box(0.25, y, 0.05, 0.12, 0.12, 0.65, CS);
      m.box(2.75, y, 0.05, 0.12, 0.12, 0.65, CS);
    }
    m.box(1.5, 0.25, 0.65, 2.6, 0.12, 0.08, HAZ);
    m.box(1.5, 0.3, 0.45, 0.2, 0.14, 0.2, CD);
    light(m, 0.25, 0.25, 0.7, "!#7cff7c");
    return { body: m, height: 0.8 };
  },
  c_lab() {
    const m = new Model();
    slab(m, 3, 3, CS);
    m.box(1.5, 1.5, 0.06, 2.5, 2.5, 0.36, CW);
    m.box(1.5, 1.5, 0.42, 2.54, 2.54, 0.05, "team");
    m.dome(1.5, 1.5, 0.47, 0.98, "#93cdf2", 14, 5, 0.75);
    m.box(2.55, 0.45, 0.47, 0.03, 0.03, 0.6, CD);
    m.sphere(2.55, 0.45, 1.08, 0.04, "!#8ff7ff", 6, 4);
    m.cyl(1.5, 1.5, 1.2, 0.08, 0.06, CGLOW, 8);
    return { body: m, height: 1.3 };
  },
  c_processor() {
    const m = new Model();
    slab(m, 3, 3, CS);
    m.cyl(1.5, 1.5, 0.06, 1.05, 0.5, CW, 16, 0.92);
    m.cyl(1.5, 1.5, 0.3, 1.0, 0.05, "team", 16);
    m.cyl(1.5, 1.5, 0.56, 0.5, 0.12, "!#ffd75a", 12);
    m.cyl(0.4, 2.5, 0.06, 0.24, 0.4, CS, 8);
    m.cyl(2.6, 0.4, 0.06, 0.24, 0.4, CS, 8);
    return { body: m, height: 0.8 };
  },
  c_pillbox() {
    const m = new Model();
    m.cyl(0.5, 0.5, 0, 0.42, 0.18, "#a7a69d", 8, 0.36);
    m.cyl(0.5, 0.5, 0.12, 0.375, 0.03, BLACK, 8);
    m.cyl(0.5, 0.5, 0.18, 0.36, 0.05, "team", 8, 0.28);
    return { body: m, height: 0.3, tip: [0.5, 0.5, 0.14] };
  },
  c_sam() {
    const m = new Model();
    m.box(0.5, 0.5, 0, 0.8, 0.8, 0.12, CS, "#a1acb7");
    const t = new Model();
    t.cyl(0, 0, 0, 0.18, 0.06, CD, 8);
    t.box(-0.02, 0, 0.06, 0.24, 0.34, 0.1, CW);
    for (const y of [-0.09, 0.09]) t.tube(-0.12, y, 0.14, 1, 0, 0.55, 0.26, 0.032, "team", 6);
    return { body: m, turret: t, pivot: [0.5, 0.5, 0.12], tip: [0.12, 0, 0.27], height: 0.45 };
  },
  c_spire() {
    const m = new Model();
    m.cyl(0.5, 0.5, 0, 0.4, 0.12, CS, 8, 0.34);
    m.taper(0.5, 0.5, 0.12, 0.3, 0.3, 1.0, 0.12, 0.12, CW);
    m.cyl(0.5, 0.5, 0.45, 0.17, 0.05, "team", 8);
    m.cyl(0.5, 0.5, 0.8, 0.12, 0.05, "team", 8);
    for (const a of [0, 1, 2, 3]) {
      const ang = (a * Math.PI) / 2 + Math.PI / 4;
      m.boxR(0.5 + Math.cos(ang) * 0.16, 0.5 + Math.sin(ang) * 0.16, 0.12, 0.04, 0.12, 0.5, ang, CS);
    }
    m.sphere(0.5, 0.5, 1.22, 0.11, "!#c6fbff", 8, 5, 1.6);
    return { body: m, height: 1.4, tip: [0.5, 0.5, 1.22] };
  },
  c_wall() {
    const m = new Model();
    m.box(0.5, 0.5, 0, 0.92, 0.92, 0.32, "#b8b6ad", "#cfcdc4");
    m.box(0.5, 0.5, 0.32, 0.5, 0.5, 0.02, "team");
    return { body: m, height: 0.35 };
  },
  c_tempest() {
    const m = new Model();
    slab(m, 3, 3, CS);
    m.cyl(1.5, 1.5, 0.06, 0.55, 1.25, CW, 12, 0.28);
    m.cyl(1.5, 1.5, 0.5, 0.84, 0.06, "team", 18, 0.84);
    m.cyl(1.5, 1.5, 0.95, 0.62, 0.05, "team", 18, 0.62);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const x = 1.5 + Math.cos(a) * 1.15,
        y = 1.5 + Math.sin(a) * 1.15;
      m.cyl(x, y, 0.06, 0.08, 0.7, CS, 6);
      m.sphere(x, y, 0.8, 0.07, "!#bfe4ff", 6, 4);
    }
    m.sphere(1.5, 1.5, 1.52, 0.3, "!#c9e8ff", 10, 6);
    return { body: m, height: 1.8 };
  },
  c_phasegate() {
    const m = new Model();
    m.cyl(1.5, 1.5, 0, 1.38, 0.12, CS, 16, 1.3);
    m.cyl(1.5, 1.5, 0.12, 1.1, 0.03, "team", 16);
    const pts: number[][] = [];
    for (let i = 0; i <= 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      pts.push([1.5 + Math.cos(a) * 0.82, 1.5, 0.98 + Math.sin(a) * 0.82]);
    }
    m.path3(pts, 0.08, CW, 6);
    m.tube(1.5, 1.46, 0.98, 0, 1, 0, 0.08, 0.72, "!#7ff4ff", 16);
    m.box(0.62, 1.5, 0.12, 0.2, 0.4, 0.2, CD);
    m.box(2.38, 1.5, 0.12, 0.2, 0.4, 0.2, CD);
    return { body: m, height: 1.8 };
  },
  // ───── Dominion ─────
  d_hub() {
    const m = new Model();
    slab(m, 3, 3, "#8a877d", "#9a978d", 0.08);
    m.taper(1.4, 1.35, 0.08, 2.2, 2.0, 0.5, 1.9, 1.7, DC);
    m.box(1.4, 1.35, 0.5, 1.94, 1.74, 0.06, "team");
    m.box(1.0, 1.0, 0.56, 0.72, 0.72, 0.5, DI);
    m.taper(1.0, 1.0, 1.06, 0.74, 0.74, 0.12, 0.4, 0.4, "team");
    m.box(1.55, 2.36, 0.08, 0.8, 0.02, 0.32, DD);
    m.box(2.45, 0.5, 0.08, 0.12, 0.12, 1.05, DR);
    m.box(2.05, 0.5, 1.09, 0.95, 0.08, 0.06, DR);
    m.cyl(2.15, 2.0, 0.56, 0.1, 0.42, DD, 8);
    m.cyl(1.9, 2.15, 0.56, 0.08, 0.32, DD, 8);
    light(m, 1.0, 1.0, 1.18, "!#ff4030");
    light(m, 0.35, 0.4, 0.58, DGLOW);
    return { body: m, height: 1.3 };
  },
  d_power() {
    const m = new Model();
    slab(m, 2, 2, "#8a877d");
    m.cyl(1, 0.95, 0.06, 0.55, 0.5, DI, 12, 0.5);
    for (const z of [0.15, 0.3, 0.45]) m.cyl(1, 0.95, z, 0.6, 0.045, COPPER, 12);
    m.cyl(1, 0.95, 0.56, 0.3, 0.26, DD, 10, 0.12);
    m.sphere(1, 0.95, 0.86, 0.11, DGLOW, 8, 5);
    m.box(0.35, 1.65, 0.06, 0.5, 0.5, 0.22, "team");
    return { body: m, height: 1.0 };
  },
  d_barracks() {
    const m = new Model();
    slab(m, 2, 2, "#8a877d");
    m.taper(1, 0.95, 0.06, 1.7, 1.55, 0.32, 1.45, 1.3, DC);
    m.box(1, 0.95, 0.38, 1.47, 1.32, 0.05, "team");
    m.box(1, 1.73, 0.06, 0.36, 0.02, 0.2, DD);
    m.box(1.8, 1.8, 0.06, 0.025, 0.025, 0.66, DD);
    m.box(1.8, 1.72, 0.52, 0.01, 0.16, 0.12, "team");
    m.box(0.3, 1.82, 0.06, 0.4, 0.12, 0.08, SAND);
    for (const x of [0.5, 1.5]) m.box(x, 1.71, 0.28, 0.16, 0.012, 0.03, BLACK);
    return { body: m, height: 0.7 };
  },
  d_refinery() {
    const m = new Model();
    slab(m, 3, 3, "#8a877d");
    m.cyl(0.65, 0.65, 0.06, 0.46, 0.7, DI, 12);
    m.cyl(0.65, 0.65, 0.4, 0.48, 0.06, "team", 12);
    m.cyl(0.65, 1.6, 0.06, 0.36, 0.55, DI, 12);
    m.box(2.0, 1.15, 0.06, 1.4, 1.5, 0.5, DC);
    m.taper(2.0, 1.15, 0.56, 1.42, 1.52, 0.1, 1.2, 1.3, "team");
    m.cyl(2.4, 0.6, 0.66, 0.1, 0.5, DD, 8);
    m.box(1.5, 2.55, 0.06, 0.8, 0.7, 0.04, DD);
    m.box(1.5, 2.3, 0.06, 0.12, 0.12, 0.42, DD);
    m.box(1.5, 2.55, 0.44, 0.12, 0.6, 0.07, DR);
    light(m, 2.65, 1.9, 0.5, DGLOW);
    return { body: m, height: 1.2 };
  },
  d_factory() {
    const m = new Model();
    slab(m, 3, 3, "#8a877d");
    m.box(1.5, 1.2, 0.06, 2.6, 2.1, 0.58, DC);
    for (const x of [0.7, 1.5, 2.3]) m.wedge(x, 1.2, 0.64, 0.8, 2.1, 0.26, 0.02, "team", "team");
    m.box(1.5, 2.26, 0.06, 1.0, 0.02, 0.46, DD);
    m.box(1.5, 2.27, 0.52, 1.1, 0.02, 0.05, HAZ);
    m.cyl(0.4, 0.4, 0.64, 0.12, 0.6, DD, 8);
    m.cyl(0.75, 0.35, 0.64, 0.1, 0.48, DD, 8);
    light(m, 2.7, 2.3, 0.5, DGLOW);
    return { body: m, height: 1.3 };
  },
  d_radar() {
    const m = new Model();
    slab(m, 2, 2, "#8a877d");
    m.box(1, 1, 0.06, 0.9, 0.9, 0.2, DC);
    const P = [
      [0.72, 0.72],
      [1.28, 0.72],
      [1.28, 1.28],
      [0.72, 1.28],
    ];
    for (const [x, y] of P) m.path3([[x, y, 0.26], [1 + (x - 1) * 0.35, 1 + (y - 1) * 0.35, 1.0]], 0.022, DI, 4);
    for (const z of [0.5, 0.75]) {
      const k = 1 - ((z - 0.26) / 0.74) * 0.65;
      const q = P.map(([x, y]) => [1 + (x - 1) * k, 1 + (y - 1) * k, z]);
      m.path3([...q, q[0]], 0.015, DI, 4);
    }
    m.box(1, 1, 1.0, 0.3, 0.3, 0.05, "team");
    m.box(0.35, 1.65, 0.06, 0.4, 0.4, 0.25, "team");
    const t = new Model();
    t.box(0, 0, 0, 0.05, 0.05, 0.12, DD);
    t.tube(0.0, 0, 0.16, 1, 0, 0.35, 0.05, 0.3, "#c9c2b0", 12, 0.34);
    t.path3([[0.02, 0, 0.18], [0.2, 0, 0.26]], 0.01, DD, 4);
    return { body: m, turret: t, pivot: [1, 1, 1.05], height: 1.5 };
  },
  d_depot() {
    const m = new Model();
    slab(m, 3, 3, "#76746b", "#827f75", 0.05);
    m.box(1.5, 1.5, 0.05, 2.2, 0.06, 0.004, "team");
    m.box(1.5, 1.5, 0.05, 0.06, 2.2, 0.004, "team");
    for (const y of [0.25, 2.75]) {
      m.box(0.25, y, 0.05, 0.14, 0.14, 0.6, DI);
      m.box(2.75, y, 0.05, 0.14, 0.14, 0.6, DI);
    }
    m.box(1.5, 0.25, 0.6, 2.6, 0.14, 0.09, DR);
    m.box(1.5, 0.3, 0.42, 0.2, 0.14, 0.18, DD);
    light(m, 0.25, 0.25, 0.65, "!#7cff7c");
    return { body: m, height: 0.8 };
  },
  d_lab() {
    const m = new Model();
    slab(m, 3, 3, "#8a877d");
    m.taper(1.5, 1.5, 0.06, 2.5, 2.5, 0.42, 2.2, 2.2, DC);
    m.box(1.5, 1.5, 0.48, 2.22, 2.22, 0.05, "team");
    m.dome(1.5, 1.5, 0.53, 0.85, "#5e6a63", 12, 4, 0.6);
    for (const [x, y] of [
      [0.5, 0.5],
      [2.5, 0.5],
      [0.5, 2.5],
    ]) {
      m.box(x, y, 0.53, 0.03, 0.03, 0.55, DD);
      m.sphere(x, y, 1.1, 0.04, DGLOW, 6, 4);
    }
    return { body: m, height: 1.2 };
  },
  d_reactor() {
    const m = new Model();
    slab(m, 3, 3, "#8a877d");
    m.cyl(0.95, 0.95, 0.06, 0.68, 0.6, DC, 14, 0.46);
    m.cyl(0.95, 0.95, 0.66, 0.46, 0.32, DC, 14, 0.54);
    m.cyl(0.95, 0.95, 0.98, 0.54, 0.02, "#333", 14, 0.5);
    m.cyl(2.15, 2.05, 0.06, 0.5, 0.45, DC, 12, 0.34);
    m.cyl(2.15, 2.05, 0.51, 0.34, 0.24, DC, 12, 0.4);
    m.box(2.2, 0.8, 0.06, 1.0, 0.9, 0.4, DI);
    m.box(2.2, 0.8, 0.46, 1.02, 0.92, 0.05, "team");
    m.cyl(2.2, 0.8, 0.51, 0.25, 0.1, "!#9cff6a", 10);
    m.box(0.9, 2.3, 0.06, 0.8, 0.6, 0.25, "team");
    return { body: m, height: 1.1 };
  },
  d_sentry() {
    const m = new Model();
    m.box(0.5, 0.5, 0, 0.72, 0.72, 0.12, DC, "#a7a296");
    const t = new Model();
    t.cyl(0, 0, 0, 0.2, 0.12, DI, 8, 0.16);
    t.cyl(0, 0, 0.04, 0.205, 0.03, "team", 8);
    t.barrel(0.12, 0, 0.07, 0.24, 0.024, DD);
    return { body: m, turret: t, pivot: [0.5, 0.5, 0.12], tip: [0.36, 0, 0.07], height: 0.32 };
  },
  d_flakbat() {
    const m = new Model();
    m.cyl(0.5, 0.5, 0, 0.42, 0.12, DC, 8, 0.4);
    const t = new Model();
    t.box(0, 0, 0, 0.28, 0.3, 0.14, DI);
    t.box(-0.05, 0, 0.14, 0.12, 0.3, 0.02, "team");
    for (const y of [-0.08, 0.08]) t.tube(0.06, y, 0.1, 1, 0, 1, 0.3, 0.024, DD, 5);
    return { body: m, turret: t, pivot: [0.5, 0.5, 0.12], tip: [0.27, 0, 0.31], height: 0.5 };
  },
  d_coil() {
    const m = new Model();
    m.box(0.5, 0.5, 0, 0.82, 0.82, 0.1, DC, "#a7a296");
    m.box(0.5, 0.5, 0.1, 0.6, 0.6, 0.04, "team");
    m.cyl(0.5, 0.5, 0.14, 0.13, 0.82, DI, 8, 0.1);
    for (let k = 0; k < 5; k++) m.cyl(0.5, 0.5, 0.26 + k * 0.14, 0.3 - k * 0.04, 0.045, COPPER, 10);
    m.sphere(0.5, 0.5, 1.06, 0.13, "!#9fd8ff", 8, 5);
    return { body: m, height: 1.2, tip: [0.5, 0.5, 1.06] };
  },
  d_wall() {
    const m = new Model();
    m.box(0.5, 0.5, 0, 0.92, 0.92, 0.32, "#8f8a7f", "#a59f93");
    m.box(0.5, 0.5, 0.32, 0.5, 0.5, 0.02, "team");
    return { body: m, height: 0.35 };
  },
  d_silo() {
    const m = new Model();
    slab(m, 3, 3, "#8a877d");
    m.box(1.75, 1.6, 0.06, 1.7, 1.6, 0.08, DD);
    m.box(1.35, 1.6, 0.14, 0.76, 1.4, 0.04, DI);
    m.box(2.15, 1.6, 0.14, 0.76, 1.4, 0.04, DI);
    for (let i = 0; i < 5; i++) m.box(1.75, 0.95 + i * 0.32, 0.18, 0.06, 0.12, 0.005, i % 2 ? HAZ : BLACK);
    m.box(0.5, 0.55, 0.06, 0.75, 0.8, 0.42, DC);
    m.box(0.5, 0.55, 0.48, 0.77, 0.82, 0.05, "team");
    light(m, 0.9, 2.6, 0.08, "!#ff4030");
    light(m, 2.6, 2.6, 0.08, "!#ff4030");
    return { body: m, height: 0.6 };
  },
  d_bulwark() {
    const m = new Model();
    slab(m, 3, 3, "#8a877d");
    m.cyl(1.5, 1.5, 0.06, 0.5, 0.55, DI, 12, 0.4);
    m.tube(1.5, 1.5, 0.6, 0, 0, 1, 0.36, 0.3, "team", 14, 0.95);
    m.sphere(1.5, 1.5, 0.98, 0.16, "!#ffd94a", 10, 6);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const x = 1.5 + Math.cos(a) * 1.15,
        y = 1.5 + Math.sin(a) * 1.15;
      m.box(x, y, 0.06, 0.16, 0.16, 0.6, DC);
      m.box(x, y, 0.66, 0.1, 0.1, 0.06, DGLOW);
    }
    return { body: m, height: 1.2 };
  },
  fuelwell() {
    const m = new Model();
    m.box(1, 1, 0, 1.85, 1.85, 0.04, "#7b6a52");
    m.cyl(1.45, 0.5, 0.04, 0.3, 0.42, "#7a3a2a", 10);
    m.cyl(1.45, 0.5, 0.46, 0.31, 0.03, "team", 10);
    m.box(0.75, 1.05, 0.04, 0.24, 0.12, 0.06, DD);
    m.path3([[0.65, 1.0, 0.04], [0.75, 1.0, 0.5], [0.85, 1.0, 0.04]], 0.02, "#5b5e52", 4);
    m.path3([[0.3, 1.0, 0.54], [1.3, 1.0, 0.46]], 0.035, "#4a4c44", 5);
    m.box(1.3, 1.0, 0.36, 0.08, 0.1, 0.2, "#3a3c36");
    m.path3([[0.3, 1.0, 0.5], [0.3, 1.0, 0.1]], 0.015, "#222", 4);
    m.box(0.35, 1.0, 0.04, 0.12, 0.12, 0.1, "#3a3c36");
    m.box(1.65, 1.6, 0.04, 0.02, 0.02, 0.5, "#444");
    m.box(1.65, 1.53, 0.42, 0.01, 0.13, 0.08, "team");
    return { body: m, height: 0.7 };
  },
};

export function unitModel(type: string): UnitModel {
  const b = unitBuilders[type];
  if (b) return b();
  // fallback box
  const m = new Model().box(0, 0, 0, 0.5, 0.3, 0.2, "team");
  return { body: m, tip: [0.25, 0, 0.1], shadow: [0.3, 0.2] };
}

export function structModel(type: string): StructModel {
  const b = structBuilders[type];
  if (b) return b();
  return { body: new Model().box(0.5, 0.5, 0, 0.9, 0.9, 0.4, "team"), height: 0.4 };
}

// ───────────────────────────── props ─────────────────────────────

export function treeModel(v: number): Model {
  const m = new Model();
  const greens = ["#2f6b2a", "#3a7d33", "#4a8a3a", "#2d5f34", "#56913d"];
  const g1 = greens[v % greens.length],
    g2 = greens[(v + 2) % greens.length];
  const ox = ((v * 37) % 20) / 100 - 0.1,
    oy = ((v * 53) % 20) / 100 - 0.1;
  if (v % 3 === 0) {
    m.cyl(ox, oy, 0, 0.035, 0.14, "#5a3d22", 6);
    m.cyl(ox, oy, 0.1, 0.22, 0.3, g1, 8, 0);
    m.cyl(ox, oy, 0.28, 0.16, 0.28, g2, 8, 0);
  } else if (v % 3 === 1) {
    m.cyl(ox, oy, 0, 0.04, 0.2, "#5a3d22", 6);
    m.sphere(ox, oy, 0.36, 0.2, g1, 8, 5);
    m.sphere(ox + 0.1, oy - 0.05, 0.3, 0.13, g2, 7, 4);
  } else {
    m.cyl(ox, oy, 0, 0.03, 0.12, "#5a3d22", 6);
    m.cyl(ox, oy, 0.08, 0.17, 0.42, g1, 7, 0);
    m.cyl(ox + 0.18, oy + 0.1, 0, 0.025, 0.1, "#5a3d22", 5);
    m.cyl(ox + 0.18, oy + 0.1, 0.06, 0.12, 0.28, g2, 7, 0);
  }
  return m;
}

export function rockModel(v: number): Model {
  const m = new Model();
  const cols = ["#8b8a83", "#7a7973", "#96948b"];
  const n = 2 + (v % 3);
  for (let i = 0; i < n; i++) {
    const a = (i * 2.3 + v) % 6.28;
    const r = 0.12 + ((v + i * 7) % 5) * 0.02;
    m.boxR(0.5 + Math.cos(a) * 0.18, 0.5 + Math.sin(a) * 0.18, 0, r * 2, r * 1.6, r * (1.2 + ((v + i) % 3) * 0.3), a, cols[(v + i) % 3]);
  }
  m.taper(0.5, 0.5, 0, 0.6, 0.55, 0.32 + (v % 4) * 0.04, 0.3, 0.28, cols[v % 3], "#a3a198");
  return m;
}

export function oreModel(gem: boolean, level: number, v: number): Model {
  const m = new Model();
  const cols = gem ? ["!#5ee6ff", "#3aa6e0", "!#c77dff"] : ["#e2b52e", "#c99a1f", "!#ffd65a"];
  const n = 1 + level * 2;
  for (let i = 0; i < n; i++) {
    const a = i * 2.39996 + v;
    const rr = 0.08 + ((i * 0.37 + v * 0.13) % 0.3);
    const x = 0.5 + Math.cos(a) * rr,
      y = 0.5 + Math.sin(a) * rr;
    const h = 0.05 + ((i * 13 + v * 7) % 7) * 0.012 + level * 0.01;
    m.cyl(x, y, 0, 0.035 + level * 0.006, h, cols[(i + v) % 3], 5, 0);
  }
  return m;
}
