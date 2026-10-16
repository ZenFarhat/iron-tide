// Two-browser multiplayer smoke test: room create/join, lockstep start, commands, desync check.
// Usage: bun scripts/mp-test.ts [outDir] [seconds] [speed]
import { chromium, type Page } from "playwright-core";

const out = process.argv[2] ?? "screenshots";
const secs = Number(process.argv[3] ?? 25);
const speed = Number(process.argv[4] ?? 1);
const url = process.env.URL ?? "http://localhost:3000/";
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });

async function open(name: string) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  const page = await ctx.newPage();
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(`${name} pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errs.push(`${name} console: ${m.text()}`));
  await page.goto(url);
  await page.fill("#mm-name", name);
  await page.click("#mm-online");
  await page.waitForSelector("#mp-create");
  return { page, errs };
}

const A = await open("Alice");
const B = await open("Bob");
await A.page.fill("#mp-rname", "Test battle");
await A.page.click("#mp-create");
await A.page.waitForSelector(".code");
const code = (await A.page.textContent(".code"))!.replace("#", "").trim();
console.log("room code", code);
await B.page.fill("#mp-code", code);
await B.page.click("#mp-join");
await B.page.waitForSelector("#rm-ready");
// Bob picks Dominion, Alice Concord
await B.page.evaluate(() => {
  const sel = document.querySelector<HTMLSelectElement>('tr.me select[data-f="faction"]')!;
  sel.value = "D";
  sel.dispatchEvent(new Event("change"));
});
await A.page.evaluate(() => {
  const sel = document.querySelector<HTMLSelectElement>('tr.me select[data-f="faction"]')!;
  sel.value = "C";
  sel.dispatchEvent(new Event("change"));
});
if (speed !== 1)
  await A.page.evaluate((v) => {
    const sel = document.querySelector<HTMLSelectElement>('select[data-s="speed"]')!;
    sel.value = String(v);
    sel.dispatchEvent(new Event("change"));
  }, speed);
await B.page.waitForTimeout(300);
await B.page.click("#rm-ready");
await A.page.waitForTimeout(400);
await A.page.screenshot({ path: `${out}/mp-lobby.png` });
await A.page.click("#rm-start");
await Promise.all([A.page.waitForFunction(() => (window as any).__ironTide.game), B.page.waitForFunction(() => (window as any).__ironTide.game)]);
console.log("both in game");

const deploy = (p: Page) =>
  p.evaluate(() => {
    const g = (window as any).__ironTide.game;
    const mcv = g.world.ents.find((e: any) => e.owner === g.me && e.type === "mhv");
    g.send({ c: "deploy", ids: [mcv.id] });
    return g.me;
  });
console.log("me", await deploy(A.page), await deploy(B.page));
console.log("speed", await A.page.evaluate(() => (window as any).__ironTide.game.speed), await B.page.evaluate(() => (window as any).__ironTide.game.speed));
// round trip from issuing a command to the sim executing it (what optimistic feedback covers)
const latency = (p: Page) =>
  p.evaluate(async () => {
    const g = (window as any).__ironTide.game;
    const out: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      g.send({ c: "stop", ids: [] });
      const seq = g.opt.pending[g.opt.pending.length - 1].seq;
      while (g.opt.pending.some((x: any) => x.seq === seq)) await new Promise((r) => requestAnimationFrame(r));
      out.push(performance.now() - t0);
      await new Promise((r) => setTimeout(r, 37));
    }
    out.sort((a, b) => a - b);
    return { avg: Math.round(out.reduce((a, b) => a + b) / out.length), max: Math.round(out[out.length - 1]) };
  });
console.log("command latency ms", JSON.stringify(await latency(A.page)), JSON.stringify(await latency(B.page)));
await A.page.waitForTimeout(3000);
// queue a power plant on both sides and move some infantry
for (const p of [A.page, B.page])
  await p.evaluate(() => {
    const g = (window as any).__ironTide.game;
    const fac = g.world.players[g.me].faction;
    g.send({ c: "build", type: fac === "C" ? "c_power" : "d_power" });
    const inf = g.world.ents.filter((e: any) => e.owner === g.me && e.kind === "inf").map((e: any) => e.id);
    g.send({ c: "move", ids: inf, x: Math.floor(g.world.map.w / 2), y: Math.floor(g.world.map.h / 2) });
  });
// drive both clients with a stream of human-style commands (all routed through the server)
const drive = (p: Page) =>
  p.evaluate(() => {
    const g = (window as any).__ironTide.game;
    const w = g.world;
    const me = w.players[g.me];
    for (const q of ["bld", "def"]) {
      const t = me.ready[q];
      if (!t) continue;
      const hub = w.ents.find((e: any) => e.owner === g.me && e.r.tags.includes("hub"));
      if (!hub) continue;
      for (let r = 2; r < 9; r++) {
        const x = hub.bx + Math.floor(Math.random() * r * 2) - r,
          y = hub.by + Math.floor(Math.random() * r * 2) - r;
        if (w.placementOk(me, t, x, y)) {
          g.send({ c: "place", type: t, x, y });
          break;
        }
      }
    }
    const order = me.faction === "C" ? ["c_power", "c_refinery", "c_barracks", "c_factory"] : ["d_power", "d_refinery", "d_barracks", "d_factory"];
    if (!me.queues.bld.length && !me.ready.bld) {
      const t = order.find((id) => w.canBuild(me, id) && !w.ents.some((e: any) => e.owner === g.me && e.type === id));
      if (t) g.send({ c: "build", type: t });
    }
    const inf = me.faction === "C" ? "c_trooper" : "d_levy";
    if (w.canBuild(me, inf) && me.queues.inf.length < 2) g.send({ c: "build", type: inf, n: 2 });
    const army = w.ents.filter((e: any) => e.owner === g.me && e.kind === "inf").map((e: any) => e.id);
    if (army.length) g.send({ c: Math.random() < 0.5 ? "amove" : "move", ids: army, x: Math.floor(Math.random() * w.map.w), y: Math.floor(Math.random() * w.map.h) });
  });

const t0 = Date.now();
const tick0 = await A.page.evaluate(() => (window as any).__ironTide.game.world.tick);
while (Date.now() - t0 < secs * 1000) {
  for (let k = 0; k < 5; k++) {
    await drive(A.page);
    await drive(B.page);
    await A.page.waitForTimeout(1000);
  }
  const sa = await A.page.evaluate(() => {
    const g = (window as any).__ironTide.game;
    return { tick: g.world.tick, ents: g.world.ents.length, desync: g.desynced, credits: g.world.players.map((p: any) => p.credits) };
  });
  const sb = await B.page.evaluate(() => {
    const g = (window as any).__ironTide.game;
    return { tick: g.world.tick, ents: g.world.ents.length, desync: g.desynced, credits: g.world.players.map((p: any) => p.credits) };
  });
  console.log("A", JSON.stringify(sa), "B", JSON.stringify(sb));
}
const tick1 = await A.page.evaluate(() => (window as any).__ironTide.game.world.tick);
console.log(`sim rate ${((tick1 - tick0) / ((Date.now() - t0) / 1000)).toFixed(1)} ticks/s (expected ~${20 * speed})`);
const ha = await A.page.evaluate(() => (window as any).__ironTide.game.desynced);
const hb = await B.page.evaluate(() => (window as any).__ironTide.game.desynced);
console.log(ha || hb ? "DESYNC DETECTED" : "lockstep in sync (server hash checks passed)");
await A.page.screenshot({ path: `${out}/mp-a.png` });
await B.page.screenshot({ path: `${out}/mp-b.png` });
console.log([...A.errs, ...B.errs].join("\n") || "no errors");
await browser.close();
