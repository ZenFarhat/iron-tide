// Optimistic feedback for the local player's commands. In lockstep a command only takes effect
// once the server turn carrying it comes back (a round trip plus the turn wait), so until then
// the client previews it: click markers, order lines, building ghosts and sidebar state. A
// preview is retired the moment the turn that carries its command has been simulated.
import type { Command } from "../sim/commands";
import type { Player, QueueItem } from "../sim/entity";
import { QUEUES, RULES, type Queue } from "../sim/rules";
import type { World } from "../sim/world";

export interface PendingCmd {
  seq: number;
  cmd: Command;
  t: number;
}

export type MarkKind = "move" | "amove" | "attack" | "enter" | "harvest" | "rally" | "sw";

/** a short-lived click marker on the ground (x, y in leptons) or on a target entity */
export interface Marker {
  kind: MarkKind;
  x: number;
  y: number;
  target: number;
  t: number;
}

export const MARK_LIFE = 0.65; // seconds
// the server drops commands past its per-turn cap; never preview one of those forever
const EXPIRE_MS = 4000;

export interface ProdView {
  queues: Record<Queue, QueueItem[]>;
  ready: Player["ready"];
}

export class Optimistic {
  pending: PendingCmd[] = [];
  marks: Marker[] = [];
  /** unit id → the newest unconfirmed order that includes it */
  unitOrders = new Map<number, PendingCmd>();
  private seq = 0;

  /** records a command about to be sent and returns its sequence number */
  issue(cmd: Command, w: World, now: number): number {
    const p: PendingCmd = { seq: ++this.seq, cmd, t: now };
    this.pending.push(p);
    if ("ids" in cmd) for (const id of cmd.ids) this.unitOrders.set(id, p);
    this.mark(cmd, w);
    return p.seq;
  }

  /** the turn carrying `seq` has run; earlier ones ran before it or were dropped by the server */
  confirm(seq: number) {
    if (!this.pending.length || this.pending[0].seq > seq) return;
    this.pending = this.pending.filter((p) => p.seq > seq);
    this.reindex();
  }

  update(dt: number, now: number) {
    if (this.marks.length) this.marks = this.marks.filter((m) => (m.t += dt) < MARK_LIFE);
    if (this.pending.length && now - this.pending[0].t > EXPIRE_MS) {
      this.pending = this.pending.filter((p) => now - p.t <= EXPIRE_MS);
      this.reindex();
    }
  }

  /** the newest unconfirmed command matching `c` that targets entity `t` */
  latestFor<C extends Command["c"]>(c: C, t: number): Extract<Command, { c: C }> | undefined {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const cmd = this.pending[i].cmd as any;
      if (cmd.c === c && cmd.t === t) return cmd;
    }
    return undefined;
  }

  /** does a footprint overlap a structure that has been placed but not started yet? */
  placingAt(bx: number, by: number, w: number, h: number): boolean {
    for (const { cmd } of this.pending) {
      if (cmd.c !== "place") continue;
      const r = RULES[cmd.type];
      if (r && bx < cmd.x + r.w && cmd.x < bx + w && by < cmd.y + r.h && cmd.y < by + h) return true;
    }
    return false;
  }

  private reindex() {
    this.unitOrders.clear();
    for (const p of this.pending) if ("ids" in p.cmd) for (const id of p.cmd.ids) this.unitOrders.set(id, p);
  }

  private mark(cmd: Command, w: World) {
    const at = (kind: MarkKind, cx: number, cy: number) => this.marks.push({ kind, x: cx * 256 + 128, y: cy * 256 + 128, target: 0, t: 0 });
    const on = (kind: MarkKind, id: number) => {
      const e = w.get(id);
      if (e) this.marks.push({ kind, x: e.x, y: e.y, target: id, t: 0 });
    };
    switch (cmd.c) {
      case "move":
      case "amove":
      case "harvest":
      case "rally":
        at(cmd.c, cmd.x, cmd.y);
        break;
      case "ffire":
        at("attack", cmd.x, cmd.y);
        break;
      case "attack":
      case "enter":
        on(cmd.c, cmd.t);
        break;
      case "sw":
        at("sw", cmd.x, cmd.y);
        if (cmd.x2 !== undefined && cmd.y2 !== undefined) at("sw", cmd.x2, cmd.y2);
        break;
    }
  }

  /** production queues and ready structures with unconfirmed build/hold/cancel/place applied,
   *  mirroring World.queueBuild / cancelBuild / placeStructure closely enough for display */
  production(w: World, p: Player): ProdView {
    if (!this.pending.some((x) => x.cmd.c === "build" || x.cmd.c === "hold" || x.cmd.c === "cancel" || x.cmd.c === "place")) return { queues: p.queues, ready: p.ready };
    const queues = {} as Record<Queue, QueueItem[]>;
    for (const q of QUEUES) queues[q] = p.queues[q].map((it) => ({ ...it }));
    const ready = { ...p.ready };
    for (const { cmd } of this.pending) {
      if (cmd.c !== "build" && cmd.c !== "hold" && cmd.c !== "cancel" && cmd.c !== "place") continue;
      const q = RULES[cmd.type]?.queue;
      if (!q) continue;
      const list = queues[q];
      const rq = q === "bld" || q === "def" ? q : null; // structure queues hold one finished building until placed
      switch (cmd.c) {
        case "build":
          if (!w.canBuild(p, cmd.type)) break;
          for (let k = 0; k < (cmd.n ?? 1); k++) {
            if (rq ? list.length > 0 || ready[rq] : list.length >= 15) break;
            list.push({ type: cmd.type, progress: 0, spent: 0, hold: false });
          }
          break;
        case "hold": {
          const it = list.find((i) => i.type === cmd.type);
          if (it) it.hold = !it.hold;
          break;
        }
        case "cancel":
          if (rq && ready[rq] === cmd.type) {
            ready[rq] = null;
            break;
          }
          for (let k = list.length - 1; k >= 0; k--) {
            if (list[k].type !== cmd.type) continue;
            list.splice(k, 1);
            if (!cmd.all) break;
          }
          break;
        case "place":
          if (rq && ready[rq] === cmd.type) ready[rq] = null;
          break;
      }
    }
    return { queues, ready };
  }
}
