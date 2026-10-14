// Procedural, symmetric, deterministic map generation.
import { Rng, isqrt } from "./fixed";
import { ORE_MAX } from "./rules";

export const T_CLEAR = 0,
  T_DIRT = 1,
  T_ROUGH = 2,
  T_WATER = 3,
  T_ROCK = 4,
  T_TREE = 5,
  T_SAND = 6,
  T_PAVE = 7;

export type Loco = "foot" | "track" | "air";

export interface MapSpec {
  seed: number;
  size: number;
  players: number;
}

export class GameMap {
  w: number;
  h: number;
  terrain: Uint8Array;
  ore: Uint8Array; // amount 0..ORE_MAX
  oreType: Uint8Array; // 0 none, 1 ore, 2 gem
  variant: Uint8Array; // visual variant per cell (client use only, deterministic anyway)
  starts: { x: number; y: number }[] = [];
  wells: { x: number; y: number }[] = [];
  oreVersion = 0;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.terrain = new Uint8Array(w * h);
    this.ore = new Uint8Array(w * h);
    this.oreType = new Uint8Array(w * h);
    this.variant = new Uint8Array(w * h);
  }

  inside(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  idx(x: number, y: number) {
    return y * this.w + x;
  }
  groundOk(i: number) {
    const t = this.terrain[i];
    return t !== T_WATER && t !== T_ROCK && t !== T_TREE;
  }
  buildableTerrain(i: number) {
    return this.groundOk(i) && this.oreType[i] === 0;
  }
}

// ---------------------------------------------------------------------------

function valueNoise(rng: Rng, w: number, h: number, scale: number) {
  const gw = Math.ceil(w / scale) + 2,
    gh = Math.ceil(h / scale) + 2;
  const g = new Float64Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = rng.int(10000) / 10000;
  return (x: number, y: number) => {
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

type Xf = (x: number, y: number) => [number, number];

export function generateMap(spec: MapSpec): GameMap {
  const size = spec.size;
  const W = size,
    H = size;
  const m = new GameMap(W, H);
  const rng = new Rng(spec.seed * 7919 + 13);
  const four = spec.players > 2;

  // Symmetry transforms mapping player 0's territory to each player's.
  const xfs: Xf[] = four
    ? [
        (x, y) => [x, y],
        (x, y) => [W - 1 - y, x],
        (x, y) => [W - 1 - x, H - 1 - y],
        (x, y) => [y, H - 1 - x],
      ]
    : [
        (x, y) => [x, y],
        (x, y) => [W - 1 - x, H - 1 - y],
      ];
  const canon = (x: number, y: number): [number, number] => {
    let best: [number, number] = [x, y];
    for (const f of xfs) {
      // inverse orbit: apply each transform and take lexicographic min
      const p = f(x, y);
      if (p[1] < best[1] || (p[1] === best[1] && p[0] < best[0])) best = p;
    }
    return best;
  };

  const inset = Math.max(8, Math.floor(size / 7));
  const s0 = four ? { x: inset, y: inset } : { x: inset, y: H - 1 - inset };
  for (let p = 0; p < xfs.length; p++) {
    const [x, y] = xfs[p](s0.x, s0.y);
    m.starts.push({ x, y });
  }
  // for 2p on a 4-way map, use opposite corners
  if (four && spec.players === 2) m.starts = [m.starts[0], m.starts[2]];

  const cx = (W - 1) / 2,
    cy = (H - 1) / 2;
  // Plan ore fields & fuel wells first (player 0, then mirrored) so terrain can avoid them
  const dirx = cx - s0.x,
    diry = cy - s0.y;
  const dl = Math.sqrt(dirx * dirx + diry * diry);
  const ux = dirx / dl,
    uy = diry / dl;
  const R = 0.7071;
  const rot = (a: number, b: number, cs: number, sn: number) => [a * cs - b * sn, a * sn + b * cs];
  const fields: { x: number; y: number; r: number; gem: boolean }[] = [];
  {
    const [ax, ay] = rot(ux, uy, R, R);
    const [bx, by] = rot(ux, uy, R, -R);
    fields.push({ x: Math.round(s0.x + ax * 10), y: Math.round(s0.y + ay * 10), r: 3, gem: false });
    fields.push({ x: Math.round(s0.x + bx * 11), y: Math.round(s0.y + by * 11), r: 3, gem: false });
    const [ex, ey] = rot(ux, uy, 0.9, 0.42);
    fields.push({ x: Math.round(s0.x + ex * dl * 0.62), y: Math.round(s0.y + ey * dl * 0.62), r: 3, gem: false });
    const [fx, fy] = rot(ux, uy, 0.9, -0.42);
    fields.push({ x: Math.round(s0.x + fx * dl * 0.55), y: Math.round(s0.y + fy * dl * 0.55), r: 2, gem: true });
  }
  const placed: { x: number; y: number; r: number; gem: boolean }[] = [];
  for (const f of fields)
    for (const xf of xfs) {
      const [x, y] = xf(f.x, f.y);
      placed.push({ x, y, r: f.r, gem: f.gem });
    }
  placed.push({ x: Math.round(cx), y: Math.round(cy), r: 3, gem: true });
  const wellSpots: { x: number; y: number }[] = [];
  {
    const [ax, ay] = rot(ux, uy, 0.8, 0.6);
    const wx = Math.round(s0.x + ax * dl * 0.75),
      wy = Math.round(s0.y + ay * dl * 0.75);
    for (const xf of xfs) {
      const [x, y] = xf(wx, wy);
      wellSpots.push({ x: Math.max(1, Math.min(W - 3, x)), y: Math.max(1, Math.min(H - 3, y)) });
    }
  }
  // distance to nearest planned feature (in canonical space it is symmetric anyway)
  const nearFeature = (x: number, y: number) => {
    for (const f of placed) {
      const d = (x - f.x) * (x - f.x) + (y - f.y) * (y - f.y);
      if (d <= (f.r + 3) * (f.r + 3)) return true;
    }
    for (const wv of wellSpots) if (Math.abs(x - wv.x - 0.5) <= 3 && Math.abs(y - wv.y - 0.5) <= 3) return true;
    return false;
  };

  const nMoist = valueNoise(rng, W, H, 9);
  const nRough = valueNoise(rng, W, H, 5);
  const nObst = valueNoise(rng, W, H, 11);
  const nTree = valueNoise(rng, W, H, 6);
  const nRidge = valueNoise(rng, W, H, 14);

  const minStartDist = (x: number, y: number) => {
    let best = 1e9;
    for (const s of m.starts) {
      const d = (s.x - x) * (s.x - x) + (s.y - y) * (s.y - y);
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [qx, qy] = canon(x, y);
      const i = m.idx(x, y);
      const keepClear = nearFeature(x, y);
      const sd = minStartDist(qx, qy);
      const cd = Math.sqrt((qx - cx) * (qx - cx) + (qy - cy) * (qy - cy));
      let t = T_CLEAR;
      const mo = nMoist(qx, qy);
      if (mo < 0.36) t = T_DIRT;
      if (nRough(qx, qy) > 0.78) t = T_ROUGH;
      const ob = nObst(qx, qy);
      if (!keepClear && sd > 13 && cd > 6 && ob > 0.74) t = T_WATER;
      const r = nRidge(qx, qy);
      if (!keepClear && sd > 11 && cd > 5 && Math.abs(r - 0.5) < 0.022 && t !== T_WATER) t = T_ROCK;
      if (!keepClear && sd > 10 && cd > 4 && t !== T_WATER && t !== T_ROCK && nTree(qx, qy) > 0.8) t = T_TREE;
      // map border: trees/rocks for a natural edge
      const edge = Math.min(qx, qy, W - 1 - qx, H - 1 - qy);
      if (edge < 1 && t === T_CLEAR && nTree(qx, qy) > 0.55) t = T_TREE;
      m.terrain[i] = t;
      m.variant[i] = (qx * 73856093) ^ (qy * 19349663) & 255;
    }
  }

  // Sand shores
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = m.idx(x, y);
      if (m.terrain[i] === T_WATER) continue;
      let nearWater = false;
      for (let dy = -1; dy <= 1 && !nearWater; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx,
            ny = y + dy;
          if (m.inside(nx, ny) && m.terrain[m.idx(nx, ny)] === T_WATER) {
            nearWater = true;
            break;
          }
        }
      if (nearWater && m.terrain[i] !== T_ROCK && m.terrain[i] !== T_TREE) m.terrain[i] = T_SAND;
    }

  // Clear start areas
  for (const s of m.starts) clearCircle(m, s.x, s.y, 9);

  // Ore fields
  for (const f of placed) placeOre(m, rng, f.x, f.y, f.r, f.gem);

  // Fuel wells
  for (const wv of wellSpots) {
    clearRect(m, wv.x - 1, wv.y - 1, 4, 4);
    m.wells.push({ x: wv.x, y: wv.y });
  }

  // Connectivity: carve corridors from each start to the centre if needed
  ensureConnectivity(m);
  removeUnreachableOre(m);
  return m;
}

function clearCircle(m: GameMap, x0: number, y0: number, r: number) {
  for (let y = y0 - r; y <= y0 + r; y++)
    for (let x = x0 - r; x <= x0 + r; x++) {
      if (!m.inside(x, y)) continue;
      if ((x - x0) * (x - x0) + (y - y0) * (y - y0) > r * r) continue;
      const i = m.idx(x, y);
      if (!m.groundOk(i) || m.terrain[i] === T_SAND) m.terrain[i] = T_CLEAR;
      m.ore[i] = 0;
      m.oreType[i] = 0;
    }
}

function clearRect(m: GameMap, x0: number, y0: number, w: number, h: number) {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      if (!m.inside(x, y)) continue;
      const i = m.idx(x, y);
      if (!m.groundOk(i)) m.terrain[i] = T_DIRT;
      m.ore[i] = 0;
      m.oreType[i] = 0;
    }
}

function placeOre(m: GameMap, rng: Rng, x0: number, y0: number, r: number, gem: boolean) {
  for (let y = y0 - r - 1; y <= y0 + r + 1; y++)
    for (let x = x0 - r - 1; x <= x0 + r + 1; x++) {
      if (!m.inside(x, y)) continue;
      const d2 = (x - x0) * (x - x0) + (y - y0) * (y - y0);
      const d = isqrt(d2 * 100) / 10;
      if (d > r + 0.6) continue;
      const i = m.idx(x, y);
      if (!m.groundOk(i)) m.terrain[i] = T_CLEAR;
      const amt = Math.max(2, Math.min(ORE_MAX, Math.round(ORE_MAX * (1 - d / (r + 1.2))) + rng.int(3)));
      m.ore[i] = amt;
      m.oreType[i] = gem ? 2 : 1;
    }
}

function ensureConnectivity(m: GameMap) {
  const W = m.w,
    H = m.h;
  const cx = Math.floor(W / 2),
    cy = Math.floor(H / 2);
  for (let pass = 0; pass < 2; pass++) {
    const seen = new Uint8Array(W * H);
    const q: number[] = [m.idx(cx, cy)];
    seen[q[0]] = 1;
    if (!m.groundOk(q[0])) m.terrain[q[0]] = T_CLEAR;
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      const x = i % W,
        y = (i / W) | 0;
      const nb = [i - 1, i + 1, i - W, i + W];
      const ok = [x > 0, x < W - 1, y > 0, y < H - 1];
      for (let k = 0; k < 4; k++) {
        if (!ok[k]) continue;
        const n = nb[k];
        if (seen[n] || !m.groundOk(n)) continue;
        seen[n] = 1;
        q.push(n);
      }
    }
    let carved = false;
    for (const s of m.starts) {
      if (seen[m.idx(s.x, s.y)]) continue;
      carved = true;
      // carve a 3-wide corridor
      const steps = Math.max(Math.abs(cx - s.x), Math.abs(cy - s.y));
      for (let k = 0; k <= steps; k++) {
        const x = Math.round(s.x + ((cx - s.x) * k) / steps),
          y = Math.round(s.y + ((cy - s.y) * k) / steps);
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (!m.inside(x + dx, y + dy)) continue;
            const i = m.idx(x + dx, y + dy);
            if (!m.groundOk(i)) m.terrain[i] = T_DIRT;
          }
      }
    }
    if (!carved) break;
  }
}

/** Ore that ground units cannot reach (e.g. on islands) is removed. */
function removeUnreachableOre(m: GameMap) {
  const W = m.w,
    H = m.h;
  const seen = new Uint8Array(W * H);
  const q: number[] = [];
  for (const s of m.starts) {
    const i = m.idx(s.x, s.y);
    if (!seen[i]) {
      seen[i] = 1;
      q.push(i);
    }
  }
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    const x = i % W,
      y = (i / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx,
        ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (seen[n] || !m.groundOk(n)) continue;
      seen[n] = 1;
      q.push(n);
    }
  }
  for (let i = 0; i < W * H; i++)
    if (m.oreType[i] && !seen[i]) {
      m.oreType[i] = 0;
      m.ore[i] = 0;
    }
}
