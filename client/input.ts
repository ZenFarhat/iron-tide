// Mouse & keyboard handling: selection, context-sensitive orders, camera.
import type { Game } from "./game";
import type { Entity } from "../sim/entity";
import type { Command } from "../sim/commands";
import { CONSTRUCT_TICKS, RULES, SUPERWEAPONS, WEAPONS } from "../sim/rules";
import { ZH } from "./render/iso";
import type { CursorKind } from "./render/renderer";

interface Action {
  cursor: CursorKind;
  exec?: () => void;
}

export class Input {
  game: Game;
  canvas: HTMLCanvasElement;
  down: { b: number; x: number; y: number; camX: number; camY: number; moved: boolean } | null = null;
  keys = new Set<string>();
  lastClick = { t: 0, id: 0 };
  lastGroup = { k: -1, t: 0 };
  lastT = 0;
  lastP = 0;
  winMouse = { x: 0, y: 0, inWindow: false };
  groups = new Map<number, number[]>();
  private offs: (() => void)[] = [];

  constructor(game: Game) {
    this.game = game;
    this.canvas = game.canvas;
    const c = this.canvas;
    c.tabIndex = 0;
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, ev: K, fn: (e: any) => void, opts?: any) => {
      el.addEventListener(ev, fn, opts);
      this.offs.push(() => el.removeEventListener(ev, fn, opts));
    };
    on(c, "mousedown", (e: MouseEvent) => this.onDown(e));
    on(window, "mousemove", (e: MouseEvent) => this.onMove(e));
    on(window, "mouseup", (e: MouseEvent) => this.onUp(e));
    on(c, "wheel", (e: WheelEvent) => this.onWheel(e), { passive: false });
    on(c, "contextmenu", (e: Event) => e.preventDefault());
    on(c, "mouseenter", () => (this.game.vs.mouse.inside = true));
    on(c, "mouseleave", () => (this.game.vs.mouse.inside = false));
    on(window, "keydown", (e: KeyboardEvent) => this.onKey(e, true));
    on(window, "keyup", (e: KeyboardEvent) => this.onKey(e, false));
    on(window, "blur", () => this.keys.clear());
    on(document.documentElement as any, "mouseleave", () => (this.winMouse.inWindow = false));
    on(document.documentElement as any, "mouseenter", () => (this.winMouse.inWindow = true));
  }

  destroy() {
    for (const f of this.offs) f();
  }

  private local(e: MouseEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  // ───────────────────────────── picking ─────────────────────────────

  pick(mx: number, my: number): Entity | null {
    const g = this.game;
    const r = g.renderer;
    const w = g.world;
    const zoom = r.cam.zoom;
    let best: Entity | null = null,
      bd = 1e9;
    for (const e of w.ents) {
      if (e.dead || e.kind === "bld" || !r.visibleTo(g.me, e)) continue;
      const [cx, cy] = r.worldToCss(e.x, e.y, e.z);
      const inf = e.kind === "inf";
      const big = e.type === "d_dread" ? 2.2 : 1;
      const hw = (inf ? 8 : 18) * zoom * big,
        top = (inf ? 24 : 22) * zoom * big,
        bot = (inf ? 5 : 10) * zoom * big;
      const dx = mx - cx,
        dy = my - cy;
      if (Math.abs(dx) <= hw && dy >= -top && dy <= bot) {
        const d = dx * dx + (dy + top / 2) * (dy + top / 2) - (e.kind === "air" ? 400 : 0);
        if (d < bd) {
          bd = d;
          best = e;
        }
      }
    }
    if (best) return best;
    for (let k = 0; k <= 9; k++) {
      const hz = k * 0.18;
      const [fx, fy] = r.screenToCell(mx, my + hz * ZH * zoom);
      const x = Math.floor(fx),
        y = Math.floor(fy);
      if (!w.map.inside(x, y)) continue;
      const id = w.bldAt[y * w.map.w + x];
      if (!id) continue;
      const b = w.get(id);
      if (!b || !r.visibleTo(g.me, b)) continue;
      const h = (r as any).constructor && b ? structHeight(b) : 1;
      if (hz <= h + 0.1) return b;
    }
    return null;
  }

  hoverCell(mx: number, my: number): [number, number] {
    const [fx, fy] = this.game.renderer.screenToCell(mx, my);
    return [Math.floor(fx), Math.floor(fy)];
  }

  // ───────────────────────────── actions ─────────────────────────────

  private mods(e?: MouseEvent | KeyboardEvent) {
    return { ctrl: !!(e?.ctrlKey || e?.metaKey || this.keys.has("Control") || this.keys.has("Meta")), alt: !!(e?.altKey || this.keys.has("Alt")), shift: !!(e?.shiftKey || this.keys.has("Shift")) };
  }

  private canAttack(u: Entity, t: Entity, force: boolean) {
    if (!force && !this.game.world.isEnemy(u.owner, t.owner)) return false;
    const air = t.flying;
    if (u.r.hero && t.kind === "bld") return true;
    const ids = u.r.deployable && u.kind === "inf" ? [u.deployed ? u.r.deployGround : u.r.wGround, u.deployed ? u.r.deployAir : u.r.wAir] : [u.r.wGround, u.r.wAir];
    for (const id of ids) {
      if (!id) continue;
      const wp = WEAPONS[id];
      if (air ? wp.air : wp.ground) return true;
    }
    return false;
  }

  resolve(target: Entity | null, cx: number, cy: number, mods: { ctrl: boolean; alt: boolean; shift: boolean }): Action {
    const g = this.game;
    const w = g.world;
    const me = g.me;
    const mode = g.vs.mode;
    const p = me >= 0 ? w.players[me] : null;
    const send = (c: Command) => {
      g.send(c);
    };
    // modes
    if (mode.kind === "place") {
      const r = RULES[mode.type!];
      const bx = cx - Math.floor((r.w - 1) / 2),
        by = cy - Math.floor((r.h - 1) / 2);
      const ok = !!p && w.placementOk(p, r.id, bx, by);
      return {
        cursor: "place",
        exec: () => {
          if (!ok) {
            g.audio.play("error");
            return;
          }
          send({ c: "place", type: r.id, x: bx, y: by });
          g.setMode({ kind: "none" });
        },
      };
    }
    if (mode.kind === "sell") {
      const ok = target && target.owner === me && target.kind === "bld" && target.built >= CONSTRUCT_TICKS && !target.selling;
      return { cursor: ok ? "sell" : "nosell", exec: ok ? () => send({ c: "sell", t: target!.id }) : () => g.audio.play("error") };
    }
    if (mode.kind === "repair") {
      const ok = target && target.owner === me && target.kind === "bld" && target.hp < target.r.hp;
      return { cursor: ok ? "repair" : "norepair", exec: ok ? () => send({ c: "repair", t: target!.id }) : () => g.audio.play("error") };
    }
    if (mode.kind === "sw") {
      const sw = SUPERWEAPONS[mode.type!];
      return {
        cursor: "sw",
        exec: () => {
          if (!w.map.inside(cx, cy)) return;
          if (sw.twoStep && mode.step === 0) {
            g.setMode({ kind: "sw", type: mode.type, step: 1, x: cx, y: cy });
            g.audio.play("click");
            g.audio.eva("Select destination");
            return;
          }
          if (sw.twoStep) send({ c: "sw", kind: sw.id, x: mode.x!, y: mode.y!, x2: cx, y2: cy });
          else send({ c: "sw", kind: sw.id, x: cx, y: cy });
          g.setMode({ kind: "none" });
        },
      };
    }
    const units = g.selectedUnits();
    const ids = units.map((u) => u.id);
    const selB = g.vs.selection.size === 1 ? w.get([...g.vs.selection][0]) : undefined;
    if (mode.kind === "amove" && units.length) {
      return { cursor: "amove", exec: () => (send({ c: "amove", ids, x: cx, y: cy }), g.setMode({ kind: "none" }), this.ack()) };
    }
    if (!units.length) {
      if (selB && selB.owner === me && selB.kind === "bld" && !target && (selB.r.tags.includes("barracks") || selB.r.tags.includes("factory") || selB.r.tags.includes("aircmd")) && w.map.inside(cx, cy))
        return { cursor: "move", exec: () => (send({ c: "rally", t: selB.id, x: cx, y: cy }), g.audio.play("click")) };
      return { cursor: target ? "select" : "default" };
    }
    if (mods.ctrl) {
      if (target) return { cursor: "attack", exec: () => (send({ c: "attack", ids, t: target.id }), this.ack()) };
      return { cursor: "attack", exec: () => (send({ c: "ffire", ids, x: cx, y: cy }), this.ack()) };
    }
    if (mods.alt && w.map.inside(cx, cy)) return { cursor: "move", exec: () => (send({ c: "move", ids, x: cx, y: cy }), this.ack()) };
    if (target) {
      if (target.owner === me) {
        if (target.kind !== "bld") {
          if (units.length === 1 && units[0] === target && (target.r.deployable || target.type === "mhv")) return { cursor: "deploy", exec: () => (send({ c: "deploy", ids: [target.id] }), this.ack()) };
          return { cursor: "select" };
        }
        const r = target.r;
        const enter = units.filter(
          (u) =>
            (u.r.engineer && target.hp < r.hp) ||
            (u.r.harvester && r.tags.includes("refinery")) ||
            (u.kind === "veh" && r.repairBay && u.hp < u.r.hp) ||
            (u.r.jet && r.pads) ||
            (u.r.chargesCoil && r.chargeable),
        );
        if (enter.length && target.built >= CONSTRUCT_TICKS) return { cursor: target.r.repairBay || (enter[0].r.engineer && !target.r.pads) ? "repair" : "enter", exec: () => (send({ c: "enter", ids: enter.map((u) => u.id), t: target.id }), this.ack()) };
        return { cursor: "select" };
      }
      const enemy = w.isEnemy(me, target.owner);
      const eng = units.filter((u) => u.r.engineer);
      if (eng.length && target.kind === "bld" && !target.r.wall && (enemy || (target.owner < 0 && target.r.capturable))) {
        const others = units.filter((u) => !u.r.engineer && this.canAttack(u, target, false));
        return {
          cursor: "capture",
          exec: () => {
            send({ c: "enter", ids: eng.map((u) => u.id), t: target.id });
            if (others.length) send({ c: "attack", ids: others.map((u) => u.id), t: target.id });
            this.ack();
          },
        };
      }
      if (enemy) {
        const atk = units.filter((u) => this.canAttack(u, target, false));
        if (atk.length) return { cursor: "attack", exec: () => (send({ c: "attack", ids: atk.map((u) => u.id), t: target.id }), this.ack()) };
      }
      return { cursor: "select" };
    }
    if (!w.map.inside(cx, cy)) return { cursor: "nomove" };
    const i = cy * w.map.w + cx;
    const harv = units.filter((u) => u.r.harvester);
    if (harv.length && w.map.oreType[i] && w.map.ore[i] && harv.length === units.length) return { cursor: "harvest", exec: () => (send({ c: "harvest", ids, x: cx, y: cy }), this.ack()) };
    const explored = me < 0 || w.players[me].explored[i];
    const groundOk = w.map.groundOk(i) && !w.solid[i];
    const anyAir = units.some((u) => u.kind === "air");
    if (!groundOk && !anyAir && explored) return { cursor: "nomove" };
    return { cursor: "move", exec: () => (send({ c: "move", ids, x: cx, y: cy }), this.ack()) };
  }

  private ack() {
    this.game.audio.play("ack", 0.45);
  }

  // ───────────────────────────── selection ─────────────────────────────

  private select(ids: number[], add: boolean) {
    const s = this.game.vs.selection;
    if (!add) s.clear();
    for (const id of ids) s.add(id);
    if (ids.length) this.game.audio.play("click", 0.35);
  }

  private onScreen(e: Entity) {
    const r = this.game.renderer;
    const [x, y] = r.worldToCss(e.x, e.y, e.z);
    return x >= 0 && y >= 0 && x <= r.cam.vw && y <= r.cam.vh;
  }

  private clickSelect(target: Entity | null, shift: boolean, now: number) {
    const g = this.game;
    const s = g.vs.selection;
    if (!target) {
      if (!shift) s.clear();
      return;
    }
    const dbl = now - this.lastClick.t < 350 && this.lastClick.id === target.id;
    this.lastClick = { t: now, id: target.id };
    if (target.owner === g.me && target.kind !== "bld") {
      if (dbl && target.type === "mhv") {
        this.select([target.id], false);
        g.send({ c: "deploy", ids: [target.id] });
        this.ack();
        return;
      }
      if (dbl) {
        this.select(
          g.world.ents.filter((e) => !e.dead && e.owner === g.me && e.type === target.type && this.onScreen(e)).map((e) => e.id),
          shift,
        );
        return;
      }
      if (shift) {
        if (s.has(target.id)) s.delete(target.id);
        else s.add(target.id);
        return;
      }
      this.select([target.id], false);
      return;
    }
    // structures or other players' units: single info selection
    this.select([target.id], false);
  }

  private boxSelect(x0: number, y0: number, x1: number, y1: number, add: boolean) {
    const g = this.game;
    const r = g.renderer;
    const ax = Math.min(x0, x1),
      bx = Math.max(x0, x1),
      ay = Math.min(y0, y1),
      by = Math.max(y0, y1);
    const ids: number[] = [];
    for (const e of g.world.ents) {
      if (e.dead || e.owner !== g.me || e.kind === "bld") continue;
      const [x, y] = r.worldToCss(e.x, e.y, e.z);
      if (x >= ax && x <= bx && y - 8 >= ay - 12 && y - 8 <= by + 4) ids.push(e.id);
    }
    // prefer combat units over harvesters if mixed
    const combat = ids.filter((id) => {
      const e = g.world.get(id)!;
      return !e.r.harvester;
    });
    const pick = combat.length ? combat : ids;
    if (!add) g.vs.selection.clear();
    for (const id of pick) g.vs.selection.add(id);
    if (pick.length) g.audio.play("ack", 0.4);
  }

  // ───────────────────────────── events ─────────────────────────────

  private onDown(e: MouseEvent) {
    this.game.audio.unlock();
    this.canvas.focus();
    const [x, y] = this.local(e);
    const cam = this.game.renderer.cam;
    this.down = { b: e.button, x, y, camX: cam.x, camY: cam.y, moved: false };
    e.preventDefault();
  }

  private onMove(e: MouseEvent) {
    this.winMouse.x = e.clientX;
    this.winMouse.y = e.clientY;
    this.winMouse.inWindow = true;
    const [x, y] = this.local(e);
    const vs = this.game.vs;
    vs.mouse.x = x;
    vs.mouse.y = y;
    const d = this.down;
    if (!d) return;
    const dist = Math.hypot(x - d.x, y - d.y);
    if (dist > 6) d.moved = true;
    if (d.b === 0 && d.moved && vs.mode.kind === "none") vs.dragBox = { x0: d.x, y0: d.y, x1: x, y1: y };
    if ((d.b === 2 || d.b === 1) && d.moved) {
      const cam = this.game.renderer.cam;
      cam.x = d.camX - (x - d.x) / cam.zoom;
      cam.y = d.camY - (y - d.y) / cam.zoom;
      this.game.renderer.clampCamera();
      vs.cursor = "pan";
    }
  }

  private onUp(e: MouseEvent) {
    const d = this.down;
    this.down = null;
    if (!d) return;
    const g = this.game;
    const vs = g.vs;
    const [x, y] = this.local(e);
    const mods = this.mods(e);
    const now = performance.now();
    if (d.b === 0) {
      if (vs.dragBox) {
        this.boxSelect(vs.dragBox.x0, vs.dragBox.y0, vs.dragBox.x1, vs.dragBox.y1, mods.shift);
        vs.dragBox = null;
        return;
      }
      if (e.target !== this.canvas && !d.moved) {
        /* released elsewhere */
      }
      const target = this.pick(x, y);
      const [cx, cy] = this.hoverCell(x, y);
      if (vs.mode.kind !== "none") {
        this.resolve(target, cx, cy, mods).exec?.();
        return;
      }
      if (g.controls === "classic") {
        const act = this.resolve(target, cx, cy, mods);
        if (act.exec && act.cursor !== "select") {
          act.exec();
          return;
        }
      }
      this.clickSelect(target, mods.shift, now);
      return;
    }
    if (d.b === 2 && !d.moved) {
      if (vs.mode.kind !== "none") {
        vs.mode = { kind: "none" };
        return;
      }
      if (g.controls === "modern") {
        const target = this.pick(x, y);
        const [cx, cy] = this.hoverCell(x, y);
        const act = this.resolve(target, cx, cy, mods);
        if (act.exec && act.cursor !== "select") act.exec();
        else if (!g.selectedUnits().length) vs.selection.clear();
        return;
      }
      vs.selection.clear();
    }
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const r = this.game.renderer;
    const [mx, my] = this.local(e);
    const [wx, wy] = r.screenToWorldScreen(mx, my);
    const z = Math.max(0.55, Math.min(1.8, r.cam.zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
    r.cam.zoom = z;
    r.cam.x = wx - mx / z;
    r.cam.y = wy - my / z;
    r.clampCamera();
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
    if (down) this.keys.add(e.key);
    else this.keys.delete(e.key);
    if (!down) return;
    const g = this.game;
    const vs = g.vs;
    const k = e.key;
    const units = g.selectedUnits();
    const ids = units.map((u) => u.id);
    const now = performance.now();
    if (/^[0-9]$/.test(k)) {
      const n = +k;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        this.groups.set(n, ids);
        for (const [id, grp] of vs.groups) if (grp === n) vs.groups.delete(id);
        for (const id of ids) vs.groups.set(id, n);
        g.audio.play("click", 0.5);
        return;
      }
      const grp = (this.groups.get(n) ?? []).filter((id) => g.world.get(id));
      if (!grp.length) return;
      this.select(grp, e.shiftKey);
      if (this.lastGroup.k === n && now - this.lastGroup.t < 400) {
        const u = g.world.get(grp[0]);
        if (u) g.renderer.centerOn(u.x, u.y);
      }
      this.lastGroup = { k: n, t: now };
      return;
    }
    switch (k) {
      case "Escape":
        if (vs.mode.kind !== "none") vs.mode = { kind: "none" };
        else if (vs.selection.size) vs.selection.clear();
        else if (g.overlayEl) g.closeMenu();
        else g.openMenu();
        break;
      case "F10":
      case "F1":
        e.preventDefault();
        g.openMenu();
        break;
      case "Enter":
        e.preventDefault();
        g.openChat();
        break;
      case "s":
      case "S":
        if (ids.length) g.send({ c: "stop", ids }), this.ack();
        break;
      case "g":
      case "G":
        if (ids.length) g.send({ c: "guard", ids }), this.ack();
        break;
      case "x":
      case "X":
        if (ids.length) g.send({ c: "scatter", ids }), this.ack();
        break;
      case "d":
      case "D": {
        const dep = [...vs.selection].filter((id) => {
          const e2 = g.world.get(id);
          return e2 && e2.owner === g.me && (e2.r.deployable || e2.type === "mhv" || e2.r.undeploy);
        });
        if (dep.length) g.send({ c: "deploy", ids: dep }), this.ack();
        break;
      }
      case "a":
      case "A":
        if (ids.length) vs.mode = { kind: "amove" };
        break;
      case "t":
      case "T": {
        const types = new Set(units.map((u) => u.type));
        if (!types.size) break;
        const all = now - this.lastT < 400;
        this.lastT = now;
        this.select(g.world.ents.filter((e2) => !e2.dead && e2.owner === g.me && types.has(e2.type) && (all || this.onScreen(e2))).map((e2) => e2.id), false);
        break;
      }
      case "p":
      case "P": {
        const all = now - this.lastP < 400;
        this.lastP = now;
        this.select(
          g.world.ents.filter((e2) => !e2.dead && e2.owner === g.me && e2.kind !== "bld" && !e2.r.harvester && e2.type !== "mhv" && !e2.r.engineer && (all || this.onScreen(e2))).map((e2) => e2.id),
          false,
        );
        break;
      }
      case "h":
      case "H": {
        const hub = g.world.ents.find((e2) => !e2.dead && e2.owner === g.me && (e2.r.tags.includes("hub") || e2.type === "mhv"));
        if (hub) g.renderer.centerOn(hub.x, hub.y);
        break;
      }
      case " ":
        e.preventDefault();
        if (g.lastAlert) g.renderer.centerOn(g.lastAlert[0], g.lastAlert[1]);
        break;
      case "q":
      case "Q":
      case "w":
      case "W":
      case "e":
      case "E":
      case "r":
      case "R":
        g.sidebar.cycleTab(k);
        break;
      case "`":
        vs.showAllHealth = !vs.showAllHealth;
        break;
      case "+":
      case "=":
        g.renderer.cam.zoom = Math.min(1.8, g.renderer.cam.zoom * 1.1);
        g.renderer.clampCamera();
        break;
      case "-":
        g.renderer.cam.zoom = Math.max(0.55, g.renderer.cam.zoom / 1.1);
        g.renderer.clampCamera();
        break;
      case "Delete": {
        const b = [...vs.selection].map((id) => g.world.get(id)).find((e2) => e2 && e2.kind === "bld" && e2.owner === g.me);
        if (b) g.send({ c: "sell", t: b.id });
        break;
      }
    }
  }

  update(dt: number) {
    const g = this.game;
    const r = g.renderer;
    const cam = r.cam;
    let dx = 0,
      dy = 0;
    const sp = (900 * dt) / cam.zoom;
    if (this.keys.has("ArrowLeft")) dx -= sp;
    if (this.keys.has("ArrowRight")) dx += sp;
    if (this.keys.has("ArrowUp")) dy -= sp;
    if (this.keys.has("ArrowDown")) dy += sp;
    if (this.winMouse.inWindow && document.hasFocus() && !this.down && !g.overlayEl) {
      const m = 5;
      const { x, y } = this.winMouse;
      if (x <= m) dx -= sp;
      if (x >= window.innerWidth - m) dx += sp;
      if (y <= m) dy -= sp;
      if (y >= window.innerHeight - m) dy += sp;
    }
    if (dx || dy) {
      cam.x += dx;
      cam.y += dy;
      r.clampCamera();
    }
    // hover & cursor
    const vs = g.vs;
    if (this.down && (this.down.b === 2 || this.down.b === 1) && this.down.moved) return;
    const { x, y } = vs.mouse;
    const target = this.pick(x, y);
    vs.hoverId = target ? target.id : 0;
    const [cx, cy] = this.hoverCell(x, y);
    vs.hoverCell = [cx, cy];
    if (vs.dragBox) {
      vs.cursor = "select";
      return;
    }
    const act = this.resolve(target, cx, cy, this.mods());
    vs.cursor = g.controls === "modern" && vs.mode.kind === "none" && act.cursor !== "select" && act.cursor !== "default" ? act.cursor : act.cursor;
  }
}

function structHeight(b: Entity): number {
  const h: Record<string, number> = {};
  return h[b.type] ?? Math.max(0.5, Math.min(1.6, 0.4 + b.r.w * 0.3));
}
