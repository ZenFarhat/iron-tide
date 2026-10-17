// Client-side visual effects. Driven by simulation events; purely cosmetic.
import { toScreen } from "./iso";
import type { SimEvent } from "../../sim/entity";
import type { World } from "../../sim/world";
import { RULES } from "../../sim/rules";

type PKind = "smoke" | "fire" | "flash" | "spark" | "debris" | "ring" | "glow" | "text" | "dust" | "blood" | "zap";

interface Particle {
  k: PKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  t: number;
  life: number;
  size: number;
  grow: number;
  r: number;
  g: number;
  b: number;
  a: number;
  text?: string;
  add: boolean;
  grav: number;
}

interface Beam {
  kind: "beam" | "arc" | "tracer" | "snipe" | "support" | "bolt" | "phase";
  x1: number;
  y1: number;
  z1: number;
  x2: number;
  y2: number;
  z2: number;
  t: number;
  life: number;
  color: string;
  width: number;
  seed: number;
}

export interface Decal {
  kind: "scorch" | "crater" | "blood" | "rubble";
  x: number;
  y: number;
  t: number;
  life: number;
  size: number;
  rot: number;
}

export interface Corpse {
  type: string;
  owner: number;
  x: number;
  y: number;
  facing: number;
  t: number;
  life: number;
  death: string;
}

export interface Wreck {
  type: string;
  owner: number;
  x: number;
  y: number;
  facing: number;
  t: number;
  life: number;
}

const rnd = Math.random;

const puffCache = new Map<number, HTMLCanvasElement>();
/** soft round particle sprite (gaussian-ish falloff); smoke has a denser core */
function puff(r: number, g: number, b: number, smoke: boolean): HTMLCanvasElement {
  const key = ((r >> 4) << 9) | ((g >> 4) << 5) | ((b >> 4) << 1) | (smoke ? 1 : 0);
  let c = puffCache.get(key);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d")!;
  const R = (r >> 4) * 16 + 8,
    G = (g >> 4) * 16 + 8,
    B = (b >> 4) * 16 + 8;
  const grd = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  if (smoke) {
    grd.addColorStop(0, `rgba(${R},${G},${B},0.9)`);
    grd.addColorStop(0.45, `rgba(${R},${G},${B},0.55)`);
    grd.addColorStop(1, `rgba(${R},${G},${B},0)`);
  } else {
    grd.addColorStop(0, `rgba(255,255,255,1)`);
    grd.addColorStop(0.18, `rgba(${R},${G},${B},0.95)`);
    grd.addColorStop(0.5, `rgba(${R},${G},${B},0.35)`);
    grd.addColorStop(1, `rgba(${R},${G},${B},0)`);
  }
  x.fillStyle = grd;
  x.fillRect(0, 0, 64, 64);
  puffCache.set(key, c);
  return c;
}

export class Fx {
  parts: Particle[] = [];
  beams: Beam[] = [];
  decals: Decal[] = [];
  corpses: Corpse[] = [];
  wrecks: Wreck[] = [];
  shake = 0;
  flash = 0; // full-screen flash (nukes)
  stormClouds: { x: number; y: number; t: number; life: number }[] = [];
  teleports: { x: number; y: number; t: number; life: number }[] = [];
  bulwarks: { x: number; y: number; t: number; life: number }[] = [];
  time = 0;
  /** game speed; delayed effects (staggered explosions) are scheduled in game time */
  speed = 1;

  add(p: Partial<Particle> & { k: PKind; x: number; y: number }) {
    if (this.parts.length > 2500) return;
    this.parts.push({ z: 0, vx: 0, vy: 0, vz: 0, t: 0, life: 1, size: 4, grow: 0, r: 255, g: 255, b: 255, a: 1, add: false, grav: 0, ...p });
  }

  beam(b: Omit<Beam, "t" | "seed">) {
    this.beams.push({ ...b, t: 0, seed: Math.floor(rnd() * 1e6) });
  }

  smoke(x: number, y: number, z: number, size = 6, dark = 0.4, life = 1.6) {
    const c = 70 + (1 - dark) * 100;
    this.add({ k: "smoke", x: x + (rnd() - 0.5) * 30, y: y + (rnd() - 0.5) * 30, z, vz: 60 + rnd() * 50, vx: (rnd() - 0.5) * 20 + 14, vy: (rnd() - 0.5) * 20 - 8, life: life * (0.7 + rnd() * 0.6), size, grow: size * 1.4, r: c, g: c - 4, b: c - 8, a: 0.45 });
  }

  fire(x: number, y: number, z: number, size = 5) {
    this.add({ k: "fire", x: x + (rnd() - 0.5) * 40, y: y + (rnd() - 0.5) * 40, z, vz: 80 + rnd() * 60, life: 0.4 + rnd() * 0.4, size, grow: -size * 0.8, r: 255, g: 150 + rnd() * 80, b: 40, a: 0.9, add: true });
  }

  explosion(x: number, y: number, z: number, scale: number) {
    this.add({ k: "flash", x, y, z: z + 10, life: 0.12 + scale * 0.05, size: 14 * scale, grow: 30 * scale, r: 255, g: 240, b: 200, a: 1, add: true });
    const nf = Math.round(6 + scale * 8);
    for (let i = 0; i < nf; i++) {
      const a = rnd() * Math.PI * 2,
        s = (40 + rnd() * 120) * scale;
      this.add({ k: "fire", x, y, z: z + 10, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: 40 + rnd() * 160 * scale, life: 0.35 + rnd() * 0.45, size: 5 * scale + rnd() * 4, grow: 6 * scale, r: 255, g: 120 + rnd() * 110, b: 30, a: 0.95, add: true });
    }
    const ns = Math.round(3 + scale * 4);
    for (let i = 0; i < ns; i++) this.smoke(x, y, z + 20, 6 * scale, 0.65, 1.2 + scale * 0.6);
    const nd = Math.round(scale * 6);
    for (let i = 0; i < nd; i++) {
      const a = rnd() * Math.PI * 2,
        s = (80 + rnd() * 200) * scale;
      this.add({ k: "debris", x, y, z: z + 10, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: 200 + rnd() * 300 * scale, life: 0.8 + rnd() * 0.6, size: 1.5 + rnd() * 1.5, r: 50, g: 45, b: 40, a: 1, grav: 1000 });
    }
    if (scale >= 1) this.add({ k: "ring", x, y, z: 0, life: 0.45, size: 6 * scale, grow: 90 * scale, r: 255, g: 220, b: 160, a: 0.5, add: true });
    if (z < 60) this.decals.push({ kind: scale >= 1.5 ? "crater" : "scorch", x, y, t: 0, life: 25 + scale * 10, size: 10 * scale, rot: rnd() * 6 });
    this.shake = Math.max(this.shake, scale >= 2 ? scale * 2.5 : 0);
  }

  sparks(x: number, y: number, z: number, n = 5, col = [255, 220, 120]) {
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2,
        s = 60 + rnd() * 160;
      this.add({ k: "spark", x, y, z, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: 80 + rnd() * 200, life: 0.2 + rnd() * 0.25, size: 1.4, r: col[0], g: col[1], b: col[2], a: 1, add: true, grav: 900 });
    }
  }

  muzzle(x: number, y: number, z: number, size = 5, col = [255, 230, 150]) {
    this.add({ k: "flash", x, y, z, life: 0.07, size, grow: size * 3, r: col[0], g: col[1], b: col[2], a: 1, add: true });
  }

  text(x: number, y: number, z: number, text: string, col = [120, 255, 120]) {
    this.add({ k: "text", x, y, z, vz: 60, life: 1.4, size: 11, r: col[0], g: col[1], b: col[2], a: 1, text });
  }

  /** emit visual effects for a simulation event */
  onEvent(ev: SimEvent, world: World, muzzleOf: (id: number) => [number, number, number] | null) {
    switch (ev.e) {
      case "fire": {
        const m = muzzleOf(ev.id) ?? [ev.x, ev.y, ev.z];
        const [mx, my, mz] = m;
        switch (ev.fx) {
          case "rifle":
          case "mg":
            this.muzzle(mx, my, mz, ev.fx === "mg" ? 4 : 3.5);
            this.beam({ kind: "tracer", x1: mx, y1: my, z1: mz, x2: ev.tx + (rnd() - 0.5) * 40, y2: ev.ty + (rnd() - 0.5) * 40, z2: ev.tz, life: 0.06, color: "255,235,170", width: 1 });
            this.sparks(ev.tx, ev.ty, ev.tz, 2);
            break;
          case "snipe":
            this.muzzle(mx, my, mz, 4);
            this.beam({ kind: "snipe", x1: mx, y1: my, z1: mz, x2: ev.tx, y2: ev.ty, z2: ev.tz, life: 0.18, color: "220,240,255", width: 1.2 });
            break;
          case "cannon":
            this.muzzle(mx, my, mz, 8);
            this.smoke(mx, my, mz, 4, 0.3, 0.8);
            break;
          case "rocket":
          case "artillery":
            this.muzzle(mx, my, mz, 5, [255, 200, 120]);
            this.smoke(mx, my, mz, 5, 0.2, 1.0);
            break;
          case "flak":
            this.muzzle(mx, my, mz, 5);
            for (let i = 0; i < 3; i++) {
              const ox = (rnd() - 0.5) * 90,
                oy = (rnd() - 0.5) * 90,
                oz = (rnd() - 0.5) * 60;
              this.add({ k: "flash", x: ev.tx + ox, y: ev.ty + oy, z: ev.tz + oz, life: 0.1, size: 4, grow: 20, r: 255, g: 220, b: 150, a: 1, add: true });
              this.add({ k: "smoke", x: ev.tx + ox, y: ev.ty + oy, z: ev.tz + oz, life: 0.9, size: 5, grow: 10, r: 50, g: 50, b: 50, a: 0.7 });
            }
            break;
          case "beam": {
            const big = ev.bonus > 0;
            this.beam({ kind: "beam", x1: mx, y1: my, z1: mz, x2: ev.tx, y2: ev.ty, z2: ev.tz, life: 0.3, color: "150,245,255", width: big ? 5 : 3.2 });
            this.add({ k: "flash", x: ev.tx, y: ev.ty, z: ev.tz, life: 0.25, size: 10, grow: 30, r: 180, g: 250, b: 255, a: 1, add: true });
            this.add({ k: "flash", x: mx, y: my, z: mz, life: 0.18, size: 8, grow: 12, r: 200, g: 255, b: 255, a: 1, add: true });
            this.sparks(ev.tx, ev.ty, ev.tz, 6, [180, 250, 255]);
            break;
          }
          case "arc":
            this.beam({ kind: "arc", x1: mx, y1: my, z1: mz, x2: ev.tx, y2: ev.ty, z2: ev.tz, life: ev.charge ? 0.12 : 0.25, color: "150,200,255", width: 2 });
            if (!ev.charge) this.sparks(ev.tx, ev.ty, ev.tz, 6, [170, 210, 255]);
            this.add({ k: "flash", x: ev.tx, y: ev.ty, z: ev.tz, life: 0.15, size: 8, grow: 14, r: 170, g: 210, b: 255, a: 1, add: true });
            break;
          case "bite":
            this.add({ k: "blood", x: ev.tx, y: ev.ty, z: 20, life: 0.5, size: 3, grow: 4, r: 140, g: 20, b: 20, a: 0.9 });
            break;
          case "sonic": {
            // a shockwave rolls from the emitter to the target
            for (let k = 0; k < 3; k++) {
              const f = (k + 1) / 4;
              this.add({ k: "ring", x: mx + (ev.tx - mx) * f, y: my + (ev.ty - my) * f, z: mz + (ev.tz - mz) * f, life: 0.25 + k * 0.06, size: 3 + k * 2, grow: 26, r: 130, g: 255, b: 210, a: 0.55, add: true });
            }
            this.add({ k: "ring", x: ev.tx, y: ev.ty, z: 10, life: 0.4, size: 6, grow: 70, r: 140, g: 255, b: 215, a: 0.6, add: true });
            this.add({ k: "flash", x: mx, y: my, z: mz, life: 0.12, size: 6, grow: 10, r: 150, g: 255, b: 220, a: 0.9, add: true });
            break;
          }
          case "harpoon":
            this.muzzle(mx, my, mz, 4, [255, 230, 190]);
            this.add({ k: "smoke", x: mx, y: my, z: mz, life: 0.6, size: 3, grow: 6, r: 200, g: 200, b: 200, a: 0.4 });
            break;
          case "bomb":
            break;
          case "charge":
            break;
        }
        break;
      }
      case "hit": {
        switch (ev.fx) {
          case "cannon":
            this.explosion(ev.x, ev.y, ev.z, 0.6);
            break;
          case "rocket":
            this.explosion(ev.x, ev.y, ev.z, ev.z > 200 ? 0.45 : 0.6);
            break;
          case "artillery":
            this.explosion(ev.x, ev.y, ev.z, 1.4);
            break;
          case "bomb":
            this.explosion(ev.x, ev.y, 0, 1.5);
            break;
          case "charge":
            this.explosion(ev.x, ev.y, 40, 2.2);
            break;
          case "beam":
            this.add({ k: "ring", x: ev.x, y: ev.y, z: 0, life: 0.35, size: 4, grow: 60, r: 170, g: 245, b: 255, a: 0.6, add: true });
            break;
          case "harpoon":
            this.sparks(ev.x, ev.y, ev.z, 6, [255, 240, 200]);
            this.add({ k: "flash", x: ev.x, y: ev.y, z: ev.z, life: 0.12, size: 6, grow: 8, r: 255, g: 230, b: 180, a: 0.9, add: true });
            break;
          case "flak":
            break;
          case "mg":
          case "rifle":
            if (!ev.target) this.sparks(ev.x, ev.y, ev.z, 3);
            break;
        }
        break;
      }
      case "die": {
        const r = RULES[ev.type];
        if (ev.kind === "inf") {
          this.corpses.push({ type: ev.type, owner: ev.owner, x: ev.x, y: ev.y, facing: ev.facing ?? 0, t: 0, life: ev.death === "explode" ? 0.01 : 6, death: ev.death });
          if (ev.death === "explode") {
            this.explosion(ev.x, ev.y, 10, 0.35);
            for (let i = 0; i < 4; i++) this.add({ k: "blood", x: ev.x, y: ev.y, z: 20, vx: (rnd() - 0.5) * 200, vy: (rnd() - 0.5) * 200, vz: 200, grav: 900, life: 0.6, size: 1.6, r: 120, g: 20, b: 20, a: 1 });
          } else if (ev.death === "zap") this.sparks(ev.x, ev.y, 30, 10, [170, 210, 255]);
          else if (ev.death === "melt") this.add({ k: "glow", x: ev.x, y: ev.y, z: 10, life: 1.2, size: 8, grow: 4, r: 120, g: 255, b: 80, a: 0.6, add: true });
          else if (ev.death === "burn") for (let i = 0; i < 5; i++) this.fire(ev.x, ev.y, 10, 4);
          else if (ev.death === "crush" || ev.death === "phase") this.decals.push({ kind: "blood", x: ev.x, y: ev.y, t: 0, life: 15, size: 5, rot: rnd() * 6 });
          if (ev.death === "phase") this.teleports.push({ x: ev.x, y: ev.y, t: 0, life: 0.6 });
        } else if (ev.kind === "bld") {
          const s = r ? Math.max(r.w, r.h) : 1;
          for (let i = 0; i < s * 3; i++) {
            setTimeout(() => {
              const ox = ((rnd() - 0.5) * s * 256) / 1.2,
                oy = ((rnd() - 0.5) * s * 256) / 1.2;
              this.explosion(ev.x + ox, ev.y + oy, 40 + rnd() * 80, 0.8 + rnd() * 0.8);
            }, (i * 110) / this.speed);
          }
          this.decals.push({ kind: "rubble", x: ev.x, y: ev.y, t: 0, life: 60, size: s * 22, rot: 0 });
          this.shake = Math.max(this.shake, 4 + s);
        } else {
          const air = ev.kind === "air";
          this.explosion(ev.x, ev.y, ev.z, air ? 1.3 : r && r.cost > 1500 ? 1.6 : 1.1);
          if (!air && r && r.kind === "veh") this.wrecks.push({ type: ev.type, owner: ev.owner, x: ev.x, y: ev.y, facing: ev.facing ?? 0, t: 0, life: 18 });
          if (air) {
            // falling wreck debris
            for (let i = 0; i < 6; i++) this.add({ k: "debris", x: ev.x, y: ev.y, z: ev.z, vx: (rnd() - 0.5) * 300, vy: (rnd() - 0.5) * 300, vz: 100, grav: 700, life: 1.5, size: 2.5, r: 60, g: 60, b: 60, a: 1 });
          }
        }
        break;
      }
      case "bigboom":
        this.explosion(ev.x, ev.y, 0, 3.5);
        this.flash = Math.max(this.flash, 0.4);
        break;
      case "crush":
        this.decals.push({ kind: "blood", x: ev.x, y: ev.y, t: 0, life: 15, size: 5, rot: rnd() * 6 });
        break;
      case "teleport":
        this.teleports.push({ x: ev.x, y: ev.y, t: 0, life: 0.7 });
        this.teleports.push({ x: ev.x2, y: ev.y2, t: 0, life: 0.7 });
        break;
      case "bolt":
        this.beam({ kind: "bolt", x1: ev.x + (rnd() - 0.5) * 200, y1: ev.y + (rnd() - 0.5) * 200, z1: 2600, x2: ev.x, y2: ev.y, z2: 0, life: 0.3, color: "210,225,255", width: 3 });
        this.explosion(ev.x, ev.y, 0, 1.2);
        this.flash = Math.max(this.flash, 0.12);
        break;
      case "swlaunch":
        if (ev.kind === "storm") this.stormClouds.push({ x: ev.x, y: ev.y, t: 0, life: 24 });
        if (ev.kind === "bulwark") this.bulwarks.push({ x: ev.x, y: ev.y, t: 0, life: 1.5 });
        if (ev.kind === "phase") {
          this.teleports.push({ x: ev.x, y: ev.y, t: 0, life: 1.2 });
          this.teleports.push({ x: ev.x2, y: ev.y2, t: 0, life: 1.2 });
        }
        break;
      case "nuke": {
        this.flash = 1;
        this.shake = 14;
        this.explosion(ev.x, ev.y, 0, 5);
        for (let i = 0; i < 40; i++) {
          const a = rnd() * Math.PI * 2,
            d = rnd() * 900;
          setTimeout(() => this.explosion(ev.x + Math.cos(a) * d, ev.y + Math.sin(a) * d, rnd() * 100, 1 + rnd()), (rnd() * 900) / this.speed);
        }
        // mushroom column
        for (let i = 0; i < 60; i++) {
          this.add({ k: "smoke", x: ev.x + (rnd() - 0.5) * 120, y: ev.y + (rnd() - 0.5) * 120, z: rnd() * 400, vz: 150 + rnd() * 250, vx: (rnd() - 0.5) * 60, vy: (rnd() - 0.5) * 60, life: 4 + rnd() * 3, size: 14, grow: 40, r: 90, g: 70, b: 60, a: 0.6 });
          this.add({ k: "fire", x: ev.x + (rnd() - 0.5) * 100, y: ev.y + (rnd() - 0.5) * 100, z: rnd() * 300, vz: 200 + rnd() * 300, life: 1 + rnd(), size: 14, grow: 20, r: 255, g: 140, b: 40, a: 0.8, add: true });
        }
        this.add({ k: "ring", x: ev.x, y: ev.y, z: 0, life: 1.4, size: 20, grow: 900, r: 255, g: 230, b: 180, a: 0.7, add: true });
        for (let i = 0; i < 6; i++) this.decals.push({ kind: "crater", x: ev.x + (rnd() - 0.5) * 600, y: ev.y + (rnd() - 0.5) * 600, t: 0, life: 120, size: 30 + rnd() * 20, rot: rnd() * 6 });
        break;
      }
      case "support":
        this.beam({ kind: "support", x1: ev.x, y1: ev.y, z1: 300, x2: ev.tx, y2: ev.ty, z2: 300, life: 0.25, color: "150,245,255", width: 2 });
        break;
      case "salvage":
        if (ev.owner === (world as any).__me) this.text(ev.x, ev.y, 140, `+$${ev.amount}`, [255, 210, 90]);
        break;
      case "blackout":
        this.add({ k: "ring", x: ev.x, y: ev.y, z: 20, life: 0.9, size: 10, grow: 520, r: 180, g: 150, b: 255, a: 0.8, add: true });
        this.add({ k: "ring", x: ev.x, y: ev.y, z: 20, life: 1.3, size: 10, grow: 380, r: 120, g: 100, b: 255, a: 0.5, add: true });
        this.add({ k: "flash", x: ev.x, y: ev.y, z: 60, life: 0.4, size: 30, grow: 120, r: 200, g: 180, b: 255, a: 0.8, add: true });
        this.flash = Math.max(this.flash, 0.15);
        break;
      case "income":
        if (ev.owner === (world as any).__me) {
          const b = world.get(ev.id);
          if (b) this.text(b.x, b.y, 160, `+$${ev.amount}`);
        }
        break;
      case "engrepair":
        this.sparks(ev.x, ev.y, 80, 12, [120, 255, 140]);
        break;
      case "capture":
        this.add({ k: "ring", x: ev.x, y: ev.y, z: 0, life: 0.6, size: 10, grow: 120, r: 255, g: 255, b: 255, a: 0.6, add: true });
        break;
      case "repairfx":
        if (rnd() < 0.5) this.sparks(ev.x, ev.y, 40, 2, [255, 255, 160]);
        break;
      case "promote":
        {
          const e = world.get(ev.id);
          if (e) this.text(e.x, e.y, 120, ev.rank === 2 ? "★ ELITE" : "▲ VETERAN", [255, 220, 90]);
        }
        break;
    }
  }

  update(dt: number) {
    this.time += dt;
    const ps = this.parts;
    let j = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.t += dt;
      if (p.t >= p.life) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vz -= p.grav * dt;
      if (p.k === "smoke") {
        p.vx *= 0.98;
        p.vy *= 0.98;
        p.vz *= 0.97;
      }
      if (p.z < 0) {
        p.z = 0;
        p.vz *= -0.3;
        p.vx *= 0.6;
        p.vy *= 0.6;
      }
      ps[j++] = p;
    }
    ps.length = j;
    this.beams = this.beams.filter((b) => (b.t += dt) < b.life);
    this.decals = this.decals.filter((d) => (d.t += dt) < d.life);
    this.corpses = this.corpses.filter((c) => (c.t += dt) < c.life);
    this.wrecks = this.wrecks.filter((c) => (c.t += dt) < c.life);
    this.stormClouds = this.stormClouds.filter((c) => (c.t += dt) < c.life);
    this.teleports = this.teleports.filter((c) => (c.t += dt) < c.life);
    this.bulwarks = this.bulwarks.filter((c) => (c.t += dt) < c.life);
    this.shake = Math.max(0, this.shake - dt * 18);
    this.flash = Math.max(0, this.flash - dt * 0.9);
  }

  /** ground-level decals (call before entities) */
  drawDecals(g: CanvasRenderingContext2D, inView: (sx: number, sy: number) => boolean) {
    for (const d of this.decals) {
      const [sx, sy] = toScreen(d.x, d.y, 0);
      if (!inView(sx, sy)) continue;
      const fade = Math.min(1, (d.life - d.t) / 4);
      g.save();
      g.translate(sx, sy);
      g.scale(1, 0.5);
      g.rotate(d.rot);
      if (d.kind === "blood") {
        g.fillStyle = `rgba(110,10,10,${0.7 * fade})`;
        g.beginPath();
        g.arc(0, 0, d.size, 0, Math.PI * 2);
        g.fill();
      } else if (d.kind === "rubble") {
        g.fillStyle = `rgba(40,36,32,${0.75 * fade})`;
        g.beginPath();
        g.arc(0, 0, d.size * 1.6, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = `rgba(90,84,76,${0.8 * fade})`;
        for (let i = 0; i < 9; i++) {
          const a = i * 0.7,
            r = d.size * (0.3 + ((i * 37) % 10) / 10);
          g.fillRect(Math.cos(a) * r, Math.sin(a) * r, 5, 4);
        }
      } else {
        const grd = g.createRadialGradient(0, 0, 0, 0, 0, d.size * 1.4);
        grd.addColorStop(0, `rgba(20,16,12,${0.65 * fade})`);
        grd.addColorStop(1, "rgba(20,16,12,0)");
        g.fillStyle = grd;
        g.beginPath();
        g.arc(0, 0, d.size * 1.4, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    }
  }

  /** particles and beams above entities */
  draw(g: CanvasRenderingContext2D, inView: (sx: number, sy: number) => boolean) {
    // storm clouds
    for (const c of this.stormClouds) {
      const [sx, sy] = toScreen(c.x, c.y, 0);
      const a = Math.min(1, c.t / 2, (c.life - c.t) / 2) * 0.55;
      const grd = g.createRadialGradient(sx, sy - 40, 10, sx, sy - 40, 260);
      grd.addColorStop(0, `rgba(30,32,48,${a})`);
      grd.addColorStop(1, "rgba(30,32,48,0)");
      g.fillStyle = grd;
      g.fillRect(sx - 280, sy - 300, 560, 520);
    }
    for (const b of this.beams) {
      const [x1, y1] = toScreen(b.x1, b.y1, b.z1);
      const [x2, y2] = toScreen(b.x2, b.y2, b.z2);
      if (!inView(x1, y1) && !inView(x2, y2)) continue;
      const k = 1 - b.t / b.life;
      g.save();
      g.globalCompositeOperation = "lighter";
      g.lineCap = "round";
      if (b.kind === "arc" || b.kind === "bolt") {
        for (let pass = 0; pass < 2; pass++) {
          g.strokeStyle = pass === 0 ? `rgba(${b.color},${0.35 * k})` : `rgba(255,255,255,${0.9 * k})`;
          g.lineWidth = pass === 0 ? b.width * 3 : b.width * 0.6;
          g.beginPath();
          g.moveTo(x1, y1);
          const n = b.kind === "bolt" ? 10 : 7;
          let seed = b.seed + Math.floor(this.time * 30);
          const jitter = Math.hypot(x2 - x1, y2 - y1) * 0.12 + 4;
          for (let i = 1; i < n; i++) {
            seed = (seed * 16807) % 2147483647;
            const t = i / n;
            const off = ((seed % 1000) / 1000 - 0.5) * jitter;
            g.lineTo(x1 + (x2 - x1) * t + off, y1 + (y2 - y1) * t + off * 0.6);
          }
          g.lineTo(x2, y2);
          g.stroke();
        }
      } else {
        g.strokeStyle = `rgba(${b.color},${0.4 * k})`;
        g.lineWidth = b.width * 2.5;
        g.beginPath();
        g.moveTo(x1, y1);
        g.lineTo(x2, y2);
        g.stroke();
        g.strokeStyle = `rgba(255,255,255,${0.95 * k})`;
        g.lineWidth = Math.max(0.6, b.width * 0.5);
        g.beginPath();
        g.moveTo(x1, y1);
        g.lineTo(x2, y2);
        g.stroke();
      }
      g.restore();
    }
    for (const p of this.parts) {
      const [sx, sy] = toScreen(p.x, p.y, p.z);
      if (!inView(sx, sy)) continue;
      const k = p.t / p.life;
      const size = Math.max(0.3, p.size + p.grow * k);
      let a = p.a * (1 - k);
      if (p.k === "smoke") a = p.a * Math.min(1, k * 6) * (1 - k);
      if (p.add) g.globalCompositeOperation = "lighter";
      switch (p.k) {
        case "ring":
          g.strokeStyle = `rgba(${p.r},${p.g},${p.b},${a})`;
          g.lineWidth = 2;
          g.beginPath();
          g.ellipse(sx, sy, size, size / 2, 0, 0, Math.PI * 2);
          g.stroke();
          break;
        case "text":
          g.globalCompositeOperation = "source-over";
          g.font = "bold 11px system-ui, sans-serif";
          g.textAlign = "center";
          g.fillStyle = `rgba(0,0,0,${a})`;
          g.fillText(p.text!, sx + 1, sy + 1);
          g.fillStyle = `rgba(${p.r},${p.g},${p.b},${a})`;
          g.fillText(p.text!, sx, sy);
          break;
        case "spark":
        case "debris":
        case "blood":
          g.fillStyle = `rgba(${p.r | 0},${p.g | 0},${p.b | 0},${a})`;
          g.fillRect(sx - size / 2, sy - size / 2, size, size);
          break;
        default: {
          // soft radial sprite, cached per quantised colour
          const sp = puff(p.r, p.g, p.b, p.k === "smoke" || p.k === "dust");
          g.globalAlpha = Math.max(0, Math.min(1, a));
          const r2 = p.k === "smoke" || p.k === "dust" ? size * 1.5 : size * 1.8;
          g.drawImage(sp, sx - r2, sy - r2, r2 * 2, r2 * 2);
          g.globalAlpha = 1;
        }
      }
      if (p.add) g.globalCompositeOperation = "source-over";
    }
    // teleport swirls
    for (const t of this.teleports) {
      const [sx, sy] = toScreen(t.x, t.y, 0);
      const k = t.t / t.life;
      g.save();
      g.globalCompositeOperation = "lighter";
      g.strokeStyle = `rgba(140,240,255,${1 - k})`;
      g.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.ellipse(sx, sy - 10 - i * 10, 10 + k * 30 + i * 4, (10 + k * 30 + i * 4) / 2, 0, 0, Math.PI * 2);
        g.stroke();
      }
      g.restore();
    }
    for (const b of this.bulwarks) {
      const [sx, sy] = toScreen(b.x, b.y, 0);
      const k = b.t / b.life;
      g.save();
      g.globalCompositeOperation = "lighter";
      g.fillStyle = `rgba(255,200,60,${0.5 * (1 - k)})`;
      g.beginPath();
      g.ellipse(sx, sy, 60 + k * 40, 30 + k * 20, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }
}
