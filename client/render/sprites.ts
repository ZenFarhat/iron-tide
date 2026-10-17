// Lazy sprite cache built from the procedural models.
import { renderModel, type Sprite } from "./model3d";
import { infantryModel, oreModel, rockModel, structModel, treeModel, unitModel, type StructModel, type UnitModel } from "./models";
import { PLAYER_COLORS } from "../../shared/protocol";
import type { Theme } from "../../sim/map";

export const NEUTRAL_COLOR = "#9d9a90";
export let SPRITE_SCALE = Math.min(2, Math.max(1, Math.round(window.devicePixelRatio || 1)));

export function teamHex(owner: number, colorOf: (o: number) => number) {
  return owner < 0 ? NEUTRAL_COLOR : PLAYER_COLORS[colorOf(owner) % PLAYER_COLORS.length].hex;
}

const cache = new Map<string, Sprite>();
const unitModels = new Map<string, UnitModel>();
const structModels = new Map<string, StructModel>();

export function getUnitModel(type: string) {
  let m = unitModels.get(type);
  if (!m) unitModels.set(type, (m = unitModel(type)));
  return m;
}
export function getStructModel(type: string) {
  let m = structModels.get(type);
  if (!m) structModels.set(type, (m = structModel(type)));
  return m;
}

const F32 = (Math.PI * 2) / 32;

export function facing32(f: number) {
  return Math.round(f / 8) & 31;
}
export function facing8(f: number) {
  return Math.round(f / 32) & 7;
}

export function vehicleBody(type: string, f32: number, team: string, dark = 0): Sprite {
  const k = `vb:${type}:${f32}:${team}:${dark}`;
  let s = cache.get(k);
  if (!s) cache.set(k, (s = renderModel(getUnitModel(type).body, { yaw: f32 * F32, team, scale: SPRITE_SCALE, dark })));
  return s;
}

export function vehicleTurret(type: string, f32: number, team: string): Sprite | null {
  const m = getUnitModel(type);
  if (!m.turret) return null;
  const k = `vt:${type}:${f32}:${team}`;
  let s = cache.get(k);
  if (!s) cache.set(k, (s = renderModel(m.turret, { yaw: f32 * F32, team, scale: SPRITE_SCALE })));
  return s;
}

export function infantrySprite(type: string, f8: number, frame: number, team: string, dead = false): Sprite {
  const k = `in:${type}:${f8}:${frame}:${team}:${dead ? 1 : 0}`;
  let s = cache.get(k);
  if (!s) cache.set(k, (s = renderModel(infantryModel(type, frame), { yaw: (f8 * Math.PI) / 4, team, scale: SPRITE_SCALE, pitch: dead ? -Math.PI / 2 : 0 })));
  return s;
}

export function structSprite(type: string, team: string, dark = 0): Sprite {
  const k = `sb:${type}:${team}:${dark}`;
  let s = cache.get(k);
  if (!s) cache.set(k, (s = renderModel(getStructModel(type).body, { team, scale: SPRITE_SCALE, dark })));
  return s;
}

export function structGhost(type: string, team: string): Sprite {
  const k = `sg:${type}:${team}`;
  let s = cache.get(k);
  if (!s) cache.set(k, (s = renderModel(getStructModel(type).body, { team, scale: SPRITE_SCALE, alpha: 0.55, outline: false })));
  return s;
}

export function structTurret(type: string, f32: number, team: string): Sprite | null {
  const m = getStructModel(type);
  if (!m.turret) return null;
  const k = `st:${type}:${f32}:${team}`;
  let s = cache.get(k);
  if (!s) cache.set(k, (s = renderModel(m.turret, { yaw: f32 * F32, team, scale: SPRITE_SCALE })));
  return s;
}

export function treeSprite(v: number, theme: Theme = "temperate", wet = false): Sprite {
  const k = `tr:${theme}:${v % 12}:${wet ? 1 : 0}`;
  let s = cache.get(k);
  if (!s) cache.set(k, (s = renderModel(treeModel(v % 12, theme, wet), { team: "#3a7d33", scale: SPRITE_SCALE })));
  return s;
}

export function rockSprite(v: number, theme: Theme = "temperate"): Sprite {
  const k = `rk:${theme}:${v % 8}`;
  let s = cache.get(k);
  if (!s) cache.set(k, (s = renderModel(rockModel(v % 8, theme), { team: "#888", scale: SPRITE_SCALE })));
  return s;
}

export function oreSprite(gem: boolean, level: number, v: number): Sprite {
  const k = `or:${gem ? 1 : 0}:${level}:${v % 4}`;
  let s = cache.get(k);
  if (!s) cache.set(k, (s = renderModel(oreModel(gem, level, v % 4), { team: "#fff", scale: SPRITE_SCALE, outline: false })));
  return s;
}

/** Cameo icon for the sidebar: renders the model large on a canvas. */
export function iconCanvas(type: string, kind: string, team: string, w = 112, h = 72): HTMLCanvasElement {
  const k = `ic:${type}:${team}:${w}x${h}`;
  const hit = cache.get(k);
  if (hit) return hit.c;
  const S = 2;
  let sp: Sprite;
  if (kind === "bld") sp = renderModel(getStructModel(type).body, { team, scale: S * 1.0 });
  else if (kind === "inf") sp = renderModel(infantryModel(type, 0), { yaw: Math.PI / 4, team, scale: S * 3.2 });
  else {
    const m = getUnitModel(type);
    const yaw = Math.PI * 0.2;
    const body = renderModel(m.body, { yaw, team, scale: S * 2.2 });
    if (m.turret && m.pivot) {
      const t = renderModel(m.turret, { yaw, team, scale: S * 2.2 });
      const c = document.createElement("canvas");
      c.width = body.c.width;
      c.height = body.c.height + 20;
      const g = c.getContext("2d")!;
      g.drawImage(body.c, 0, 20);
      const [px, py, pz] = m.pivot;
      const rx = px * Math.cos(yaw) - py * Math.sin(yaw),
        ry = px * Math.sin(yaw) + py * Math.cos(yaw);
      const sx = (rx - ry) * 30 * S * 2.2,
        sy = ((rx + ry) * 15 - pz * 34) * S * 2.2;
      g.drawImage(t.c, body.ox + sx - t.ox, 20 + body.oy + sy - t.oy);
      sp = { c, ox: body.ox, oy: body.oy + 20, s: S };
    } else sp = body;
  }
  const c = document.createElement("canvas");
  c.width = w * S;
  c.height = h * S;
  const g = c.getContext("2d")!;
  const sc = Math.min((w * S * 0.92) / sp.c.width, (h * S * 0.92) / sp.c.height, 1.6);
  const dw = sp.c.width * sc,
    dh = sp.c.height * sc;
  g.drawImage(sp.c, (w * S - dw) / 2, (h * S - dh) / 2 + 2, dw, dh);
  cache.set(k, { c, ox: 0, oy: 0, s: S });
  return c;
}
