// Menus: main menu, skirmish setup, multiplayer browser and room lobby.
import { DEFAULT_LOBBY, MAX_SLOTS, PLAYER_COLORS, type AIDifficulty, type LobbySettings, type RoomState, type RoomSummary, type ServerMsg, type SlotFaction, type StartPlayer, type Turn } from "../shared/protocol";
import { FACTIONS } from "../sim/rules";
import { Net } from "./net";

export interface SkirmishStart {
  settings: LobbySettings & { seed: number };
  players: StartPlayer[];
}

export interface OnlineStart {
  net: Net;
  seed: number;
  settings: LobbySettings;
  players: StartPlayer[];
  you: number;
  history: Turn[];
}

export interface MenuCallbacks {
  startSkirmish(s: SkirmishStart): void;
  startOnline(s: OnlineStart): void;
  unlockAudio(): void;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function getName() {
  try {
    return localStorage.getItem("it.name") || "Commander";
  } catch {
    return "Commander";
  }
}
function setName(n: string) {
  try {
    localStorage.setItem("it.name", n);
  } catch {}
}

const MAP_SIZES = [
  [56, "Small (56)"],
  [64, "Compact (64)"],
  [72, "Medium (72)"],
  [88, "Large (88)"],
  [104, "Huge (104)"],
] as const;
const CREDITS = [5000, 7500, 10000, 15000, 20000, 30000];

function factionOptions(sel: SlotFaction) {
  return [["R", "Random"], ...FACTIONS.map((f) => [f.id, f.name])].map(([v, n]) => `<option value="${v}" ${v === sel ? "selected" : ""}>${n}</option>`).join("");
}
function colorOptions(sel: number, taken: Set<number>) {
  return PLAYER_COLORS.map((c, i) => `<option value="${i}" ${i === sel ? "selected" : ""} ${taken.has(i) && i !== sel ? "disabled" : ""} style="color:${c.hex}">■ ${c.name}</option>`).join("");
}
function teamOptions(sel: number) {
  return [0, 1, 2, 3, 4].map((t) => `<option value="${t}" ${t === sel ? "selected" : ""}>${t === 0 ? "—" : "Team " + t}</option>`).join("");
}
function settingsHtml(s: LobbySettings, editable: boolean, seed?: number) {
  const dis = editable ? "" : "disabled";
  return `<div class="settings">
    <label>Map<select data-s="mapSize" ${dis}>${MAP_SIZES.map(([v, n]) => `<option value="${v}" ${v === s.mapSize ? "selected" : ""}>${n}</option>`).join("")}</select></label>
    <label>Credits<select data-s="credits" ${dis}>${CREDITS.map((v) => `<option value="${v}" ${v === s.credits ? "selected" : ""}>$${v.toLocaleString()}</option>`).join("")}</select></label>
    <label>Starting units<select data-s="startUnits" ${dis}>${[0, 1, 2, 3, 5, 10].map((v) => `<option value="${v}" ${v === s.startUnits ? "selected" : ""}>${v}</option>`).join("")}</select></label>
    <label class="chk"><input type="checkbox" data-s="superweapons" ${s.superweapons ? "checked" : ""} ${dis}/> Superweapons</label>
    <label class="chk"><input type="checkbox" data-s="shortGame" ${s.shortGame ? "checked" : ""} ${dis}/> Short game</label>
    ${seed !== undefined ? `<label>Map seed<input data-s="seed" type="number" value="${seed}" ${dis}/></label>` : ""}
  </div>`;
}
function readSettings(root: HTMLElement): Partial<LobbySettings> & { seed?: number } {
  const out: any = {};
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-s]").forEach((el) => {
    const k = el.dataset.s!;
    if (el instanceof HTMLInputElement && el.type === "checkbox") out[k] = el.checked;
    else out[k] = Number(el.value);
  });
  return out;
}

export class Menu {
  root: HTMLElement;
  cb: MenuCallbacks;
  net: Net | null = null;
  room: RoomState | null = null;
  rooms: RoomSummary[] = [];
  private off: (() => void) | null = null;
  private chatLog: string[] = [];

  constructor(root: HTMLElement, cb: MenuCallbacks) {
    this.root = root;
    this.cb = cb;
  }

  show(html: string) {
    this.root.innerHTML = `<div class="menu-bg"></div><div class="menu-wrap">${html}</div>`;
    this.root.style.display = "block";
  }
  hide() {
    this.root.style.display = "none";
    this.root.innerHTML = "";
  }

  main() {
    this.show(`
      <div class="title-block">
        <div class="title">IRON <span>TIDE</span></div>
        <div class="subtitle">A real-time strategy battle for the browser</div>
      </div>
      <div class="panel main-panel">
        <label class="name-row">Commander name <input id="mm-name" maxlength="20" value="${esc(getName())}"/></label>
        <button class="big primary" id="mm-skirmish">Skirmish vs AI</button>
        <button class="big" id="mm-online">Multiplayer</button>
        <button class="big ghost" id="mm-help">How to play</button>
        <div class="credits-line">Original game · all art, audio and names generated procedurally · Built with Bun</div>
      </div>`);
    const name = this.root.querySelector<HTMLInputElement>("#mm-name")!;
    name.onchange = () => setName(name.value.trim() || "Commander");
    this.root.querySelector<HTMLButtonElement>("#mm-skirmish")!.onclick = () => {
      this.cb.unlockAudio();
      setName(name.value.trim() || "Commander");
      this.skirmish();
    };
    this.root.querySelector<HTMLButtonElement>("#mm-online")!.onclick = () => {
      this.cb.unlockAudio();
      setName(name.value.trim() || "Commander");
      this.online();
    };
    this.root.querySelector<HTMLButtonElement>("#mm-help")!.onclick = () => this.help();
  }

  help() {
    this.show(`<div class="panel help-panel">
      <h2>Field manual</h2>
      <div class="help-cols">
      <div><h3>Getting started</h3><ol>
        <li><b>Double-click</b> your <b>Mobile Hub</b> (or select it and press <kbd>D</kbd>) to deploy your Command Hub.</li>
        <li>Build a <b>Power</b> plant, then an <b>Ore Refinery</b> — it comes with a free harvester.</li>
        <li>Add <b>Barracks</b> and a vehicle factory, then tech up via radar and the tech lab.</li>
        <li>Keep power positive: low power slows production and shuts down defenses and radar.</li>
        <li>Destroy every enemy structure to win.</li></ol>
      <h3>Economy</h3><p>Harvesters collect gold ore ($25) and blue gems ($50). Ore slowly regrows. Capture <b>Fuel Wells</b> with Engineers for steady income.</p>
      <h3>Factions</h3><p><b>Concord</b> fields fast tanks, light-beam weapons, Striker jets and a lightning-storm superweapon.<br/><b>Dominion</b> fields heavy armor, arc weapons, rocket artillery, airships and a city-killing missile.</p></div>
      <div><h3>Controls</h3><table class="keys">
        <tr><td>Left-drag</td><td>Box select</td></tr>
        <tr><td>Left-click</td><td>Select / order (classic)</td></tr>
        <tr><td>Right-click</td><td>Deselect, cancel (classic)</td></tr>
        <tr><td>Right-drag</td><td>Scroll map</td></tr>
        <tr><td>Ctrl+click</td><td>Force fire</td></tr>
        <tr><td>Alt+click</td><td>Force move (crush)</td></tr>
        <tr><td>A</td><td>Attack-move</td></tr>
        <tr><td>S / G / X</td><td>Stop / Guard / Scatter</td></tr>
        <tr><td>D</td><td>Deploy (hub, troopers, lancers)</td></tr>
        <tr><td>Ctrl+1..9, 1..9</td><td>Groups (tap twice to centre)</td></tr>
        <tr><td>T / P</td><td>Same type / all combat units</td></tr>
        <tr><td>H / Space</td><td>Home / last alert</td></tr>
        <tr><td>Q W E R</td><td>Sidebar tabs</td></tr>
        <tr><td>Enter</td><td>Chat</td></tr>
        <tr><td>Wheel</td><td>Zoom</td></tr>
      </table><p class="dim">Modern controls (right-click to order) can be enabled in the in-game menu (Esc).</p></div></div>
      <div class="btns"><button class="primary" id="h-back">Back</button></div></div>`);
    this.root.querySelector<HTMLButtonElement>("#h-back")!.onclick = () => this.main();
  }

  // ───────────────────────────── skirmish ─────────────────────────────

  skirmish() {
    type S = { kind: "human" | "ai"; name: string; faction: SlotFaction; color: number; team: number; ai: AIDifficulty };
    const slots: S[] = [
      { kind: "human", name: getName(), faction: "R", color: 0, team: 0, ai: "normal" },
      { kind: "ai", name: "AI", faction: "R", color: 1, team: 0, ai: "normal" },
    ];
    const settings = { ...DEFAULT_LOBBY, seed: Math.floor(Math.random() * 99999) };
    const render = () => {
      const taken = new Set(slots.map((s) => s.color));
      this.show(`<div class="panel lobby-panel">
        <h2>Skirmish</h2>
        <table class="slots"><tr><th>Player</th><th>Faction</th><th>Color</th><th>Team</th><th></th></tr>
        ${slots
          .map(
            (s, i) => `<tr>
          <td>${s.kind === "human" ? `<b>${esc(s.name)}</b>` : `<select data-i="${i}" data-f="ai">${(["easy", "normal", "hard"] as const).map((d) => `<option value="${d}" ${d === s.ai ? "selected" : ""}>AI · ${d}</option>`).join("")}</select>`}</td>
          <td><select data-i="${i}" data-f="faction">${factionOptions(s.faction)}</select></td>
          <td><select data-i="${i}" data-f="color" style="color:${PLAYER_COLORS[s.color].hex}">${colorOptions(s.color, taken)}</select></td>
          <td><select data-i="${i}" data-f="team">${teamOptions(s.team)}</select></td>
          <td>${s.kind === "ai" ? `<button class="small danger" data-rm="${i}">✕</button>` : ""}</td></tr>`,
          )
          .join("")}
        </table>
        ${slots.length < MAX_SLOTS ? `<button class="small" id="sk-add">+ Add AI opponent</button>` : ""}
        ${settingsHtml(settings, true, settings.seed)}
        <div class="btns"><button id="sk-back">Back</button><button class="primary" id="sk-start">Start battle</button></div>
      </div>`);
      this.root.querySelectorAll<HTMLSelectElement>("select[data-i]").forEach((el) => {
        el.onchange = () => {
          const s = slots[+el.dataset.i!];
          const f = el.dataset.f!;
          if (f === "faction") s.faction = el.value as SlotFaction;
          if (f === "color") s.color = +el.value;
          if (f === "team") s.team = +el.value;
          if (f === "ai") s.ai = el.value as AIDifficulty;
          render();
        };
      });
      this.root.querySelectorAll<HTMLButtonElement>("[data-rm]").forEach((b) => (b.onclick = () => (slots.splice(+b.dataset.rm!, 1), render())));
      const add = this.root.querySelector<HTMLButtonElement>("#sk-add");
      if (add)
        add.onclick = () => {
          const used = new Set(slots.map((s) => s.color));
          slots.push({ kind: "ai", name: "AI", faction: "R", color: PLAYER_COLORS.findIndex((_, i) => !used.has(i)), team: 0, ai: "normal" });
          render();
        };
      this.root.querySelectorAll<HTMLElement>("[data-s]").forEach((el) => (el.onchange = () => Object.assign(settings, readSettings(this.root))));
      this.root.querySelector<HTMLButtonElement>("#sk-back")!.onclick = () => this.main();
      this.root.querySelector<HTMLButtonElement>("#sk-start")!.onclick = () => {
        Object.assign(settings, readSettings(this.root));
        const teams = new Set(slots.map((s) => s.team || 100 + slots.indexOf(s)));
        if (teams.size < 2) {
          alert("Everyone is on the same team — set at least one opponent on a different team.");
          return;
        }
        const players: StartPlayer[] = slots.map((s) => ({
          name: s.kind === "human" ? s.name : `AI ${s.ai}`,
          faction: s.faction === "R" ? (Math.random() < 0.5 ? "C" : "D") : s.faction,
          color: s.color,
          team: s.team,
          ai: s.kind === "ai" ? s.ai : null,
        }));
        this.cb.startSkirmish({ settings: { ...settings }, players });
      };
    };
    render();
  }

  // ───────────────────────────── online ─────────────────────────────

  async online() {
    this.show(`<div class="panel"><h2>Connecting…</h2></div>`);
    if (!this.net) this.net = new Net();
    try {
      await this.net.connect(getName());
    } catch (e) {
      this.show(`<div class="panel"><h2>Could not connect</h2><p>Make sure the Iron Tide server is running (<code>bun run dev</code>).</p><div class="btns"><button id="b">Back</button></div></div>`);
      this.root.querySelector<HTMLButtonElement>("#b")!.onclick = () => this.main();
      return;
    }
    this.off?.();
    this.off = this.net.on((m) => this.onMsg(m));
    this.net.sendRaw({ t: "list" });
    this.browser();
  }

  private onMsg(m: ServerMsg) {
    switch (m.t) {
      case "rooms":
        this.rooms = m.rooms;
        if (!this.room) this.browser();
        break;
      case "room":
        this.room = m.room;
        if (m.room && m.room.state === "lobby") this.roomView();
        else if (!m.room) this.browser();
        break;
      case "chat":
        this.chatLog.push(m.system ? `<i>${esc(m.text)}</i>` : `<b style="color:${m.color >= 0 ? PLAYER_COLORS[m.color].hex : "#ddd"}">${esc(m.from)}:</b> ${esc(m.text)}`);
        if (this.chatLog.length > 60) this.chatLog.shift();
        const log = this.root.querySelector(".chat-log");
        if (log) {
          log.innerHTML = this.chatLog.join("<br/>");
          log.scrollTop = 1e9;
        }
        break;
      case "start":
        this.off?.();
        this.off = null;
        this.room = null;
        this.cb.startOnline({ net: this.net!, seed: m.seed, settings: m.settings, players: m.players, you: m.you, history: m.history });
        break;
      case "error": {
        const box = this.root.querySelector(".err");
        if (box) box.textContent = m.msg;
        else if (this.root.style.display !== "none") alert(m.msg);
        break;
      }
    }
  }

  private browser() {
    if (this.root.style.display === "none") return;
    const rows = this.rooms.length
      ? this.rooms.map((r) => `<tr><td><b>${esc(r.name)}</b> <span class="dim">#${r.id}</span></td><td>${r.players}/${r.max}</td><td>${r.state}</td><td><button class="small primary" data-join="${r.id}">${r.state === "lobby" ? "Join" : "Spectate"}</button></td></tr>`).join("")
      : `<tr><td colspan="4" class="dim">No battles yet — create one!</td></tr>`;
    this.show(`<div class="panel lobby-panel">
      <h2>Multiplayer</h2>
      <p class="dim">Playing as <b>${esc(this.net?.name ?? "")}</b>. Share the room code with a friend, or open a second browser tab to test locally.</p>
      <table class="rooms"><tr><th>Battle</th><th>Players</th><th>Status</th><th></th></tr>${rows}</table>
      <div class="row-inline"><input id="mp-rname" placeholder="Battle name" maxlength="32"/><button class="primary" id="mp-create">Create battle</button></div>
      <div class="row-inline"><input id="mp-code" placeholder="Room code" maxlength="5" style="text-transform:uppercase"/><button id="mp-join">Join by code</button></div>
      <div class="err"></div>
      <div class="btns"><button id="mp-back">Back</button><button id="mp-refresh">Refresh</button></div></div>`);
    this.root.querySelectorAll<HTMLButtonElement>("[data-join]").forEach((b) => (b.onclick = () => this.net!.sendRaw({ t: "join", id: b.dataset.join! })));
    this.root.querySelector<HTMLButtonElement>("#mp-create")!.onclick = () => {
      const n = this.root.querySelector<HTMLInputElement>("#mp-rname")!.value.trim();
      this.net!.sendRaw({ t: "create", name: n || `${this.net!.name}'s battle` });
    };
    this.root.querySelector<HTMLButtonElement>("#mp-join")!.onclick = () => {
      const c = this.root.querySelector<HTMLInputElement>("#mp-code")!.value.trim().toUpperCase();
      if (c) this.net!.sendRaw({ t: "join", id: c });
    };
    this.root.querySelector<HTMLButtonElement>("#mp-refresh")!.onclick = () => this.net!.sendRaw({ t: "list" });
    this.root.querySelector<HTMLButtonElement>("#mp-back")!.onclick = () => {
      this.off?.();
      this.off = null;
      this.main();
    };
  }

  private roomView() {
    const r = this.room!;
    const net = this.net!;
    const host = r.hostId === net.clientId;
    const taken = new Set(r.slots.filter((s) => s.kind === "human" || s.kind === "ai").map((s) => s.color));
    const mine = r.slots.findIndex((s) => s.kind === "human" && s.clientId === net.clientId);
    const slotRow = (s: (typeof r.slots)[number], i: number) => {
      const me = i === mine;
      const editAi = host && s.kind === "ai";
      const canEdit = me || editAi;
      let who: string;
      if (s.kind === "human") who = `<b>${esc(s.name)}</b>${s.clientId === r.hostId ? ' <span class="tag">HOST</span>' : ""}`;
      else if (host) who = `<select data-slotkind="${i}"><option value="open" ${s.kind === "open" ? "selected" : ""}>Open</option><option value="closed" ${s.kind === "closed" ? "selected" : ""}>Closed</option>${(["easy", "normal", "hard"] as const).map((d) => `<option value="ai:${d}" ${s.kind === "ai" && s.ai === d ? "selected" : ""}>AI · ${d}</option>`).join("")}</select>`;
      else who = s.kind === "ai" ? `AI · ${s.ai}` : s.kind === "open" ? `<span class="dim">Open</span> ${mine >= 0 ? `<button class="small" data-moveto="${i}">Sit here</button>` : ""}` : `<span class="dim">Closed</span>`;
      const active = s.kind === "human" || s.kind === "ai";
      return `<tr class="${me ? "me" : ""}"><td>${who}</td>
        <td>${active ? `<select data-slot="${i}" data-f="faction" ${canEdit ? "" : "disabled"}>${factionOptions(s.faction)}</select>` : ""}</td>
        <td>${active ? `<select data-slot="${i}" data-f="color" ${canEdit ? "" : "disabled"} style="color:${PLAYER_COLORS[s.color].hex}">${colorOptions(s.color, taken)}</select>` : ""}</td>
        <td>${active ? `<select data-slot="${i}" data-f="team" ${canEdit ? "" : "disabled"}>${teamOptions(s.team)}</select>` : ""}</td>
        <td>${s.kind === "human" ? (s.clientId === r.hostId ? "" : s.ready ? '<span class="ready">READY</span>' : '<span class="dim">not ready</span>') : ""}</td></tr>`;
    };
    this.show(`<div class="panel lobby-panel room-panel">
      <h2>${esc(r.name)} <span class="code">#${r.id}</span></h2>
      <table class="slots"><tr><th>Player</th><th>Faction</th><th>Color</th><th>Team</th><th></th></tr>${r.slots.map(slotRow).join("")}</table>
      ${r.spectators.length ? `<p class="dim">Spectators: ${r.spectators.map(esc).join(", ")}</p>` : ""}
      ${settingsHtml(r.settings, host)}
      <div class="chat"><div class="chat-log">${this.chatLog.join("<br/>")}</div><input class="chat-in" placeholder="Chat…" maxlength="200"/></div>
      <div class="err"></div>
      <div class="btns"><button id="rm-leave">Leave</button>${host ? `<button class="primary" id="rm-start">Start battle</button>` : mine >= 0 ? `<button class="primary" id="rm-ready">${r.slots[mine].ready ? "Not ready" : "Ready"}</button>` : ""}</div></div>`);
    const log = this.root.querySelector(".chat-log");
    if (log) log.scrollTop = 1e9;
    this.root.querySelectorAll<HTMLSelectElement>("select[data-slot]").forEach((el) => {
      el.onchange = () => {
        const i = +el.dataset.slot!;
        const f = el.dataset.f!;
        const v = f === "faction" ? el.value : +el.value;
        net.sendRaw({ t: "slot", slot: i, [f]: v } as any);
      };
    });
    this.root.querySelectorAll<HTMLSelectElement>("select[data-slotkind]").forEach((el) => {
      el.onchange = () => {
        const i = +el.dataset.slotkind!;
        const v = el.value;
        if (v.startsWith("ai:")) net.sendRaw({ t: "setslot", slot: i, kind: "ai", ai: v.slice(3) as AIDifficulty });
        else net.sendRaw({ t: "setslot", slot: i, kind: v as "open" | "closed" });
      };
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-moveto]").forEach((b) => (b.onclick = () => net.sendRaw({ t: "move", slot: +b.dataset.moveto! })));
    this.root.querySelectorAll<HTMLElement>("[data-s]").forEach((el) => (el.onchange = () => net.sendRaw({ t: "settings", settings: readSettings(this.root) })));
    const chat = this.root.querySelector<HTMLInputElement>(".chat-in")!;
    chat.onkeydown = (e) => {
      if (e.key === "Enter" && chat.value.trim()) {
        net.sendRaw({ t: "chat", text: chat.value.trim() });
        chat.value = "";
      }
    };
    this.root.querySelector<HTMLButtonElement>("#rm-leave")!.onclick = () => {
      net.sendRaw({ t: "leave" });
      this.room = null;
      this.chatLog = [];
    };
    const st = this.root.querySelector<HTMLButtonElement>("#rm-start");
    if (st) st.onclick = () => net.sendRaw({ t: "start" });
    const rd = this.root.querySelector<HTMLButtonElement>("#rm-ready");
    if (rd) rd.onclick = () => net.sendRaw({ t: "slot", slot: mine, ready: !r.slots[mine].ready });
  }
}
