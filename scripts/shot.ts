// Headless browser smoke test + screenshots. Usage: bun scripts/shot.ts [outDir]
import { chromium } from "playwright-core";

const out = process.argv[2] ?? "screenshots";
const url = process.env.URL ?? "http://localhost:3000/";
const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
await Bun.write(`${out}/.keep`, "");

const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 });
const errors: string[] = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") errors.push(`[${m.type()}] ${m.text()}`);
});
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}\n${e.stack}`));

await page.goto(url);
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/1-menu.png` });
await page.click("#mm-skirmish");
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/2-skirmish.png` });
await page.click("#sk-start");
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/3-game-start.png` });

// deploy MCV and fast-forward a little with the AI playing for us
const info = await page.evaluate(() => {
  const g = (window as any).__ironTide.game;
  const w = g.world;
  const mcv = w.ents.find((e: any) => e.owner === g.me && e.type === "mhv");
  g.vs.selection.add(mcv.id);
  g.send({ c: "deploy", ids: [mcv.id] });
  return { me: g.me, faction: w.players[g.me].faction, ents: w.ents.length };
});
console.log("game info", info);
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}/4-deployed.png` });

if (process.env.LONG) {
  // hand the human slot to the AI and run fast to see a developed base & combat
  await page.evaluate(() => {
    const it = (window as any).__ironTide;
    it.aiTakeover("hard");
    it.game.speed = 6;
  });
  const steps = Number(process.env.LONG) / 5000;
  for (let i = 0; i < steps; i++) {
    await page.waitForTimeout(5000);
    const s = await page.evaluate(() => {
      const g = (window as any).__ironTide.game;
      if (!g) return "no game";
      const w = g.world;
      return `t=${(w.tick / 20 / 60).toFixed(1)}m ents=${w.ents.length} fps=${Math.round(g.fps)} ` + w.players.map((p: any) => `${p.name}:$${p.credits} k${p.stats.kills}`).join(" ");
    });
    console.log(s);
  }
  await page.evaluate(() => {
    const g = (window as any).__ironTide.game;
    g.speed = 1;
    // look at the most interesting spot: biggest cluster of my structures
    const mine = g.world.ents.filter((e: any) => e.owner === g.me && e.kind === "bld");
    if (mine.length) g.renderer.centerOn(mine[0].x + 300, mine[0].y + 300);
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/5-base.png` });
  await page.evaluate(() => {
    const g = (window as any).__ironTide.game;
    const w = g.world;
    // find a fight: projectile or unit attacking
    const fighter = w.ents.find((e: any) => e.kind !== "bld" && e.target && w.tick - e.lastFire < 40);
    if (fighter) g.renderer.centerOn(fighter.x, fighter.y);
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/6-battle.png` });
}

console.log(errors.length ? errors.join("\n") : "no console errors");
await browser.close();
