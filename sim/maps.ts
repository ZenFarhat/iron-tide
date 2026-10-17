// Hand-made battlefields. Each map is painted in player 0's frame and stamped through the
// map's symmetry, so every start gets the same terrain, ore and wildlife. Like the generator,
// painting uses only + - * / and Math.sqrt so every browser builds an identical map.
import { Rng } from "./fixed";
import {
  GameMap,
  T_CLEAR,
  T_DIRT,
  T_ICE,
  T_ROCK,
  T_ROUGH,
  T_SAND,
  T_SHALLOW,
  T_TREE,
  T_WATER,
  finishMap,
  ihash,
  symmetry,
  type OreSpot,
  type Theme,
  type Xf,
} from "./map";

export interface MapDef {
  id: string;
  name: string;
  desc: string;
  theme: Theme;
  size: number;
  /** 2 = point symmetry (two starts), 4 = four-way rotation (four starts) */
  sym: 2 | 4;
  /** player 0's start; the others are its symmetric images */
  start: [number, number];
  build(p: Painter): void;
}

function valueNoise(rng: Rng, w: number, h: number, scale: number) {
  const gw = Math.ceil(w / scale) + 2,
    gh = Math.ceil(h / scale) + 2;
  const g = new Float64Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = rng.int(10000) / 10000;
  return (x: number, y: number) => {
    x = Math.max(0, x);
    y = Math.max(0, y);
    const fx = x / scale,
      fy = y / scale;
    const ix = Math.floor(fx),
      iy = Math.floor(fy);
    const tx = fx - ix,
      ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx),
      sy = ty * ty * (3 - 2 * ty);
    const a = g[iy * gw + ix],
      b = g[iy * gw + ix + 1],
      c = g[(iy + 1) * gw + ix],
      d = g[(iy + 1) * gw + ix + 1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

/** squared distance from (px, py) to the segment (ax, ay)–(bx, by) */
function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax,
    dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t - px,
    qy = ay + dy * t - py;
  return qx * qx + qy * qy;
}

type Only = number[] | undefined;

export class Painter {
  m: GameMap;
  rng: Rng;
  W: number;
  H: number;
  /** map centre */
  cx: number;
  cy: number;
  xfs: Xf[];
  private inv: Xf[];
  ores: OreSpot[] = [];
  wells: { x: number; y: number }[] = [];
  private wobble: (x: number, y: number) => number;

  constructor(m: GameMap, rng: Rng, four: boolean) {
    this.m = m;
    this.rng = rng;
    this.W = m.w;
    this.H = m.h;
    this.cx = (m.w - 1) / 2;
    this.cy = (m.h - 1) / 2;
    this.xfs = symmetry(m.w, m.h, four);
    // every transform is its own inverse except the quarter turns, which invert each other
    this.inv = four ? [this.xfs[0], this.xfs[3], this.xfs[2], this.xfs[1]] : this.xfs;
    this.wobble = valueNoise(rng, m.w, m.h, 4);
  }

  /** paint terrain t wherever `inside` holds in player 0's frame, on every player's side */
  shape(t: number, inside: (x: number, y: number) => boolean, only?: Only) {
    const m = this.m;
    for (let y = 0; y < this.H; y++)
      for (let x = 0; x < this.W; x++) {
        const i = y * this.W + x;
        if (only && !only.includes(m.terrain[i])) continue;
        for (const f of this.inv) {
          const [a, b] = f(x, y);
          if (inside(a, b)) {
            m.terrain[i] = t;
            break;
          }
        }
      }
  }
  fill(t: number) {
    this.m.terrain.fill(t);
  }
  disc(x: number, y: number, r: number, t: number, only?: Only) {
    this.shape(t, (a, b) => (a - x) * (a - x) + (b - y) * (b - y) <= r * r, only);
  }
  /** a disc with a ragged, natural edge */
  blob(x: number, y: number, r: number, t: number, ragged = 0.3, only?: Only) {
    this.shape(
      t,
      (a, b) => {
        const rr = r * (1 - ragged + 2 * ragged * this.wobble(a, b));
        return (a - x) * (a - x) + (b - y) * (b - y) <= rr * rr;
      },
      only,
    );
  }
  ring(x: number, y: number, r0: number, r1: number, t: number, only?: Only) {
    this.shape(
      t,
      (a, b) => {
        const d = (a - x) * (a - x) + (b - y) * (b - y);
        return d >= r0 * r0 && d <= r1 * r1;
      },
      only,
    );
  }
  /** a thick polyline (rivers, ridges, causeways) */
  path(pts: [number, number][], width: number, t: number, only?: Only) {
    const h2 = (width / 2) * (width / 2);
    this.shape(
      t,
      (a, b) => {
        for (let k = 0; k < pts.length - 1; k++) if (segDist2(a, b, pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1]) <= h2) return true;
        return false;
      },
      only,
    );
  }
  /** noise patches evaluated in symmetric (canonical) space */
  scatter(t: number, scale: number, threshold: number, only?: Only) {
    const n = valueNoise(this.rng, this.W, this.H, scale);
    const m = this.m;
    for (let y = 0; y < this.H; y++)
      for (let x = 0; x < this.W; x++) {
        const i = y * this.W + x;
        if (only && !only.includes(m.terrain[i])) continue;
        const [qx, qy] = this.canon(x, y);
        if (n(qx, qy) > threshold) m.terrain[i] = t;
      }
  }
  /** lone cells (single trees, boulders) at a per-mille density */
  sprinkle(t: number, perMille: number, only?: Only) {
    const m = this.m;
    for (let y = 0; y < this.H; y++)
      for (let x = 0; x < this.W; x++) {
        const i = y * this.W + x;
        if (only && !only.includes(m.terrain[i])) continue;
        const [qx, qy] = this.canon(x, y);
        if (ihash(qx + 7, qy + 3) % 1000 < perMille) m.terrain[i] = t;
      }
  }
  ore(x: number, y: number, r: number, gem = false) {
    // snap to a cell in player 0's frame first so every mirrored copy lands on whole cells
    x = Math.round(x);
    y = Math.round(y);
    for (const f of this.xfs) {
      const [a, b] = f(x, y);
      this.ores.push({ x: a, y: b, r, gem });
    }
  }
  /** a field on the centre itself (already symmetric) */
  centreOre(r: number, gem = true) {
    this.ores.push({ x: Math.round(this.cx), y: Math.round(this.cy), r, gem });
  }
  well(x: number, y: number) {
    x = Math.round(x);
    y = Math.round(y);
    for (const f of this.xfs) {
      const [a, b] = f(x, y);
      // a well's footprint is 2×2 from its corner; keep the mirrored corner on the same cells
      this.wells.push({ x: Math.max(1, Math.min(this.W - 3, a)), y: Math.max(1, Math.min(this.H - 3, b)) });
    }
  }

  private canon(x: number, y: number): [number, number] {
    let best: [number, number] = [x, y];
    for (const f of this.xfs) {
      const p = f(x, y);
      if (p[1] < best[1] || (p[1] === best[1] && p[0] < best[0])) best = p;
    }
    return best;
  }
}

const LAND = [T_CLEAR, T_DIRT, T_ROUGH, T_SAND];

export const MAPS: MapDef[] = [
  {
    id: "twin_rivers",
    name: "Twin Rivers",
    desc: "Two navigable rivers wall off each base. Wade across at the fords, or fight for the water.",
    theme: "temperate",
    size: 80,
    sym: 2,
    start: [13, 66],
    build(p) {
      p.fill(T_CLEAR);
      p.scatter(T_DIRT, 9, 0.64);
      p.scatter(T_ROUGH, 5, 0.8, LAND);
      p.scatter(T_TREE, 6, 0.79, [T_CLEAR, T_DIRT]);
      // the rivers drain into two neutral corner seas, so the water forms a ring ships can sail
      p.shape(T_WATER, (x, y) => x + y < 22);
      p.path([[6, 10], [14, 30], [24, 44], [36, 58], [58, 83]], 4.5, T_WATER);
      p.blob(29, 50, 4.5, T_WATER, 0.2);
      for (const [x, y] of [[13, 28], [45, 69]] as [number, number][]) p.disc(x, y, 3.2, T_SHALLOW, [T_WATER]);
      p.blob(30, 24, 2.6, T_ROCK, 0.35);
      p.ore(12, 53, 3);
      p.ore(26, 66, 3);
      p.ore(33, 36, 2, true);
      p.ore(19, 13, 3);
      p.centreOre(3);
      p.well(55, 51);
    },
  },
  {
    id: "archipelago",
    name: "Archipelago",
    desc: "Four island fortresses linked by shallow causeways around a central treasure isle. Navies decide it.",
    theme: "temperate",
    size: 96,
    sym: 4,
    start: [17, 17],
    build(p) {
      p.fill(T_WATER);
      p.blob(17, 17, 16, T_CLEAR, 0.18);
      p.blob(p.cx, p.cy, 13, T_CLEAR, 0.2);
      p.blob(47.5, 12, 6.5, T_CLEAR, 0.25);
      p.path([[29, 15], [43, 13]], 3, T_SHALLOW, [T_WATER]);
      p.path([[15, 29], [13, 43]], 3, T_SHALLOW, [T_WATER]);
      p.path([[28, 28], [39, 39]], 3, T_SHALLOW, [T_WATER]);
      p.scatter(T_DIRT, 8, 0.66, [T_CLEAR]);
      p.scatter(T_TREE, 5, 0.8, [T_CLEAR, T_DIRT]);
      p.ore(9, 27, 3);
      p.ore(27, 9, 3);
      p.ore(47.5, 10, 2);
      p.ore(38, 47.5, 2, true);
      p.centreOre(3);
      p.well(46, 15);
    },
  },
  {
    id: "glacier_pass",
    name: "Glacier Pass",
    desc: "Mountain walls with three passes guard each base. Tanks can cross the frozen lake in the middle; ships cannot.",
    theme: "snow",
    size: 80,
    sym: 2,
    start: [13, 66],
    build(p) {
      p.fill(T_CLEAR);
      p.scatter(T_DIRT, 9, 0.62);
      p.scatter(T_ROUGH, 6, 0.74, LAND);
      p.blob(p.cx, p.cy, 11, T_ICE, 0.22);
      p.disc(p.cx, p.cy, 2.6, T_WATER);
      p.path([[2, 18], [26, 42], [62, 78]], 3.4, T_ROCK);
      for (const [x, y] of [[11, 27], [31, 47], [50, 66]] as [number, number][]) p.disc(x, y, 2.6, T_CLEAR, [T_ROCK]);
      p.blob(6, 44, 4, T_WATER, 0.25);
      p.scatter(T_TREE, 6, 0.75, [T_CLEAR, T_DIRT]);
      p.ore(11, 53, 3);
      p.ore(26, 67, 3);
      p.ore(29, 38, 2, true);
      p.ore(16, 12, 3);
      p.well(46, 22);
    },
  },
  {
    id: "frozen_fjords",
    name: "Frozen Fjords",
    desc: "Two icy seas and long fjords reach deep inland. Control the water to flank the highlands.",
    theme: "snow",
    size: 88,
    sym: 2,
    start: [14, 73],
    build(p) {
      p.fill(T_CLEAR);
      p.scatter(T_DIRT, 9, 0.6);
      p.scatter(T_ROUGH, 6, 0.72, LAND);
      p.shape(T_WATER, (x, y) => x + y < 27);
      p.path([[4, 18], [6, 36], [10, 56]], 3.6, T_WATER);
      p.path([[18, 4], [36, 6], [56, 10]], 3.6, T_WATER);
      p.path([[10, 10], [24, 22], [31, 31]], 3.2, T_WATER);
      p.blob(13, 7, 3, T_ICE, 0.3, [T_WATER]);
      p.blob(5, 11, 2.5, T_ICE, 0.3, [T_WATER]);
      p.blob(p.cx - 9, p.cy + 9, 3.5, T_ROCK, 0.35);
      p.blob(p.cx - 2, p.cy + 14, 2.5, T_ROCK, 0.35);
      p.scatter(T_TREE, 6, 0.77, [T_CLEAR, T_DIRT]);
      p.ore(13, 60, 3);
      p.ore(27, 73, 3);
      p.ore(34, 48, 2, true);
      p.centreOre(3);
      p.well(22, 46);
    },
  },
  {
    id: "permafrost",
    name: "Permafrost",
    desc: "A frozen river splits the tundra. Its ice carries tanks, but open holes and ponds break up the line.",
    theme: "tundra",
    size: 80,
    sym: 2,
    start: [13, 66],
    build(p) {
      p.fill(T_DIRT);
      p.scatter(T_CLEAR, 9, 0.56);
      p.scatter(T_ROUGH, 5, 0.66, LAND);
      p.scatter(T_WATER, 7, 0.8, LAND);
      p.path([[-2, -2], [81, 81]], 5.5, T_ICE);
      p.disc(p.cx, p.cy, 2.5, T_WATER);
      p.disc(21, 21, 2.2, T_WATER);
      p.blob(30, 52, 2.5, T_ROCK, 0.35);
      p.blob(46, 64, 2.2, T_ROCK, 0.35);
      p.scatter(T_TREE, 6, 0.8, [T_CLEAR, T_DIRT, T_ROUGH]);
      p.ore(11, 53, 3);
      p.ore(26, 67, 3);
      p.ore(26, 40, 2, true);
      p.ore(44, 72, 3);
      p.well(32, 22);
    },
  },
  {
    id: "dune_sea",
    name: "Dune Sea",
    desc: "Open dunes broken by mesas. Every base has its own oasis; the great oasis in the centre holds the gems.",
    theme: "desert",
    size: 88,
    sym: 4,
    start: [15, 15],
    build(p) {
      p.fill(T_SAND);
      p.scatter(T_DIRT, 9, 0.62);
      p.scatter(T_ROUGH, 5, 0.8, LAND);
      for (const [x, y, r] of [[29, 9, 3.5], [9, 29, 3.5], [31, 31, 3], [44, 22, 2.5]] as [number, number, number][]) p.blob(x, y, r, T_ROCK, 0.35);
      p.blob(p.cx, p.cy, 5.5, T_WATER, 0.2);
      p.ring(p.cx, p.cy, 6.2, 8.5, T_TREE, LAND);
      p.sprinkle(T_SAND, 520, [T_TREE]);
      p.blob(5, 5, 3, T_WATER, 0.2);
      p.ring(5, 5, 3.5, 5, T_TREE, LAND);
      p.sprinkle(T_SAND, 600, [T_TREE]);
      p.sprinkle(T_TREE, 3, [T_SAND, T_DIRT]);
      p.ore(24, 14, 3);
      p.ore(14, 24, 3);
      p.ore(36, 36, 2, true);
      p.well(26, 40);
    },
  },
  {
    id: "oasis_run",
    name: "Oasis Run",
    desc: "A small desert duel across a palm-lined river. Three fords; the middle one sits on the gem bed.",
    theme: "desert",
    size: 64,
    sym: 2,
    start: [11, 52],
    build(p) {
      p.fill(T_SAND);
      p.scatter(T_DIRT, 8, 0.6);
      p.path([[-2, -2], [65, 65]], 4.2, T_WATER);
      for (const [x, y] of [[15, 15], [p.cx, p.cy]] as [number, number][]) p.disc(x, y, 3, T_SHALLOW, [T_WATER]);
      p.shape(T_TREE, (x, y) => {
        const d = Math.abs(x - y);
        return d > 4.5 && d < 6.5 && ihash(Math.round(x), Math.round(y)) % 100 < 22;
      }, LAND);
      p.blob(20, 42, 3, T_ROCK, 0.35);
      p.blob(8, 30, 2, T_ROCK, 0.35);
      p.ore(10, 40, 3);
      p.ore(23, 54, 3);
      p.ore(25, 33, 2, true);
      p.well(36, 52);
    },
  },
  {
    id: "serengeti",
    name: "Serengeti",
    desc: "Vast savanna for four. Lions, elephants and zebra herds roam between the kopjes and the great waterhole.",
    theme: "safari",
    size: 96,
    sym: 4,
    start: [16, 16],
    build(p) {
      p.fill(T_CLEAR);
      p.scatter(T_DIRT, 8, 0.6);
      p.scatter(T_ROUGH, 5, 0.85, LAND);
      p.disc(p.cx, p.cy, 8.5, T_SHALLOW);
      p.blob(p.cx, p.cy, 6.5, T_WATER, 0.15);
      p.blob(32, 10, 2.5, T_WATER, 0.25);
      for (const [x, y] of [[36, 22], [22, 36], [46, 30]] as [number, number][]) p.blob(x, y, 2.4, T_ROCK, 0.4);
      p.scatter(T_TREE, 6, 0.84, [T_CLEAR, T_DIRT]);
      p.sprinkle(T_TREE, 12, [T_CLEAR, T_DIRT]);
      p.ore(8, 27, 3);
      p.ore(27, 8, 3);
      p.ore(35, 35, 2, true);
      p.ore(47.5, 18, 3);
      p.well(30, 46);
    },
  },
  {
    id: "crater_highlands",
    name: "Crater Highlands",
    desc: "A volcanic crater rim with four gaps rings a lake and rich gem beds. Prides of lions hunt the slopes.",
    theme: "safari",
    size: 80,
    sym: 2,
    start: [13, 66],
    build(p) {
      p.fill(T_CLEAR);
      p.scatter(T_DIRT, 8, 0.6);
      p.scatter(T_ROUGH, 5, 0.84, LAND);
      p.ring(p.cx, p.cy, 11, 13.5, T_ROCK);
      for (const [x, y] of [[31, 48], [31, 31]] as [number, number][]) p.disc(x, y, 2.8, T_CLEAR, [T_ROCK]);
      p.blob(p.cx, p.cy, 4, T_WATER, 0.2);
      p.sprinkle(T_TREE, 14, [T_CLEAR, T_DIRT]);
      p.scatter(T_TREE, 6, 0.86, [T_CLEAR, T_DIRT]);
      p.ore(12, 53, 3);
      p.ore(26, 67, 3);
      p.ore(34, 44, 2, true);
      p.ore(14, 14, 3);
      p.well(52, 64);
    },
  },
];

export function mapDef(id: string): MapDef | undefined {
  return MAPS.find((m) => m.id === id);
}

export function buildPremade(def: MapDef, seed: number, players: number): GameMap {
  const m = new GameMap(def.size, def.size);
  m.theme = def.theme;
  m.name = def.name;
  const rng = new Rng(seed * 7919 + 101);
  const four = def.sym === 4;
  const p = new Painter(m, rng, four);
  def.build(p);
  for (const f of p.xfs) {
    const [x, y] = f(def.start[0], def.start[1]);
    m.starts.push({ x, y });
  }
  // two players on a four-way map take opposite corners
  if (four && players === 2) m.starts = [m.starts[0], m.starts[2]];
  for (let i = 0; i < m.w * m.h; i++) m.variant[i] = ihash(i % m.w, (i / m.w) | 0) & 255;
  finishMap(m, rng, p.ores, p.wells, p.xfs);
  return m;
}
