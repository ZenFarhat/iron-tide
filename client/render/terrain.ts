// Procedural per-pixel terrain, cached in 16×16-cell chunks.
import type { GameMap } from "../../sim/map";
import { T_CLEAR, T_DIRT, T_PAVE, T_ROCK, T_ROUGH, T_SAND, T_TREE, T_WATER } from "../../sim/map";
import { HW, HH } from "./iso";

export const CHUNK = 16;

// base colours per terrain type
const BASE: Record<number, [number, number, number]> = {
  [T_CLEAR]: [92, 122, 58],
  [T_DIRT]: [134, 111, 72],
  [T_ROUGH]: [112, 102, 80],
  [T_WATER]: [36, 84, 116],
  [T_ROCK]: [118, 114, 104],
  [T_TREE]: [74, 104, 48],
  [T_SAND]: [190, 170, 122],
  [T_PAVE]: [112, 112, 112],
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
  constructor(map: GameMap) {
    this.map = map;
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
      if (t === T_CLEAR || t === T_TREE) {
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
        if (t === T_WATER) {
          const wv = vnoise(X * 3 + Y * 1.5, Y * 4) - 0.5;
          k = 1 + wv * 0.22 + grain * 0.03;
          // brighter towards shore
        } else if (t === T_ROUGH) k += (hash2(px * 3 + 7, py * 5 + ci) > 0.93 ? -0.25 : 0) + n1 * 0.1;
        else if (t === T_CLEAR || t === T_TREE) {
          // grass blades speckle
          if (hash2(px + 11 * cj, py * 2 + ci) > 0.96) k += 0.18;
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
        img.data[i * 4] = 90;
        img.data[i * 4 + 1] = 88;
        img.data[i * 4 + 2] = 84;
      }
    }
    return img;
  }
}

export { T_ROCK, T_TREE, T_WATER };
