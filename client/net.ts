// Sessions feed turns (batches of player commands) into the lockstep simulation.
import type { Command } from "../sim/commands";
import { PROTOCOL_VERSION, type ClientMsg, type ServerMsg, type Turn } from "../shared/protocol";

export interface Session {
  readonly me: number;
  readonly online: boolean;
  /** highest turn number available (inclusive), or Infinity for local sessions */
  available(): number;
  turn(n: number): Turn;
  send(cmd: Command): void;
  hash(tick: number, h: number): void;
  chat(text: string): void;
  close(): void;
}

/** Single-player: turns are produced on demand from locally queued commands. */
export class LocalSession implements Session {
  me = 0;
  online = false;
  private pending: Turn = [];
  available() {
    return Infinity;
  }
  turn(_n: number): Turn {
    const t = this.pending;
    this.pending = [];
    return t;
  }
  send(cmd: Command) {
    this.pending.push([this.me, cmd]);
  }
  hash() {}
  chat() {}
  close() {}
}

type Listener = (m: ServerMsg) => void;

/** WebSocket connection to the Bun server (lobby + lockstep). */
export class Net {
  ws: WebSocket | null = null;
  clientId = "";
  name = "";
  listeners = new Set<Listener>();
  ping = 0;
  private pingTimer: number | null = null;
  private openP: Promise<void> | null = null;

  connect(name: string): Promise<void> {
    if (this.openP) return this.openP;
    this.openP = new Promise((resolve, reject) => {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${proto}//${location.host}/ws`);
      this.ws = ws;
      ws.onopen = () => {
        this.sendRaw({ t: "hello", name, v: PROTOCOL_VERSION });
      };
      ws.onmessage = (ev) => {
        let m: ServerMsg;
        try {
          m = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (m.t === "welcome") {
          this.clientId = m.clientId;
          this.name = m.name;
          resolve();
        }
        if (m.t === "pong") this.ping = Math.round(performance.now() - m.ts);
        for (const l of this.listeners) l(m);
      };
      ws.onerror = () => reject(new Error("Could not connect to server"));
      ws.onclose = () => {
        this.openP = null;
        this.ws = null;
        if (this.pingTimer) clearInterval(this.pingTimer);
        for (const l of this.listeners) l({ t: "error", msg: "Disconnected from server." });
      };
      this.pingTimer = window.setInterval(() => this.sendRaw({ t: "ping", ts: performance.now() }), 2000);
    });
    return this.openP;
  }

  on(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  sendRaw(m: ClientMsg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }
}

/** Online lockstep session: commands go to the server, turns come back to everyone. */
export class NetSession implements Session {
  me: number;
  online = true;
  net: Net;
  turns: Turn[] = [];
  private off: () => void;
  onDesync: ((tick: number) => void) | null = null;
  onChat: ((from: string, color: number, text: string, system: boolean) => void) | null = null;

  constructor(net: Net, me: number, history: Turn[]) {
    this.net = net;
    this.me = me;
    this.turns = history.slice();
    this.off = net.on((m) => {
      if (m.t === "turn") this.turns[m.n] = m.cmds;
      else if (m.t === "desync") this.onDesync?.(m.tick);
      else if (m.t === "chat") this.onChat?.(m.from, m.color, m.text, !!m.system);
    });
  }
  available() {
    // highest contiguous turn
    let n = this.turns.length - 1;
    while (n >= 0 && this.turns[n] === undefined) n--;
    return n;
  }
  turn(n: number): Turn {
    return this.turns[n] ?? [];
  }
  send(cmd: Command) {
    if (this.me < 0) return;
    this.net.sendRaw({ t: "cmd", cmd });
  }
  hash(tick: number, h: number) {
    if (this.me >= 0) this.net.sendRaw({ t: "hash", tick, h });
  }
  chat(text: string) {
    this.net.sendRaw({ t: "chat", text });
  }
  close() {
    this.off();
  }
}
