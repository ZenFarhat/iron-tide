// Real mouse/keyboard UI flow test in headless Chrome. Usage: bun scripts/ui-test.ts [outDir]
import { chromium } from "playwright-core";

const out = process.argv[2] ?? "screenshots";
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}\n${e.stack}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
await page.goto(process.env.URL ?? "http://localhost:3000/");
await page.click("#mm-skirmish");
await page.click("#sk-start");
await page.waitForFunction(() => (window as any).__ironTide.game);
await page.waitForTimeout(800);

const css = (id: number) =>
  page.evaluate((id) => {
    const g = (window as any).__ironTide.game;
    const e = g.world.get(id);
    if (!e) return null;
    const [x, y] = g.renderer.worldToCss(e.x, e.y, e.z);
    return { x, y };
  }, id);
const state = () =>
  page.evaluate(() => {
    const g = (window as any).__ironTide.game;
    const w = g.world;
    const me = w.players[g.me];
    return {
      sel: [...g.vs.selection],
      mcv: w.ents.find((e: any) => e.owner === g.me && e.type === "mhv")?.id ?? 0,
      hub: w.ents.find((e: any) => e.owner === g.me && e.r.tags.includes("hub"))?.id ?? 0,
      ready: me.ready.bld,
      queue: me.queues.bld.map((q: any) => q.type),
      structs: w.ents.filter((e: any) => e.owner === g.me && e.kind === "bld").map((e: any) => e.type),
      inf: w.ents.filter((e: any) => e.owner === g.me && e.kind === "inf").map((e: any) => e.id),
      mode: g.vs.mode.kind,
    };
  });

let s = await state();
// 1. click the MCV to select it
const mp = (await css(s.mcv))!;
await page.mouse.click(mp.x, mp.y - 8);
s = await state();
console.log("selected after click:", s.sel, "mcv", s.mcv);
// 2. press D to deploy
await page.keyboard.press("d");
await page.waitForTimeout(2600);
s = await state();
console.log("hub after deploy:", s.hub, "structs", s.structs);
await page.screenshot({ path: `${out}/ui-1-deployed.png` });
// 3. click the power plant cameo
await page.click(".cameo >> nth=0");
await page.waitForTimeout(200);
s = await state();
console.log("queue after cameo click:", s.queue);
await page.evaluate(() => ((window as any).__ironTide.game.speed = 8));
await page.waitForFunction(() => {
  const g = (window as any).__ironTide.game;
  return !!g.world.players[g.me].ready.bld;
}, null, { timeout: 30000 });
await page.evaluate(() => ((window as any).__ironTide.game.speed = 1));
await page.screenshot({ path: `${out}/ui-2-ready.png` });
// 4. click cameo again → placement mode; hover next to hub; click to place
await page.click(".cameo.is-ready");
s = await state();
console.log("mode after ready click:", s.mode);
const spot = await page.evaluate(() => {
  const g = (window as any).__ironTide.game;
  const w = g.world;
  const p = w.players[g.me];
  const hub = w.ents.find((e: any) => e.owner === g.me && e.r.tags.includes("hub"));
  for (let r = 3; r < 7; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const bx = hub.bx + dx,
          by = hub.by + dy;
        if (w.placementOk(p, p.ready.bld, bx, by)) {
          // cursor cell = bx + floor((w-1)/2)
          const [x, y] = g.renderer.worldToCss((bx + 0.5) * 256 + 0, (by + 0.5) * 256, 0);
          return { x, y, bx, by };
        }
      }
  return null;
});
console.log("placement spot", spot);
await page.mouse.move(spot!.x, spot!.y);
await page.waitForTimeout(250);
await page.screenshot({ path: `${out}/ui-3-placing.png` });
await page.mouse.click(spot!.x, spot!.y);
await page.waitForTimeout(1200);
s = await state();
console.log("structures after placing:", s.structs);
// 5. box-select infantry and move them
const pts = await Promise.all(s.inf.map((id: number) => css(id)));
const xs = pts.filter(Boolean).map((p) => p!.x),
  ys = pts.filter(Boolean).map((p) => p!.y);
await page.mouse.move(Math.min(...xs) - 20, Math.min(...ys) - 30);
await page.mouse.down();
await page.mouse.move(Math.max(...xs) + 20, Math.max(...ys) + 10, { steps: 5 });
await page.screenshot({ path: `${out}/ui-4-boxselect.png` });
await page.mouse.up();
s = await state();
console.log("box selected:", s.sel.length, "of", s.inf.length, "infantry");
await page.mouse.click(Math.max(...xs) + 220, Math.max(...ys) + 60);
await page.waitForTimeout(1500);
const moved = await page.evaluate(() => {
  const g = (window as any).__ironTide.game;
  return [...g.vs.selection].map((id: any) => g.world.get(id)).map((e: any) => `${e.type}:${e.order}`);
});
console.log("after move click:", moved);
await page.screenshot({ path: `${out}/ui-5-moved.png` });
// 6. hover enemy-less ground with selection shows move cursor; right click deselects (classic)
await page.mouse.click(700, 400, { button: "right" });
s = await state();
console.log("selection after right-click:", s.sel.length);
console.log(errors.join("\n") || "no errors");
await browser.close();
