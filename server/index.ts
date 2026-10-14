// Iron Tide server: serves the bundled browser client (Bun HTML imports) and runs the
// WebSocket lobby + lockstep relay. Usage: bun server/index.ts  (PORT env, default 3000)
import index from "../client/index.html";
import gallery from "../client/gallery.html";
import { Room, send, type ClientData, type WS } from "./room";
import { PROTOCOL_VERSION, type ClientMsg } from "../shared/protocol";

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#0b1116"/><path d="M6 22 16 6l10 16z" fill="#f2b33d"/><path d="M11 22h10l-5-8z" fill="#0b1116"/></svg>`;
const rooms = new Map<string, Room>();
let nextClient = 1;

function roomList() {
  return [...rooms.values()].map((r) => r.summary());
}

function broadcastRooms() {
  const msg = JSON.stringify({ t: "rooms", rooms: roomList() });
  for (const ws of lobbyClients) ws.send(msg);
}

const lobbyClients = new Set<WS>();

function newRoomId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (;;) {
    let id = "";
    for (let i = 0; i < 5; i++) id += chars[Math.floor(Math.random() * chars.length)];
    if (!rooms.has(id)) return id;
  }
}

function cleanName(n: unknown) {
  const s = String(n ?? "")
    .replace(/[^\p{L}\p{N} _\-\.]/gu, "")
    .trim()
    .slice(0, 20);
  return s || "Commander";
}

const port = Number(process.env.PORT ?? 3000);
const dev = process.env.NODE_ENV !== "production";

const server = Bun.serve<ClientData, string>({
  port,
  hostname: process.env.HOST ?? "0.0.0.0",
  development: dev ? { hmr: false, console: true } : false,
  routes: {
    "/": index,
    ...(process.env.NODE_ENV !== "production" ? { "/gallery": gallery } : {}),
    "/health": new Response("ok"),
    "/favicon.ico": new Response(FAVICON, { headers: { "content-type": "image/svg+xml", "cache-control": "max-age=86400" } }),
    "/api/rooms": () => Response.json(roomList()),
  },
  fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const ok = srv.upgrade(req, { data: { id: `c${nextClient++}`, name: "Commander", room: null } });
      return ok ? undefined : new Response("upgrade failed", { status: 400 });
    }
    return new Response("Not found", { status: 404 });
  },
  websocket: {
    maxPayloadLength: 64 * 1024,
    idleTimeout: 120,
    open(ws) {
      lobbyClients.add(ws);
    },
    message(ws, raw) {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object" || typeof (msg as any).t !== "string") return;
      switch (msg.t) {
        case "hello":
          if (msg.v !== PROTOCOL_VERSION) return send(ws, { t: "error", msg: "Client version mismatch — please refresh." });
          ws.data.name = cleanName(msg.name);
          send(ws, { t: "welcome", clientId: ws.data.id, name: ws.data.name });
          send(ws, { t: "rooms", rooms: roomList() });
          return;
        case "ping":
          return send(ws, { t: "pong", ts: msg.ts });
        case "list":
          return send(ws, { t: "rooms", rooms: roomList() });
        case "create": {
          if (ws.data.room) ws.data.room.leave(ws);
          const id = newRoomId();
          const room = new Room(id, cleanName(msg.name) || `${ws.data.name}'s battle`, ws, () => {
            rooms.delete(id);
            broadcastRooms();
          });
          rooms.set(id, room);
          lobbyClients.delete(ws);
          broadcastRooms();
          return;
        }
        case "join": {
          const room = rooms.get(String(msg.id).toUpperCase());
          if (!room) return send(ws, { t: "error", msg: "Room not found." });
          if (ws.data.room) ws.data.room.leave(ws);
          lobbyClients.delete(ws);
          room.join(ws);
          broadcastRooms();
          return;
        }
        case "leave":
          if (ws.data.room) ws.data.room.leave(ws);
          send(ws, { t: "room", room: null });
          lobbyClients.add(ws);
          broadcastRooms();
          return;
      }
      const room = ws.data.room;
      if (room) {
        room.handle(ws, msg);
        if (msg.t === "start" || msg.t === "setslot") broadcastRooms();
      }
    },
    close(ws) {
      lobbyClients.delete(ws);
      if (ws.data.room) {
        ws.data.room.leave(ws);
        broadcastRooms();
      }
    },
  },
});

console.log(`⚔  Iron Tide server running at http://localhost:${server.port}  (${dev ? "development" : "production"})`);

// Graceful shutdown (containers send SIGTERM; as PID 1 we must handle it ourselves).
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    console.log(`${sig} received, shutting down`);
    for (const r of rooms.values()) r.stop();
    server.stop(true);
    process.exit(0);
  });
}
