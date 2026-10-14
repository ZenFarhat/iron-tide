import { chromium } from "playwright-core";
const out = process.argv[2] ?? "screenshots";
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("pageerror", (e) => console.log("pageerror", e.message));
await page.goto("http://localhost:3000/gallery" + (process.argv[3] ?? ""));
await page.waitForTimeout(1500);
const h = await page.evaluate(() => document.body.scrollHeight);
let i = 0;
for (let y = 0; y < h; y += 1100) {
  await page.screenshot({ path: `${out}/gal-${i++}.png`, clip: { x: 0, y, width: 1100, height: Math.min(1100, h - y) }, fullPage: true });
}
console.log("parts", i);
await browser.close();
