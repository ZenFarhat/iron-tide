// In-match client controller: owns the World, the lockstep loop, rendering and UI.
import { World } from "../sim/world";
import type { Command } from "../sim/commands";
import type { SimEvent } from "../sim/entity";
import { TPS } from "../sim/fixed";
import { RULES, SUPERWEAPONS } from "../sim/rules";
import { PLAYER_COLORS, turnTicks } from "../shared/protocol";
import { Optimistic } from "./optimistic";
import { Renderer, type Mode, type ViewState } from "./render/renderer";
import { Fx } from "./render/fx";
import { Audio, FX_SOUND } from "./audio";
import type { Session } from "./net";
import { Sidebar, fmtTime } from "./ui/sidebar";
import { Minimap } from "./ui/minimap";
import { Input } from "./input";

export interface GameOptions {
  world: World;
  session: Session;
  audio: Audio;
  onExit: () => void;
  title?: string;
  /** game speed multiplier; fixed for the whole match when online */
  speed?: number;
}

/** speeds offered in the single-player menu (online games use the lobby's GAME_SPEEDS) */
const LOCAL_SPEEDS = [0.5, 1, 1.5, 2, 3, 4, 8];

export class Game {
  world: World;
  session: Session;
  me: number;
  audio: Audio;
  root: HTMLDivElement;
  canvas: HTMLCanvasElement;
  renderer: Renderer;
  fx: Fx;
  sidebar: Sidebar;
  minimap: Minimap;
  input: Input;
  vs: ViewState;
  controls: "classic" | "modern" = "classic";
  speed = 1;
  /** sim ticks per lockstep turn */
  turnTicks = 1;
  opt = new Optimistic();
  paused = false;
  running = true;
  private acc = 0;
  private last = 0;
  private refreshT = 0;
  private raf = 0;
  msgEl: HTMLDivElement;
  hintEl: HTMLDivElement | null = null;
  topEl: HTMLDivElement;
  swEl: HTMLDivElement;
  overlayEl: HTMLDivElement | null = null;
  chatEl: HTMLInputElement;
  lastAlert: [number, number] | null = null;
  ended = false;
  desynced = false;
  onExit: () => void;
  fps = 60;
  ff = false;

  constructor(host: HTMLElement, o: GameOptions) {
    this.world = o.world;
    this.session = o.session;
    this.me = o.session.me;
    this.audio = o.audio;
    this.onExit = o.onExit;
    this.speed = o.speed ?? 1;
    // local sessions apply commands on the very next tick; online turns cover several ticks
    this.turnTicks = this.session.online ? turnTicks(this.speed) : 1;
    (this.world as any).__me = this.me;
    try {
      const c = localStorage.getItem("it.controls");
      if (c === "modern" || c === "classic") this.controls = c;
    } catch {}
    const root = document.createElement("div");
    root.className = "game";
    root.innerHTML = `<div class="viewport"><canvas class="view"></canvas><div class="topbar"></div><div class="sw-timers"></div><div class="messages"></div><input class="chat-input" maxlength="200" placeholder="Say something… (Enter to send, Esc to cancel)"/></div>`;
    host.appendChild(root);
    this.root = root;
    this.canvas = root.querySelector("canvas.view")!;
    this.msgEl = root.querySelector(".messages")!;
    this.topEl = root.querySelector(".topbar")!;
    this.swEl = root.querySelector(".sw-timers")!;
    this.chatEl = root.querySelector(".chat-input")!;
    this.fx = new Fx();
    this.renderer = new Renderer(this.canvas, this.world, this.fx);
    this.vs = {
      me: this.me,
      selection: new Set(),
      hoverId: 0,
      hoverCell: null,
      mode: { kind: "none" },
      dragBox: null,
      mouse: { x: 0, y: 0, inside: false },
      cursor: "default",
      groups: new Map(),
      showAllHealth: false,
      opt: this.opt,
    };
    this.sidebar = new Sidebar(this, root);
    this.minimap = new Minimap(this, this.sidebar.minimapHost);
    this.input = new Input(this);
    const onResize = () => this.resize();
    window.addEventListener("resize", onResize);
    this.cleanup.push(() => window.removeEventListener("resize", onResize));
    this.resize();
    // centre on my start
    const mine = this.world.ents.find((e) => e.owner === Math.max(0, this.me) && e.type === "mhv");
    if (mine) this.renderer.centerOn(mine.x, mine.y);
    if ("onDesync" in this.session) {
      (this.session as any).onDesync = (t: number) => {
        this.desynced = true;
        this.message(`⚠ Desync detected at tick ${t}. The match may diverge between players.`, "#ff8060");
      };
      (this.session as any).onChat = (from: string, color: number, text: string, system: boolean) => {
        if (system) this.message(text, "#9fb3c8");
        else this.message(`${from}: ${text}`, color >= 0 ? PLAYER_COLORS[color].hex : "#ddd");
        if (!system) this.audio.play("click", 0.6);
      };
    }
    this.chatEl.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        const t = this.chatEl.value.trim();
        if (t) {
          if (this.session.online) this.session.chat(t);
          else this.message(`You: ${t}`, "#ddd");
        }
        this.chatEl.value = "";
        this.chatEl.style.display = "none";
        this.canvas.focus();
      } else if (e.key === "Escape") {
        this.chatEl.value = "";
        this.chatEl.style.display = "none";
      }
    });
    this.message(this.me >= 0 ? `${this.world.players[this.me].name}, deploy your Mobile Hub to begin: select it and press D.` : "Spectating.", "#cfe3ff");
    if (this.me >= 0) {
      const h = document.createElement("div");
      h.className = "start-hint";
      h.innerHTML = `<b>Double-click your Mobile Hub</b> to deploy your base <span>(or select it and press <kbd>D</kbd>)</span>`;
      root.querySelector(".viewport")!.appendChild(h);
      this.hintEl = h;
    }
    this.audio.startMusic();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  cleanup: (() => void)[] = [];

  resize() {
    const vp = this.root.querySelector(".viewport") as HTMLElement;
    const r = vp.getBoundingClientRect();
    this.renderer.resize(Math.max(100, r.width), Math.max(100, r.height));
  }

  openChat() {
    this.chatEl.style.display = "block";
    this.chatEl.focus();
  }

  send(cmd: Command) {
    if (this.me < 0 || this.ended) return;
    this.session.send(cmd, this.opt.issue(cmd, this.world, performance.now()));
  }

  setMode(m: Mode) {
    this.vs.mode = m;
  }
  toggleMode(kind: "sell" | "repair") {
    this.audio.unlock();
    this.audio.play("click", 0.6);
    this.vs.mode = this.vs.mode.kind === kind ? { kind: "none" } : { kind };
  }

  armSuperweapon(kind: string) {
    const ready = this.world.ents.some((e) => !e.dead && e.owner === this.me && e.r.superweapon === kind && e.swCharge >= SUPERWEAPONS[kind].charge);
    if (!ready) {
      this.audio.play("error");
      return;
    }
    this.audio.play("click");
    this.vs.mode = { kind: "sw", type: kind, step: 0 };
    this.audio.eva(SUPERWEAPONS[kind].twoStep ? "Select units to shift" : "Select target");
  }

  minimapOrder(x: number, y: number) {
    const ids = [...this.vs.selection].filter((id) => {
      const e = this.world.get(id);
      return e && e.owner === this.me && e.kind !== "bld";
    });
    if (ids.length) {
      this.send({ c: "move", ids, x, y });
      this.audio.play("ack", 0.5);
    }
  }

  hideHint() {
    const h = this.hintEl;
    if (!h) return;
    this.hintEl = null;
    h.classList.add("fade");
    setTimeout(() => h.remove(), 600);
  }

  message(text: string, color = "#e8f0ff") {
    const d = document.createElement("div");
    d.className = "msg";
    d.style.color = color;
    d.textContent = text;
    this.msgEl.appendChild(d);
    while (this.msgEl.children.length > 7) this.msgEl.firstChild!.remove();
    setTimeout(() => d.classList.add("fade"), 7000);
    setTimeout(() => d.remove(), 8000);
  }

  openMenu() {
    if (this.overlayEl) return;
    if (!this.session.online) this.paused = true;
    const o = document.createElement("div");
    o.className = "overlay";
    o.innerHTML = `<div class="panel menu-panel">
      <h2>${this.session.online ? "Options" : "Paused"}</h2>
      <label class="row">Controls
        <select data-k="controls"><option value="classic">Classic (left-click commands)</option><option value="modern">Modern (right-click commands)</option></select></label>
      <label class="row">Sound effects <input type="range" min="0" max="1" step="0.05" data-k="sfx"></label>
      <label class="row">Music <input type="range" min="0" max="1" step="0.05" data-k="music"></label>
      <label class="row">Announcer voice <input type="checkbox" data-k="voice"></label>
      ${this.session.online ? `<div class="row">Game speed <b>${this.speed}×</b></div>` : `<label class="row">Game speed <select data-k="speed">${LOCAL_SPEEDS.map((v) => `<option value="${v}">${v}×${v === 1 ? " (normal)" : ""}</option>`).join("")}</select></label>`}
      <div class="btns"><button data-a="resume" class="primary">Resume</button><button data-a="surrender" class="danger">${this.me >= 0 && !this.world.players[this.me].defeated && !this.ended ? "Surrender" : "Leave match"}</button></div>
      <div class="help">
        <b>Controls</b> · Drag to select · Left-click to order (classic) · Right-click / Esc deselects · Right-drag scrolls<br/>
        Ctrl+click force-fire · Alt+click force-move · A attack-move · S stop · G guard · D deploy · X scatter<br/>
        Ctrl+1-9 assign group · 1-9 select (twice to centre) · T same type · P all combat · H home · Space last alert<br/>
        Q/W/E/R sidebar tabs · Enter chat · Mouse wheel zoom · ` + "`" + ` toggles health bars
      </div></div>`;
    document.body.appendChild(o);
    this.overlayEl = o;
    const ctl = o.querySelector('[data-k="controls"]') as HTMLSelectElement;
    ctl.value = this.controls;
    ctl.onchange = () => {
      this.controls = ctl.value as any;
      try {
        localStorage.setItem("it.controls", this.controls);
      } catch {}
    };
    const sfx = o.querySelector('[data-k="sfx"]') as HTMLInputElement;
    sfx.value = String(this.audio.settings.sfx);
    sfx.oninput = () => {
      this.audio.settings.sfx = +sfx.value;
      this.audio.saveSettings();
    };
    const mus = o.querySelector('[data-k="music"]') as HTMLInputElement;
    mus.value = String(this.audio.settings.music);
    mus.oninput = () => {
      this.audio.settings.music = +mus.value;
      this.audio.settings.musicOn = +mus.value > 0;
      this.audio.saveSettings();
    };
    const voice = o.querySelector('[data-k="voice"]') as HTMLInputElement;
    voice.checked = this.audio.settings.voice;
    voice.onchange = () => {
      this.audio.settings.voice = voice.checked;
      this.audio.saveSettings();
    };
    const sp = o.querySelector('[data-k="speed"]') as HTMLSelectElement | null;
    if (sp) {
      sp.value = String(this.speed);
      sp.onchange = () => (this.speed = +sp.value);
    }
    (o.querySelector('[data-a="resume"]') as HTMLButtonElement).onclick = () => this.closeMenu();
    (o.querySelector('[data-a="surrender"]') as HTMLButtonElement).onclick = () => {
      if (this.me >= 0 && !this.world.players[this.me].defeated && !this.ended) this.send({ c: "leave" });
      this.closeMenu();
      this.exit();
    };
  }

  closeMenu() {
    this.overlayEl?.remove();
    this.overlayEl = null;
    this.paused = false;
  }

  exit() {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.audio.stopMusic();
    this.input.destroy();
    this.sidebar.destroy();
    this.overlayEl?.remove();
    for (const c of this.cleanup) c();
    // give the leave command a moment to reach the server before closing
    setTimeout(() => this.session.close(), 300);
    this.root.remove();
    this.onExit();
  }

  // ───────────────────────────── loop ─────────────────────────────

  private frame = (now: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    const dtMs = Math.min(250, now - this.last);
    this.last = now;
    const dt = dtMs / 1000;
    this.fps = this.fps * 0.95 + (1000 / Math.max(1, dtMs)) * 0.05;
    const stepMs = 1000 / TPS;
    const avail = this.session.available();
    const maxTick = avail === Infinity ? Infinity : (avail + 1) * this.turnTicks;
    // buffering thresholds are real-time durations, so they hold at every game speed
    const ticksIn = (ms: number) => Math.ceil((ms * TPS * this.speed) / 1000);
    const maxSteps = Math.max(6, ticksIn(300));
    if (!this.paused) this.acc += dtMs * this.speed;
    let steps = 0;
    if (maxTick !== Infinity && this.world.tick + ticksIn(600) < maxTick) {
      // far behind (joined mid-game or tab was hidden): fast-forward without effects
      this.ff = true;
      const t0 = performance.now();
      while (this.world.tick < maxTick - ticksIn(200) && performance.now() - t0 < 30) this.stepSim();
      this.ff = false;
      this.acc = 0;
    }
    while (this.acc >= stepMs && this.world.tick < maxTick && steps < maxSteps) {
      this.stepSim();
      this.acc -= stepMs;
      steps++;
    }
    // slightly speed up when we have a backlog to keep latency low
    if (maxTick !== Infinity && this.world.tick + ticksIn(300) < maxTick && !this.paused) {
      for (let k = 0; k < Math.ceil(this.speed) && this.world.tick < maxTick; k++) this.stepSim();
    }
    if (this.world.tick >= maxTick) this.acc = Math.min(this.acc, stepMs);
    if (this.acc > stepMs * maxSteps) this.acc = stepMs * maxSteps;
    const alpha = Math.max(0, Math.min(1, this.acc / stepMs));
    // world animation (effects, walk cycles, spinning radars) runs on game time
    const simDt = this.paused ? 0 : dt * this.speed;
    this.fx.speed = this.speed;
    this.opt.update(dt, now);
    this.input.update(dt);
    this.fx.update(simDt);
    this.renderer.draw(alpha, this.vs, dt, simDt);
    this.minimap.draw(dt);
    this.sidebar.update(dt);
    this.refreshT += dt;
    if (this.refreshT > 0.12) {
      this.refreshT = 0;
      this.sidebar.refresh();
      this.updateHud();
    }
  };

  private stepSim() {
    const w = this.world;
    const T = w.tick;
    const cmds = T % this.turnTicks === 0 ? this.session.turn(T / this.turnTicks) : [];
    w.step(cmds);
    // our own commands in this turn have now taken effect: retire their previews
    for (const [pi, , seq] of cmds) if (pi === this.me && seq !== undefined) this.opt.confirm(seq);
    for (const ev of w.events) this.onEvent(ev);
    w.events.length = 0;
    if (w.tick % 100 === 0) this.session.hash(w.tick, w.hash());
    // prune selection
    for (const id of this.vs.selection) if (!w.get(id)) this.vs.selection.delete(id);
  }

  private soundAt(x: number, y: number): [number, number] {
    const [cx, cy] = this.renderer.worldToCss(x, y, 0);
    const vw = this.renderer.cam.vw,
      vh = this.renderer.cam.vh;
    const dx = cx - vw / 2,
      dy = cy - vh / 2;
    const d = Math.hypot(dx / vw, dy / vh);
    const vol = Math.max(0, 1 - Math.max(0, d - 0.45) * 1.6);
    return [vol, dx / (vw / 2)];
  }

  private onEvent(ev: SimEvent) {
    const w = this.world;
    if (this.ff) {
      if (ev.e === "gameover") this.showGameOver(ev.winners);
      return;
    }
    this.fx.onEvent(ev, w, (id) => {
      const e = w.byId.get(id);
      return e ? this.renderer.muzzleOf(e) : null;
    });
    switch (ev.e) {
      case "fire": {
        const s = FX_SOUND[ev.fx];
        if (s) {
          const [v, p] = this.soundAt(ev.x, ev.y);
          this.audio.play(s, v * (ev.fx === "mg" ? 0.5 : 0.75), p);
        }
        break;
      }
      case "hit": {
        if (["cannon", "rocket", "artillery", "bomb", "charge"].includes(ev.fx)) {
          const [v, p] = this.soundAt(ev.x, ev.y);
          this.audio.play(ev.fx === "artillery" || ev.fx === "bomb" || ev.fx === "charge" ? "bigexplode" : "explode", v * 0.7, p);
        }
        break;
      }
      case "die": {
        const [v, p] = this.soundAt(ev.x, ev.y);
        if (ev.kind === "bld") this.audio.play("bigexplode", v, p);
        else if (ev.kind !== "inf") this.audio.play("explode", v, p);
        break;
      }
      case "crush": {
        const [v, p] = this.soundAt(ev.x, ev.y);
        this.audio.play("crush", v, p);
        break;
      }
      case "bigboom":
        this.audio.play("nuke", 0.8);
        break;
      case "bolt": {
        const [v, p] = this.soundAt(ev.x, ev.y);
        this.audio.play("bolt", Math.max(0.3, v), p);
        break;
      }
      case "nuke":
        this.audio.play("nuke", 1);
        break;
      case "teleport": {
        const [v, p] = this.soundAt(ev.x2, ev.y2);
        this.audio.play("teleport", Math.max(0.2, v), p);
        break;
      }
      case "eva":
        if (ev.owner === this.me || ev.owner === -1) {
          this.audio.eva(ev.msg);
          if (!["Building", "Training", "On hold"].includes(ev.msg)) this.message(ev.msg, ev.owner === -1 ? "#ffcf70" : "#bfe0ff");
        }
        break;
      case "ready":
        if (ev.owner === this.me) this.audio.play("ready", 0.6);
        break;
      case "placed":
        if (ev.owner === this.me) this.audio.play("place", 0.8);
        break;
      case "sell":
        if (ev.owner === this.me) this.audio.play("sell", 0.6);
        break;
      case "promote":
        if (ev.owner === this.me) this.audio.play("promote", 0.5);
        break;
      case "alert":
        if (ev.owner === this.me) {
          this.minimap.ping(ev.x / 256, ev.y / 256);
          this.lastAlert = [ev.x, ev.y];
          this.audio.play("alarm", 0.4);
        }
        break;
      case "swlaunch":
        this.minimap.ping(ev.x / 256, ev.y / 256);
        this.lastAlert = [ev.x, ev.y];
        break;
      case "nodeploy":
        if (ev.owner === this.me) this.audio.play("error");
        break;
      case "deploy":
        if (ev.owner === this.me) {
          this.audio.play("place", 0.8);
          this.hideHint();
        }
        break;
      case "defeat":
        if (ev.owner === this.me) this.message("You have been defeated.", "#ff7060"), this.hideHint();
        else this.message(`${w.players[ev.owner].name} was eliminated.`, "#ffcf70");
        break;
      case "gameover":
        this.showGameOver(ev.winners);
        break;
    }
  }

  private showGameOver(winners: number[]) {
    if (this.ended) return;
    this.ended = true;
    const w = this.world;
    const won = this.me >= 0 && winners.includes(this.me);
    const title = this.me < 0 ? "Match over" : won ? "Victory" : "Defeat";
    this.audio.eva(this.me < 0 ? "Battle control terminated" : won ? "Mission accomplished" : "Mission failed");
    setTimeout(() => {
      const o = document.createElement("div");
      o.className = "overlay";
      const rows = w.players
        .map(
          (p) =>
            `<tr><td><span class="sw-dot" style="background:${PLAYER_COLORS[p.color].hex}"></span>${p.name}${winners.includes(p.idx) ? " 🏆" : ""}</td><td>${p.faction === "C" ? "Concord" : "Dominion"}</td><td>${p.stats.kills}</td><td>${p.stats.losses}</td><td>${p.stats.built}</td><td>$${p.stats.harvested.toLocaleString()}</td></tr>`,
        )
        .join("");
      o.innerHTML = `<div class="panel go-panel"><h1 class="${won ? "win" : "lose"}">${title}</h1>
        <p>Match length ${fmtTime(Math.floor(w.tick / TPS))}</p>
        <table class="stats"><tr><th>Commander</th><th>Faction</th><th>Kills</th><th>Losses</th><th>Built</th><th>Harvested</th></tr>${rows}</table>
        <div class="btns"><button class="primary" data-a="exit">Return to menu</button><button data-a="watch">Keep watching</button></div></div>`;
      document.body.appendChild(o);
      (o.querySelector('[data-a="exit"]') as HTMLButtonElement).onclick = () => {
        o.remove();
        this.exit();
      };
      (o.querySelector('[data-a="watch"]') as HTMLButtonElement).onclick = () => o.remove();
      this.cleanup.push(() => o.remove());
    }, 1500);
  }

  private updateHud() {
    const w = this.world;
    const secs = Math.floor(w.tick / TPS);
    const ping = (this.session as any).net?.ping;
    this.topEl.innerHTML = `<span>⏱ ${fmtTime(secs)}</span>${this.speed !== 1 ? `<span class="speed">${this.speed}× speed</span>` : ""}${this.session.online ? `<span>📶 ${ping ?? "-"} ms</span>` : ""}<span>${Math.round(this.fps)} fps</span>${this.paused ? "<span class='paused'>PAUSED</span>" : ""}${this.desynced ? "<span class='desync'>DESYNC</span>" : ""}`;
    // superweapon timers for every player (visible to all, as is tradition)
    const rows: string[] = [];
    for (const e of w.ents) {
      if (e.dead || !e.r.superweapon || e.owner < 0 || e.built < 40) continue;
      const sw = SUPERWEAPONS[e.r.superweapon];
      const left = Math.max(0, sw.charge - e.swCharge);
      const p = w.players[e.owner];
      rows.push(`<div class="swt"><span class="sw-dot" style="background:${PLAYER_COLORS[p.color].hex}"></span>${sw.name} <b>${left === 0 ? "READY" : fmtTime(Math.ceil(left / TPS))}</b></div>`);
    }
    this.swEl.innerHTML = rows.join("");
  }

  /** selectable own mobile units in the current selection */
  selectedUnits() {
    const out = [];
    for (const id of this.vs.selection) {
      const e = this.world.get(id);
      if (e && e.owner === this.me && e.kind !== "bld") out.push(e);
    }
    return out;
  }
}

export { RULES };
