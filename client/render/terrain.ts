// Procedural per-pixel terrain, cached in 16×16-cell chunks.
import type { GameMap, Theme } from "../../sim/map";
import { T_CLEAR, T_DIRT, T_ICE, T_PAVE, T_ROCK, T_ROUGH, T_SAND, T_SHALLOW, T_TREE, T_WATER } from "../../sim/map";
import { HW, HH } from "./iso";

export const CHUNK = 16;

type RGB = [number, number, number];
// base colours per terrain type, per biome
const PALETTES: Record<Theme, Record<number, RGB>> = {
  temperate: {
    [T_CLEAR]: [92, 122, 58],
    [T_DIRT]: [134, 111, 72],
    [T_ROUGH]: [112, 102, 80],
    [T_WATER]: [36, 84, 116],
    [T_ROCK]: [118, 114, 104],
    [T_TREE]: [74, 104, 48],
    [T_SAND]: [190, 170, 122],
    [T_PAVE]: [112, 112, 112],
    [T_ICE]: [178, 212, 228],
    [T_SHALLOW]: [86, 132, 136],
  },
  snow: {
    [T_CLEAR]: [222, 230, 238],
    [T_DIRT]: [194, 203, 214],
    [T_ROUGH]: [146, 150, 158],
    [T_WATER]: [34, 70, 98],
    [T_ROCK]: [124, 128, 138],
    [T_TREE]: [204, 214, 224],
    [T_SAND]: [214, 220, 226],
    [T_PAVE]: [150, 152, 158],
    [T_ICE]: [172, 210, 230],
    [T_SHALLOW]: [86, 128, 156],
  },
  tundra: {
    [T_CLEAR]: [124, 128, 88],
    [T_DIRT]: [118, 100, 76],
    [T_ROUGH]: [124, 122, 112],
    [T_WATER]: [46, 78, 98],
    [T_ROCK]: [112, 112, 108],
    [T_TREE]: [96, 106, 72],
    [T_SAND]: [160, 150, 120],
    [T_PAVE]: [120, 118, 112],
    [T_ICE]: [184, 210, 222],
    [T_SHALLOW]: [94, 122, 132],
  },
  desert: {
    [T_CLEAR]: [214, 184, 134],
    [T_DIRT]: [188, 150, 104],
    [T_ROUGH]: [166, 132, 98],
    [T_WATER]: [38, 132, 148],
    [T_ROCK]: [168, 108, 74],
    [T_TREE]: [196, 170, 116],
    [T_SAND]: [232, 202, 146],
    [T_PAVE]: [170, 160, 140],
    [T_ICE]: [190, 214, 222],
    [T_SHALLOW]: [96, 176, 170],
  },
  safari: {
    [T_CLEAR]: [174, 164, 90],
    [T_DIRT]: [164, 116, 74],
    [T_ROUGH]: [148, 128, 96],
    [T_WATER]: [66, 100, 92],
    [T_ROCK]: [138, 114, 96],
    [T_TREE]: [146, 150, 80],
    [T_SAND]: [198, 174, 118],
    [T_PAVE]: [140, 130, 110],
    [T_ICE]: [190, 214, 222],
    [T_SHALLOW]: [116, 124, 94],
  },
};

function hash2(x: number, y: number) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number) {
  const xi = Math.floor(x),
    yi = Math.floor(y);
  const xf = x - xi,
    yf = y - yi;
  const u = xf * xf * (3 - 2 * xf),
    v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi),
    b = hash2(xi + 1, yi),
    c = hash2(xi, yi + 1),
    d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export class TerrainCache {
  map: GameMap;
  chunks = new Map<number, HTMLCanvasElement>();
  cw: number;
  ch: number;
  colors: Float32Array; // per-cell rgb
  theme: Theme;
  private base: Record<number, RGB>;
  constructor(map: GameMap) {
    this.map = map;
    this.theme = map.theme;
    const BASE = (this.base = PALETTES[map.theme] ?? PALETTES.temperate);
    this.cw = Math.ceil(map.w / CHUNK);
    this.ch = Math.ceil(map.h / CHUNK);
    const n = map.w * map.h;
    this.colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const t = map.terrain[i];
      const b = BASE[t] ?? BASE[T_CLEAR];
      const x = i % map.w,
        y = (i / map.w) | 0;
      // macro variation
      const mv = vnoise(x * 0.18, y * 0.18) - 0.5;
      let r = b[0],
        g = b[1],
        bl = b[2];
      if (this.theme === "snow" && t !== T_WATER && t !== T_SHALLOW) {
        // snowfields: faint blue-grey drifts
        r += mv * 14;
        g += mv * 14;
        bl += mv * 10;
      } else if (t === T_CLEAR || t === T_TREE) {
        r += mv * 30;
        g += mv * 36;
        bl += mv * 10;
      } else {
        r += mv * 18;
        g += mv * 16;
        bl += mv * 12;
      }
      if (map.oreType[i]) {
        // ore-stained ground
        r = r * 0.6 + 140 * 0.4;
        g = g * 0.6 + 116 * 0.4;
        bl = bl * 0.6 + 64 * 0.4;
      }
      this.colors[i * 3] = r;
      this.colors[i * 3 + 1] = g;
      this.colors[i * 3 + 2] = bl;
    }
  }

  /** screen-space bounding box origin of a chunk (relative to map origin) */
  chunkOrigin(ci: number, cj: number): [number, number] {
    const x0 = ci * CHUNK,
      y0 = cj * CHUNK;
    return [(x0 - y0 - CHUNK) * HW, (x0 + y0) * HH];
  }

  get(ci: number, cj: number): HTMLCanvasElement {
    const k = cj * this.cw + ci;
    let c = this.chunks.get(k);
    if (!c) this.chunks.set(k, (c = this.build(ci, cj)));
    return c;
  }

  build(ci: number, cj: number): HTMLCanvasElement {
    const W = CHUNK * 2 * HW,
      H = CHUNK * 2 * HH;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H + 2;
    const g = c.getContext("2d")!;
    const img = g.createImageData(W, H + 2);
    const d = img.data;
    const m = this.map;
    const [ox, oy] = this.chunkOrigin(ci, cj);
    const x0 = ci * CHUNK,
      y0 = cj * CHUNK;
    const x1 = Math.min(m.w, x0 + CHUNK),
      y1 = Math.min(m.h, y0 + CHUNK);
    const col = this.colors;
    const MW = m.w,
      MH = m.h;
    for (let py = 0; py < H + 2; py++) {
      const sy = oy + py + 0.5;
      for (let px = 0; px < W; px++) {
        const sx = ox + px + 0.5;
        const a = sx / HW,
          b = sy / HH;
        const X = (a + b) / 2,
          Y = (b - a) / 2;
        if (X < x0 || Y < y0 || X >= x1 || Y >= y1) continue;
        // bilinear blend between cell centres
        const fx = X - 0.5,
          fy = Y - 0.5;
        let ix = Math.floor(fx),
          iy = Math.floor(fy);
        let tx = fx - ix,
          ty = fy - iy;
        tx = tx * tx * (3 - 2 * tx);
        ty = ty * ty * (3 - 2 * ty);
        const ix0 = ix < 0 ? 0 : ix >= MW ? MW - 1 : ix,
          ix1 = ix + 1 >= MW ? MW - 1 : ix + 1 < 0 ? 0 : ix + 1;
        const iy0 = iy < 0 ? 0 : iy >= MH ? MH - 1 : iy,
          iy1 = iy + 1 >= MH ? MH - 1 : iy + 1 < 0 ? 0 : iy + 1;
        const i00 = (iy0 * MW + ix0) * 3,
          i10 = (iy0 * MW + ix1) * 3,
          i01 = (iy1 * MW + ix0) * 3,
          i11 = (iy1 * MW + ix1) * 3;
        const w00 = (1 - tx) * (1 - ty),
          w10 = tx * (1 - ty),
          w01 = (1 - tx) * ty,
          w11 = tx * ty;
        let r = col[i00] * w00 + col[i10] * w10 + col[i01] * w01 + col[i11] * w11;
        let gg = col[i00 + 1] * w00 + col[i10 + 1] * w10 + col[i01 + 1] * w01 + col[i11 + 1] * w11;
        let bb = col[i00 + 2] * w00 + col[i10 + 2] * w10 + col[i01 + 2] * w01 + col[i11 + 2] * w11;
        const cell = Math.floor(Y) * MW + Math.floor(X);
        const t = m.terrain[cell];
        // detail noise
        const n1 = vnoise(X * 7, Y * 7) - 0.5;
        const n2 = vnoise(X * 2.2 + 31, Y * 2.2 + 17) - 0.5;
        const grain = hash2(px + ci * 977, py + cj * 491) - 0.5;
        let k = 1 + n1 * 0.16 + n2 * 0.12 + grain * 0.06;
        const th = this.theme;
        if (t === T_WATER || t === T_SHALLOW) {
          const wv = vnoise(X * 3 + Y * 1.5, Y * 4) - 0.5;
          k = 1 + wv * (t === T_SHALLOW ? 0.14 : 0.22) + grain * 0.03;
          // fords: sandbars show through the water
          if (t === T_SHALLOW && vnoise(X * 2.5 + 9, Y * 2.5) > 0.62) k += 0.1;
        } else if (t === T_ICE) {
          // frozen sheet: smooth, with hairline cracks and wind-polished streaks
          k = 1 + n2 * 0.06 + grain * 0.02;
          const crack = Math.abs(vnoise(X * 1.1 + 3, Y * 1.1 + 11) - 0.5);
          if (crack < 0.011) k -= 0.16;
          if (vnoise(X * 0.9 + Y * 0.9, Y * 0.3) > 0.7) k += 0.07;
        } else if (t === T_ROUGH) k += (hash2(px * 3 + 7, py * 5 + ci) > 0.93 ? -0.25 : 0) + n1 * 0.1;
        else if (th === "snow") {
          k = 1 + n1 * 0.06 + n2 * 0.05 + grain * 0.03;
          if (hash2(px + 5 * cj, py * 3 + ci) > 0.985) k += 0.12; // glitter
        } else if (th === "desert" && t === T_SAND) {
          // wind ripples across the dunes
          const ripple = vnoise(X * 0.8, Y * 0.8) * 6 + (X - Y) * 2.2;
          k += (ripple - Math.floor(ripple) > 0.82 ? -0.07 : 0.02) + n1 * 0.05;
        } else if (t === T_CLEAR || t === T_TREE) {
          // grass blades speckle (dry and golden on the savanna, mossy on the tundra)
          if (hash2(px + 11 * cj, py * 2 + ci) > 0.96) k += th === "safari" ? 0.2 : 0.18;
          if (th === "safari" && hash2(px * 7 + ci, py * 3 + cj) > 0.985) k -= 0.18;
        }
        r *= k;
        gg *= k;
        bb *= k;
        const o = (py * W + px) * 4;
        d[o] = r < 0 ? 0 : r > 255 ? 255 : r;
        d[o + 1] = gg < 0 ? 0 : gg > 255 ? 255 : gg;
        d[o + 2] = bb < 0 ? 0 : bb > 255 ? 255 : bb;
        d[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  /** small RGB image, one pixel per cell (for minimap) */
  cellImage(): ImageData {
    const m = this.map;
    const img = new ImageData(m.w, m.h);
    for (let i = 0; i < m.w * m.h; i++) {
      img.data[i * 4] = this.colors[i * 3];
      img.data[i * 4 + 1] = this.colors[i * 3 + 1];
      img.data[i * 4 + 2] = this.colors[i * 3 + 2];
      img.data[i * 4 + 3] = 255;
      const t = m.terrain[i];
      if (t === T_TREE) {
        img.data[i * 4] *= 0.7;
        img.data[i * 4 + 1] *= 0.82;
        img.data[i * 4 + 2] *= 0.7;
      }
      if (t === T_ROCK) {
        const rk = this.base[T_ROCK];
        img.data[i * 4] = rk[0] * 0.75;
        img.data[i * 4 + 1] = rk[1] * 0.75;
        img.data[i * 4 + 2] = rk[2] * 0.75;
      }
    }
    return img;
  }
}

export { T_ROCK, T_TREE, T_WATER };
