// A tiny flat-shaded software 3D renderer used to generate all unit/structure sprites at
// runtime from primitive-based models (no external art assets).
import { HW, HH, ZH, VIEW } from "./iso";

export type Col = string; // "#rrggbb", "team", "team2", "team3", or prefix "!" for unlit/glowing

export interface Face {
  p: number[]; // flat xyz list
  c: Col;
}

const TAU = Math.PI * 2;

export class Model {
  faces: Face[] = [];

  quad(a: number[], b: number[], c: number[], d: number[], col: Col) {
    this.faces.push({ p: [...a, ...b, ...c, ...d], c: col });
    return this;
  }
  poly(pts: number[][], col: Col) {
    this.faces.push({ p: pts.flat(), c: col });
    return this;
  }

  /** axis-aligned box centred on (x,y), from z to z+h; l along x, w along y */
  box(x: number, y: number, z: number, l: number, w: number, h: number, col: Col, top?: Col) {
    const x0 = x - l / 2,
      x1 = x + l / 2,
      y0 = y - w / 2,
      y1 = y + w / 2,
      z0 = z,
      z1 = z + h;
    const t = top ?? col;
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], t); // top
    this.quad([x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0], col); // bottom
    this.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], col); // +x
    this.quad([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], col); // -x
    this.quad([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], col); // +y
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], col); // -y
    return this;
  }

  /** box rotated by yaw (radians) around its centre */
  boxR(x: number, y: number, z: number, l: number, w: number, h: number, yaw: number, col: Col, top?: Col) {
    const m = new Model().box(0, 0, z, l, w, h, col, top);
    const cs = Math.cos(yaw),
      sn = Math.sin(yaw);
    for (const f of m.faces) {
      for (let i = 0; i < f.p.length; i += 3) {
        const px = f.p[i],
          py = f.p[i + 1];
        f.p[i] = x + px * cs - py * sn;
        f.p[i + 1] = y + px * sn + py * cs;
      }
      this.faces.push(f);
    }
    return this;
  }

  /** box whose top slopes: hb = height at -x end, hf = height at +x end */
  wedge(x: number, y: number, z: number, l: number, w: number, hb: number, hf: number, col: Col, top?: Col) {
    const x0 = x - l / 2,
      x1 = x + l / 2,
      y0 = y - w / 2,
      y1 = y + w / 2;
    const t = top ?? col;
    this.quad([x0, y0, z + hb], [x1, y0, z + hf], [x1, y1, z + hf], [x0, y1, z + hb], t);
    this.quad([x0, y1, z], [x1, y1, z], [x1, y0, z], [x0, y0, z], col);
    this.quad([x1, y0, z], [x1, y1, z], [x1, y1, z + hf], [x1, y0, z + hf], col);
    this.quad([x0, y1, z], [x0, y0, z], [x0, y0, z + hb], [x0, y1, z + hb], col);
    this.poly([[x1, y1, z], [x0, y1, z], [x0, y1, z + hb], [x1, y1, z + hf]], col);
    this.poly([[x0, y0, z], [x1, y0, z], [x1, y0, z + hf], [x0, y0, z + hb]], col);
    return this;
  }

  /** box whose top is shrunk (frustum-like hull): top inset sx, sy */
  taper(x: number, y: number, z: number, l: number, w: number, h: number, tl: number, tw: number, col: Col, top?: Col, tx = 0) {
    const b = [
      [x - l / 2, y - w / 2, z],
      [x + l / 2, y - w / 2, z],
      [x + l / 2, y + w / 2, z],
      [x - l / 2, y + w / 2, z],
    ];
    const t = [
      [x + tx - tl / 2, y - tw / 2, z + h],
      [x + tx + tl / 2, y - tw / 2, z + h],
      [x + tx + tl / 2, y + tw / 2, z + h],
      [x + tx - tl / 2, y + tw / 2, z + h],
    ];
    this.poly([t[0], t[1], t[2], t[3]], top ?? col);
    this.poly([b[3], b[2], b[1], b[0]], col);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.poly([b[i], b[j], t[j], t[i]], col);
    }
    return this;
  }

  /** vertical cylinder / frustum */
  cyl(x: number, y: number, z: number, r: number, h: number, col: Col, seg = 12, rTop = r, top?: Col) {
    const ring = (rr: number, zz: number) => Array.from({ length: seg }, (_, i) => [x + Math.cos((i / seg) * TAU) * rr, y + Math.sin((i / seg) * TAU) * rr, zz]);
    const b = ring(r, z),
      t = ring(rTop, z + h);
    if (rTop > 0.001) this.poly(t, top ?? col);
    this.poly(b.slice().reverse(), col);
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      if (rTop > 0.001) this.poly([b[i], b[j], t[j], t[i]], col);
      else this.poly([b[i], b[j], [x, y, z + h]], col);
    }
    return this;
  }

  /** cylinder along an axis from point a, direction (dx,dy,dz) normalized, length len */
  tube(ax: number, ay: number, az: number, dx: number, dy: number, dz: number, len: number, r: number, col: Col, seg = 8, rEnd = r, cap?: Col) {
    // orthonormal basis
    const n = Math.hypot(dx, dy, dz);
    dx /= n;
    dy /= n;
    dz /= n;
    let ux = -dy,
      uy = dx,
      uz = 0;
    if (Math.abs(dz) > 0.9) {
      ux = 1;
      uy = 0;
      uz = 0;
    }
    const un = Math.hypot(ux, uy, uz);
    ux /= un;
    uy /= un;
    uz /= un;
    const vx = dy * uz - dz * uy,
      vy = dz * ux - dx * uz,
      vz = dx * uy - dy * ux;
    const ring = (rr: number, t: number) =>
      Array.from({ length: seg }, (_, i) => {
        const a = (i / seg) * TAU,
          c = Math.cos(a) * rr,
          s = Math.sin(a) * rr;
        return [ax + dx * t + ux * c + vx * s, ay + dy * t + uy * c + vy * s, az + dz * t + uz * c + vz * s];
      });
    const b = ring(r, 0),
      e = ring(rEnd, len);
    this.poly(b.slice().reverse(), cap ?? col);
    this.poly(e, cap ?? col);
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      this.poly([b[i], b[j], e[j], e[i]], col);
    }
    return this;
  }

  /** barrel along +x at height z */
  barrel(x: number, y: number, z: number, len: number, r: number, col: Col, seg = 6) {
    return this.tube(x, y, z, 1, 0, 0, len, r, col, seg);
  }

  /** wheel: cylinder along y axis */
  wheel(x: number, y: number, z: number, r: number, w: number, col: Col, hub?: Col) {
    this.tube(x, y - w / 2, z, 0, 1, 0, w, r, col, 10, r, hub ?? col);
    return this;
  }

  sphere(x: number, y: number, z: number, r: number, col: Col, segU = 10, segV = 6, sz = 1) {
    const pts: number[][][] = [];
    for (let v = 0; v <= segV; v++) {
      const phi = (v / segV) * Math.PI;
      const row: number[][] = [];
      for (let u = 0; u < segU; u++) {
        const th = (u / segU) * TAU;
        row.push([x + Math.sin(phi) * Math.cos(th) * r, y + Math.sin(phi) * Math.sin(th) * r, z + Math.cos(phi) * r * sz]);
      }
      pts.push(row);
    }
    for (let v = 0; v < segV; v++)
      for (let u = 0; u < segU; u++) {
        const u2 = (u + 1) % segU;
        if (v === 0) this.poly([pts[v][u], pts[v + 1][u], pts[v + 1][u2]], col);
        else if (v === segV - 1) this.poly([pts[v][u], pts[v + 1][u], pts[v][u2]], col);
        else this.poly([pts[v][u], pts[v + 1][u], pts[v + 1][u2], pts[v][u2]], col);
      }
    return this;
  }

  /** upper hemisphere sitting on z */
  dome(x: number, y: number, z: number, r: number, col: Col, segU = 12, segV = 4, sz = 1) {
    const rows: number[][][] = [];
    for (let v = 0; v <= segV; v++) {
      const phi = (v / segV) * (Math.PI / 2);
      rows.push(Array.from({ length: segU }, (_, u) => {
        const th = (u / segU) * TAU;
        return [x + Math.sin(phi) * Math.cos(th) * r, y + Math.sin(phi) * Math.sin(th) * r, z + Math.cos(phi) * r * sz];
      }));
    }
    for (let v = 0; v < segV; v++)
      for (let u = 0; u < segU; u++) {
        const u2 = (u + 1) % segU;
        if (v === 0) this.poly([rows[v][u], rows[v + 1][u], rows[v + 1][u2]], col);
        else this.poly([rows[v][u], rows[v + 1][u], rows[v + 1][u2], rows[v][u2]], col);
      }
    return this;
  }

  /** chain of tubes through points */
  path3(pts: number[][], r: number, col: Col, seg = 6) {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay, az] = pts[i],
        [bx, by, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, by - ay, bz - az);
      if (len > 1e-6) this.tube(ax, ay, az, bx - ax, by - ay, bz - az, len, r, col, seg);
    }
    return this;
  }

  /** lathe along x axis: profile = [[x, r], ...] */
  latheX(y: number, z: number, profile: [number, number][], col: Col | ((i: number) => Col), seg = 12) {
    const rings = profile.map(([px, r]) => Array.from({ length: seg }, (_, i) => [px, y + Math.cos((i / seg) * TAU) * r, z + Math.sin((i / seg) * TAU) * r]));
    for (let k = 0; k < rings.length - 1; k++) {
      const c = typeof col === "function" ? col(k) : col;
      for (let i = 0; i < seg; i++) {
        const j = (i + 1) % seg;
        const a = rings[k][i],
          b = rings[k][j],
          d = rings[k + 1][i],
          e = rings[k + 1][j];
        this.poly([a, b, e, d], c);
      }
    }
    return this;
  }

  /** flat plate (one-sided appearance from above) */
  plate(pts: [number, number][], z: number, col: Col, thick = 0.015) {
    const top = pts.map(([x, y]) => [x, y, z + thick]);
    const bot = pts.map(([x, y]) => [x, y, z]).reverse();
    this.poly(top, col);
    this.poly(bot, col);
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      this.poly([[pts[i][0], pts[i][1], z], [pts[j][0], pts[j][1], z], [pts[j][0], pts[j][1], z + thick], [pts[i][0], pts[i][1], z + thick]], col);
    }
    return this;
  }

  add(m: Model, dx = 0, dy = 0, dz = 0) {
    for (const f of m.faces) {
      const p = f.p.slice();
      for (let i = 0; i < p.length; i += 3) {
        p[i] += dx;
        p[i + 1] += dy;
        p[i + 2] += dz;
      }
      this.faces.push({ p, c: f.c });
    }
    return this;
  }
}

// ───────────────────────────── rasterizer ─────────────────────────────

export interface Sprite {
  c: HTMLCanvasElement;
  ox: number; // anchor in canvas px
  oy: number;
  s: number; // canvas px per screen px
}

const hexCache = new Map<string, [number, number, number]>();
export function hexRgb(h: string): [number, number, number] {
  let v = hexCache.get(h);
  if (!v) {
    const n = parseInt(h.slice(1), 16);
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    hexCache.set(h, v);
  }
  return v;
}

const L = (() => {
  const v = [-0.35, 0.62, 1.0];
  const n = Math.hypot(v[0], v[1], v[2]);
  return v.map((x) => x / n);
})();

export interface RenderOpts {
  yaw?: number;
  scale?: number; // canvas px per screen px
  team: string;
  outline?: boolean;
  alpha?: number;
  dark?: number; // 0..1 darkening (damaged)
  pitch?: number; // rotation around y (lying down)
  ghost?: boolean;
}

function teamShade(team: [number, number, number], k: number): [number, number, number] {
  return [Math.min(255, team[0] * k), Math.min(255, team[1] * k), Math.min(255, team[2] * k)];
}

export function renderModel(model: Model, o: RenderOpts): Sprite {
  const S = o.scale ?? 1;
  const yaw = o.yaw ?? 0;
  const cs = Math.cos(yaw),
    sn = Math.sin(yaw);
  const pc = Math.cos(o.pitch ?? 0),
    ps = Math.sin(o.pitch ?? 0);
  const team = hexRgb(o.team);
  const dark = o.dark ?? 0;
  type PF = { sx: number[]; sy: number[]; depth: number; rgb: [number, number, number] };
  const out: PF[] = [];
  let minX = 1e9,
    minY = 1e9,
    maxX = -1e9,
    maxY = -1e9;
  for (const f of model.faces) {
    const p = f.p;
    const n = p.length / 3;
    const wx: number[] = new Array(n),
      wy: number[] = new Array(n),
      wz: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      let x = p[i * 3],
        y = p[i * 3 + 1],
        z = p[i * 3 + 2];
      if (o.pitch) {
        const x2 = x * pc - z * ps,
          z2 = x * ps + z * pc;
        x = x2;
        z = z2;
      }
      wx[i] = x * cs - y * sn;
      wy[i] = x * sn + y * cs;
      wz[i] = z;
    }
    // Newell normal
    let nx = 0,
      ny = 0,
      nz = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      nx += (wy[i] - wy[j]) * (wz[i] + wz[j]);
      ny += (wz[i] - wz[j]) * (wx[i] + wx[j]);
      nz += (wx[i] - wx[j]) * (wy[i] + wy[j]);
    }
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const sx: number[] = new Array(n),
      sy: number[] = new Array(n);
    let cx = 0,
      cy = 0,
      cz = 0;
    for (let i = 0; i < n; i++) {
      sx[i] = (wx[i] - wy[i]) * HW * S;
      sy[i] = ((wx[i] + wy[i]) * HH - wz[i] * ZH) * S;
      if (sx[i] < minX) minX = sx[i];
      if (sx[i] > maxX) maxX = sx[i];
      if (sy[i] < minY) minY = sy[i];
      if (sy[i] > maxY) maxY = sy[i];
      cx += wx[i];
      cy += wy[i];
      cz += wz[i];
    }
    const facing = nx * VIEW[0] + ny * VIEW[1] + nz * VIEW[2];
    if (facing <= 0.0001) continue;
    cx /= n;
    cy /= n;
    cz /= n;
    let col = f.c;
    let lit = true;
    if (col[0] === "!") {
      lit = false;
      col = col.slice(1);
    }
    let base: [number, number, number];
    if (col === "team") base = team;
    else if (col === "team2") base = teamShade(team, 0.62);
    else if (col === "team3") base = [Math.min(255, team[0] * 0.6 + 100), Math.min(255, team[1] * 0.6 + 100), Math.min(255, team[2] * 0.6 + 100)];
    else base = hexRgb(col);
    let k = 1;
    if (lit) {
      const d = nx * L[0] + ny * L[1] + nz * L[2];
      k = 0.42 + 0.66 * Math.max(0, d);
    }
    k *= 1 - dark;
    out.push({ sx, sy, depth: cx * VIEW[0] + cy * VIEW[1] + cz * VIEW[2], rgb: [Math.min(255, base[0] * k), Math.min(255, base[1] * k), Math.min(255, base[2] * k)] });
  }
  out.sort((a, b) => a.depth - b.depth);
  const pad = 3 * S;
  if (minX > maxX) {
    minX = maxX = minY = maxY = 0;
  }
  const w = Math.max(1, Math.ceil(maxX - minX + pad * 2)),
    h = Math.max(1, Math.ceil(maxY - minY + pad * 2));
  const ox = -minX + pad,
    oy = -minY + pad;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.lineJoin = "round";
  g.lineWidth = 0.7 * S;
  for (const f of out) {
    const col = `rgb(${f.rgb[0] | 0},${f.rgb[1] | 0},${f.rgb[2] | 0})`;
    g.fillStyle = col;
    g.strokeStyle = col;
    g.beginPath();
    g.moveTo(f.sx[0] + ox, f.sy[0] + oy);
    for (let i = 1; i < f.sx.length; i++) g.lineTo(f.sx[i] + ox, f.sy[i] + oy);
    g.closePath();
    g.fill();
    g.stroke();
  }
  let final = c;
  if (o.outline !== false) {
    final = document.createElement("canvas");
    final.width = w;
    final.height = h;
    const f = final.getContext("2d")!;
    const r = Math.max(1, Math.round(S * 0.8));
    for (const [dx, dy] of [
      [r, 0],
      [-r, 0],
      [0, r],
      [0, -r],
    ])
      f.drawImage(c, dx, dy);
    f.globalCompositeOperation = "source-in";
    f.fillStyle = "rgba(10,12,16,0.75)";
    f.fillRect(0, 0, w, h);
    f.globalCompositeOperation = "source-over";
    f.drawImage(c, 0, 0);
  }
  if (o.alpha !== undefined && o.alpha < 1) {
    const a = document.createElement("canvas");
    a.width = w;
    a.height = h;
    const g2 = a.getContext("2d")!;
    g2.globalAlpha = o.alpha;
    g2.drawImage(final, 0, 0);
    final = a;
  }
  return { c: final, ox, oy, s: S };
}

/** Draw sprite with its anchor at screen (x,y) in the current (CSS px) transform. */
export function drawSprite(g: CanvasRenderingContext2D, sp: Sprite, x: number, y: number, alpha = 1) {
  if (alpha !== 1) g.globalAlpha = alpha;
  g.drawImage(sp.c, x - sp.ox / sp.s, y - sp.oy / sp.s, sp.c.width / sp.s, sp.c.height / sp.s);
  if (alpha !== 1) g.globalAlpha = 1;
}
