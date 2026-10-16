// Browser entry point.
import { Menu, inviteCode } from "./lobby";
import { Game } from "./game";
import { World } from "../sim/world";
import { LocalSession, NetSession } from "./net";
import { Audio } from "./audio";
import { aiInit } from "../sim/ai";

const audio = new Audio();
const app = document.getElementById("app")!;
const menuRoot = document.getElementById("menu")!;
let game: Game | null = null;

function loading(text: string) {
  const d = document.createElement("div");
  d.className = "loading";
  d.innerHTML = `<div class="spinner"></div><div>${text}</div>`;
  document.body.appendChild(d);
  return () => d.remove();
}

const menu: Menu = new Menu(menuRoot, {
  unlockAudio: () => audio.unlock(),
  startSkirmish(s) {
    menu.hide();
    const done = loading("Generating battlefield…");
    setTimeout(() => {
      const world = new World(
        { seed: s.settings.seed, mapSize: s.settings.mapSize, credits: s.settings.credits, startUnits: s.settings.startUnits, superweapons: s.settings.superweapons, shortGame: s.settings.shortGame },
        s.players.map((p) => ({ name: p.name, faction: p.faction, color: p.color, team: p.team, ai: p.ai })),
      );
      const session = new LocalSession();
      game = new Game(app, {
        world,
        session,
        audio,
        speed: s.settings.speed,
        onExit: () => {
          game = null;
          menu.main();
        },
      });
      prewarm(game);
      done();
    }, 30);
  },
  startOnline(s) {
    menu.hide();
    const done = loading(s.you >= 0 ? "Deploying forces…" : "Joining as spectator…");
    setTimeout(() => {
      const world = new World(
        { seed: s.seed, mapSize: s.settings.mapSize, credits: s.settings.credits, startUnits: s.settings.startUnits, superweapons: s.settings.superweapons, shortGame: s.settings.shortGame },
        s.players.map((p) => ({ name: p.name, faction: p.faction, color: p.color, team: p.team, ai: p.ai })),
      );
      const session = new NetSession(s.net, s.you, s.history);
      game = new Game(app, {
        world,
        session,
        audio,
        speed: s.settings.speed,
        onExit: () => {
          game = null;
          s.net.sendRaw({ t: "leave" });
          menu.online();
        },
      });
      prewarm(game);
      s.net.sendRaw({ t: "loaded" });
      done();
    }, 30);
  },
});

function prewarm(g: Game) {
  const t = g.renderer.terrain;
  for (let j = 0; j < t.ch; j++) for (let i = 0; i < t.cw; i++) t.get(i, j);
}

const invite = inviteCode();
if (invite) {
  // drop the code from the address bar so a later refresh doesn't rejoin
  history.replaceState(null, "", location.pathname);
  menu.joinInvite(invite);
} else menu.main();

// expose for debugging / automated tests
(window as any).__ironTide = {
  get game() {
    return game;
  },
  menu,
  /** debug: hand the local player over to the AI */
  aiTakeover(level: "easy" | "normal" | "hard" = "hard") {
    if (!game || game.me < 0) return;
    const p = game.world.players[game.me];
    p.ai = level;
    aiInit(game.world, p);
  },
};
