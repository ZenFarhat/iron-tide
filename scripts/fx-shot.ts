// Stage battles and superweapons in a live browser to screenshot effects. Usage: bun scripts/fx-shot.ts [outDir]
import { chromium } from "playwright-core";
const out = process.argv[2] ?? "screenshots";
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}\n${e.stack}`));
await page.goto(process.env.URL ?? "http://localhost:3000/");
await page.click("#mm-skirmish");
await page.click("#sk-start");
await page.waitForFunction(() => (window as any).__ironTide.game);
await page.waitForTimeout(500);
await page.evaluate(() => {
  const g = (window as any).__ironTide.game;
  const w = g.world;
  for (const p of w.players) p.explored.fill(1), p.exploredVersion++, (p.ai = null);
  // clear the middle of the map
  const cx = Math.floor(w.map.w / 2), cy = Math.floor(w.map.h / 2);
  for (let y = cy - 10; y <= cy + 10; y++) for (let x = cx - 14; x <= cx + 14; x++) { const i = y * w.map.w + x; w.map.terrain[i] = 0; w.map.oreType[i] = 0; w.map.ore[i] = 0; }
  const me = g.me, foe = 1 - me;
  w.players[me].faction = "C"; w.players[foe].faction = "D";
  const L = 256, H = 128;
  const sp = (t: string, o: number, x: number, y: number, f = 0) => w.spawnUnit(t, o, (cx + x) * L + H, (cy + y) * L + H, f);
  // Concord side
  ["c_warden", "c_warden", "c_lens", "c_rover", "c_warden"].forEach((t, i) => sp(t, me, -6, -3 + i * 1.5 | 0, 0));
  for (let i = 0; i < 6; i++) sp(i % 2 ? "c_lancer" : "c_trooper", me, -8, -3 + i, 0);
  w.addStructure("c_spire", me, cx - 9, cy - 2, true); w.addStructure("c_spire", me, cx - 9, cy + 1, true);
  w.addStructure("c_power", me, cx - 13, cy - 2, true); w.addStructure("c_power", me, cx - 13, cy + 1, true);
  // Dominion side
  ["d_bastion", "d_crawler", "d_titan", "d_bastion", "d_crawler"].forEach((t, i) => sp(t, foe, 6, -3 + i * 1.5 | 0, 128));
  for (let i = 0; i < 6; i++) sp(i % 2 ? "d_arc" : "d_levy", foe, 8, -3 + i, 128);
  w.addStructure("d_coil", foe, cx + 9, cy - 1, true); w.addStructure("d_reactor", foe, cx + 11, cy + 2, true);
  const air = sp("d_dread", foe, 12, -6, 128); if (air) air.z = 640;
  g.renderer.centerOn(cx * L, cy * L);
  g.renderer.cam.zoom = 1.25; g.renderer.clampCamera();
  const ids = (o: number) => w.ents.filter((e: any) => e.owner === o && e.kind !== "bld").map((e: any) => e.id);
  w.applyCommand(me, { c: "amove", ids: ids(me), x: cx + 8, y: cy });
  w.applyCommand(foe, { c: "amove", ids: ids(foe), x: cx - 8, y: cy });
});
for (let i = 1; i <= 4; i++) { await page.waitForTimeout(1600); await page.screenshot({ path: `${out}/fx-battle-${i}.png` }); }
// superweapons
await page.evaluate(() => {
  const g = (window as any).__ironTide.game;
  const w = g.world;
  const cx = Math.floor(w.map.w / 2), cy = Math.floor(w.map.h / 2);
  const foe = 1 - g.me;
  const silo = w.addStructure("d_silo", foe, cx + 6, cy + 6, true);
  silo.swCharge = 1e9;
  w.applyCommand(foe, { c: "sw", kind: "nuke", x: cx - 6, y: cy });
});
await page.waitForTimeout(6400);
await page.screenshot({ path: `${out}/fx-nuke-1.png` });
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/fx-nuke-2.png` });
await page.evaluate(() => {
  const g = (window as any).__ironTide.game;
  const w = g.world;
  const cx = Math.floor(w.map.w / 2), cy = Math.floor(w.map.h / 2);
  const t = w.addStructure("c_tempest", g.me, cx - 6, cy - 8, true);
  t.swCharge = 1e9;
  w.players[g.me].lowPower = false;
  w.applyCommand(g.me, { c: "sw", kind: "storm", x: cx + 9, y: cy });
});
await page.waitForTimeout(5500);
await page.screenshot({ path: `${out}/fx-storm.png` });
console.log(errors.join("\n") || "no errors");
await browser.close();
