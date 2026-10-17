// Wire protocol between browser clients and the Bun server (JSON over WebSocket).
import type { Command } from "../sim/commands";
import { FACTIONS, type Faction } from "../sim/rules";
import { TPS } from "../sim/fixed";
import type { Theme } from "../sim/map";

export const PROTOCOL_VERSION = 3;
/** real time between network turns; shorter turns mean less input delay */
export const TURN_MS = 50;
export const MAX_SLOTS = 4;
export const GAME_SPEEDS = [1, 2, 3, 4, 8];

/** Simulation ticks covered by one turn. The server's turn clock never changes; faster games
 *  just simulate more ticks per turn, so everything in the sim (timers included) speeds up. */
export function turnTicks(speed: number) {
  return Math.max(1, Math.round((TURN_MS * TPS * speed) / 1000));
}

export type AIDifficulty = "easy" | "normal" | "hard";
export type SlotFaction = Faction | "R";

export interface Slot {
  kind: "open" | "closed" | "human" | "ai";
  clientId?: string;
  name: string;
  faction: SlotFaction;
  color: number;
  team: number;
  ready: boolean;
  ai?: AIDifficulty;
}

export interface LobbySettings {
  mapSize: number;
  credits: number;
  startUnits: number;
  superweapons: boolean;
  shortGame: boolean;
  speed: number;
  /** "random" or a hand-made map id */
  map: string;
  /** biome for random maps */
  theme: Theme;
  wildlife: boolean;
}

export const DEFAULT_LOBBY: LobbySettings = { mapSize: 72, credits: 10000, startUnits: 3, superweapons: true, shortGame: true, speed: 1, map: "random", theme: "temperate", wildlife: true };

/** resolve a "Random" faction pick */
export function rollFaction(f: SlotFaction): Faction {
  return f === "R" ? FACTIONS[Math.floor(Math.random() * FACTIONS.length)].id : f;
}

export interface RoomSummary {
  id: string;
  name: string;
  players: number;
  max: number;
  state: "lobby" | "loading" | "playing" | "ended";
}

export interface RoomState {
  id: string;
  name: string;
  hostId: string;
  slots: Slot[];
  settings: LobbySettings;
  state: RoomSummary["state"];
  spectators: string[];
}

export interface StartPlayer {
  name: string;
  faction: Faction;
  color: number;
  team: number;
  ai: AIDifficulty | null;
  clientId?: string;
}

/** [player, command, sender's sequence number]; the number lets the sender retire its optimistic preview */
export type Turn = [number, Command, number?][];

export type ClientMsg =
  | { t: "hello"; name: string; v: number }
  | { t: "list" }
  | { t: "create"; name: string }
  | { t: "join"; id: string }
  | { t: "leave" }
  | { t: "slot"; slot: number; faction?: SlotFaction; color?: number; team?: number; ready?: boolean }
  | { t: "setslot"; slot: number; kind: "open" | "closed" | "ai"; ai?: AIDifficulty }
  | { t: "move"; slot: number }
  | { t: "settings"; settings: Partial<LobbySettings> }
  | { t: "start" }
  | { t: "loaded" }
  | { t: "cmd"; cmd: Command; seq?: number }
  | { t: "hash"; tick: number; h: number }
  | { t: "chat"; text: string }
  | { t: "ping"; ts: number };

export type ServerMsg =
  | { t: "welcome"; clientId: string; name: string }
  | { t: "rooms"; rooms: RoomSummary[] }
  | { t: "room"; room: RoomState | null }
  | { t: "start"; seed: number; settings: LobbySettings; players: StartPlayer[]; you: number; history: Turn[] }
  | { t: "go" }
  | { t: "turn"; n: number; cmds: Turn }
  | { t: "chat"; from: string; color: number; text: string; system?: boolean }
  | { t: "desync"; tick: number }
  | { t: "pong"; ts: number }
  | { t: "error"; msg: string };

export const PLAYER_COLORS = [
  { name: "Cobalt", hex: "#3b7dff" },
  { name: "Crimson", hex: "#e8323a" },
  { name: "Jade", hex: "#2fbf5f" },
  { name: "Amber", hex: "#f2b41c" },
  { name: "Violet", hex: "#a057f0" },
  { name: "Teal", hex: "#1ec8c8" },
  { name: "Tangerine", hex: "#ff7a1f" },
  { name: "Rose", hex: "#ff6fb5" },
];
