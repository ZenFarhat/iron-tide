// Wire protocol between browser clients and the Bun server (JSON over WebSocket).
import type { Command } from "../sim/commands";
import type { Faction } from "../sim/rules";

export const PROTOCOL_VERSION = 1;
export const TURN_MS = 100;
export const MAX_SLOTS = 4;

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
}

export const DEFAULT_LOBBY: LobbySettings = { mapSize: 72, credits: 10000, startUnits: 3, superweapons: true, shortGame: true };

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

export type Turn = [number, Command][];

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
  | { t: "cmd"; cmd: Command }
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
