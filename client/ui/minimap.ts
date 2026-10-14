// Isometric radar minimap.
import type { Game } from "../game";
import { HW, HH } from "../render/iso";
import { PLAYER_COLORS } from "../../shared/protocol";

export class Minimap {
  game: Game;
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  cells: HTMLCanvasElement;
  base: ImageData;
  scale = 1;
  ox = 0;
  oy = 0;
  w = 232;
  h = 140;
  t = 0;
  pings: { x: number; y: number; t: number }[] = [];
  dragging = false;
  offline: HTMLDivElement;

  constructor(game: Game, host: HTMLElement) {
    this.game = game;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "minimap";
    host.appendChild(this.canvas);
    this.offline = document.createElement("div");
    this.offline.className = "radar-off";
    this.offline.textContent = "RADAR OFFLINE";
    host.appendChild(this.offline);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = this.w * dpr;
    this.canvas.height = this.h * dpr;
    this.canvas.style.width = this.w + "px";
    this.canvas.style.height = this.h + "px";
    this.g = this.canvas.getContext("2d")!;
    this.g.scale(dpr, dpr);
    const m = game.world.map;
    this.cells = document.createElement("canvas");
    this.cells.width = m.w;
    this.cells.height = m.h;
    this.base = game.renderer.terrain.cellImage();
    const fullW = (m.w + m.h) * HW,
      fullH = (m.w + m.h) * HH;
    this.scale = Math.min((this.w - 8) / fullW, (this.h - 8) / fullH);
    this.ox = this.w / 2 + ((m.h - m.w) * HW * this.scale) / 2;
    this.oy = (this.h - fullH * this.scale) / 2;
    const toCell = (ev: MouseEvent) => {
      const r = this.canvas.getBoundingClientRect();
      const mx = ev.clientX - r.left,
        my = ev.clientY - r.top;
      const sx = (mx - this.ox) / this.scale,
        sy = (my - this.oy) / this.scale;
      const a = sx / HW,
        b = sy / HH;
      return [(a + b) / 2, (b - a) / 2];
    };
    this.canvas.addEventListener("mousedown", (ev) => {
      if (!this.online()) return;
      ev.preventDefault();
      const [x, y] = toCell(ev);
      if (ev.button === 0 && !(this.game.controls === "modern" && false)) {
        this.dragging = true;
        this.game.renderer.centerOn(x * 256, y * 256);
      } else if (ev.button === 2) this.game.minimapOrder(Math.floor(x), Math.floor(y));
    });
    window.addEventListener("mousemove", (ev) => {
      if (!this.dragging) return;
      const [x, y] = toCell(ev);
      this.game.renderer.centerOn(x * 256, y * 256);
    });
    window.addEventListener("mouseup", () => (this.dragging = false));
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  online() {
    const g = this.game;
    if (g.me < 0) return true;
    const p = g.world.players[g.me];
    return p.radar || p.defeated;
  }

  ping(x: number, y: number) {
    this.pings.push({ x, y, t: 0 });
  }

  draw(dt: number) {
    this.t += dt;
    const g = this.g;
    const game = this.game;
    const w = game.world;
    const m = w.map;
    const on = this.online();
    this.offline.style.display = on ? "none" : "flex";
    g.clearRect(0, 0, this.w, this.h);
    g.fillStyle = "#05080a";
    g.fillRect(0, 0, this.w, this.h);
    if (!on) {
      // static
      for (let i = 0; i < 160; i++) {
        g.fillStyle = `rgba(120,140,150,${Math.random() * 0.25})`;
        g.fillRect(Math.random() * this.w, Math.random() * this.h, 2, 1);
      }
      return;
    }
    const img = new ImageData(new Uint8ClampedArray(this.base.data), m.w, m.h);
    const d = img.data;
    for (let i = 0; i < m.w * m.h; i++) {
      if (m.oreType[i] && m.ore[i]) {
        const o = i * 4;
        if (m.oreType[i] === 2) {
          d[o] = 90;
          d[o + 1] = 200;
          d[o + 2] = 230;
        } else {
          d[o] = 205;
          d[o + 1] = 165;
          d[o + 2] = 50;
        }
      }
    }
    const me = game.me;
    const ex = me >= 0 ? w.players[me].explored : null;
    for (const e of w.ents) {
      if (e.dead) continue;
      if (ex && !ex[e.cell] && e.owner !== me) continue;
      const hex = e.owner < 0 ? "#bbbbbb" : PLAYER_COLORS[w.players[e.owner].color].hex;
      const n = parseInt(hex.slice(1), 16);
      const r = (n >> 16) & 255,
        gg = (n >> 8) & 255,
        b = n & 255;
      const paint = (i: number) => {
        const o = i * 4;
        d[o] = r;
        d[o + 1] = gg;
        d[o + 2] = b;
      };
      if (e.kind === "bld") for (const c of w.footprintCells(e)) paint(c);
      else {
        paint(e.cell);
        if (e.kind === "veh" && e.cell + 1 < m.w * m.h) paint(e.cell + 1);
      }
    }
    if (ex)
      for (let i = 0; i < m.w * m.h; i++)
        if (!ex[i]) {
          const o = i * 4;
          d[o] = d[o + 1] = d[o + 2] = 0;
        }
    this.cells.getContext("2d")!.putImageData(img, 0, 0);
    const s = this.scale;
    g.save();
    g.setTransform(HW * s * dprOf(this), HH * s * dprOf(this), -HW * s * dprOf(this), HH * s * dprOf(this), this.ox * dprOf(this), this.oy * dprOf(this));
    g.imageSmoothingEnabled = false;
    g.drawImage(this.cells, 0, 0);
    g.restore();
    // camera viewport
    const r = game.renderer;
    const cam = r.cam;
    const vx0 = cam.x,
      vy0 = cam.y,
      vx1 = cam.x + cam.vw / cam.zoom,
      vy1 = cam.y + cam.vh / cam.zoom;
    g.strokeStyle = "rgba(255,255,255,0.85)";
    g.lineWidth = 1;
    g.strokeRect(this.ox + vx0 * s, this.oy + vy0 * s, (vx1 - vx0) * s, (vy1 - vy0) * s);
    // pings
    this.pings = this.pings.filter((p) => (p.t += dt) < 3);
    for (const p of this.pings) {
      const sx = this.ox + (p.x - p.y) * HW * s,
        sy = this.oy + (p.x + p.y) * HH * s;
      const k = (p.t % 1) / 1;
      g.strokeStyle = `rgba(255,70,50,${1 - k})`;
      g.beginPath();
      g.arc(sx, sy, 3 + k * 12, 0, Math.PI * 2);
      g.stroke();
    }
  }
}

function dprOf(_m: Minimap) {
  return Math.min(2, window.devicePixelRatio || 1);
}
