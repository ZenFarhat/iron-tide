# Iron Tide

A browser RTS in the classic late-90s / early-2000s base-building style: construction
yards, power grids, ore harvesting, rock-paper-scissors armor, veterancy, deployable
infantry, tank crushing, superweapons with public countdowns, and 2–4 player online PvP
over deterministic lockstep. Built entirely on Bun.

**Everything in this project is original.** The factions, units, structures, names, numbers,
3D models, terrain, sound effects, announcer lines and music are all designed or generated
here. No art, audio, data files or text from any commercial game are used. The game reproduces
genre *mechanics* only, and game mechanics aren't protected by copyright.

## Quick start

```bash
bun install
bun run dev        # http://localhost:3000  (serves the client and the multiplayer server)
```

- **Skirmish:** Main menu → *Skirmish vs AI*. Add up to three AI opponents (easy, normal or hard), with teams, map size, credits and superweapons configurable.
- **Multiplayer:** Main menu → *Multiplayer* → *Create battle*. Share the 5-letter room code; others join by code or from the list, mark themselves ready, and the host starts. Open two browser tabs to try it locally. Late joiners spectate, and the server replays the turn history so they catch up.
- **Production:** `bun run start` (set `PORT` / `HOST`). `bun run build` also produces a static bundle in `dist/`, but online play needs the server.

## Docker / deploy

```bash
docker build -t iron-tide .
docker run --rm -p 3000:3000 iron-tide          # http://localhost:3000
docker run -d --restart unless-stopped -p 80:3000 --name iron-tide iron-tide
```

The image is `oven/bun:1.4.3-alpine`. It runs as the non-root `bun` user, has a built-in `HEALTHCHECK` on `/health`, and shuts down gracefully on SIGTERM. Configure it with `PORT` (default 3000) and `HOST` (default `0.0.0.0`).

It runs on any container host that supports WebSockets, such as Fly.io, Railway, Render, a VPS or Kubernetes:

- Expose the container port and route both HTTP and the `/ws` WebSocket upgrade to it.
- Terminate TLS at the platform or proxy. The client switches to `wss://` automatically when the page is served over https.
- **Run a single instance.** Rooms and lockstep state live in memory, so two players must reach the same process. Scale vertically, or use sticky routing per room.
- Configure a WebSocket idle timeout of at least 120 s on any proxy in front of the server. Clients ping every 2 s, so this only matters for proxies with very short defaults.

## Stack and library research

| Need | Choice | Why |
| --- | --- | --- |
| HTTP, bundling, dev server | `Bun.serve` with HTML imports | Bun bundles `client/index.html` and its TypeScript on the fly, with no Vite/webpack. |
| Networking | Bun's native WebSocket server | Built in, fast, pub/sub-capable. JSON messages are small because lockstep only sends commands. |
| Tests | `bun test` | Built in. Used for determinism and mechanics tests. |
| Rendering | Canvas 2D plus a small software 3D rasterizer (`client/render/model3d.ts`) | Models are built from primitives and rendered at load time into team-coloured, shaded sprites for 32 facings. This produced the needed art with no asset pipeline. PixiJS was considered but not required at this sprite count; the game holds 60 fps. |
| Audio | WebAudio synthesis plus `speechSynthesis` | Every sound effect and the soundtrack are synthesized; the announcer uses the browser's own TTS voice. No audio files. |
| Pathfinding | Custom A* on typed arrays | Needs locomotor rules, deterministic tie-breaking, and avoidance of stationary units. |
| E2E screenshots | `playwright-core` (dev only), driving the installed Chrome | Used for visual verification and the two-browser multiplayer test. |

The only runtime dependency is Bun itself.

## Architecture

```
sim/        deterministic simulation, shared by client, tests and tools (pure TS, no DOM)
  fixed.ts    integer math: isqrt, integer atan2/sin tables, seeded RNG, state hashing
  rules.ts    all unit / structure / weapon / warhead data (original)
  map.ts      seeded symmetric map generator (ore fields, gem fields, fuel wells, lakes, ridges)
  world.ts    World: entities, commands, production, power, placement, shroud, defeat
  units.ts    movement, group moves, jams and side-stepping, harvesters, aircraft, deploy, crush
  combat.ts   targeting, weapons, projectiles, splash, veterancy, superweapons
  ai.ts       skirmish AI (runs inside the sim, so it works in multiplayer too)
server/     Bun server: lobby, rooms, server-clocked lockstep relay, desync detection
shared/     wire protocol types
client/     browser: renderer, procedural models, effects, sidebar, minimap, input, audio, lobby
tests/      determinism and mechanics tests
scripts/    headless AI matches, balance duels, Playwright screenshot / UI / multiplayer tests
```

### Netcode: server-clocked deterministic lockstep

- Each client runs an identical simulation at 20 ticks/s. Only player **commands** cross the network.
- The server emits a *turn* every 100 ms containing every command it received; each turn covers 2 ticks. Clients execute turn *n* at tick 2n, so all simulations see the same inputs on the same tick.
- Simulation state is integer-only (positions in 1/256-cell "leptons"), with a seeded PRNG and no `Math.sin`/`atan2`/`random`, so results are bit-identical across browsers.
- Every 100 ticks, each client sends a state hash. The server compares them and broadcasts a desync warning if they differ.
- The server sanitizes every command, and the simulation checks ownership, so clients can't command other players' units.
- A lagging or backgrounded tab fast-forwards to catch up and never stalls the others. A disconnected player is removed with a deterministic `leave` command.

## Gameplay

- **Two factions.**
  - *Concord:* fast Warden tanks, Lens tanks, Skyguard Rovers, Striker jets, Phase Harvesters that teleport home, and Lumen Spires that relay beams into each other.
  - *Dominion:* heavy Bastion and Titan tanks, Arc Crawlers, Siege Launchers, Dreadnought airships, armed Ore Haulers, Arc Coils that Arc Troopers can supercharge, and a Fission Reactor that explodes when destroyed.
- **Economy:** gold ore ($25) and gems ($50), ore regrowth and spread, refinery docking with queues, and Fuel Wells you capture with Engineers.
- **Power:** low power slows production, shuts down powered defenses and radar, and pauses superweapon charging.
- **Production:** sidebar tabs, clock-wipe cameos, and progressive payment that pauses when credits run out. Extra factories speed up production. Hold/cancel with right-click, shift-click queues 5. Primary buildings and rally points. Placement is limited by build radius.
- **Combat:** 10 armor classes against 17 warheads, splash with falloff, turrets that fire on the move, burst weapons, homing and ballistic projectiles, and an anti-air/ground split.
- **Veterancy:** veteran and elite ranks give more damage, faster fire, more armor and speed; elite units self-repair.
- **Infantry:** Troopers and Lancers deploy (automatically when enemies approach). Hounds instantly kill infantry. Heroes (limit 1) snipe or plant charges. Engineers capture or fully repair structures. Destroyed buildings release survivors.
- **Vehicles:** tanks crush enemy infantry, and units can repair at a Repair Bay. The Mobile Hub deploys into a Command Hub and packs back up again.
- **Superweapons**, with countdowns visible to everyone:
  - Annihilator Silo: a warhead plus lingering radiation.
  - Tempest Engine: a lightning storm.
  - Phase Gate: teleports a group of vehicles.
  - Bulwark Projector: temporary invulnerability.
- **Shroud:** areas stay revealed once explored. Allies share vision.
- **Victory:** the "short game" rule applies — a player loses when they have no structures and no Mobile Hub left.

## Controls (classic: left-click to command)

| Input | Action |
| --- | --- |
| Left-drag / left-click | select / order (move, attack, enter, capture, harvest) |
| Right-click / right-drag | deselect or cancel / scroll the map |
| Ctrl+click / Alt+click | force-fire / force-move |
| A, S, G, X, D | attack-move, stop, guard, scatter, deploy |
| Ctrl+1–9, 1–9 (twice) | assign group, select group (twice centres on it) |
| T / P (twice = whole map) | same type / all combat units |
| H / Space | home base / last alert |
| Q W E R | sidebar tabs |
| Enter, Esc, wheel, \` | chat, menu, zoom, toggle health bars |

Modern controls (right-click to command) can be switched on in the in-game menu.

## Development

```bash
bun test                              # determinism + mechanics (21 tests)
bun run typecheck
bun scripts/headless.ts 1 20 CD       # AI vs AI match (seed, minutes, factions)
bun scripts/duel.ts c_warden d_bastion 6000   # equal-cost balance duel
bun scripts/shot.ts out/              # headless Chrome screenshots (server must be running)
bun scripts/ui-test.ts out/           # real mouse/keyboard flow
bun scripts/mp-test.ts out/ 40        # two browsers, online lockstep, desync check
bun scripts/fx-shot.ts out/           # staged battle + superweapon effects
```

`http://localhost:3000/gallery` (dev only) renders every procedural model for inspection.
In the browser console, `__ironTide.aiTakeover("hard")` hands your side to the AI.

## Not included

There is no naval combat, no terrain elevation or bridges, no garrisonable civilian buildings,
no spies or mind control, no crates and no campaign. The simulation is structured so these can
be added as rules plus behaviours.
