// Command sidebar: production cameos with clock-wipe progress, power bar, credits, modes.
import type { Game } from "../game";
import { RULES, SUPERWEAPONS, buildTicks, buildablesFor, type Queue, type Rule } from "../../sim/rules";
import { iconCanvas, teamHex } from "../render/sprites";
import type { Player } from "../../sim/entity";

type Tab = "bld" | "def" | "inf" | "veh";
const TABS: { id: Tab; label: string; key: string; queues: Queue[] }[] = [
  { id: "bld", label: "Structures", key: "Q", queues: ["bld"] },
  { id: "def", label: "Defenses", key: "W", queues: ["def"] },
  { id: "inf", label: "Infantry", key: "E", queues: ["inf"] },
  { id: "veh", label: "Vehicles", key: "R", queues: ["veh", "air", "sea"] },
];

const TAB_ICONS: Record<Tab, string> = {
  bld: `<svg viewBox="0 0 24 24"><path d="M3 21V10l5-3v4l5-3v4l5-3v12z" fill="currentColor"/></svg>`,
  def: `<svg viewBox="0 0 24 24"><path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z" fill="currentColor"/></svg>`,
  inf: `<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="3" fill="currentColor"/><path d="M8 9h8l-1 7h-2l-1 6-1-6H9z" fill="currentColor"/></svg>`,
  veh: `<svg viewBox="0 0 24 24"><path d="M2 15h20v3H2zM4 11h12l2 4H4zM9 8h6v3H9zM15 9h7v1.5h-7z" fill="currentColor"/></svg>`,
};

interface CameoEl {
  root: HTMLDivElement;
  wipe: HTMLDivElement;
  count: HTMLDivElement;
  state: HTMLDivElement;
  type: string;
}

export class Sidebar {
  game: Game;
  root: HTMLDivElement;
  tab: Tab = "bld";
  tabEls = new Map<Tab, HTMLButtonElement>();
  cameosEl: HTMLDivElement;
  cameos: CameoEl[] = [];
  creditsEl: HTMLSpanElement;
  powerFill: HTMLDivElement;
  powerDrain: HTMLDivElement;
  powerText: HTMLDivElement;
  swStrip: HTMLDivElement;
  tooltip: HTMLDivElement;
  shownCredits = 0;
  listKey = "";
  swKey = "";
  minimapHost: HTMLDivElement;
  btnRepair: HTMLButtonElement;
  btnSell: HTMLButtonElement;

  constructor(game: Game, host: HTMLElement) {
    this.game = game;
    const root = document.createElement("div");
    root.className = "sidebar";
    root.innerHTML = `
      <div class="sb-radar"></div>
      <div class="sb-credits"><span class="sb-cr-sym">$</span><span class="sb-cr-val">0</span></div>
      <div class="sb-buttons">
        <button class="sb-btn" data-act="repair" title="Repair mode">${wrench}</button>
        <button class="sb-btn" data-act="sell" title="Sell mode">$</button>
        <button class="sb-btn" data-act="menu" title="Menu (Esc)">☰</button>
      </div>
      <div class="sb-sw"></div>
      <div class="sb-main">
        <div class="sb-power" title="Power">
          <div class="sb-power-fill"></div><div class="sb-power-drain"></div>
        </div>
        <div class="sb-col">
          <div class="sb-tabs"></div>
          <div class="sb-cameos"></div>
        </div>
      </div>
      <div class="sb-power-text"></div>`;
    host.appendChild(root);
    this.root = root;
    this.minimapHost = root.querySelector(".sb-radar")!;
    this.creditsEl = root.querySelector(".sb-cr-val")!;
    this.powerFill = root.querySelector(".sb-power-fill")!;
    this.powerDrain = root.querySelector(".sb-power-drain")!;
    this.powerText = root.querySelector(".sb-power-text")!;
    this.cameosEl = root.querySelector(".sb-cameos")!;
    this.swStrip = root.querySelector(".sb-sw")!;
    this.btnRepair = root.querySelector('[data-act="repair"]')!;
    this.btnSell = root.querySelector('[data-act="sell"]')!;
    const tabs = root.querySelector(".sb-tabs")!;
    for (const t of TABS) {
      const b = document.createElement("button");
      b.className = "sb-tab";
      b.innerHTML = TAB_ICONS[t.id];
      b.title = `${t.label} (${t.key})`;
      b.onclick = () => {
        this.game.audio.play("click", 0.5);
        this.setTab(t.id);
      };
      tabs.appendChild(b);
      this.tabEls.set(t.id, b);
    }
    this.btnRepair.onclick = () => this.game.toggleMode("repair");
    this.btnSell.onclick = () => this.game.toggleMode("sell");
    (root.querySelector('[data-act="menu"]') as HTMLButtonElement).onclick = () => this.game.openMenu();
    this.tooltip = document.createElement("div");
    this.tooltip.className = "tooltip";
    document.body.appendChild(this.tooltip);
    root.addEventListener("contextmenu", (e) => e.preventDefault());
    this.setTab("bld");
  }

  setTab(t: Tab) {
    this.tab = t;
    for (const [id, el] of this.tabEls) el.classList.toggle("active", id === t);
    this.listKey = "";
    this.refresh();
  }

  cycleTab(key: string) {
    const t = TABS.find((x) => x.key === key.toUpperCase());
    if (t) this.setTab(t.id);
  }

  private items(tab: Tab): Rule[] {
    const g = this.game;
    const p = g.world.players[g.me];
    if (!p) return [];
    const out: Rule[] = [];
    for (const q of TABS.find((x) => x.id === tab)!.queues) for (const r of buildablesFor(p.faction, q)) if (g.world.canBuild(p, r.id)) out.push(r);
    return out;
  }

  /** rebuild cameo list if availability changed (called ~10×/s) */
  refresh() {
    const g = this.game;
    const p = g.world.players[g.me];
    if (!p) {
      this.cameosEl.innerHTML = `<div class="sb-empty">Spectating</div>`;
      return;
    }
    // tab availability
    const { queues, ready } = this.prod(p);
    for (const t of TABS) {
      const n = this.items(t.id).length;
      const el = this.tabEls.get(t.id)!;
      el.classList.toggle("empty", n === 0);
      const busy = t.queues.some((q) => queues[q].length > 0 || (q === "bld" || q === "def" ? !!ready[q] : false));
      el.classList.toggle("busy", busy);
      el.classList.toggle("ready", t.queues.some((q) => (q === "bld" || q === "def") && !!ready[q]));
    }
    const items = this.items(this.tab);
    const key = this.tab + ":" + items.map((r) => r.id).join(",");
    if (key !== this.listKey) {
      this.listKey = key;
      this.cameosEl.innerHTML = "";
      this.cameos = [];
      const team = teamHex(g.me, (o) => g.world.players[o].color);
      for (const r of items) {
        const root = document.createElement("div");
        root.className = "cameo";
        const ic = iconCanvas(r.id, r.kind, team);
        const img = document.createElement("canvas");
        img.width = ic.width;
        img.height = ic.height;
        img.getContext("2d")!.drawImage(ic, 0, 0);
        img.className = "cameo-icon";
        root.appendChild(img);
        root.insertAdjacentHTML("beforeend", `<div class="cameo-wipe"></div><div class="cameo-name">${r.name}</div><div class="cameo-cost">$${r.cost}</div><div class="cameo-count"></div><div class="cameo-state"></div>`);
        root.onmousedown = (e) => this.click(r, e);
        root.onmouseenter = () => this.showTip(r, root);
        root.onmouseleave = () => (this.tooltip.style.display = "none");
        this.cameosEl.appendChild(root);
        this.cameos.push({ root, wipe: root.querySelector(".cameo-wipe")!, count: root.querySelector(".cameo-count")!, state: root.querySelector(".cameo-state")!, type: r.id });
      }
      if (!items.length) this.cameosEl.innerHTML = `<div class="sb-empty">${p.tags.has("hub") || this.tab === "inf" || this.tab === "veh" ? "Nothing available yet" : "Deploy your Mobile Hub (D)"}</div>`;
    }
    this.refreshSW();
  }

  private refreshSW() {
    const g = this.game;
    const w = g.world;
    const list: { kind: string; charge: number; max: number; id: number }[] = [];
    for (const e of w.ents) {
      if (e.dead || e.owner !== g.me || !e.r.superweapon || e.built < 40) continue;
      const sw = SUPERWEAPONS[e.r.superweapon];
      list.push({ kind: sw.id, charge: e.swCharge, max: sw.charge, id: e.id });
    }
    const key = list.map((l) => l.id).join(",");
    if (key !== this.swKey) {
      this.swKey = key;
      this.swStrip.innerHTML = "";
      for (const l of list) {
        const b = document.createElement("button");
        b.className = "sw-btn";
        b.dataset.kind = l.kind;
        b.innerHTML = `<span class="sw-name">${SUPERWEAPONS[l.kind].name}</span><span class="sw-time"></span><div class="sw-bar"><div></div></div>`;
        b.onclick = () => g.armSuperweapon(l.kind);
        this.swStrip.appendChild(b);
      }
    }
    const btns = this.swStrip.querySelectorAll<HTMLButtonElement>(".sw-btn");
    btns.forEach((b, i) => {
      const l = list[i];
      if (!l) return;
      const ready = l.charge >= l.max;
      b.classList.toggle("ready", ready);
      b.querySelector<HTMLElement>(".sw-time")!.textContent = ready ? "READY" : fmtTime(((l.max - l.charge) / 20) | 0);
      (b.querySelector(".sw-bar div") as HTMLElement).style.width = `${(l.charge / l.max) * 100}%`;
    });
  }

  private showTip(r: Rule, el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    const secs = Math.round(buildTicks(r.cost) / 20);
    const pw = r.power ? `<span class="${r.power > 0 ? "pos" : "neg"}">⚡ ${r.power > 0 ? "+" : ""}${r.power}</span>` : "";
    this.tooltip.innerHTML = `<b>${r.name}</b><div class="tt-row"><span>$${r.cost}</span><span>⏱ ${secs}s</span>${pw}</div><div class="tt-desc">${r.desc}</div><div class="tt-hint">Left-click: build · Right-click: hold / cancel · Shift: ×5</div>`;
    this.tooltip.style.display = "block";
    const tw = this.tooltip.offsetWidth;
    this.tooltip.style.left = `${Math.max(8, rect.left - tw - 10)}px`;
    this.tooltip.style.top = `${Math.min(window.innerHeight - this.tooltip.offsetHeight - 8, rect.top)}px`;
  }

  /** production state including clicks the server hasn't echoed back yet */
  private prod(p: Player) {
    return this.game.opt.production(this.game.world, p);
  }

  private click(r: Rule, ev: MouseEvent) {
    ev.preventDefault();
    const g = this.game;
    const p = g.world.players[g.me];
    if (!p || p.defeated) return;
    g.audio.unlock();
    const q = r.queue!;
    const isBld = q === "bld" || q === "def";
    const { queues, ready } = this.prod(p);
    const head = queues[q][0];
    if (ev.button === 2) {
      // right: hold, then cancel
      if (isBld && ready[q] === r.id) {
        g.send({ c: "cancel", type: r.id });
        if (g.vs.mode.kind === "place") g.setMode({ kind: "none" });
        g.audio.play("click");
        return;
      }
      const has = queues[q].some((i) => i.type === r.id);
      if (!has) return;
      if (head && head.type === r.id && !head.hold) g.send({ c: "hold", type: r.id });
      else g.send({ c: "cancel", type: r.id, all: ev.shiftKey });
      g.audio.play("click");
      return;
    }
    if (ev.button !== 0) return;
    if (isBld && ready[q] === r.id) {
      g.setMode({ kind: "place", type: r.id });
      g.audio.play("click");
      return;
    }
    if (head && head.type === r.id && head.hold) {
      g.send({ c: "hold", type: r.id });
      g.audio.play("click");
      return;
    }
    if (isBld && (queues[q].length || ready[q])) {
      g.audio.play("error");
      g.audio.eva("Unable to comply, building in progress");
      return;
    }
    g.send({ c: "build", type: r.id, n: ev.shiftKey && !isBld ? 5 : 1 });
    g.audio.play("build");
  }

  /** per-frame light updates */
  update(dt: number) {
    const g = this.game;
    const p = g.world.players[g.me];
    if (!p) return;
    // credits ticker
    const target = p.credits;
    const diff = target - this.shownCredits;
    if (Math.abs(diff) < 1) this.shownCredits = target;
    else this.shownCredits += Math.sign(diff) * Math.max(1, Math.min(Math.abs(diff), Math.abs(diff) * dt * 8 + 20 * dt * 60));
    this.creditsEl.textContent = Math.round(this.shownCredits).toLocaleString();
    // power
    const max = Math.max(200, p.powerOut, p.powerIn) * 1.15;
    this.powerFill.style.height = `${(p.powerOut / max) * 100}%`;
    this.powerDrain.style.bottom = `${(p.powerIn / max) * 100}%`;
    this.powerFill.className = "sb-power-fill " + (p.lowPower ? "low" : p.powerOut - p.powerIn < 50 ? "warn" : "ok");
    this.powerText.textContent = `⚡ ${p.powerOut - p.powerIn >= 0 ? "+" : ""}${p.powerOut - p.powerIn}   (${p.powerOut}/${p.powerIn})`;
    this.btnRepair.classList.toggle("active", g.vs.mode.kind === "repair");
    this.btnSell.classList.toggle("active", g.vs.mode.kind === "sell");
    // cameo overlays
    const { queues, ready } = this.prod(p);
    for (const c of this.cameos) {
      const r = RULES[c.type];
      const q = r.queue!;
      const list = queues[q];
      const n = list.filter((i) => i.type === c.type).length;
      const head = list[0];
      let pct = 0,
        state = "";
      if ((q === "bld" || q === "def") && ready[q] === c.type) state = "READY";
      else if (head && head.type === c.type) {
        pct = Math.max(0.0001, head.progress / (buildTicks(r.cost) * 100));
        if (head.hold) state = "ON HOLD";
        else if (head.progress >= buildTicks(r.cost) * 100) state = "WAITING";
      } else if (n > 0) pct = 0.0001;
      c.wipe.style.background = pct > 0 && state !== "READY" ? `conic-gradient(rgba(0,0,0,0) ${pct * 360}deg, rgba(4,10,16,0.66) ${pct * 360}deg)` : "none";
      c.count.textContent = n > 1 ? String(n) : "";
      c.state.textContent = state;
      c.root.classList.toggle("is-ready", state === "READY");
      c.root.classList.toggle("is-hold", state === "ON HOLD");
      const busyOther = (q === "bld" || q === "def") && (ready[q] || (head && head.type !== c.type));
      c.root.classList.toggle("dim", !!busyOther && state === "");
    }
  }

  destroy() {
    this.root.remove();
    this.tooltip.remove();
  }
}

export function fmtTime(s: number) {
  const m = Math.floor(s / 60),
    ss = s % 60;
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

const wrench = `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M21 6.5a5 5 0 0 1-6.6 4.7L6 19.6a2 2 0 1 1-2.8-2.8l8.4-8.4A5 5 0 0 1 17.5 3l-3 3 .9 2.6 2.6.9z" fill="currentColor"/></svg>`;
