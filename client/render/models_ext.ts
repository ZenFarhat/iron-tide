// Procedural models for the expansion: the Syndicate, every faction's navy, and wildlife.
// Same conventions as models.ts — units face +x with z up (cells); structures span [0,w]×[0,h]
// from the footprint's top corner. Ships sit with their waterline at z = 0.
import { Model, type Col } from "./model3d";
import type { StructModel, UnitModel } from "./models";

// Syndicate palette: weathered hull green, rust, brass and canvas, with a sonic green glow
const SH = "#56625c",
  SD = "#2f3833",
  SR = "#8f5634",
  SB = "#b8924a",
  SC = "#b5a688",
  SK = "#1d2120",
  SGLOW = "!#7dffcf",
  SLAMP = "!#ffb35a";
// Concord / Dominion palettes (as in models.ts)
const CW = "#d6dbe1",
  CS = "#8c98a5",
  CD = "#545e69",
  CGLOW = "!#8ff7ff",
  GLASS = "#5ea7d6";
const DI = "#6c6e61",
  DD = "#3e403a",
  DC = "#9b968b",
  DR = "#81442a";
const BLACK = "#1c1d20",
  HAZ = "#d9b43a",
  WATERLINE = "#2a2c2e";

function slab(m: Model, w: number, h: number, col: Col, top?: Col, z = 0.06) {
  m.box(w / 2, h / 2, 0, w - 0.1, h - 0.1, z, col, top);
}
function light(m: Model, x: number, y: number, z: number, c: Col = SLAMP) {
  m.box(x, y, z, 0.05, 0.05, 0.05, c);
}

// ───────────────────────────── hovercraft ─────────────────────────────

/** rubber skirt the craft rides on */
function skirt(m: Model, len: number, wid: number, h = 0.07) {
  m.taper(0, 0, 0, len, wid, h, len * 0.94, wid * 0.92, SK, "#2a2f2d");
}
/** ducted lift fans at the stern */
function fans(m: Model, x: number, ys: number[], z: number, r: number) {
  for (const y of ys) {
    m.tube(x, y, z, -1, 0, 0, 0.06, r, SD, 10);
    m.cyl(x - 0.03, y, z - r, 0.012, r * 2, "#4a524e", 4);
  }
}

// ───────────────────────────── ships ─────────────────────────────

/** an extruded hull with a pointed bow */
function hull(m: Model, len: number, wid: number, h: number, col: Col, deck: Col, bow = 0.9) {
  const b = wid * bow;
  const pts: [number, number][] = [
    [-len / 2, -wid / 2],
    [len / 2 - b, -wid / 2],
    [len / 2, 0],
    [len / 2 - b, wid / 2],
    [-len / 2, wid / 2],
  ];
  m.plate(pts, -0.02, WATERLINE, 0.03);
  m.plate(pts, 0.01, col, h - 0.01);
  const inset = 0.04;
  m.plate(
    [
      [-len / 2 + inset, -wid / 2 + inset],
      [len / 2 - b, -wid / 2 + inset],
      [len / 2 - inset * 2, 0],
      [len / 2 - b, wid / 2 - inset],
      [-len / 2 + inset, wid / 2 - inset],
    ],
    h,
    deck,
    0.006,
  );
}

const unitBuilders: Record<string, () => UnitModel> = {
  // ── Syndicate hovercraft ──
  s_skiff() {
    const b = new Model();
    skirt(b, 0.62, 0.34, 0.06);
    b.taper(0, 0, 0.06, 0.56, 0.28, 0.08, 0.42, 0.22, "team");
    b.wedge(0.2, 0, 0.14, 0.14, 0.2, 0.05, 0.0, SH);
    b.box(-0.08, 0, 0.14, 0.18, 0.16, 0.06, SD);
    fans(b, -0.26, [0], 0.16, 0.07);
    light(b, 0.27, 0.08, 0.1);
    light(b, 0.27, -0.08, 0.1);
    const t = new Model();
    t.cyl(0, 0, 0, 0.06, 0.04, SD, 8);
    for (const y of [-0.03, 0.03]) t.barrel(0.03, y, 0.04, 0.16, 0.012, BLACK, 5);
    t.box(-0.02, 0, 0.04, 0.06, 0.1, 0.05, SB);
    return { body: b, turret: t, pivot: [0.04, 0, 0.14], tip: [0.19, 0, 0.04], shadow: [0.36, 0.22] };
  },
  s_corsair() {
    const b = new Model();
    skirt(b, 0.82, 0.46);
    b.taper(0, 0, 0.07, 0.76, 0.4, 0.11, 0.6, 0.32, "team");
    b.wedge(0.32, 0, 0.18, 0.12, 0.3, 0.04, 0.0, SH);
    b.box(-0.24, 0, 0.18, 0.18, 0.34, 0.04, SD);
    fans(b, -0.36, [-0.11, 0.11], 0.2, 0.08);
    b.box(0.0, 0.17, 0.12, 0.3, 0.02, 0.04, SR);
    b.box(0.0, -0.17, 0.12, 0.3, 0.02, 0.04, SR);
    const t = new Model();
    t.taper(0, 0, 0, 0.3, 0.24, 0.09, 0.22, 0.18, SH);
    t.box(-0.04, 0, 0.09, 0.14, 0.14, 0.03, "team");
    t.barrel(0.13, 0, 0.05, 0.38, 0.022, SD);
    t.barrel(0.44, 0, 0.05, 0.05, 0.03, SB);
    return { body: b, turret: t, pivot: [-0.02, 0, 0.18], tip: [0.5, 0, 0.05], shadow: [0.46, 0.3] };
  },
  s_howler() {
    const b = new Model();
    skirt(b, 0.74, 0.42);
    b.taper(0, 0, 0.07, 0.68, 0.36, 0.1, 0.56, 0.3, "team");
    b.box(0.2, 0, 0.17, 0.16, 0.26, 0.08, SH);
    fans(b, -0.32, [-0.1, 0.1], 0.18, 0.07);
    // sonic projector: a tilted dish ringed with emitters
    b.tube(-0.06, 0, 0.17, 0.5, 0, 1, 0.16, 0.05, SD, 8);
    b.tube(0.0, 0, 0.3, 0.6, 0, 0.8, 0.05, 0.15, SB, 14, 0.18);
    b.tube(0.03, 0, 0.34, 0.6, 0, 0.8, 0.02, 0.12, SGLOW, 14);
    b.sphere(0.06, 0, 0.37, 0.04, SGLOW, 8, 5);
    return { body: b, tip: [0.08, 0, 0.4], shadow: [0.42, 0.28] };
  },
  s_leviathan() {
    const b = new Model();
    skirt(b, 1.08, 0.62, 0.09);
    b.taper(0, 0, 0.09, 1.0, 0.56, 0.14, 0.82, 0.46, "team");
    b.box(-0.18, 0, 0.23, 0.4, 0.4, 0.1, SH, "#66746c");
    b.box(0.32, 0, 0.23, 0.18, 0.36, 0.05, SD);
    fans(b, -0.5, [-0.17, 0, 0.17], 0.26, 0.09);
    for (const y of [-0.22, 0.22]) {
      b.cyl(-0.3, y, 0.33, 0.05, 0.06, SD, 8);
      b.barrel(-0.27, y, 0.38, 0.1, 0.012, BLACK, 5);
      b.barrel(-0.27, y + 0.025, 0.38, 0.1, 0.012, BLACK, 5);
    }
    light(b, 0.48, 0.2, 0.16);
    light(b, 0.48, -0.2, 0.16);
    const t = new Model();
    t.taper(0, 0, 0, 0.42, 0.34, 0.12, 0.3, 0.26, SH);
    t.box(-0.06, 0, 0.12, 0.18, 0.2, 0.03, "team");
    for (const y of [-0.06, 0.06]) {
      t.barrel(0.18, y, 0.07, 0.42, 0.028, SD);
      t.barrel(0.56, y, 0.07, 0.06, 0.036, SB);
    }
    return { body: b, turret: t, pivot: [0.08, 0, 0.33], tip: [0.62, 0, 0.07], shadow: [0.6, 0.38] };
  },
  s_harv() {
    const b = new Model();
    skirt(b, 0.9, 0.5);
    b.box(-0.08, 0, 0.07, 0.6, 0.44, 0.18, "team");
    b.box(0.3, -0.12, 0.07, 0.18, 0.18, 0.22, SH);
    b.box(0.392, -0.12, 0.2, 0.012, 0.14, 0.06, GLASS);
    b.taper(-0.1, 0, 0.25, 0.48, 0.38, 0.08, 0.42, 0.32, SR);
    fans(b, -0.42, [-0.12, 0.12], 0.18, 0.08);
    // salvage crane arm
    b.path3([[0.22, 0.12, 0.25], [0.3, 0.12, 0.42], [0.44, 0.12, 0.38]], 0.018, SB, 5);
    b.box(0.44, 0.12, 0.3, 0.05, 0.05, 0.06, SD);
    return { body: b, tip: [0.4, 0, 0.1], shadow: [0.5, 0.32] };
  },

  // ── Concord navy ──
  c_cutter() {
    const b = new Model();
    hull(b, 0.78, 0.26, 0.1, "team", "#c3cad1");
    b.box(-0.02, 0, 0.1, 0.22, 0.17, 0.09, CW);
    b.box(0.08, 0, 0.14, 0.02, 0.15, 0.04, GLASS);
    b.box(-0.24, 0, 0.1, 0.14, 0.18, 0.06, CS);
    b.cyl(-0.05, 0, 0.19, 0.012, 0.12, CD, 4);
    const t = new Model();
    t.cyl(0, 0, 0, 0.05, 0.04, CD, 8);
    t.barrel(0.03, 0, 0.03, 0.12, 0.012, BLACK, 5);
    t.box(-0.03, 0.05, 0.03, 0.08, 0.05, 0.05, CS);
    return { body: b, turret: t, pivot: [0.2, 0, 0.1], tip: [0.15, 0, 0.03], shadow: [0.44, 0.18] };
  },
  c_frigate() {
    const b = new Model();
    hull(b, 1.06, 0.34, 0.12, "team", "#c3cad1");
    b.box(-0.12, 0, 0.12, 0.34, 0.24, 0.12, CW, "#e6eaee");
    b.box(-0.06, 0, 0.24, 0.16, 0.16, 0.08, CS);
    b.box(0.02, 0, 0.27, 0.02, 0.14, 0.04, GLASS);
    b.cyl(-0.12, 0, 0.32, 0.015, 0.16, CD, 4);
    b.sphere(-0.12, 0, 0.5, 0.03, CGLOW, 6, 4);
    b.box(-0.4, 0, 0.12, 0.12, 0.2, 0.05, CS);
    const t = new Model();
    t.cyl(0, 0, 0, 0.08, 0.06, CS, 10);
    t.tube(0, 0, 0.08, 1, 0, 0.25, 0.18, 0.05, CW, 8, 0.035);
    t.sphere(0.18, 0, 0.12, 0.035, "!#c6fbff", 8, 5);
    return { body: b, turret: t, pivot: [0.28, 0, 0.12], tip: [0.2, 0, 0.12], shadow: [0.58, 0.22] };
  },
  c_cruiser() {
    const b = new Model();
    hull(b, 1.42, 0.44, 0.14, "team", "#c3cad1");
    b.box(-0.2, 0, 0.14, 0.5, 0.32, 0.14, CW, "#e6eaee");
    b.box(-0.14, 0, 0.28, 0.26, 0.22, 0.1, CS);
    b.box(-0.02, 0, 0.32, 0.02, 0.18, 0.05, GLASS);
    b.cyl(-0.22, 0, 0.38, 0.018, 0.22, CD, 4);
    b.dome(-0.22, 0, 0.6, 0.05, "#7fb6dd", 8, 3);
    b.box(-0.56, 0, 0.14, 0.16, 0.26, 0.06, CS);
    light(b, 0.55, 0, 0.16, CGLOW);
    const t = new Model();
    t.cyl(0, 0, 0, 0.11, 0.07, CS, 12);
    t.box(0, 0, 0.07, 0.18, 0.14, 0.06, CW);
    t.tube(0.06, 0, 0.1, 1, 0, 0.12, 0.34, 0.035, CW, 8, 0.03);
    t.tube(0.36, 0, 0.14, 1, 0, 0.12, 0.05, 0.05, CD, 8);
    t.sphere(0.42, 0, 0.15, 0.03, "!#c6fbff", 8, 5);
    return { body: b, turret: t, pivot: [0.36, 0, 0.14], tip: [0.44, 0, 0.15], shadow: [0.76, 0.28] };
  },

  // ── Dominion navy ──
  d_gunboat() {
    const b = new Model();
    hull(b, 0.82, 0.3, 0.1, "team", DC, 0.6);
    b.box(-0.08, 0, 0.1, 0.22, 0.2, 0.1, DI);
    b.box(0.03, 0, 0.15, 0.012, 0.16, 0.04, "#6b8ca0");
    b.box(-0.28, 0, 0.1, 0.12, 0.2, 0.05, DD);
    b.cyl(-0.12, 0.06, 0.2, 0.02, 0.1, DD, 6);
    const t = new Model();
    t.cyl(0, 0, 0, 0.07, 0.05, DD, 8);
    t.box(0, 0, 0.05, 0.1, 0.1, 0.05, "team");
    t.tube(0.02, 0.025, 0.08, 1, 0, 0.8, 0.16, 0.014, DD, 5);
    t.tube(0.02, -0.025, 0.08, 1, 0, 0.8, 0.16, 0.014, DD, 5);
    return { body: b, turret: t, pivot: [0.2, 0, 0.1], tip: [0.12, 0, 0.18], shadow: [0.46, 0.2] };
  },
  d_monitor() {
    const b = new Model();
    hull(b, 1.08, 0.42, 0.09, "team", DC, 0.5);
    b.taper(-0.06, 0, 0.09, 0.8, 0.36, 0.06, 0.7, 0.3, DI);
    b.box(-0.34, 0, 0.15, 0.2, 0.22, 0.1, DD);
    b.cyl(-0.38, 0.06, 0.25, 0.025, 0.12, DD, 6);
    b.cyl(-0.38, -0.06, 0.25, 0.025, 0.12, DD, 6);
    const t = new Model();
    t.cyl(0, 0, 0, 0.13, 0.1, "team", 12, 0.11);
    t.box(-0.08, 0, 0.1, 0.08, 0.12, 0.03, DI);
    for (const y of [-0.05, 0.05]) {
      t.barrel(0.12, y, 0.05, 0.34, 0.028, DD);
      t.barrel(0.44, y, 0.05, 0.05, 0.036, DD);
    }
    return { body: b, turret: t, pivot: [0.16, 0, 0.15], tip: [0.5, 0, 0.05], shadow: [0.58, 0.26] };
  },
  d_barge() {
    const b = new Model();
    const pts: [number, number][] = [
      [-0.55, -0.24],
      [0.46, -0.24],
      [0.55, -0.14],
      [0.55, 0.14],
      [0.46, 0.24],
      [-0.55, 0.24],
    ];
    b.plate(pts, -0.02, WATERLINE, 0.03);
    b.plate(pts, 0.01, "team", 0.08);
    b.box(-0.4, 0, 0.09, 0.16, 0.3, 0.12, DI);
    b.box(-0.33, 0, 0.17, 0.012, 0.22, 0.04, "#6b8ca0");
    // tilted rocket rack
    b.tube(-0.18, 0, 0.12, 1, 0, 0.5, 0.52, 0.03, DD, 5);
    for (const y of [-0.12, 0, 0.12]) b.tube(-0.1, y, 0.16, 1, 0, 0.5, 0.48, 0.045, "#cfc8b4", 8);
    for (const y of [-0.12, 0, 0.12]) b.tube(0.33, y, 0.37, 1, 0, 0.5, 0.06, 0.045, DR, 8, 0);
    return { body: b, tip: [0.36, 0, 0.4], shadow: [0.6, 0.3] };
  },

  // ── Syndicate navy ──
  s_runner() {
    const b = new Model();
    hull(b, 0.86, 0.26, 0.09, "team", SC, 1.2);
    b.wedge(0.06, 0, 0.09, 0.18, 0.2, 0.08, 0.02, SH);
    b.box(0.1, 0, 0.13, 0.012, 0.16, 0.035, GLASS);
    b.box(-0.3, 0, 0.09, 0.14, 0.2, 0.06, SD);
    b.box(-0.37, 0.07, 0.08, 0.04, 0.05, 0.06, SB);
    b.box(-0.37, -0.07, 0.08, 0.04, 0.05, 0.06, SB);
    const t = new Model();
    t.cyl(0, 0, 0, 0.05, 0.04, SD, 8);
    for (const y of [-0.03, 0.03]) {
      t.barrel(0.02, y, 0.05, 0.18, 0.016, SH);
      t.barrel(0.2, y, 0.05, 0.03, 0.022, SR);
    }
    return { body: b, turret: t, pivot: [-0.12, 0, 0.09], tip: [0.24, 0, 0.05], shadow: [0.48, 0.18] };
  },
  s_galleon() {
    const b = new Model();
    hull(b, 1.3, 0.42, 0.15, "team", "#8a6e4a", 0.7);
    b.box(-0.48, 0, 0.15, 0.24, 0.36, 0.14, SR, "#a46a40");
    b.box(-0.4, 0, 0.29, 0.1, 0.3, 0.05, SD);
    // two masts carrying patched canvas sails
    for (const [x, h] of [
      [0.22, 0.5],
      [-0.12, 0.6],
    ] as [number, number][]) {
      b.cyl(x, 0, 0.15, 0.016, h, "#5a4128", 5);
      b.box(x + 0.01, 0, 0.15 + h * 0.4, 0.02, 0.34, h * 0.5, SC);
      b.box(x + 0.012, 0.06, 0.15 + h * 0.55, 0.02, 0.08, 0.06, SR);
    }
    // sonic broadside dishes
    for (const y of [-0.2, 0.2]) {
      b.tube(0.04, y, 0.2, 0, y > 0 ? 1 : -1, 0.6, 0.04, 0.08, SB, 12, 0.1);
      b.sphere(0.04, y * 1.2, 0.23, 0.03, SGLOW, 6, 4);
    }
    light(b, 0.6, 0, 0.18);
    return { body: b, tip: [0.04, 0.22, 0.25], shadow: [0.7, 0.3] };
  },
};

// ───────────────────────────── structures ─────────────────────────────

/** a floating dock for shipyards: pontoons, slipway and a gantry crane */
function dock(m: Model, deck: Col, frame: Col, dark: Col, accent: Col, lamp: Col) {
  for (const y of [0.35, 2.65]) m.box(1.5, y, -0.02, 2.9, 0.5, 0.12, frame, deck);
  m.box(0.35, 1.5, -0.02, 0.5, 1.9, 0.12, frame, deck);
  // slipway water left open between the pontoons
  m.box(1.75, 1.5, -0.02, 2.2, 1.7, 0.02, "#244a5c");
  for (const x of [0.9, 2.6]) {
    m.box(x, 0.35, 0.1, 0.1, 0.1, 0.62, dark);
    m.box(x, 2.65, 0.1, 0.1, 0.1, 0.62, dark);
  }
  m.box(0.9, 1.5, 0.72, 0.14, 2.4, 0.08, accent);
  m.box(2.6, 1.5, 0.72, 0.14, 2.4, 0.08, accent);
  m.box(1.75, 1.5, 0.8, 1.84, 0.12, 0.06, "team");
  m.box(1.75, 1.5, 0.7, 0.16, 0.16, 0.1, dark);
  m.path3([[1.75, 1.5, 0.7], [1.75, 1.5, 0.4]], 0.01, BLACK, 4);
  m.box(0.4, 0.5, 0.1, 0.5, 0.5, 0.3, deck, "team");
  light(m, 2.9, 0.15, 0.12, lamp);
  light(m, 2.9, 2.85, 0.12, lamp);
}

const structBuilders: Record<string, () => StructModel> = {
  c_navyard() {
    const m = new Model();
    dock(m, CS, "#a8b2bc", CD, CW, CGLOW);
    return { body: m, height: 0.9 };
  },
  d_navyard() {
    const m = new Model();
    dock(m, DC, "#8f8a7f", DD, DI, "!#ffb04a");
    return { body: m, height: 0.9 };
  },
  s_navyard() {
    const m = new Model();
    dock(m, "#8a6e4a", SH, SD, SR, SLAMP);
    m.box(0.4, 2.2, 0.1, 0.3, 0.3, 0.2, SB);
    return { body: m, height: 0.9 };
  },

  s_hub() {
    const m = new Model();
    slab(m, 3, 3, "#6c6a60", "#7c7a70", 0.07);
    // corrugated command warehouse with a canvas awning
    m.box(1.3, 1.3, 0.07, 1.9, 1.7, 0.46, SH, "#66746c");
    m.taper(1.3, 1.3, 0.53, 1.96, 1.76, 0.16, 1.96, 0.3, "team");
    m.box(1.3, 2.17, 0.07, 0.8, 0.02, 0.32, SD);
    m.box(1.3, 2.3, 0.4, 1.0, 0.3, 0.02, SC);
    // salvage crane
    m.box(2.55, 0.5, 0.07, 0.14, 0.14, 1.0, SR);
    m.path3([[2.55, 0.5, 1.07], [1.7, 0.5, 1.12]], 0.035, SB, 5);
    m.path3([[1.75, 0.5, 1.1], [1.75, 0.5, 0.75]], 0.008, BLACK, 4);
    m.box(1.75, 0.5, 0.68, 0.1, 0.1, 0.08, SD);
    m.box(0.5, 2.4, 0.07, 0.42, 0.36, 0.22, SR, "#a46a40");
    m.box(0.5, 0.5, 0.07, 0.04, 0.04, 0.8, SD);
    m.box(0.5, 0.42, 0.72, 0.02, 0.16, 0.12, "team");
    light(m, 2.2, 2.2, 0.5);
    light(m, 0.3, 1.5, 0.3);
    return { body: m, height: 1.2 };
  },
  s_power() {
    const m = new Model();
    slab(m, 2, 2, "#6c6a60");
    // tidal turbine housing with exposed rotor and intake pipes
    m.cyl(1, 1, 0.06, 0.48, 0.34, SH, 14, 0.44);
    m.cyl(1, 1, 0.4, 0.45, 0.04, "team", 14);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      m.boxR(1 + Math.cos(a) * 0.2, 1 + Math.sin(a) * 0.2, 0.44, 0.36, 0.07, 0.02, a, SB);
    }
    m.cyl(1, 1, 0.44, 0.07, 0.08, SD, 8);
    m.sphere(1, 1, 0.55, 0.05, SGLOW, 8, 5);
    m.tube(0.2, 0.25, 0.12, 1, 0, 0, 0.5, 0.06, SR, 8);
    m.tube(0.2, 1.75, 0.12, 1, 0, 0, 0.5, 0.06, SR, 8);
    return { body: m, height: 0.7 };
  },
  s_barracks() {
    const m = new Model();
    slab(m, 2, 2, "#6c6a60");
    m.box(1, 0.9, 0.06, 1.4, 1.2, 0.3, SH);
    m.taper(1, 0.9, 0.36, 1.5, 1.3, 0.14, 1.5, 0.1, SC);
    m.box(1, 1.51, 0.06, 0.4, 0.02, 0.22, SD);
    for (const [x, y] of [
      [0.3, 1.75],
      [0.5, 1.8],
      [1.75, 0.3],
    ] as [number, number][])
      m.box(x, y, 0.06, 0.16, 0.16, 0.14, SR, "#a46a40");
    m.box(1.75, 1.72, 0.06, 0.02, 0.02, 0.6, SD);
    m.box(1.75, 1.64, 0.5, 0.01, 0.16, 0.1, "team");
    light(m, 1.5, 1.52, 0.3);
    return { body: m, height: 0.7 };
  },
  s_refinery() {
    const m = new Model();
    slab(m, 3, 3, "#6c6a60");
    for (const [x, y, r, h] of [
      [0.6, 0.6, 0.38, 0.8],
      [0.6, 1.5, 0.32, 0.6],
    ] as [number, number, number, number][]) {
      m.cyl(x, y, 0.06, r, h, SH, 12);
      m.cyl(x, y, 0.06 + h, r, 0.06, SR, 12, r * 0.7);
    }
    m.box(2.0, 1.15, 0.06, 1.4, 1.5, 0.46, SH, "#66746c");
    m.box(2.0, 1.15, 0.4, 1.42, 1.52, 0.05, "team");
    m.box(2.0, 1.92, 0.06, 0.6, 0.02, 0.3, SD);
    m.box(1.5, 2.55, 0.06, 0.8, 0.7, 0.04, SD);
    m.box(1.5, 2.3, 0.06, 0.12, 0.12, 0.42, SD);
    m.box(1.5, 2.55, 0.44, 0.12, 0.6, 0.07, HAZ);
    m.tube(1.0, 0.6, 0.5, 1, 0.4, 0, 0.6, 0.05, SB, 6);
    light(m, 2.65, 0.5, 0.56);
    return { body: m, height: 1.0 };
  },
  s_factory() {
    const m = new Model();
    slab(m, 3, 3, "#6c6a60");
    // hangar under a canvas gable roof
    m.box(1.5, 1.25, 0.06, 2.5, 2.1, 0.42, SH);
    m.taper(1.5, 1.25, 0.48, 2.56, 2.16, 0.34, 2.56, 0.36, SC);
    m.box(1.5, 1.25, 0.82, 2.6, 0.14, 0.04, "team");
    m.box(1.5, 2.31, 0.06, 1.2, 0.02, 0.38, SD);
    m.box(1.5, 2.32, 0.44, 1.3, 0.02, 0.05, HAZ);
    for (const x of [0.6, 2.4]) {
      m.tube(x, 0.5, 0.5, 0, 0, 1, 0.12, 0.14, SD, 12);
      m.cyl(x, 0.5, 0.6, 0.12, 0.02, SB, 12);
    }
    light(m, 0.25, 2.3, 0.5);
    light(m, 2.75, 2.3, 0.5);
    return { body: m, height: 1.0 };
  },
  s_radar() {
    const m = new Model();
    slab(m, 2, 2, "#6c6a60");
    m.box(1, 1, 0.06, 0.7, 0.7, 0.24, SH);
    // lattice spire
    m.taper(1, 1, 0.3, 0.3, 0.3, 0.8, 0.06, 0.06, SR);
    m.sphere(1, 1, 1.12, 0.04, "!#ff5050", 6, 4);
    m.box(1.6, 0.4, 0.06, 0.3, 0.3, 0.18, SR, "#a46a40");
    const t = new Model();
    t.box(0, 0, 0, 0.04, 0.04, 0.1, SD);
    t.tube(0, 0, 0.1, 1, 0, 0.3, 0.3, 0.02, SB, 6);
    t.tube(0.0, 0, 0.12, -1, 0, 0.3, 0.12, 0.13, SC, 10, 0.16);
    return { body: m, turret: t, pivot: [1, 1, 0.8], height: 1.2 };
  },
  s_depot() {
    const m = new Model();
    slab(m, 3, 3, "#6a6860", "#74726a", 0.05);
    m.box(1.5, 1.5, 0.05, 2.2, 0.06, 0.004, "team");
    m.box(1.5, 1.5, 0.05, 0.06, 2.2, 0.004, "team");
    m.box(1.5, 1.5, 0.05, 1.6, 1.6, 0.003, "#5c5a52");
    for (const [x, y] of [
      [0.25, 0.25],
      [2.75, 0.25],
    ] as [number, number][])
      m.box(x, y, 0.05, 0.12, 0.12, 0.65, SR);
    m.box(1.5, 0.25, 0.65, 2.6, 0.12, 0.08, SB);
    m.box(1.5, 0.25, 0.45, 0.12, 0.12, 0.2, SD);
    return { body: m, height: 0.8 };
  },
  s_lab() {
    const m = new Model();
    slab(m, 3, 3, "#555650");
    // black bunker with glowing specimen vats
    m.taper(1.4, 1.3, 0.06, 2.3, 2.1, 0.52, 1.9, 1.7, "#2a2e2c", "#353a37");
    m.box(1.4, 1.3, 0.58, 1.6, 1.4, 0.05, "team");
    for (const x of [0.75, 1.4, 2.05]) {
      m.cyl(x, 2.55, 0.06, 0.16, 0.38, "#1c2220", 10);
      m.cyl(x, 2.55, 0.1, 0.13, 0.3, SGLOW, 10);
      m.cyl(x, 2.55, 0.44, 0.17, 0.04, SB, 10);
    }
    m.box(2.6, 0.5, 0.06, 0.04, 0.04, 0.9, SD);
    m.sphere(2.6, 0.5, 0.98, 0.05, SGLOW, 8, 5);
    return { body: m, height: 1.0 };
  },
  s_gunnest() {
    const m = new Model();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      m.boxR(0.5 + Math.cos(a) * 0.33, 0.5 + Math.sin(a) * 0.33, 0, 0.18, 0.1, 0.14, a + Math.PI / 2, "#9e8a66", "#b09a74");
    }
    m.cyl(0.5, 0.5, 0, 0.26, 0.1, SD, 10);
    const t = new Model();
    t.cyl(0, 0, 0, 0.08, 0.05, SH, 8);
    t.box(0.02, 0, 0.05, 0.12, 0.1, 0.06, SR);
    t.barrel(0.08, 0, 0.08, 0.2, 0.014, BLACK, 5);
    return { body: m, turret: t, pivot: [0.5, 0.5, 0.1], tip: [0.28, 0, 0.08], height: 0.35 };
  },
  s_flaknest() {
    const m = new Model();
    m.cyl(0.5, 0.5, 0, 0.42, 0.12, "#6c6a60", 12, 0.38);
    m.cyl(0.5, 0.5, 0.12, 0.2, 0.08, SD, 10);
    const t = new Model();
    t.box(0, 0, 0, 0.2, 0.2, 0.1, SH);
    t.box(0, 0, 0.1, 0.2, 0.06, 0.01, "team");
    for (const y of [-0.06, 0.06]) t.tube(0.04, y, 0.08, 1, 0, 1, 0.3, 0.018, SD, 5);
    return { body: m, turret: t, pivot: [0.5, 0.5, 0.2], tip: [0.2, 0, 0.3], height: 0.45 };
  },
  s_pylon() {
    const m = new Model();
    m.cyl(0.5, 0.5, 0, 0.36, 0.08, "#6c6a60", 10, 0.32);
    m.cyl(0.5, 0.5, 0.08, 0.1, 0.9, SD, 8, 0.06);
    for (const z of [0.38, 0.62, 0.84]) {
      m.tube(0.5, 0.5, z, 0, 0, 1, 0.03, 0.2 - z * 0.1, SB, 14, 0.2 - z * 0.1);
      m.tube(0.5, 0.5, z + 0.03, 0, 0, 1, 0.01, 0.16 - z * 0.08, SGLOW, 14);
    }
    m.sphere(0.5, 0.5, 1.02, 0.08, SGLOW, 8, 5);
    m.box(0.5, 0.5, 0.1, 0.24, 0.24, 0.02, "team");
    return { body: m, height: 1.2, tip: [0.5, 0.5, 1.02] };
  },
  s_wall() {
    const m = new Model();
    m.box(0.5, 0.5, 0, 0.9, 0.9, 0.3, "#6d665a", "#7d766a");
    m.box(0.5, 0.5, 0.3, 0.92, 0.14, 0.04, SR);
    m.box(0.5, 0.5, 0.3, 0.14, 0.92, 0.04, SR);
    m.box(0.5, 0.5, 0.34, 0.3, 0.3, 0.02, "team");
    return { body: m, height: 0.35 };
  },
  s_barrage() {
    const m = new Model();
    slab(m, 3, 3, "#62605a");
    m.box(1.5, 1.5, 0.06, 2.3, 2.1, 0.14, SD);
    // battery of mortar tubes in three ranks
    for (let r = 0; r < 3; r++)
      for (let k = 0; k < 4; k++) {
        const x = 0.75 + k * 0.5,
          y = 0.9 + r * 0.55;
        m.tube(x, y, 0.2, 0.2, 0.2, 1, 0.42, 0.09, SH, 10);
        m.cyl(x + 0.06, y + 0.06, 0.6, 0.095, 0.03, SB, 10);
      }
    m.box(0.4, 2.6, 0.06, 0.5, 0.4, 0.3, SR, "#a46a40");
    m.box(0.4, 2.6, 0.36, 0.52, 0.42, 0.04, "team");
    light(m, 2.75, 2.75, 0.1, "!#ff4030");
    return { body: m, height: 0.9, tip: [1.5, 1.5, 0.7] };
  },
  s_blackout() {
    const m = new Model();
    slab(m, 3, 3, "#62605a");
    m.cyl(1.5, 1.5, 0.06, 0.6, 0.3, SH, 14, 0.5);
    m.cyl(1.5, 1.5, 0.36, 0.52, 0.04, "team", 14);
    m.cyl(1.5, 1.5, 0.4, 0.14, 0.7, SD, 10, 0.08);
    for (const z of [0.6, 0.78, 0.94]) m.tube(1.5, 1.5, z, 0, 0, 1, 0.04, 0.26 - (z - 0.6) * 0.3, SB, 14);
    m.sphere(1.5, 1.5, 1.18, 0.14, "!#b8a0ff", 10, 6);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      m.box(1.5 + Math.cos(a) * 1.1, 1.5 + Math.sin(a) * 1.1, 0.06, 0.14, 0.14, 0.5, SR);
    }
    return { body: m, height: 1.3, tip: [1.5, 1.5, 1.18] };
  },
};

// ───────────────────────────── wildlife ─────────────────────────────

/** four legs; diagonal pairs swing together while walking */
function legs(m: Model, xf: number, xb: number, ys: number, h: number, w: number, col: Col, walk: number, stride = 0.04) {
  for (const [x, y, ph] of [
    [xf, ys, 1],
    [xf, -ys, -1],
    [xb, ys, -1],
    [xb, -ys, 1],
  ])
    m.box(x + walk * stride * ph, y, 0, w, w, h, col);
}

interface Pose {
  walk: number; // −1..1 stride phase
  graze: boolean; // head down (idle)
  lunge: boolean; // striking
}

function pose(frame: number): Pose {
  return { walk: frame >= 1 && frame <= 4 ? Math.sin(((frame - 1) / 4) * Math.PI * 2) : 0, graze: frame === 6, lunge: frame === 5 };
}

const animalBuilders: Record<string, (p: Pose) => Model> = {
  a_zebra(p) {
    const m = new Model();
    const W = "#ece9e2",
      K = "#1e1e20";
    legs(m, 0.11, -0.11, 0.04, 0.17, 0.03, W, p.walk);
    m.box(0, 0, 0.16, 0.3, 0.12, 0.12, W);
    for (const x of [-0.11, -0.05, 0.01, 0.07]) m.box(x, 0, 0.165, 0.02, 0.125, 0.11, K);
    const hz = p.graze ? 0.08 : 0.32;
    m.path3([[0.12, 0, 0.24], [0.18, 0, hz + 0.02]], 0.035, W, 5);
    m.box(0.21, 0, hz - 0.02, 0.1, 0.05, 0.05, W);
    m.box(0.255, 0, hz - 0.03, 0.03, 0.045, 0.04, K);
    m.path3([[0.12, 0, 0.28], [0.17, 0, hz + 0.05]], 0.012, K, 4);
    m.tube(-0.15, 0, 0.24, -1, 0, -1.2, 0.12, 0.008, K, 4);
    return m;
  },
  a_giraffe(p) {
    const m = new Model();
    const T = "#d8a95a",
      B = "#7a4a22";
    legs(m, 0.09, -0.09, 0.04, 0.32, 0.025, T, p.walk, 0.05);
    m.taper(0, 0, 0.3, 0.26, 0.12, 0.1, 0.22, 0.1, T);
    for (const [x, y] of [
      [-0.06, 0.06],
      [0.04, -0.061],
      [0.02, 0.061],
      [-0.08, -0.061],
    ])
      m.box(x, y, 0.33, 0.05, 0.004, 0.05, B);
    const hz = p.graze ? 0.44 : 0.82;
    m.path3([[0.1, 0, 0.36], [0.17, 0, hz - 0.04]], 0.028, T, 6);
    for (const z of [0.5, 0.62, 0.74]) if (z < hz) m.box(0.135, 0, z, 0.04, 0.058, 0.03, B);
    m.box(0.21, 0, hz - 0.06, 0.1, 0.045, 0.05, T);
    m.box(0.16, 0.015, hz - 0.01, 0.01, 0.01, 0.04, B);
    m.box(0.16, -0.015, hz - 0.01, 0.01, 0.01, 0.04, B);
    m.tube(-0.13, 0, 0.36, -1, 0, -1, 0.12, 0.008, B, 4);
    return m;
  },
  a_elephant(p) {
    const m = new Model();
    const G = "#8d8a86",
      D = "#77746f";
    legs(m, 0.14, -0.14, 0.08, 0.22, 0.075, G, p.walk, 0.03);
    m.box(0, 0, 0.2, 0.42, 0.26, 0.24, G, "#9a9792");
    const hx = p.lunge ? 0.27 : 0.23,
      hz = p.graze ? 0.24 : 0.32;
    m.box(hx, 0, hz, 0.14, 0.18, 0.16, G);
    // big ears
    m.plate([[hx - 0.04, 0.08], [hx + 0.02, 0.2], [hx - 0.1, 0.22], [hx - 0.12, 0.1]], hz + 0.02, D, 0.12);
    m.plate([[hx - 0.12, -0.1], [hx - 0.1, -0.22], [hx + 0.02, -0.2], [hx - 0.04, -0.08]], hz + 0.02, D, 0.12);
    m.path3([[hx + 0.08, 0, hz + 0.04], [hx + 0.14, 0, hz - 0.08], [hx + 0.12, 0, p.graze ? 0.0 : 0.06]], 0.025, D, 6);
    for (const y of [-0.05, 0.05]) m.tube(hx + 0.06, y, hz - 0.02, 1, 0, -0.3, 0.12, 0.012, "#f2eadc", 5, 0.004);
    m.tube(-0.21, 0, 0.36, -1, 0, -1.5, 0.12, 0.01, D, 4);
    return m;
  },
  a_lion(p) {
    const m = new Model();
    const T = "#c9963e",
      M = "#7a4a1e";
    legs(m, 0.1, -0.1, 0.035, 0.11, 0.03, T, p.walk, 0.05);
    m.box(0, 0, 0.1, 0.3, 0.1, 0.1, T);
    const hx = p.lunge ? 0.2 : 0.16;
    m.sphere(hx, 0, 0.21, 0.07, M, 8, 5);
    m.box(hx + 0.05, 0, 0.18, 0.07, 0.05, 0.05, T);
    m.box(hx + 0.09, 0, 0.17, 0.02, 0.03, 0.025, "#3a2414");
    m.path3([[-0.15, 0, 0.18], [-0.24, 0, 0.12], [-0.27, 0, 0.16]], 0.008, T, 4);
    m.sphere(-0.27, 0, 0.16, 0.018, M, 5, 3);
    return m;
  },
  a_reindeer(p) {
    const m = new Model();
    const B = "#7a5a40",
      W = "#d8d0c0",
      A = "#c8b48a";
    legs(m, 0.1, -0.1, 0.04, 0.15, 0.028, B, p.walk);
    m.box(0, 0, 0.14, 0.28, 0.12, 0.12, B);
    m.box(-0.12, 0, 0.15, 0.05, 0.12, 0.09, W);
    m.box(0.1, 0, 0.17, 0.08, 0.13, 0.08, W);
    const hz = p.graze ? 0.08 : 0.3;
    m.path3([[0.12, 0, 0.22], [0.18, 0, hz]], 0.03, B, 5);
    m.box(0.21, 0, hz - 0.03, 0.09, 0.045, 0.045, B);
    // antlers
    for (const y of [-0.03, 0.03]) {
      m.path3([[0.18, y, hz + 0.02], [0.16, y * 2.6, hz + 0.12], [0.2, y * 3.4, hz + 0.2]], 0.008, A, 4);
      m.path3([[0.17, y * 2.2, hz + 0.09], [0.24, y * 2.4, hz + 0.13]], 0.007, A, 4);
    }
    return m;
  },
  a_bear(p) {
    const m = new Model();
    const F = "#efe9dc",
      S = "#d9d1c0";
    legs(m, 0.12, -0.12, 0.06, 0.12, 0.05, S, p.walk, 0.035);
    m.taper(0, 0, 0.1, 0.4, 0.2, 0.16, 0.34, 0.16, F);
    const hx = p.lunge ? 0.27 : 0.23,
      hz = p.graze ? 0.1 : 0.2;
    m.box(hx, 0, hz, 0.12, 0.1, 0.09, F);
    m.box(hx + 0.07, 0, hz + 0.01, 0.04, 0.05, 0.04, S);
    m.box(hx + 0.095, 0, hz + 0.02, 0.012, 0.02, 0.015, "#1e1e20");
    m.box(hx - 0.02, 0.04, hz + 0.08, 0.02, 0.02, 0.02, S);
    m.box(hx - 0.02, -0.04, hz + 0.08, 0.02, 0.02, 0.02, S);
    return m;
  },
  a_wolf(p) {
    const m = new Model();
    const G = "#8a8a88",
      D = "#5e5e5e";
    legs(m, 0.09, -0.09, 0.03, 0.11, 0.022, G, p.walk, 0.05);
    m.box(0, 0, 0.1, 0.26, 0.08, 0.08, G);
    const hx = p.lunge ? 0.19 : 0.15,
      hz = p.graze ? 0.1 : 0.18;
    m.box(hx, 0, hz, 0.08, 0.06, 0.06, G);
    m.box(hx + 0.06, 0, hz, 0.06, 0.035, 0.035, D);
    m.box(hx - 0.01, 0.02, hz + 0.06, 0.015, 0.012, 0.03, D);
    m.box(hx - 0.01, -0.02, hz + 0.06, 0.015, 0.012, 0.03, D);
    m.tube(-0.13, 0, 0.16, -1, 0, -0.5, 0.14, 0.022, D, 5, 0.012);
    return m;
  },
  a_muskox(p) {
    const m = new Model();
    const B = "#4a3426",
      H = "#cdbfa6";
    legs(m, 0.1, -0.1, 0.05, 0.1, 0.04, "#3a2a20", p.walk, 0.03);
    // shaggy coat hanging almost to the ground
    m.taper(0, 0, 0.04, 0.34, 0.2, 0.22, 0.28, 0.14, B);
    m.sphere(0.03, 0, 0.24, 0.1, B, 8, 4);
    const hx = p.lunge ? 0.22 : 0.18,
      hz = p.graze ? 0.08 : 0.15;
    m.box(hx, 0, hz, 0.1, 0.1, 0.09, B);
    for (const y of [-1, 1]) m.path3([[hx - 0.02, y * 0.03, hz + 0.09], [hx - 0.01, y * 0.09, hz + 0.08], [hx + 0.03, y * 0.09, hz + 0.02]], 0.014, H, 4);
    return m;
  },
  a_camel(p) {
    const m = new Model();
    const T = "#c8a46a",
      D = "#a4824e";
    legs(m, 0.1, -0.1, 0.04, 0.26, 0.026, T, p.walk, 0.05);
    m.box(0, 0, 0.24, 0.3, 0.13, 0.12, T);
    m.sphere(-0.01, 0, 0.36, 0.08, D, 8, 4);
    const hz = p.graze ? 0.12 : 0.42;
    m.path3([[0.13, 0, 0.3], [0.2, 0, 0.32], [0.23, 0, hz]], 0.028, T, 5);
    m.box(0.27, 0, hz - 0.01, 0.1, 0.045, 0.05, T);
    m.tube(-0.15, 0, 0.32, -1, 0, -1.2, 0.1, 0.008, D, 4);
    return m;
  },
  a_jackal(p) {
    const m = new Model();
    const T = "#b08850",
      D = "#5a4430";
    legs(m, 0.07, -0.07, 0.025, 0.09, 0.018, T, p.walk, 0.05);
    m.box(0, 0, 0.08, 0.2, 0.06, 0.06, T);
    m.box(0, 0, 0.13, 0.14, 0.05, 0.015, D);
    const hx = p.lunge ? 0.15 : 0.12,
      hz = p.graze ? 0.07 : 0.14;
    m.box(hx, 0, hz, 0.06, 0.045, 0.045, T);
    m.box(hx + 0.045, 0, hz, 0.04, 0.025, 0.025, T);
    m.box(hx - 0.01, 0.015, hz + 0.045, 0.012, 0.01, 0.04, T);
    m.box(hx - 0.01, -0.015, hz + 0.045, 0.012, 0.01, 0.04, T);
    m.tube(-0.1, 0, 0.12, -1, 0, -0.6, 0.1, 0.014, D, 4, 0.008);
    return m;
  },
};

export function extUnitModel(type: string): UnitModel | undefined {
  return unitBuilders[type]?.();
}
export function extStructModel(type: string): StructModel | undefined {
  return structBuilders[type]?.();
}
export function animalModel(type: string, frame: number): Model | undefined {
  return animalBuilders[type]?.(pose(frame));
}
