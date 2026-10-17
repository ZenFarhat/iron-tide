// Main frame renderer (Canvas 2D).
import type { World } from "../../sim/world";
import type { Entity } from "../../sim/entity";
import { CONSTRUCT_TICKS, RULES, SELL_TICKS, SUPERWEAPONS, WEAPONS } from "../../sim/rules";
import { T_ROCK, T_TREE } from "../../sim/map";
import { HW, HH, ZH, toScreen, toWorld } from "./iso";
import { drawSprite } from "./model3d";
import { TerrainCache, CHUNK } from "./terrain";
import {
  facing32,
  facing8,
  getStructModel,
  getUnitModel,
  infantrySprite,
  oreSprite,
  rockSprite,
  structGhost,
  structSprite,
  structTurret,
  teamHex,
  treeSprite,
  vehicleBody,
  vehicleTurret,
} from "./sprites";
import { Fx } from "./fx";
import { MARK_LIFE, type MarkKind, type Optimistic } from "../optimistic";

export type CursorKind =
  | "default"
  | "select"
  | "move"
  | "nomove"
  | "attack"
  | "enter"
  | "capture"
  | "repair"
  | "norepair"
  | "sell"
  | "nosell"
  | "deploy"
  | "nodeploy"
  | "harvest"
  | "sw"
  | "place"
  | "amove"
  | "pan";

export interface Mode {
  kind: "none" | "place" | "sell" | "repair" | "sw" | "amove" | "ffire" | "rally";
  type?: string; // structure type or sw kind
  step?: number;
  x?: number;
  y?: number;
}

export interface ViewState {
  me: number;
  selection: Set<number>;
  hoverId: number;
  hoverCell: [number, number] | null;
  mode: Mode;
  dragBox: { x0: number; y0: number; x1: number; y1: number } | null;
  mouse: { x: number; y: number; inside: boolean };
  cursor: CursorKind;
  groups: Map<number, number>; // entity id → group number
  showAllHealth: boolean;
  /** the local player's unconfirmed commands and click markers */
  opt: Optimistic;
}

const MARK_RGB: Record<MarkKind, string> = {
  move: "120,255,140",
  amove: "255,150,80",
  attack: "255,80,70",
  enter: "110,200,255",
  harvest: "255,210,90",
  rally: "235,240,255",
  sw: "255,220,120",
};

export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  vw = 800;
  vh = 600;
}

const TAU = Math.PI * 2;

export class Renderer {
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  world: World;
  terrain: TerrainCache;
  cam = new Camera();
  fx: Fx;
  dpr = 1;
  shroud: HTMLCanvasElement;
  shroudVersion = -1;
  colorOf: (owner: number) => number;
  /** game-time clock for world animation; uiTime is real time for cursors and click feedback */
  time = 0;
  uiTime = 0;
  /** game seconds per real second this frame (0 while paused); scales per-frame particle spawns */
  private simRate = 1;
  private trailT = 0;
  /** screen-space weather particles (snowflakes, dust motes), in css px */
  private weather: { x: number; y: number; s: number; v: number; ph: number }[] = [];

  constructor(canvas: HTMLCanvasElement, world: World, fx: Fx) {
    this.canvas = canvas;
    this.g = canvas.getContext("2d", { alpha: false })!;
    this.world = world;
    this.fx = fx;
    this.terrain = new TerrainCache(world.map);
    this.shroud = document.createElement("canvas");
    this.shroud.width = world.map.w + 2;
    this.shroud.height = world.map.h + 2;
    this.colorOf = (o) => world.players[o]?.color ?? 0;
  }

  team(owner: number) {
    return teamHex(owner, this.colorOf);
  }

  resize(w: number, h: number) {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";
    this.cam.vw = w;
    this.cam.vh = h;
    this.clampCamera();
  }

  /** world-screen bounds of the map diamond */
  mapBounds() {
    const m = this.world.map;
    return { x0: -m.h * HW, x1: m.w * HW, y0: 0, y1: (m.w + m.h) * HH };
  }

  clampCamera() {
    const b = this.mapBounds();
    const vw = this.cam.vw / this.cam.zoom,
      vh = this.cam.vh / this.cam.zoom;
    this.cam.x = Math.max(b.x0 - vw / 2, Math.min(b.x1 - vw / 2, this.cam.x));
    this.cam.y = Math.max(b.y0 - vh / 2, Math.min(b.y1 - vh / 2, this.cam.y));
  }

  centerOn(x: number, y: number) {
    const [sx, sy] = toScreen(x, y, 0);
    this.cam.x = sx - this.cam.vw / this.cam.zoom / 2;
    this.cam.y = sy - this.cam.vh / this.cam.zoom / 2;
    this.clampCamera();
  }

  /** css px (relative to canvas) → world-screen px */
  screenToWorldScreen(mx: number, my: number): [number, number] {
    return [this.cam.x + mx / this.cam.zoom, this.cam.y + my / this.cam.zoom];
  }
  /** css px → fractional cell coords */
  screenToCell(mx: number, my: number): [number, number] {
    const [sx, sy] = this.screenToWorldScreen(mx, my);
    return toWorld(sx, sy);
  }
  worldToCss(x: number, y: number, z = 0): [number, number] {
    const [sx, sy] = toScreen(x, y, z);
    return [(sx - this.cam.x) * this.cam.zoom, (sy - this.cam.y) * this.cam.zoom];
  }

  lerpPos(e: Entity, a: number): [number, number, number] {
    return [e.px + (e.x - e.px) * a, e.py + (e.y - e.py) * a, e.pz + (e.z - e.pz) * a];
  }

  visibleTo(me: number, e: Entity): boolean {
    if (me < 0) return true;
    if (e.owner === me || this.world.isAlly(me, e.owner)) return true;
    return this.world.players[me].explored[e.cell] === 1;
  }

  /** screen-space anchor for entity muzzle (for effects) */
  muzzleOf(e: Entity): [number, number, number] {
    if (e.kind === "bld") {
      const sm = getStructModel(e.type);
      const tip = sm.tip ?? [e.r.w / 2, e.r.h / 2, sm.height * 0.8];
      if (sm.turret && sm.pivot && sm.tip) {
        const a = (e.turret / 256) * TAU;
        const [tx, ty, tz] = sm.tip;
        return [(e.bx + sm.pivot[0] + tx * Math.cos(a) - ty * Math.sin(a)) * 256, (e.by + sm.pivot[1] + tx * Math.sin(a) + ty * Math.cos(a)) * 256, (sm.pivot[2] + tz) * 256];
      }
      return [(e.bx + tip[0]) * 256, (e.by + tip[1]) * 256, tip[2] * 256];
    }
    if (e.kind === "inf") {
      const a = (e.facing / 256) * TAU;
      return [e.x + Math.cos(a) * 50, e.y + Math.sin(a) * 50, e.z + (e.deployed ? 60 : 85)];
    }
    const m = getUnitModel(e.type);
    const bf = (e.facing / 256) * TAU;
    if (m.turret && m.pivot) {
      const tf = (e.turret / 256) * TAU;
      const [px, py, pz] = m.pivot;
      const [tx, ty, tz] = m.tip;
      const wx = px * Math.cos(bf) - py * Math.sin(bf) + tx * Math.cos(tf) - ty * Math.sin(tf);
      const wy = px * Math.sin(bf) + py * Math.cos(bf) + tx * Math.sin(tf) + ty * Math.cos(tf);
      return [e.x + wx * 256, e.y + wy * 256, e.z + (pz + tz) * 256];
    }
    const [tx, ty, tz] = m.tip;
    return [e.x + (tx * Math.cos(bf) - ty * Math.sin(bf)) * 256, e.y + (tx * Math.sin(bf) + ty * Math.cos(bf)) * 256, e.z + tz * 256];
  }

  private updateShroud(me: number) {
    const p = this.world.players[me];
    if (!p || p.exploredVersion === this.shroudVersion) return;
    this.shroudVersion = p.exploredVersion;
    const m = this.world.map;
    const W = m.w + 2,
      H = m.h + 2;
    const g = this.shroud.getContext("2d")!;
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        const inside = x > 0 && y > 0 && x <= m.w && y <= m.h;
        const ex = inside && p.explored[(y - 1) * m.w + (x - 1)];
        img.data[o + 3] = ex ? 0 : 255;
      }
    g.putImageData(img, 0, 0);
  }

  draw(alpha: number, vs: ViewState, dt: number, simDt = dt) {
    this.time += simDt;
    this.uiTime += dt;
    this.simRate = dt > 0 ? simDt / dt : 1;
    const g = this.g;
    const w = this.world;
    const cam = this.cam;
    const z = cam.zoom * this.dpr;
    const shake = this.fx.shake;
    const shx = shake ? (Math.random() - 0.5) * shake : 0,
      shy = shake ? (Math.random() - 0.5) * shake : 0;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = "#07090b";
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    g.imageSmoothingEnabled = true;
    g.setTransform(z, 0, 0, z, (-cam.x + shx) * z, (-cam.y + shy) * z);
    const vx0 = cam.x - 80,
      vy0 = cam.y - 120,
      vx1 = cam.x + cam.vw / cam.zoom + 80,
      vy1 = cam.y + cam.vh / cam.zoom + 160;
    const inView = (sx: number, sy: number) => sx > vx0 && sx < vx1 && sy > vy0 && sy < vy1;
    const m = w.map;

    // terrain chunks
    const tc = this.terrain;
    for (let cj = 0; cj < tc.ch; cj++)
      for (let ci = 0; ci < tc.cw; ci++) {
        const [ox, oy] = tc.chunkOrigin(ci, cj);
        if (ox > vx1 || oy > vy1 || ox + CHUNK * 2 * HW < vx0 || oy + CHUNK * 2 * HH < vy0) continue;
        g.drawImage(tc.get(ci, cj), ox, oy);
      }

    // visible cell range
    const corners = [toWorld(vx0, vy0), toWorld(vx1, vy0), toWorld(vx0, vy1), toWorld(vx1, vy1)];
    const cx0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[0])))),
      cx1 = Math.min(m.w - 1, Math.ceil(Math.max(...corners.map((c) => c[0]))));
    const cy0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[1])))),
      cy1 = Math.min(m.h - 1, Math.ceil(Math.max(...corners.map((c) => c[1]))));
    const me = vs.me;
    const explored = me >= 0 ? w.players[me].explored : null;

    // ore
    for (let y = cy0; y <= cy1; y++)
      for (let x = cx0; x <= cx1; x++) {
        const i = y * m.w + x;
        const ot = m.oreType[i];
        if (!ot || !m.ore[i]) continue;
        const sx = (x - y) * HW,
          sy = (x + y) * HH;
        if (!inView(sx, sy)) continue;
        const lvl = Math.min(4, 1 + Math.floor((m.ore[i] - 1) / 3));
        drawSprite(g, oreSprite(ot === 2, lvl, m.variant[i]), sx, sy);
      }

    this.fx.drawDecals(g, inView);

    // placement grid (under buildings)
    if (vs.mode.kind === "place" && vs.hoverCell && vs.mode.type && me >= 0) this.drawPlacement(vs);

    // collect drawables
    type D = { d: number; k: number; e?: Entity; x: number; y: number; z: number; v?: number };
    const list: D[] = [];
    const air: D[] = [];
    for (const e of w.ents) {
      if (e.dead) continue;
      if (!this.visibleTo(me, e)) continue;
      if (e.kind === "bld") {
        const [sx, sy] = toScreen(e.bx * 256, e.by * 256, 0);
        if (sx < vx0 - e.r.w * HW * 2 || sx > vx1 + e.r.h * HW * 2 || sy > vy1 + 50 || sy + (e.r.w + e.r.h) * HH < vy0) continue;
        list.push({ d: e.bx + e.r.w / 2 + e.by + e.r.h / 2, k: 0, e, x: sx, y: sy, z: 0 });
        continue;
      }
      const [x, y, zz] = this.lerpPos(e, alpha);
      const [sx, sy] = toScreen(x, y, zz);
      if (!inView(sx, sy)) continue;
      let d = (x + y) / 256;
      // units standing on a structure (jets on pads, vehicles in a repair bay) sit on top of it;
      // sorting by the structure's centre would otherwise hide the ones on its back half
      const host = w.bldAt[e.cell] ? w.get(w.bldAt[e.cell]) : undefined;
      if (host) d = Math.max(d, host.bx + host.r.w / 2 + host.by + host.r.h / 2 + 0.01 + d * 1e-4);
      const item = { d, k: e.kind === "inf" ? 2 : 1, e, x: sx, y: sy, z: zz };
      if (e.kind === "air" && zz > 30) {
        air.push(item);
        // shadow
        const [gx, gy] = toScreen(x, y, 0);
        const um = getUnitModel(e.type);
        g.fillStyle = "rgba(0,0,0,0.22)";
        g.beginPath();
        g.ellipse(gx, gy, um.shadow[0] * 34, um.shadow[1] * 20, 0, 0, TAU);
        g.fill();
      } else list.push(item);
    }
    // props
    for (let y = cy0; y <= cy1; y++)
      for (let x = cx0; x <= cx1; x++) {
        const i = y * m.w + x;
        const t = m.terrain[i];
        if (t !== T_TREE && t !== T_ROCK) continue;
        const sx = (x - y) * HW,
          sy = (x + y + 1) * HH;
        if (!inView(sx, sy)) continue;
        // trees beside water grow differently (desert palms)
        let wet = 0;
        if (t === T_TREE)
          for (const n of [i - 1, i + 1, i - m.w, i + m.w]) if (n >= 0 && n < m.terrain.length && m.waterOk(n)) wet = 256;
        list.push({ d: x + y + 1, k: t === T_TREE ? 3 : 4, x: sx, y: sy, z: 0, v: m.variant[i] + wet });
      }
    // structures placed by us but not started by the sim yet (optimistic preview)
    if (me >= 0)
      vs.opt.pending.forEach((pc, i) => {
        const r = pc.cmd.c === "place" ? RULES[pc.cmd.type] : undefined;
        if (!r || pc.cmd.c !== "place") return;
        const [sx, sy] = toScreen(pc.cmd.x * 256, pc.cmd.y * 256, 0);
        list.push({ d: pc.cmd.x + r.w / 2 + pc.cmd.y + r.h / 2, k: 7, x: sx, y: sy, z: 0, v: i });
      });
    // wrecks & corpses
    for (const c of this.fx.wrecks) {
      const [sx, sy] = toScreen(c.x, c.y, 0);
      if (inView(sx, sy)) list.push({ d: (c.x + c.y) / 256 - 0.3, k: 5, x: sx, y: sy, z: 0, v: this.fx.wrecks.indexOf(c) });
    }
    for (const c of this.fx.corpses) {
      const [sx, sy] = toScreen(c.x, c.y, 0);
      if (inView(sx, sy)) list.push({ d: (c.x + c.y) / 256 - 0.2, k: 6, x: sx, y: sy, z: 0, v: this.fx.corpses.indexOf(c) });
    }
    list.sort((a, b) => a.d - b.d);

    // shadows for ground vehicles
    for (const it of list) {
      if (it.k !== 1 || !it.e) continue;
      const um = getUnitModel(it.e.type);
      g.fillStyle = "rgba(0,0,0,0.28)";
      g.beginPath();
      g.ellipse(it.x + 2, it.y + 2, um.shadow[0] * 34, um.shadow[1] * 20, 0, 0, TAU);
      g.fill();
    }
    for (const it of list) {
      switch (it.k) {
        case 0:
          this.drawStructure(it.e!, it.x, it.y, vs);
          break;
        case 1:
          this.drawVehicle(it.e!, it.x, it.y);
          break;
        case 2:
          this.drawInfantry(it.e!, it.x, it.y);
          break;
        case 3:
          drawSprite(g, treeSprite(it.v! & 255, m.theme, it.v! >= 256), it.x, it.y);
          break;
        case 4:
          drawSprite(g, rockSprite(it.v!, m.theme), it.x, it.y - HH);
          break;
        case 5: {
          const c = this.fx.wrecks[it.v!];
          const a = Math.min(1, (c.life - c.t) / 3);
          drawSprite(g, vehicleBody(c.type, facing32(c.facing), this.team(c.owner), 0.65), it.x, it.y, a);
          break;
        }
        case 7: {
          const cmd = vs.opt.pending[it.v!].cmd;
          if (cmd.c === "place") this.drawPendingPlacement(cmd.type, cmd.x, cmd.y, it.x, it.y, me);
          break;
        }
        case 6: {
          const c = this.fx.corpses[it.v!];
          const a = Math.min(1, (c.life - c.t) / 2);
          drawSprite(g, infantrySprite(c.type, facing8(c.facing), 0, this.team(c.owner), true), it.x, it.y, a * (c.death === "melt" ? 0.5 : 1));
          break;
        }
      }
    }

    // projectiles
    this.drawProjectiles(alpha, inView, simDt);
    // aircraft
    air.sort((a, b) => a.d - b.d);
    for (const it of air) this.drawVehicle(it.e!, it.x, it.y);
    this.fx.draw(g, inView);

    // shroud
    if (me >= 0) {
      this.updateShroud(me);
      g.save();
      g.setTransform(HW * z, HH * z, -HW * z, HH * z, (-cam.x + shx) * z, (-cam.y + shy) * z);
      g.imageSmoothingEnabled = true;
      g.drawImage(this.shroud, -1, -1);
      g.restore();
    }

    // overlays
    this.drawOverlays(vs, alpha);
    this.drawWeather(dt);

    // screen space
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.fx.flash > 0) {
      g.fillStyle = `rgba(255,250,235,${Math.min(0.9, this.fx.flash)})`;
      g.fillRect(0, 0, cam.vw, cam.vh);
    }
    if (vs.dragBox) {
      const b = vs.dragBox;
      g.strokeStyle = "rgba(255,255,255,0.9)";
      g.lineWidth = 1;
      g.fillStyle = "rgba(160,220,255,0.08)";
      const x = Math.min(b.x0, b.x1),
        y = Math.min(b.y0, b.y1);
      g.fillRect(x, y, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
      g.strokeRect(x + 0.5, y + 0.5, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
    }
    if (vs.mouse.inside) drawCursor(g, vs.cursor, vs.mouse.x, vs.mouse.y, this.uiTime);
  }

  /** biome weather drawn over the battlefield: snowfall, tundra flurries, drifting desert dust */
  private drawWeather(dt: number) {
    const theme = this.world.map.theme;
    const n = theme === "snow" ? 160 : theme === "tundra" ? 55 : theme === "desert" ? 40 : 0;
    if (!n) return;
    const g = this.g;
    const vw = this.cam.vw,
      vh = this.cam.vh;
    while (this.weather.length < n) this.weather.push({ x: Math.random() * vw, y: Math.random() * vh, s: 0.6 + Math.random() * 1.6, v: 0.6 + Math.random() * 0.8, ph: Math.random() * 6 });
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const dust = theme === "desert";
    g.fillStyle = dust ? "rgba(235,205,150,0.35)" : "rgba(255,255,255,0.8)";
    const rate = dt * this.simRate;
    for (const f of this.weather) {
      if (dust) {
        f.x += (40 + f.v * 30) * rate;
        f.y += Math.sin(this.time + f.ph) * 6 * rate;
      } else {
        f.y += (26 + f.v * 34) * f.s * rate;
        f.x += (Math.sin(this.time * 0.8 + f.ph) * 10 - 8) * rate;
      }
      if (f.y > vh + 4) (f.y = -4), (f.x = Math.random() * vw);
      if (f.x > vw + 4) f.x = -4;
      if (f.x < -4) f.x = vw + 4;
      g.beginPath();
      g.arc(f.x, f.y, dust ? f.s * 0.8 : f.s, 0, TAU);
      g.fill();
    }
  }

  private drawPlacement(vs: ViewState) {
    const g = this.g;
    const w = this.world;
    const r = RULES[vs.mode.type!];
    const [hx, hy] = vs.hoverCell!;
    const bx = hx - Math.floor((r.w - 1) / 2),
      by = hy - Math.floor((r.h - 1) / 2);
    const p = w.players[vs.me];
    const ok = w.placementOk(p, r.id, bx, by);
    for (let y = by; y < by + r.h; y++)
      for (let x = bx; x < bx + r.w; x++) {
        let cellOk = ok;
        if (!w.map.inside(x, y)) cellOk = false;
        else {
          const i = y * w.map.w + x;
          if (!w.siteOk(r, i) || w.bldAt[i] || !p.explored[i] || (w.vehAt[i] && w.get(w.vehAt[i])) || w.infAt[i]) cellOk = false;
        }
        const sx = (x - y) * HW,
          sy = (x + y) * HH;
        g.fillStyle = cellOk ? "rgba(80,255,120,0.28)" : "rgba(255,60,60,0.35)";
        g.strokeStyle = cellOk ? "rgba(140,255,170,0.8)" : "rgba(255,120,120,0.8)";
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(sx, sy);
        g.lineTo(sx + HW, sy + HH);
        g.lineTo(sx, sy + 2 * HH);
        g.lineTo(sx - HW, sy + HH);
        g.closePath();
        g.fill();
        g.stroke();
      }
    const [ax, ay] = toScreen(bx * 256, by * 256, 0);
    drawSprite(g, structGhost(r.id, this.team(vs.me)), ax, ay);
  }

  private drawStructure(e: Entity, sx: number, sy: number, vs: ViewState) {
    const g = this.g;
    const w = this.world;
    const team = this.team(e.owner);
    const r = e.r;
    const damaged = e.hp < r.hp * 0.5;
    const off = (r.needsPower && !e.powered) || e.disabledUntil > w.tick;
    const dark = off ? 0.4 : damaged ? 0.22 : 0;
    const sp = structSprite(e.type, team, dark);
    let prog = 1;
    if (e.built < CONSTRUCT_TICKS) prog = e.built / CONSTRUCT_TICKS;
    if (e.selling > 0) prog = 1 - e.selling / SELL_TICKS;
    if (prog < 1) {
      const top = sy - sp.oy / sp.s,
        h = sp.c.height / sp.s;
      const cut = top + h * (1 - prog);
      g.save();
      g.beginPath();
      g.rect(sx - sp.ox / sp.s - 4, cut, sp.c.width / sp.s + 8, h);
      g.clip();
      drawSprite(g, sp, sx, sy);
      g.restore();
      // construction glow line
      g.save();
      g.globalCompositeOperation = "lighter";
      g.strokeStyle = "rgba(150,230,255,0.7)";
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(sx - sp.ox / sp.s, cut);
      g.lineTo(sx - sp.ox / sp.s + sp.c.width / sp.s, cut);
      g.stroke();
      g.restore();
      // footprint outline
      this.footprint(e, "rgba(150,230,255,0.4)");
      return;
    }
    drawSprite(g, sp, sx, sy);
    const sm = getStructModel(e.type);
    if (sm.turret && sm.pivot) {
      let f = e.turret;
      if (r.radar) f = e.owner >= 0 && !w.players[e.owner].lowPower ? Math.floor(this.time * 40 + e.id * 13) & 255 : e.turret;
      const ts = structTurret(e.type, facing32(f), team);
      if (ts) {
        const [px, py, pz] = sm.pivot;
        drawSprite(g, ts, sx + (px - py) * HW, sy + (px + py) * HH - pz * ZH);
      }
    }
    // glows
    if ((r.chargeable && e.chargedUntil > w.tick) || (r.superweapon && e.owner >= 0 && e.swCharge >= SUPERWEAPONS[r.superweapon].charge)) {
      const tip = sm.tip ?? [r.w / 2, r.h / 2, sm.height];
      const gx = sx + (tip[0] - tip[1]) * HW,
        gy = sy + (tip[0] + tip[1]) * HH - tip[2] * ZH;
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 6);
      g.save();
      g.globalCompositeOperation = "lighter";
      const grd = g.createRadialGradient(gx, gy, 1, gx, gy, 18 + pulse * 6);
      grd.addColorStop(0, r.chargeable ? "rgba(170,220,255,0.9)" : "rgba(255,240,170,0.8)");
      grd.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grd;
      g.fillRect(gx - 26, gy - 26, 52, 52);
      g.restore();
    }
    if (e.invuln > w.tick) this.invulnGlow(sp, sx, sy);
    // damage smoke / fire
    if (damaged && this.chance(0.08 * Math.max(r.w, 1))) {
      const fx = (e.bx + 0.2 + Math.random() * (r.w - 0.4)) * 256,
        fy = (e.by + 0.2 + Math.random() * (r.h - 0.4)) * 256;
      this.fx.smoke(fx, fy, sm.height * 200, 5, 0.75, 2);
      if (e.hp < r.hp * 0.25) this.fx.fire(fx, fy, sm.height * 150, 5);
    }
    if (e.repairing && this.chance(0.15)) this.fx.sparks(e.x, e.y, sm.height * 220, 2, [255, 255, 140]);
    void vs;
  }

  /** corner brackets around a unit (selection, or a flashing order target) */
  private bracket(e: Entity, sx: number, sy: number, color: string) {
    const g = this.g;
    const inf = e.kind === "inf";
    const bw = inf ? 14 : 34,
      bh = inf ? 24 : 26;
    const cy = sy - (inf ? 12 : 8);
    const x0 = sx - bw / 2,
      y0 = cy - bh / 2,
      x1 = sx + bw / 2,
      y1 = cy + bh / 2,
      L = inf ? 4 : 6;
    g.strokeStyle = color;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x0, y0 + L);
    g.lineTo(x0, y0);
    g.lineTo(x0 + L, y0);
    g.moveTo(x1 - L, y0);
    g.lineTo(x1, y0);
    g.lineTo(x1, y0 + L);
    g.moveTo(x1, y1 - L);
    g.lineTo(x1, y1);
    g.lineTo(x1 - L, y1);
    g.moveTo(x0 + L, y1);
    g.lineTo(x0, y1);
    g.lineTo(x0, y1 - L);
    g.stroke();
  }

  /** a structure the local player has placed but the sim hasn't started yet */
  private drawPendingPlacement(type: string, bx: number, by: number, sx: number, sy: number, me: number) {
    const r = RULES[type];
    this.footprintRect(bx, by, r.w, r.h, "rgba(150,230,255,0.6)");
    drawSprite(this.g, structGhost(r.id, this.team(me)), sx, sy, 0.55 + 0.2 * Math.sin(this.uiTime * 10));
  }

  /** instant feedback for the local player's orders while their turn is in flight */
  private drawFeedback(vs: ViewState, alpha: number) {
    const g = this.g;
    const w = this.world;
    const pulse = 0.45 + 0.35 * Math.sin(this.uiTime * 14);
    for (const { cmd } of vs.opt.pending) {
      if (cmd.c !== "sell" && cmd.c !== "repair") continue;
      const e = w.get(cmd.t);
      if (e) this.footprint(e, cmd.c === "sell" ? `rgba(255,210,90,${pulse})` : `rgba(120,255,140,${pulse})`);
    }
    for (const m of vs.opt.marks) {
      const k = m.t / MARK_LIFE;
      const rgb = MARK_RGB[m.kind];
      if (m.target) {
        // flash the target three times
        const e = w.get(m.target);
        if (!e || Math.floor(k * 6) % 2) continue;
        if (e.kind === "bld") this.footprint(e, `rgba(${rgb},0.95)`);
        else {
          const [x, y, zz] = this.lerpPos(e, alpha);
          const [sx, sy] = toScreen(x, y, zz);
          this.bracket(e, sx, sy, `rgba(${rgb},0.95)`);
        }
        continue;
      }
      // ground marker: a ring that snaps inward onto the clicked spot
      const [sx, sy] = toScreen(m.x, m.y, 0);
      const r = 5 + 17 * (1 - k) * (1 - k);
      g.lineWidth = 2;
      g.strokeStyle = `rgba(${rgb},${1 - k})`;
      g.beginPath();
      g.ellipse(sx, sy, r, r / 2, 0, 0, TAU);
      g.stroke();
      g.lineWidth = 1;
      g.strokeStyle = `rgba(${rgb},${0.8 * (1 - k)})`;
      g.beginPath();
      g.ellipse(sx, sy, 4, 2, 0, 0, TAU);
      g.stroke();
    }
  }

  private invulnGlow(sp: { c: HTMLCanvasElement; ox: number; oy: number; s: number }, sx: number, sy: number) {
    const g = this.g;
    g.save();
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.35 + 0.15 * Math.sin(this.time * 8);
    g.filter = "sepia(1) saturate(4) brightness(1.2)";
    drawSprite(g, sp, sx, sy);
    g.restore();
  }

  /** per-frame random spawn with probability p at normal speed */
  private chance(p: number) {
    return Math.random() < p * this.simRate;
  }

  private footprint(e: Entity, color: string) {
    this.footprintRect(e.bx, e.by, e.r.w, e.r.h, color);
  }

  private footprintRect(bx: number, by: number, w: number, h: number, color: string) {
    const g = this.g;
    const x0 = bx,
      y0 = by,
      x1 = bx + w,
      y1 = by + h;
    const P = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ].map(([x, y]) => [(x - y) * HW, (x + y) * HH]);
    g.strokeStyle = color;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(P[0][0], P[0][1]);
    for (let i = 1; i < 4; i++) g.lineTo(P[i][0], P[i][1]);
    g.closePath();
    g.stroke();
  }

  private drawVehicle(e: Entity, sx: number, sy: number) {
    const g = this.g;
    const team = this.team(e.owner);
    const m = getUnitModel(e.type);
    const w = this.world;
    const blacked = e.disabledUntil > w.tick;
    const dark = blacked ? 0.45 : e.hp < e.r.hp * 0.35 ? 0.2 : 0;
    const loco = e.r.loco;
    const moving = e.x !== e.px || e.y !== e.py;
    if (loco === "naval" || loco === "hover") {
      // ships ride the swell, hovercraft float on their cushion
      if (!blacked) sy += Math.sin(this.time * (loco === "naval" ? 1.6 : 4) + e.id) * (loco === "naval" ? 0.7 : 0.5) - (loco === "hover" ? 1.5 : 0);
      const onWater = w.map.waterOk(e.cell);
      if (moving && onWater && this.chance(loco === "naval" ? 0.6 : 0.45)) {
        const a = (e.facing / 256) * TAU;
        const back = loco === "naval" ? 120 : 70;
        this.fx.add({ k: "dust", x: e.x - Math.cos(a) * back + (Math.random() - 0.5) * 50, y: e.y - Math.sin(a) * back + (Math.random() - 0.5) * 50, z: 0, vz: 0, life: 0.9, size: 2, grow: 5, r: 225, g: 238, b: 245, a: 0.4 });
      } else if (moving && loco === "hover" && this.chance(0.25)) {
        this.fx.add({ k: "dust", x: e.x + (Math.random() - 0.5) * 90, y: e.y + (Math.random() - 0.5) * 90, z: 6, vz: 20, life: 0.7, size: 2.5, grow: 6, r: 170, g: 155, b: 120, a: 0.35 });
      }
    }
    if (blacked && this.chance(0.15)) this.fx.sparks(e.x, e.y, 60, 2, [190, 170, 255]);
    const body = vehicleBody(e.type, facing32(e.facing), team, dark);
    drawSprite(g, body, sx, sy);
    if (m.turret && m.pivot) {
      const a = (e.facing / 256) * TAU;
      const [px, py, pz] = m.pivot;
      const rx = px * Math.cos(a) - py * Math.sin(a),
        ry = px * Math.sin(a) + py * Math.cos(a);
      const t = vehicleTurret(e.type, facing32(e.turret), team);
      if (t) drawSprite(g, t, sx + (rx - ry) * HW, sy + (rx + ry) * HH - pz * ZH);
    }
    if (e.invuln > this.world.tick) this.invulnGlow(body, sx, sy);
    if (dark && this.chance(0.05)) this.fx.smoke(e.x, e.y, e.z + 60, 3, 0.8, 1.2);
    if (e.r.harvester && e.harv === "mining" && this.chance(0.25)) this.fx.add({ k: "dust", x: e.x + (Math.random() - 0.5) * 120, y: e.y + (Math.random() - 0.5) * 120, z: 10, vz: 30, life: 0.8, size: 3, grow: 6, r: 170, g: 150, b: 90, a: 0.4 });
    if (e.kind === "air" && e.z > 100 && e.r.jet && this.chance(0.3)) {
      const a = (e.facing / 256) * TAU;
      this.fx.add({ k: "glow", x: e.x - Math.cos(a) * 110, y: e.y - Math.sin(a) * 110, z: e.z, life: 0.15, size: 2.5, grow: -1, r: 255, g: 200, b: 120, a: 0.8, add: true });
    }
  }

  private drawInfantry(e: Entity, sx: number, sy: number) {
    const team = this.team(e.owner);
    let frame = 0;
    if (e.deployed) frame = 6;
    else if (e.x !== e.px || e.y !== e.py) frame = 1 + (Math.floor(this.time * 9 + e.id) % 4);
    else if (this.world.tick - e.lastFire < 4) frame = 5;
    // idle wildlife spends a good part of its time with its head down, grazing
    if (e.r.animal && frame === 0 && (this.time * 0.35 + e.id * 0.37) % 3 < 1.7) frame = 6;
    const sp = infantrySprite(e.type, facing8(e.facing), frame, team);
    const g = this.g;
    g.fillStyle = "rgba(0,0,0,0.25)";
    g.beginPath();
    g.ellipse(sx + 1, sy + 1, 6, 3, 0, 0, TAU);
    g.fill();
    drawSprite(g, sp, sx, sy);
  }

  private drawProjectiles(alpha: number, inView: (x: number, y: number) => boolean, dt: number) {
    const g = this.g;
    this.trailT += dt;
    const trail = this.trailT > 0.03;
    if (trail) this.trailT = 0;
    for (const p of this.world.projs) {
      if (p.dead) continue;
      const x = p.px + (p.x - p.px) * alpha,
        y = p.py + (p.y - p.py) * alpha,
        zz = p.pz + (p.z - p.pz) * alpha;
      const [sx, sy] = toScreen(x, y, zz);
      if (!inView(sx, sy)) continue;
      const [qx, qy] = toScreen(p.px, p.py, p.pz);
      if (p.special === "nuke") {
        g.save();
        g.globalCompositeOperation = "lighter";
        g.fillStyle = "rgba(255,200,120,0.9)";
        g.beginPath();
        g.arc(sx, sy, 6, 0, TAU);
        g.fill();
        g.restore();
        g.strokeStyle = "#ddd";
        g.lineWidth = 4;
        g.beginPath();
        g.moveTo(qx, qy);
        g.lineTo(sx, sy);
        g.stroke();
        if (trail) {
          this.fx.smoke(x, y, zz, 8, 0.2, 2.5);
          this.fx.fire(x, y, zz, 6);
        }
        continue;
      }
      switch (p.w.proj) {
        case "shell":
          g.save();
          g.globalCompositeOperation = "lighter";
          g.strokeStyle = "rgba(255,220,140,0.9)";
          g.lineWidth = 2;
          g.beginPath();
          g.moveTo(qx, qy);
          g.lineTo(sx, sy);
          g.stroke();
          g.restore();
          break;
        case "missile":
        case "artillery": {
          const big = p.w.proj === "artillery";
          g.strokeStyle = big ? "#e8e2d0" : "#f4f4f4";
          g.lineWidth = big ? 3 : 1.6;
          g.beginPath();
          g.moveTo(qx, qy);
          g.lineTo(sx, sy);
          g.stroke();
          g.save();
          g.globalCompositeOperation = "lighter";
          g.fillStyle = "rgba(255,190,90,0.9)";
          g.beginPath();
          g.arc(qx, qy, big ? 3 : 2, 0, TAU);
          g.fill();
          g.restore();
          if (trail) this.fx.add({ k: "smoke", x: p.px, y: p.py, z: p.pz, life: big ? 1.4 : 0.6, size: big ? 3 : 2, grow: big ? 8 : 4, r: 200, g: 200, b: 200, a: 0.5 });
          break;
        }
        case "bomb":
          if (p.w.id === "barrageShell") {
            // incoming barrage round: a bright streak out of the sky
            g.save();
            g.globalCompositeOperation = "lighter";
            g.strokeStyle = "rgba(255,170,80,0.9)";
            g.lineWidth = 2.5;
            g.beginPath();
            g.moveTo(qx, qy - 14);
            g.lineTo(sx, sy);
            g.stroke();
            g.restore();
            if (trail) this.fx.add({ k: "smoke", x: p.px, y: p.py, z: p.pz, life: 1, size: 2, grow: 6, r: 180, g: 180, b: 180, a: 0.45 });
            break;
          }
          g.fillStyle = "#2a2a2a";
          g.beginPath();
          g.ellipse(sx, sy, 2.5, 4, 0, 0, TAU);
          g.fill();
          break;
        case "charge":
          if (Math.floor(this.time * 6) % 2 === 0) {
            g.fillStyle = "#ff3030";
            g.beginPath();
            g.arc(sx, sy - 6, 2.5, 0, TAU);
            g.fill();
          }
          break;
      }
    }
  }

  private drawOverlays(vs: ViewState, alpha: number) {
    const g = this.g;
    const w = this.world;
    const me = vs.me;
    for (const e of w.ents) {
      if (e.dead) continue;
      const sel = vs.selection.has(e.id);
      const hov = vs.hoverId === e.id;
      if (!sel && !hov && !(vs.showAllHealth && e.hp < e.r.hp)) continue;
      if (!this.visibleTo(me, e)) continue;
      if (e.kind === "bld") {
        if (sel) this.footprint(e, "rgba(255,255,255,0.7)");
        const sm = getStructModel(e.type);
        const [sx, sy] = toScreen(e.bx * 256, e.by * 256, 0);
        const topY = sy - sm.height * ZH - 8;
        this.healthBar(sx + ((e.r.w - e.r.h) * HW) / 2, Math.min(topY, sy + ((e.r.w + e.r.h) * HH) / 2 - 30), e, Math.min(20, 6 + e.r.w * 4));
        const rally = e.owner === me ? vs.opt.latestFor("rally", e.id) : undefined;
        const rallyX = rally ? rally.x : e.rallyX,
          rallyY = rally ? rally.y : e.rallyY;
        if (sel && rallyX >= 0) {
          const [rx, ry] = toScreen(rallyX * 256 + 128, rallyY * 256 + 128, 0);
          const [cx, cy] = toScreen(e.x, e.y, 0);
          g.setLineDash([4, 4]);
          g.strokeStyle = "rgba(255,255,255,0.6)";
          g.beginPath();
          g.moveTo(cx, cy);
          g.lineTo(rx, ry);
          g.stroke();
          g.setLineDash([]);
          g.fillStyle = this.team(e.owner);
          g.fillRect(rx, ry - 14, 8, 5);
          g.fillStyle = "#ddd";
          g.fillRect(rx - 1, ry - 14, 1.5, 14);
        }
        if (sel && me >= 0 && e.owner === me && w.players[me].primary && Object.values(w.players[me].primary).includes(e.id)) {
          g.font = "bold 9px system-ui";
          g.textAlign = "center";
          g.fillStyle = "#ffe08a";
          g.fillText("PRIMARY", sx + ((e.r.w - e.r.h) * HW) / 2, topY - 6);
        }
        continue;
      }
      const [x, y, zz] = this.lerpPos(e, alpha);
      const [sx, sy] = toScreen(x, y, zz);
      const inf = e.kind === "inf";
      const bw = inf ? 14 : 34,
        bh = inf ? 24 : 26;
      const cy = sy - (inf ? 12 : 8);
      if (sel) this.bracket(e, sx, sy, "rgba(255,255,255,0.95)");
      this.healthBar(sx, cy - bh / 2 - 4, e, inf ? 5 : 9);
      const grp = vs.groups.get(e.id);
      if (sel && grp !== undefined) {
        g.font = "bold 9px system-ui";
        g.textAlign = "left";
        g.fillStyle = "#fff";
        g.fillText(String(grp), sx + bw / 2 - 4, cy + bh / 2 + 2);
      }
      if (e.r.harvester && sel) {
        const cap = e.r.harvester.capacity;
        const n = 5,
          filled = Math.round((e.cargo / cap) * n);
        for (let i = 0; i < n; i++) {
          g.fillStyle = i < filled ? (e.cargoGem > 0 ? "#6ee8ff" : "#f0c040") : "rgba(0,0,0,0.5)";
          g.fillRect(sx - n * 2.5 + i * 5, cy + bh / 2 + 1, 4, 3);
        }
      }
      if (e.r.ammo && sel) {
        for (let i = 0; i < e.r.ammo; i++) {
          g.fillStyle = i < e.ammo ? "#ffd060" : "rgba(0,0,0,0.5)";
          g.fillRect(sx - e.r.ammo * 2.5 + i * 5, cy + bh / 2 + 1, 4, 3);
        }
      }
      if (sel && e.owner === me) {
        // an unconfirmed order replaces the unit's current one straight away
        const pend = vs.opt.unitOrders.get(e.id)?.cmd;
        let line: [number, number, boolean] | null = null;
        if (pend) {
          if (pend.c === "move" || pend.c === "amove") line = [pend.x * 256 + 128, pend.y * 256 + 128, pend.c === "amove"];
        } else if (e.gx >= 0 && (e.order === "move" || e.order === "amove")) line = [e.gx, e.gy, e.order === "amove"];
        if (line) {
          const [tx, ty] = toScreen(line[0], line[1], 0);
          g.strokeStyle = line[2] ? "rgba(255,120,80,0.35)" : "rgba(120,255,140,0.35)";
          g.beginPath();
          g.moveTo(sx, sy);
          g.lineTo(tx, ty);
          g.stroke();
        }
      }
    }
    if (me >= 0) this.drawFeedback(vs, alpha);
    // superweapon target reticle
    if (vs.mode.kind === "sw" && vs.hoverCell) {
      const sw = SUPERWEAPONS[vs.mode.type!];
      const [hx, hy] = vs.hoverCell;
      const [sx, sy] = toScreen(hx * 256 + 128, hy * 256 + 128, 0);
      const r = (sw.radius / 256) * 42;
      g.strokeStyle = `rgba(255,${80 + 80 * Math.sin(this.uiTime * 8)},60,0.9)`;
      g.lineWidth = 1.5;
      g.beginPath();
      g.ellipse(sx, sy, r, r / 2, 0, 0, TAU);
      g.stroke();
      if (vs.mode.step === 1 && vs.mode.x !== undefined) {
        const [ox, oy] = toScreen(vs.mode.x * 256 + 128, vs.mode.y! * 256 + 128, 0);
        g.strokeStyle = "rgba(120,240,255,0.9)";
        g.beginPath();
        g.ellipse(ox, oy, r, r / 2, 0, 0, TAU);
        g.stroke();
        g.setLineDash([6, 4]);
        g.beginPath();
        g.moveTo(ox, oy);
        g.lineTo(sx, sy);
        g.stroke();
        g.setLineDash([]);
      }
    }
    // weapon range ring for single selected defence
    if (vs.selection.size === 1) {
      const e = w.get([...vs.selection][0]);
      if (e && e.kind === "bld" && (e.r.wGround || e.r.wAir)) {
        const wp = WEAPONS[(e.r.wGround ?? e.r.wAir)!];
        const [sx, sy] = toScreen(e.x, e.y, 0);
        const r = (wp.range / 256) * 42 + e.r.w * 21;
        g.strokeStyle = "rgba(255,255,255,0.25)";
        g.beginPath();
        g.ellipse(sx, sy, r, r / 2, 0, 0, TAU);
        g.stroke();
      }
    }
  }

  private healthBar(cx: number, y: number, e: Entity, pips: number) {
    const g = this.g;
    const ratio = Math.max(0, e.hp / e.r.hp);
    const filled = Math.ceil(ratio * pips);
    const col = ratio > 0.5 ? "#3ce35a" : ratio > 0.25 ? "#f1d23a" : "#f0453a";
    const pw = 3,
      gap = 1;
    const total = pips * (pw + gap) - gap;
    const x0 = Math.round(cx - total / 2);
    g.fillStyle = "rgba(0,0,0,0.65)";
    g.fillRect(x0 - 1, y - 1, total + 2, 5);
    for (let i = 0; i < pips; i++) {
      g.fillStyle = i < filled ? col : "rgba(60,60,60,0.8)";
      g.fillRect(x0 + i * (pw + gap), y, pw, 3);
    }
    if (e.rank > 0) {
      g.fillStyle = "#ffd75a";
      g.font = "bold 9px system-ui";
      g.textAlign = "left";
      g.fillText(e.rank === 2 ? "★" : "▲", x0 + total + 3, y + 4);
    }
  }
}

// ───────────────────────────── cursors ─────────────────────────────

export function drawCursor(g: CanvasRenderingContext2D, kind: CursorKind, x: number, y: number, t: number) {
  g.save();
  g.translate(Math.round(x), Math.round(y));
  g.lineWidth = 2;
  g.lineJoin = "round";
  const outline = (draw: () => void, color: string) => {
    g.strokeStyle = "rgba(0,0,0,0.85)";
    g.lineWidth = 4;
    draw();
    g.stroke();
    g.strokeStyle = color;
    g.lineWidth = 2;
    draw();
    g.stroke();
  };
  const pulse = 1 + 0.12 * Math.sin(t * 10);
  switch (kind) {
    case "move":
    case "amove": {
      const c = kind === "amove" ? "#ff8a5a" : "#7dff8a";
      for (let i = 0; i < 4; i++) {
        g.save();
        g.rotate((i * Math.PI) / 2);
        outline(() => {
          g.beginPath();
          g.moveTo(-4, -6 * pulse - 4);
          g.lineTo(0, -6 * pulse);
          g.lineTo(4, -6 * pulse - 4);
        }, c);
        g.restore();
      }
      break;
    }
    case "nomove":
    case "nodeploy":
    case "norepair":
    case "nosell":
      outline(() => {
        g.beginPath();
        g.arc(0, 0, 8, 0, TAU);
        g.moveTo(-6, -6);
        g.lineTo(6, 6);
      }, "#ff4a4a");
      break;
    case "attack":
      outline(() => {
        g.beginPath();
        g.arc(0, 0, 9 * pulse, 0, TAU);
        g.moveTo(-14, 0);
        g.lineTo(-5, 0);
        g.moveTo(14, 0);
        g.lineTo(5, 0);
        g.moveTo(0, -14);
        g.lineTo(0, -5);
        g.moveTo(0, 14);
        g.lineTo(0, 5);
      }, "#ff4040");
      break;
    case "enter":
    case "capture":
    case "harvest": {
      const c = kind === "capture" ? "#ffd84a" : kind === "harvest" ? "#f0c040" : "#7dff8a";
      for (let i = 0; i < 4; i++) {
        g.save();
        g.rotate((i * Math.PI) / 2 + Math.PI / 4);
        outline(() => {
          g.beginPath();
          g.moveTo(-4, -14 * pulse);
          g.lineTo(0, -8 * pulse);
          g.lineTo(4, -14 * pulse);
        }, c);
        g.restore();
      }
      break;
    }
    case "deploy":
      for (let i = 0; i < 4; i++) {
        g.save();
        g.rotate((i * Math.PI) / 2 + Math.PI / 4);
        outline(() => {
          g.beginPath();
          g.moveTo(-4, -8 * pulse);
          g.lineTo(0, -13 * pulse);
          g.lineTo(4, -8 * pulse);
        }, "#7dd8ff");
        g.restore();
      }
      break;
    case "repair":
      outline(() => {
        g.beginPath();
        g.moveTo(-8, 8);
        g.lineTo(3, -3);
        g.arc(6, -6, 4, Math.PI * 0.75, Math.PI * 2.25);
      }, "#7dff8a");
      break;
    case "sell":
      g.font = "bold 18px system-ui";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.strokeStyle = "#000";
      g.lineWidth = 4;
      g.strokeText("$", 0, 0);
      g.fillStyle = "#ffd84a";
      g.fillText("$", 0, 0);
      break;
    case "sw":
      outline(() => {
        g.beginPath();
        g.arc(0, 0, 12 * pulse, 0, TAU);
        g.moveTo(0, -18);
        g.lineTo(0, 18);
        g.moveTo(-18, 0);
        g.lineTo(18, 0);
      }, "#ffb040");
      break;
    case "select":
      outline(() => {
        g.beginPath();
        g.moveTo(-9, -4);
        g.lineTo(-9, -9);
        g.lineTo(-4, -9);
        g.moveTo(4, -9);
        g.lineTo(9, -9);
        g.lineTo(9, -4);
        g.moveTo(9, 4);
        g.lineTo(9, 9);
        g.lineTo(4, 9);
        g.moveTo(-4, 9);
        g.lineTo(-9, 9);
        g.lineTo(-9, 4);
      }, "#ffffff");
      break;
    case "place":
    case "pan":
    case "default":
    default:
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(0, 16);
      g.lineTo(4, 12);
      g.lineTo(7, 19);
      g.lineTo(10, 18);
      g.lineTo(7, 11);
      g.lineTo(12, 11);
      g.closePath();
      g.fillStyle = "#e8eef4";
      g.strokeStyle = "#111";
      g.lineWidth = 1.5;
      g.fill();
      g.stroke();
  }
  g.restore();
}
