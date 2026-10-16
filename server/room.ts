// A game room: lobby management plus the server-clocked lockstep turn relay.
import type { ServerWebSocket } from "bun";
import { sanitizeCommand } from "../sim/commands";
import {
  DEFAULT_LOBBY,
  GAME_SPEEDS,
  MAX_SLOTS,
  PLAYER_COLORS,
  TURN_MS,
  type ClientMsg,
  type LobbySettings,
  type RoomState,
  type ServerMsg,
  type Slot,
  type StartPlayer,
  type Turn,
} from "../shared/protocol";

export interface ClientData {
  id: string;
  name: string;
  room: Room | null;
}
export type WS = ServerWebSocket<ClientData>;

const MAX_CMDS_PER_TURN = 24;
const LOAD_TIMEOUT_MS = 30000;

export function send(ws: WS, msg: ServerMsg) {
  ws.send(JSON.stringify(msg));
}

export class Room {
  id: string;
  name: string;
  hostId: string;
  slots: Slot[];
  settings: LobbySettings = { ...DEFAULT_LOBBY };
  state: RoomState["state"] = "lobby";
  members = new Map<string, WS>();
  spectators = new Set<string>();
  // game
  seed = 0;
  players: StartPlayer[] = [];
  clientToPlayer = new Map<string, number>();
  history: Turn[] = [];
  pending: Turn = [];
  cmdCount = new Map<number, number>();
  turnTimer: ReturnType<typeof setInterval> | null = null;
  startedAt = 0;
  loaded = new Set<string>();
  loadTimer: ReturnType<typeof setTimeout> | null = null;
  hashes = new Map<number, Map<number, number>>();
  desynced = false;
  onEmpty: () => void;

  constructor(id: string, name: string, host: WS, onEmpty: () => void) {
    this.id = id;
    this.name = name.slice(0, 32) || "Battle";
    this.hostId = host.data.id;
    this.onEmpty = onEmpty;
    this.slots = Array.from({ length: MAX_SLOTS }, (_, i) => ({
      kind: i < 2 ? "open" : "open",
      name: "Open",
      faction: "R",
      color: i,
      team: 0,
      ready: false,
    }));
    this.join(host);
  }

  summary() {
    return {
      id: this.id,
      name: this.name,
      players: this.slots.filter((s) => s.kind === "human" || s.kind === "ai").length,
      max: this.slots.filter((s) => s.kind !== "closed").length,
      state: this.state,
    };
  }

  snapshot(): RoomState {
    return {
      id: this.id,
      name: this.name,
      hostId: this.hostId,
      slots: this.slots,
      settings: this.settings,
      state: this.state,
      spectators: [...this.spectators].map((id) => this.members.get(id)?.data.name ?? "?"),
    };
  }

  broadcast(msg: ServerMsg) {
    const s = JSON.stringify(msg);
    for (const ws of this.members.values()) ws.send(s);
  }

  pushState() {
    this.broadcast({ t: "room", room: this.snapshot() });
  }

  system(text: string) {
    this.broadcast({ t: "chat", from: "", color: -1, text, system: true });
  }

  join(ws: WS) {
    this.members.set(ws.data.id, ws);
    ws.data.room = this;
    if (this.state === "lobby") {
      const free = this.slots.findIndex((s) => s.kind === "open");
      if (free >= 0) {
        const used = new Set(this.slots.filter((s) => s.kind !== "open" && s.kind !== "closed").map((s) => s.color));
        let color = this.slots[free].color;
        if (used.has(color)) color = PLAYER_COLORS.findIndex((_, i) => !used.has(i));
        this.slots[free] = { kind: "human", clientId: ws.data.id, name: ws.data.name, faction: "R", color, team: 0, ready: false };
      } else this.spectators.add(ws.data.id);
      this.system(`${ws.data.name} joined`);
      this.pushState();
    } else {
      // join an in-progress game as spectator: send full turn history so they can fast-forward
      this.spectators.add(ws.data.id);
      send(ws, { t: "room", room: this.snapshot() });
      send(ws, { t: "start", seed: this.seed, settings: this.settings, players: this.players, you: -1, history: this.history });
      if (this.state === "playing") send(ws, { t: "go" });
      this.system(`${ws.data.name} is spectating`);
    }
  }

  leave(ws: WS) {
    const id = ws.data.id;
    this.members.delete(id);
    this.spectators.delete(id);
    ws.data.room = null;
    if (this.state === "lobby") {
      const i = this.slots.findIndex((s) => s.kind === "human" && s.clientId === id);
      if (i >= 0) this.slots[i] = { kind: "open", name: "Open", faction: "R", color: this.slots[i].color, team: 0, ready: false };
    } else {
      const pi = this.clientToPlayer.get(id);
      if (pi !== undefined && this.state === "playing") this.pending.push([pi, { c: "leave" }]);
      if (pi !== undefined && this.state === "loading") this.loaded.add(id), this.checkLoaded();
    }
    if (this.hostId === id) {
      const next = this.members.keys().next();
      if (!next.done) this.hostId = next.value;
    }
    this.system(`${ws.data.name} left`);
    if (this.members.size === 0) {
      this.stop();
      this.onEmpty();
      return;
    }
    this.pushState();
  }

  isHost(ws: WS) {
    return ws.data.id === this.hostId;
  }

  handle(ws: WS, msg: ClientMsg) {
    switch (msg.t) {
      case "slot": {
        const s = this.slots[msg.slot];
        if (!s || this.state !== "lobby") return;
        const mine = s.kind === "human" && s.clientId === ws.data.id;
        const hostAi = s.kind === "ai" && this.isHost(ws);
        if (!mine && !hostAi) return;
        if (msg.faction === "C" || msg.faction === "D" || msg.faction === "R") s.faction = msg.faction;
        if (typeof msg.color === "number" && msg.color >= 0 && msg.color < PLAYER_COLORS.length) {
          if (!this.slots.some((o) => o !== s && (o.kind === "human" || o.kind === "ai") && o.color === msg.color)) s.color = msg.color;
        }
        if (typeof msg.team === "number" && msg.team >= 0 && msg.team <= 4) s.team = msg.team;
        if (typeof msg.ready === "boolean" && mine) s.ready = msg.ready;
        this.pushState();
        break;
      }
      case "setslot": {
        if (!this.isHost(ws) || this.state !== "lobby") return;
        const s = this.slots[msg.slot];
        if (!s || s.kind === "human") return;
        if (msg.kind === "ai") {
          const used = new Set(this.slots.filter((o) => o.kind === "human" || o.kind === "ai").map((o) => o.color));
          const color = used.has(s.color) ? PLAYER_COLORS.findIndex((_, i) => !used.has(i)) : s.color;
          const ai = msg.ai === "easy" || msg.ai === "hard" ? msg.ai : "normal";
          this.slots[msg.slot] = { kind: "ai", name: `AI (${ai})`, faction: "R", color, team: s.team, ready: true, ai };
        } else this.slots[msg.slot] = { kind: msg.kind === "closed" ? "closed" : "open", name: msg.kind === "closed" ? "Closed" : "Open", faction: "R", color: s.color, team: 0, ready: false };
        this.pushState();
        break;
      }
      case "move": {
        if (this.state !== "lobby") return;
        const to = this.slots[msg.slot];
        const from = this.slots.findIndex((s) => s.kind === "human" && s.clientId === ws.data.id);
        if (!to || to.kind !== "open" || from < 0) return;
        this.slots[msg.slot] = { ...this.slots[from] };
        this.slots[from] = { kind: "open", name: "Open", faction: "R", color: this.slots[from].color, team: 0, ready: false };
        this.pushState();
        break;
      }
      case "settings": {
        if (!this.isHost(ws) || this.state !== "lobby") return;
        const st = msg.settings;
        if (typeof st.mapSize === "number" && [56, 64, 72, 88, 104].includes(st.mapSize)) this.settings.mapSize = st.mapSize;
        if (typeof st.credits === "number" && st.credits >= 1000 && st.credits <= 50000) this.settings.credits = Math.round(st.credits);
        if (typeof st.startUnits === "number" && st.startUnits >= 0 && st.startUnits <= 10) this.settings.startUnits = Math.round(st.startUnits);
        if (typeof st.superweapons === "boolean") this.settings.superweapons = st.superweapons;
        if (typeof st.shortGame === "boolean") this.settings.shortGame = st.shortGame;
        if (typeof st.speed === "number" && GAME_SPEEDS.includes(st.speed)) this.settings.speed = st.speed;
        for (const s of this.slots) if (s.kind === "human" && s.clientId !== this.hostId) s.ready = false;
        this.pushState();
        break;
      }
      case "start":
        this.tryStart(ws);
        break;
      case "loaded":
        this.loaded.add(ws.data.id);
        this.checkLoaded();
        break;
      case "cmd": {
        if (this.state !== "playing") return;
        const pi = this.clientToPlayer.get(ws.data.id);
        if (pi === undefined) return;
        const n = this.cmdCount.get(pi) ?? 0;
        if (n >= MAX_CMDS_PER_TURN) return;
        const cmd = sanitizeCommand(msg.cmd);
        if (!cmd) return;
        this.cmdCount.set(pi, n + 1);
        const seq = msg.seq;
        this.pending.push(typeof seq === "number" && Number.isSafeInteger(seq) ? [pi, cmd, seq] : [pi, cmd]);
        break;
      }
      case "hash":
        this.recordHash(ws, msg.tick, msg.h);
        break;
      case "chat": {
        const text = String(msg.text ?? "").slice(0, 200).trim();
        if (!text) return;
        const pi = this.clientToPlayer.get(ws.data.id);
        const slot = this.slots.find((s) => s.clientId === ws.data.id);
        const color = pi !== undefined ? this.players[pi]?.color : slot?.color ?? -1;
        this.broadcast({ t: "chat", from: ws.data.name, color: color ?? -1, text });
        break;
      }
    }
  }

  private tryStart(ws: WS) {
    if (!this.isHost(ws) || this.state !== "lobby") return;
    const filled = this.slots.filter((s) => s.kind === "human" || s.kind === "ai");
    if (filled.length < 2) return send(ws, { t: "error", msg: "Need at least two players (add an AI or wait for someone to join)." });
    const notReady = filled.filter((s) => s.kind === "human" && s.clientId !== this.hostId && !s.ready);
    if (notReady.length) return send(ws, { t: "error", msg: `Waiting for ${notReady.map((s) => s.name).join(", ")} to be ready.` });
    this.seed = (Math.random() * 0x7fffffff) | 0;
    this.players = [];
    this.clientToPlayer.clear();
    for (const s of filled) {
      const faction = s.faction === "R" ? (Math.random() < 0.5 ? "C" : "D") : s.faction;
      const idx = this.players.length;
      this.players.push({ name: s.name, faction, color: s.color, team: s.team, ai: s.kind === "ai" ? s.ai ?? "normal" : null, clientId: s.clientId });
      if (s.kind === "human" && s.clientId) this.clientToPlayer.set(s.clientId, idx);
    }
    this.state = "loading";
    this.history = [];
    this.pending = [];
    this.loaded.clear();
    this.hashes.clear();
    this.desynced = false;
    for (const [id, m] of this.members) {
      const you = this.clientToPlayer.get(id) ?? -1;
      send(m, { t: "start", seed: this.seed, settings: this.settings, players: this.players, you, history: [] });
    }
    this.pushState();
    this.loadTimer = setTimeout(() => this.go(), LOAD_TIMEOUT_MS);
  }

  private checkLoaded() {
    if (this.state !== "loading") return;
    for (const id of this.clientToPlayer.keys()) if (this.members.has(id) && !this.loaded.has(id)) return;
    this.go();
  }

  private go() {
    if (this.state !== "loading") return;
    if (this.loadTimer) clearTimeout(this.loadTimer);
    this.state = "playing";
    this.broadcast({ t: "go" });
    this.pushState();
    this.startedAt = performance.now();
    // players who disconnected during loading leave at turn 0
    for (const [cid, pi] of this.clientToPlayer) if (!this.members.has(cid)) this.pending.push([pi, { c: "leave" }]);
    // server-clocked lockstep: emit one turn every TURN_MS, catching up if the timer drifts
    this.turnTimer = setInterval(() => {
      const due = Math.floor((performance.now() - this.startedAt) / TURN_MS);
      let guard = 0;
      while (this.history.length <= due && guard++ < 10) this.emitTurn();
    }, TURN_MS / 2);
  }

  private emitTurn() {
    const n = this.history.length;
    const cmds = this.pending;
    this.pending = [];
    this.cmdCount.clear();
    this.history.push(cmds);
    this.broadcast({ t: "turn", n, cmds });
    // stop when no humans remain
    if (n % 50 === 0) {
      const humans = [...this.clientToPlayer.keys()].filter((id) => this.members.has(id));
      if (humans.length === 0 && this.spectators.size === 0) this.stop();
    }
  }

  private recordHash(ws: WS, tick: number, h: number) {
    if (this.desynced || typeof tick !== "number" || typeof h !== "number") return;
    const pi = this.clientToPlayer.get(ws.data.id);
    if (pi === undefined) return;
    let m = this.hashes.get(tick);
    if (!m) this.hashes.set(tick, (m = new Map()));
    m.set(pi, h >>> 0);
    const vals = new Set(m.values());
    if (vals.size > 1) {
      this.desynced = true;
      this.broadcast({ t: "desync", tick });
      this.system(`Desync detected at tick ${tick}`);
    }
    // keep memory bounded
    if (this.hashes.size > 64) {
      const oldest = Math.min(...this.hashes.keys());
      this.hashes.delete(oldest);
    }
  }

  stop() {
    if (this.turnTimer) clearInterval(this.turnTimer);
    if (this.loadTimer) clearTimeout(this.loadTimer);
    this.turnTimer = null;
    if (this.state === "playing" || this.state === "loading") this.state = "ended";
  }
}
