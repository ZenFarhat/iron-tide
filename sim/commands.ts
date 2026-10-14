// Player commands. These are the only inputs to the deterministic simulation and the
// only thing sent over the network during a match.

export type Command =
  | { c: "move"; ids: number[]; x: number; y: number }
  | { c: "amove"; ids: number[]; x: number; y: number }
  | { c: "attack"; ids: number[]; t: number }
  | { c: "ffire"; ids: number[]; x: number; y: number }
  | { c: "stop"; ids: number[] }
  | { c: "guard"; ids: number[] }
  | { c: "deploy"; ids: number[] }
  | { c: "scatter"; ids: number[] }
  | { c: "enter"; ids: number[]; t: number }
  | { c: "harvest"; ids: number[]; x: number; y: number }
  | { c: "build"; type: string; n?: number }
  | { c: "hold"; type: string }
  | { c: "cancel"; type: string; all?: boolean }
  | { c: "place"; type: string; x: number; y: number }
  | { c: "sell"; t: number }
  | { c: "repair"; t: number }
  | { c: "primary"; t: number }
  | { c: "rally"; t: number; x: number; y: number }
  | { c: "sw"; kind: string; x: number; y: number; x2?: number; y2?: number }
  | { c: "leave" };

const UNIT_CMDS = new Set(["move", "amove", "attack", "ffire", "stop", "guard", "deploy", "scatter", "enter", "harvest"]);

/** Defensive validation of untrusted command payloads (server + sim both call this). */
export function sanitizeCommand(raw: any): Command | null {
  if (!raw || typeof raw !== "object" || typeof raw.c !== "string") return null;
  const int = (v: any) => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null);
  const str = (v: any) => (typeof v === "string" && v.length < 40 ? v : null);
  if (UNIT_CMDS.has(raw.c)) {
    if (!Array.isArray(raw.ids) || raw.ids.length > 200) return null;
    const ids: number[] = [];
    for (const v of raw.ids) {
      const n = int(v);
      if (n !== null) ids.push(n);
    }
    const out: any = { c: raw.c, ids };
    if (raw.c === "move" || raw.c === "amove" || raw.c === "ffire" || raw.c === "harvest") {
      const x = int(raw.x),
        y = int(raw.y);
      if (x === null || y === null) return null;
      out.x = x;
      out.y = y;
    }
    if (raw.c === "attack" || raw.c === "enter") {
      const t = int(raw.t);
      if (t === null) return null;
      out.t = t;
    }
    return out;
  }
  switch (raw.c) {
    case "build": {
      const type = str(raw.type);
      if (!type) return null;
      const n = int(raw.n);
      return { c: "build", type, n: n === null ? 1 : Math.max(1, Math.min(5, n)) };
    }
    case "hold":
    case "cancel": {
      const type = str(raw.type);
      if (!type) return null;
      return raw.c === "hold" ? { c: "hold", type } : { c: "cancel", type, all: !!raw.all };
    }
    case "place": {
      const type = str(raw.type),
        x = int(raw.x),
        y = int(raw.y);
      if (!type || x === null || y === null) return null;
      return { c: "place", type, x, y };
    }
    case "sell":
    case "repair":
    case "primary": {
      const t = int(raw.t);
      if (t === null) return null;
      return { c: raw.c, t } as Command;
    }
    case "rally": {
      const t = int(raw.t),
        x = int(raw.x),
        y = int(raw.y);
      if (t === null || x === null || y === null) return null;
      return { c: "rally", t, x, y };
    }
    case "sw": {
      const kind = str(raw.kind),
        x = int(raw.x),
        y = int(raw.y);
      if (!kind || x === null || y === null) return null;
      const out: Command = { c: "sw", kind, x, y };
      const x2 = int(raw.x2),
        y2 = int(raw.y2);
      if (x2 !== null && y2 !== null) {
        out.x2 = x2;
        out.y2 = y2;
      }
      return out;
    }
    case "leave":
      return { c: "leave" };
  }
  return null;
}
