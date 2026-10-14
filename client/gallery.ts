// Dev page: renders every procedural model for visual inspection (/gallery).
import { RULES } from "../sim/rules";
import { infantrySprite, structSprite, structTurret, vehicleBody, vehicleTurret, getUnitModel, getStructModel, treeSprite, rockSprite, oreSprite } from "./render/sprites";
import { HW, HH, ZH } from "./render/iso";
import { drawSprite, type Sprite } from "./render/model3d";

const root = document.getElementById("root")!;
const team = new URLSearchParams(location.search).get("team") ?? "#3b7dff";
const Z = 2;

function cell(label: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const d = document.createElement("div");
  d.className = "cell";
  const c = document.createElement("canvas");
  c.width = w * Z;
  c.height = h * Z;
  c.style.width = w * Z + "px";
  const g = c.getContext("2d")!;
  g.scale(Z, Z);
  draw(g);
  d.appendChild(c);
  d.appendChild(document.createTextNode(label));
  return d;
}
function section(title: string) {
  const h = document.createElement("h3");
  h.textContent = title;
  root.appendChild(h);
  const r = document.createElement("div");
  r.className = "row";
  root.appendChild(r);
  return r;
}

const units = Object.values(RULES).filter((r) => r.kind === "veh" || r.kind === "air");
const r1 = section("Vehicles & aircraft (8 facings)");
for (const r of units) {
  r1.appendChild(
    cell(r.name, 8 * 64, 80, (g) => {
      for (let i = 0; i < 8; i++) {
        const f32 = i * 4;
        const x = 32 + i * 64,
          y = 50;
        const b = vehicleBody(r.id, f32, team);
        drawSprite(g, b, x, y);
        const m = getUnitModel(r.id);
        if (m.turret && m.pivot) {
          const a = (f32 / 32) * Math.PI * 2;
          const [px, py, pz] = m.pivot;
          const rx = px * Math.cos(a) - py * Math.sin(a),
            ry = px * Math.sin(a) + py * Math.cos(a);
          const t = vehicleTurret(r.id, f32, team) as Sprite;
          drawSprite(g, t, x + (rx - ry) * HW, y + (rx + ry) * HH - pz * ZH);
        }
      }
    }),
  );
}
const r2 = section("Infantry (8 facings · frames 0..6)");
for (const r of Object.values(RULES).filter((r) => r.kind === "inf")) {
  r2.appendChild(
    cell(r.name, 8 * 26 + 7 * 26, 44, (g) => {
      for (let i = 0; i < 8; i++) drawSprite(g, infantrySprite(r.id, i, 0, team), 14 + i * 26, 36);
      for (let f = 0; f < 7; f++) drawSprite(g, infantrySprite(r.id, 1, f, team), 14 + (8 + f) * 26, 36);
    }),
  );
}
const r3 = section("Structures");
for (const r of Object.values(RULES).filter((r) => r.kind === "bld")) {
  const w = (r.w + r.h) * HW + 20,
    h = (r.w + r.h) * HH + 90;
  r3.appendChild(
    cell(r.name, w, h, (g) => {
      const ax = r.h * HW + 10,
        ay = 70;
      g.strokeStyle = "rgba(255,255,255,0.25)";
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(ax + r.w * HW, ay + r.w * HH);
      g.lineTo(ax + (r.w - r.h) * HW, ay + (r.w + r.h) * HH);
      g.lineTo(ax - r.h * HW, ay + r.h * HH);
      g.closePath();
      g.stroke();
      drawSprite(g, structSprite(r.id, team), ax, ay);
      const sm = getStructModel(r.id);
      if (sm.turret && sm.pivot) {
        const t = structTurret(r.id, 28, team)!;
        const [px, py, pz] = sm.pivot;
        drawSprite(g, t, ax + (px - py) * HW, ay + (px + py) * HH - pz * ZH);
      }
    }),
  );
}
const r4 = section("Props & ore");
r4.appendChild(
  cell("trees", 12 * 34, 60, (g) => {
    for (let i = 0; i < 12; i++) drawSprite(g, treeSprite(i), 18 + i * 34, 48);
  }),
);
r4.appendChild(
  cell("rocks", 8 * 64, 60, (g) => {
    for (let i = 0; i < 8; i++) drawSprite(g, rockSprite(i), 32 + i * 64, 20);
  }),
);
r4.appendChild(
  cell("ore / gems", 8 * 64, 50, (g) => {
    for (let i = 0; i < 4; i++) drawSprite(g, oreSprite(false, i + 1, i), 32 + i * 64, 10);
    for (let i = 0; i < 4; i++) drawSprite(g, oreSprite(true, i + 1, i), 32 + (i + 4) * 64, 10);
  }),
);
