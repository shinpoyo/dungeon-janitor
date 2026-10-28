import type { Game, Thing } from "./game";
import type { TreasureKind } from "./map";

const FONT = `"Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif`;

const C = {
  floorA: "#3d3833",
  floorB: "#38332f",
  wall: "#1b1820",
  wallTop: "#2c2733",
  door: "#7a5232",
  doorDark: "#4f3420",
  shelf: "#6b4a2d",
  staff: "#2e3a3a",
  blueprint: "#14467a",
  blueLine: "rgba(220,235,255,0.9)",
  blueFaint: "rgba(220,235,255,0.18)",
};

const TREASURE_SHORT: Record<TreasureKind, string> = { herb: "薬", sword: "剣", gold: "金" };

export function render(ctx: CanvasRenderingContext2D, g: Game, T: number, showBlueprint: boolean, time: number) {
  const { bp } = g;
  ctx.clearRect(0, 0, bp.width * T, bp.height * T);

  if (showBlueprint) {
    drawBlueprint(ctx, g, T);
    return;
  }

  // 床と壁
  for (let y = 0; y < bp.height; y++) {
    for (let x = 0; x < bp.width; x++) {
      const t = bp.tiles[y][x];
      const px = x * T;
      const py = y * T;
      if (t === "wall") {
        ctx.fillStyle = C.wall;
        ctx.fillRect(px, py, T, T);
        if (y + 1 < bp.height && bp.tiles[y + 1][x] !== "wall") {
          ctx.fillStyle = C.wallTop;
          ctx.fillRect(px, py + T * 0.55, T, T * 0.45);
          ctx.fillStyle = "rgba(0,0,0,0.25)";
          ctx.fillRect(px, py + T * 0.75, T, 1);
        }
        continue;
      }
      if (t === "hidden") {
        // 職員用の隠し戸：勇者には壁に見えるが、清掃員には分かるよう印を付ける
        ctx.fillStyle = C.wallTop;
        ctx.fillRect(px, py, T, T);
        ctx.strokeStyle = "rgba(255,211,77,0.55)";
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(px + T * 0.2, py + T * 0.12, T * 0.6, T * 0.76);
        ctx.setLineDash([]);
        continue;
      }
      ctx.fillStyle = bp.roomAt[y][x] >= 0 && bp.rooms[bp.roomAt[y][x]].staff ? C.staff : (x + y) % 2 ? C.floorA : C.floorB;
      ctx.fillRect(px, py, T, T);
      if (t === "shelf") drawShelf(ctx, px, py, T, x);
    }
  }
  drawMarker(ctx, bp.entrance.x * T, bp.entrance.y * T, T, "入口", "#5fa86b");
  drawStairs(ctx, bp.stairs.x * T, bp.stairs.y * T, T);

  // 地面に付くもの → 立っているもの、の順に描く
  const order: Thing["kind"][] = ["stain", "trap", "door", "torch", "chest", "monster"];
  for (const kind of order) {
    for (const th of g.things) {
      if (th.kind !== kind) continue;
      // 勇者と戦っている相手は揺らす
      const shake = g.hero?.fighting === th ? Math.sin(time * 60) * T * 0.06 : 0;
      ctx.translate(shake, 0);
      drawThing(ctx, th, T, time);
      ctx.translate(-shake, 0);
    }
  }

  drawDarkness(ctx, g, T);

  // 予約したマスの番号
  g.janitor.queue.forEach((task, i) => {
    const cx = task.pos.x * T + T / 2;
    const cy = task.pos.y * T + T / 2;
    ctx.strokeStyle = "#ffd34d";
    ctx.lineWidth = 2;
    ctx.strokeRect(task.pos.x * T + 2, task.pos.y * T + 2, T - 4, T - 4);
    ctx.fillStyle = "#ffd34d";
    ctx.beginPath();
    ctx.arc(cx + T * 0.3, cy - T * 0.3, T * 0.17, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#222";
    ctx.font = `bold ${Math.round(T * 0.24)}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(i + 1), cx + T * 0.3, cy - T * 0.29);
  });

  drawJanitor(ctx, g, T, time);
  if (g.hero) drawHero(ctx, g.hero.px * T, g.hero.py * T, T, time);

  for (const b of g.bubbles) drawBubble(ctx, b.text, (b.x + 0.5) * T, (b.y - 0.1) * T - (1.6 - b.life) * T * 0.4, T, b.tone, Math.min(1, b.life * 2));
}

// まだ見ていない所は真っ暗、見たことはあるが今は照らされていない所は薄暗く
function drawDarkness(ctx: CanvasRenderingContext2D, g: Game, T: number) {
  const { bp } = g;
  for (let y = 0; y < bp.height; y++) {
    for (let x = 0; x < bp.width; x++) {
      const i = y * bp.width + x;
      if (g.visible[i]) continue;
      ctx.fillStyle = g.seen[i] ? "rgba(6,4,10,0.6)" : "#07050a";
      ctx.fillRect(x * T, y * T, T + 0.5, T + 0.5);
    }
  }
}

function drawShelf(ctx: CanvasRenderingContext2D, px: number, py: number, T: number, x: number) {
  ctx.fillStyle = C.shelf;
  ctx.fillRect(px + T * 0.06, py + T * 0.08, T * 0.88, T * 0.84);
  ctx.fillStyle = "#4a321e";
  ctx.fillRect(px + T * 0.06, py + T * 0.48, T * 0.88, T * 0.06);
  const colors = ["#e9e2c4", "#b8854f", "#d9b23a"];
  ctx.fillStyle = colors[x % 3];
  ctx.fillRect(px + T * 0.18, py + T * 0.2, T * 0.25, T * 0.25);
  ctx.fillRect(px + T * 0.55, py + T * 0.6, T * 0.25, T * 0.25);
  ctx.fillStyle = "#c9b38a";
  ctx.fillRect(px + T * 0.55, py + T * 0.22, T * 0.22, T * 0.23);
  ctx.fillRect(px + T * 0.2, py + T * 0.62, T * 0.22, T * 0.22);
}

function drawMarker(ctx: CanvasRenderingContext2D, px: number, py: number, T: number, label: string, color: string) {
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.35;
  ctx.fillRect(px + 2, py + 2, T - 4, T - 4);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#e8f5e9";
  ctx.font = `bold ${Math.round(T * 0.26)}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, px + T / 2, py + T / 2);
}

function drawStairs(ctx: CanvasRenderingContext2D, px: number, py: number, T: number) {
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = `rgb(${90 - i * 20},${80 - i * 18},${70 - i * 16})`;
    ctx.fillRect(px + T * 0.1 + i * T * 0.05, py + T * (0.15 + i * 0.18), T * 0.8 - i * T * 0.1, T * 0.18);
  }
}

function drawThing(ctx: CanvasRenderingContext2D, th: Thing, T: number, time: number) {
  const px = th.pos.x * T;
  const py = th.pos.y * T;
  const cx = px + T / 2;
  const cy = py + T / 2;
  switch (th.kind) {
    case "stain":
      if (th.cleaned) return;
      if (th.stain === "graffiti") {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(-0.25);
        ctx.fillStyle = "#e46aa8";
        ctx.font = `bold ${Math.round(T * 0.3)}px ${FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("参上", 0, 0);
        ctx.restore();
      } else {
        ctx.fillStyle = th.stain === "blood" ? "rgba(150,20,30,0.85)" : "rgba(10,8,6,0.75)";
        blob(ctx, cx, cy, T * 0.3, th.pos.x * 7 + th.pos.y * 13);
      }
      return;
    case "trap":
      if (th.armed) {
        ctx.strokeStyle = "rgba(0,0,0,0.25)";
        ctx.lineWidth = 1;
        ctx.strokeRect(px + T * 0.2, py + T * 0.2, T * 0.6, T * 0.6);
      } else {
        ctx.fillStyle = "#222";
        ctx.fillRect(px + T * 0.15, py + T * 0.15, T * 0.7, T * 0.7);
        ctx.fillStyle = "#b9bec7";
        for (let i = 0; i < 3; i++)
          for (let j = 0; j < 3; j++) {
            const sx = px + T * (0.25 + i * 0.22);
            const sy = py + T * (0.32 + j * 0.2);
            ctx.beginPath();
            ctx.moveTo(sx - T * 0.06, sy + T * 0.07);
            ctx.lineTo(sx, sy - T * 0.08);
            ctx.lineTo(sx + T * 0.06, sy + T * 0.07);
            ctx.fill();
          }
      }
      return;
    case "door":
      if (!th.broken) {
        ctx.fillStyle = C.door;
        ctx.fillRect(px + T * 0.08, py + T * 0.05, T * 0.84, T * 0.9);
        ctx.fillStyle = C.doorDark;
        ctx.fillRect(px + T * 0.48, py + T * 0.05, T * 0.04, T * 0.9);
        ctx.fillStyle = "#d8b45a";
        ctx.fillRect(px + T * 0.62, py + T * 0.48, T * 0.08, T * 0.08);
      } else {
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.fillRect(px + T * 0.08, py + T * 0.05, T * 0.84, T * 0.9);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.fillStyle = C.door;
        ctx.rotate(0.6);
        ctx.fillRect(-T * 0.4, -T * 0.08, T * 0.7, T * 0.14);
        ctx.rotate(-1.4);
        ctx.fillRect(-T * 0.25, T * 0.12, T * 0.55, T * 0.12);
        ctx.restore();
      }
      return;
    case "torch": {
      // 壁際の燭台
      ctx.fillStyle = "#5a4636";
      ctx.fillRect(cx - T * 0.04, py + T * 0.2, T * 0.08, T * 0.32);
      if (th.lit) {
        const flick = Math.sin(time * 12 + th.pos.x) * 0.04;
        ctx.fillStyle = "rgba(255,170,60,0.18)";
        ctx.beginPath();
        ctx.arc(cx, py + T * 0.2, T * (0.5 + flick), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffb53d";
        ctx.beginPath();
        ctx.ellipse(cx, py + T * 0.14, T * 0.1, T * (0.16 + flick), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff1a8";
        ctx.beginPath();
        ctx.ellipse(cx, py + T * 0.17, T * 0.05, T * 0.08, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = "#2a2422";
        ctx.fillRect(cx - T * 0.07, py + T * 0.12, T * 0.14, T * 0.1);
        ctx.fillStyle = "rgba(160,160,160,0.35)";
        ctx.beginPath();
        ctx.arc(cx + Math.sin(time * 2) * T * 0.05, py + T * 0.02, T * 0.05, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
    case "chest": {
      const w = T * 0.72;
      const h = T * 0.48;
      const x0 = cx - w / 2;
      const y0 = py + T * 0.38;
      ctx.fillStyle = "#8a5a2b";
      ctx.fillRect(x0, y0, w, h);
      ctx.fillStyle = "#d9a93a";
      ctx.fillRect(x0, y0 + h * 0.35, w, h * 0.14);
      if (th.open) {
        ctx.fillStyle = "#1a120c";
        ctx.fillRect(x0 + 3, y0 + 2, w - 6, h * 0.3);
        ctx.fillStyle = "#6e4622";
        ctx.fillRect(x0, y0 - T * 0.26, w, T * 0.24);
      } else {
        ctx.fillStyle = "#a06a34";
        ctx.fillRect(x0, y0 - T * 0.12, w, T * 0.14);
        ctx.fillStyle = "#d9a93a";
        ctx.fillRect(cx - T * 0.05, y0 + h * 0.3, T * 0.1, T * 0.12);
      }
      return;
    }
    case "monster":
      drawMonster(ctx, th, T, time);
      return;
  }
}

function drawMonster(ctx: CanvasRenderingContext2D, th: Extract<Thing, { kind: "monster" }>, T: number, time: number) {
  const px = th.pos.x * T;
  const py = th.pos.y * T;
  const cx = px + T / 2;
  if (th.state === "gone") return;
  const down = th.state === "down";
  const reviving = th.state === "reviving";
  ctx.globalAlpha = reviving ? 0.55 + Math.sin(time * 8) * 0.2 : 1;
  if (th.monster === "slime") {
    const bob = down ? 0 : Math.sin(time * 4 + th.pos.x) * T * 0.03;
    const h = down ? T * 0.26 : T * 0.4;
    const w = down ? T * 0.4 : T * 0.34;
    const base = py + T * 0.86;
    ctx.fillStyle = "#4cc46a";
    ctx.beginPath();
    ctx.ellipse(cx, base - h / 2 + bob, w, h / 2 + (down ? 0 : T * 0.06), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1c2a1f";
    const ey = base - h * 0.6 + bob;
    if (down) eyesX(ctx, cx, ey, T);
    else {
      ctx.fillRect(cx - T * 0.12, ey, T * 0.06, T * 0.08);
      ctx.fillRect(cx + T * 0.06, ey, T * 0.06, T * 0.08);
    }
  } else {
    if (down) {
      ctx.fillStyle = "#e8e4d6";
      ctx.fillRect(cx - T * 0.3, py + T * 0.72, T * 0.5, T * 0.07);
      ctx.fillRect(cx - T * 0.1, py + T * 0.62, T * 0.4, T * 0.06);
      ctx.beginPath();
      ctx.arc(cx + T * 0.22, py + T * 0.78, T * 0.13, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#222";
      eyesX(ctx, cx + T * 0.22, py + T * 0.76, T * 0.7);
    } else {
      const bob = Math.sin(time * 3 + th.pos.y) * T * 0.02;
      ctx.fillStyle = "#e8e4d6";
      ctx.fillRect(cx - T * 0.04, py + T * 0.42 + bob, T * 0.08, T * 0.3);
      ctx.fillRect(cx - T * 0.18, py + T * 0.5 + bob, T * 0.36, T * 0.05);
      ctx.fillRect(cx - T * 0.14, py + T * 0.72, T * 0.06, T * 0.16);
      ctx.fillRect(cx + T * 0.08, py + T * 0.72, T * 0.06, T * 0.16);
      ctx.beginPath();
      ctx.arc(cx, py + T * 0.3 + bob, T * 0.16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#222";
      ctx.fillRect(cx - T * 0.09, py + T * 0.27 + bob, T * 0.06, T * 0.06);
      ctx.fillRect(cx + T * 0.03, py + T * 0.27 + bob, T * 0.06, T * 0.06);
    }
  }
  ctx.globalAlpha = 1;
  if (reviving) {
    // 起き上がるまでの残り
    const p = 1 - th.reviveLeft / 8;
    ctx.strokeStyle = "#9fe7ff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, py + T * 0.5, T * 0.42, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#f4f0c8";
    ctx.fillRect(cx - T * 0.08, py + T * 0.05, T * 0.16, T * 0.2);
  }
}

function eyesX(ctx: CanvasRenderingContext2D, cx: number, cy: number, T: number) {
  ctx.strokeStyle = ctx.fillStyle as string;
  ctx.lineWidth = Math.max(1, T * 0.04);
  for (const ox of [-T * 0.09, T * 0.09]) {
    ctx.beginPath();
    ctx.moveTo(cx + ox - T * 0.04, cy - T * 0.04);
    ctx.lineTo(cx + ox + T * 0.04, cy + T * 0.04);
    ctx.moveTo(cx + ox + T * 0.04, cy - T * 0.04);
    ctx.lineTo(cx + ox - T * 0.04, cy + T * 0.04);
    ctx.stroke();
  }
}

function blob(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, seed: number) {
  ctx.beginPath();
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const rr = r * (0.7 + 0.3 * Math.abs(Math.sin(seed + i * 1.7)));
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr * 0.7;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.fill();
}

function drawJanitor(ctx: CanvasRenderingContext2D, g: Game, T: number, time: number) {
  const j = g.janitor;
  const cx = j.px * T + T / 2;
  const by = j.py * T + T * 0.9;
  const moving = j.path.length > 0;
  const bob = moving ? Math.abs(Math.sin(time * 14)) * T * 0.05 : 0;
  // モップ
  ctx.strokeStyle = "#a07850";
  ctx.lineWidth = Math.max(2, T * 0.05);
  ctx.beginPath();
  ctx.moveTo(cx + T * 0.24, by - T * 0.62 - bob);
  ctx.lineTo(cx + T * 0.3, by - T * 0.05);
  ctx.stroke();
  ctx.fillStyle = "#e0dccb";
  ctx.fillRect(cx + T * 0.18, by - T * 0.1, T * 0.24, T * 0.1);
  // 体
  ctx.fillStyle = "#3f7fd1";
  ctx.fillRect(cx - T * 0.17, by - T * 0.45 - bob, T * 0.34, T * 0.38);
  ctx.fillStyle = "#2b2b2b";
  ctx.fillRect(cx - T * 0.14, by - T * 0.08, T * 0.1, T * 0.08);
  ctx.fillRect(cx + T * 0.04, by - T * 0.08, T * 0.1, T * 0.08);
  // 頭と帽子
  ctx.fillStyle = "#f2c9a0";
  ctx.beginPath();
  ctx.arc(cx, by - T * 0.58 - bob, T * 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#2f5f9e";
  ctx.fillRect(cx - T * 0.17, by - T * 0.76 - bob, T * 0.34, T * 0.1);
  ctx.fillStyle = "#222";
  ctx.fillRect(cx - T * 0.07, by - T * 0.6 - bob, T * 0.04, T * 0.04);
  ctx.fillRect(cx + T * 0.03, by - T * 0.6 - bob, T * 0.04, T * 0.04);

  if (j.work) {
    const p = 1 - j.work.left / j.work.total;
    const w = T * 0.8;
    const x0 = cx - w / 2;
    const y0 = by - T * 1.0;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(x0, y0, w, T * 0.12);
    ctx.fillStyle = "#8ef08e";
    ctx.fillRect(x0 + 1, y0 + 1, (w - 2) * p, T * 0.12 - 2);
  }
}

function drawHero(ctx: CanvasRenderingContext2D, px: number, py: number, T: number, time: number) {
  const cx = px + T / 2;
  const by = py + T * 0.9;
  const bob = Math.abs(Math.sin(time * 10)) * T * 0.04;
  ctx.fillStyle = "#b8312f";
  ctx.beginPath();
  ctx.moveTo(cx - T * 0.22, by - T * 0.1);
  ctx.lineTo(cx, by - T * 0.5 - bob);
  ctx.lineTo(cx + T * 0.22, by - T * 0.1);
  ctx.fill();
  ctx.fillStyle = "#c9cdd6";
  ctx.fillRect(cx - T * 0.15, by - T * 0.45 - bob, T * 0.3, T * 0.35);
  ctx.fillStyle = "#f2c9a0";
  ctx.beginPath();
  ctx.arc(cx, by - T * 0.58 - bob, T * 0.14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#e0b33a";
  ctx.fillRect(cx - T * 0.16, by - T * 0.76 - bob, T * 0.32, T * 0.09);
  ctx.fillRect(cx - T * 0.03, by - T * 0.82 - bob, T * 0.06, T * 0.08);
  ctx.strokeStyle = "#e6e9ef";
  ctx.lineWidth = Math.max(2, T * 0.05);
  ctx.beginPath();
  ctx.moveTo(cx + T * 0.2, by - T * 0.3 - bob);
  ctx.lineTo(cx + T * 0.36, by - T * 0.72 - bob);
  ctx.stroke();
}

function drawBubble(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, T: number, tone: string, alpha: number) {
  ctx.globalAlpha = alpha;
  ctx.font = `bold ${Math.max(11, Math.round(T * 0.34))}px ${FONT}`;
  const w = ctx.measureText(text).width + T * 0.3;
  const h = T * 0.48;
  const W = ctx.canvas.width / (window.devicePixelRatio || 1);
  const left = Math.max(2, Math.min(W - w - 2, x - w / 2));
  const top = Math.max(2, y - h);
  ctx.fillStyle = tone === "good" ? "#fff6c9" : tone === "bad" ? "#ffd9d6" : "#ffffff";
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(left, top, w, h, h / 3);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#222";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, left + w / 2, top + h / 2 + 1);
  ctx.globalAlpha = 1;
}

// 設計図：本来あるべき姿だけを、青焼きの線画で描く
function drawBlueprint(ctx: CanvasRenderingContext2D, g: Game, T: number) {
  const { bp } = g;
  ctx.fillStyle = C.blueprint;
  ctx.fillRect(0, 0, bp.width * T, bp.height * T);
  ctx.strokeStyle = C.blueFaint;
  ctx.lineWidth = 1;
  for (let x = 0; x <= bp.width; x++) line(ctx, x * T, 0, x * T, bp.height * T);
  for (let y = 0; y <= bp.height; y++) line(ctx, 0, y * T, bp.width * T, y * T);

  ctx.strokeStyle = C.blueLine;
  ctx.lineWidth = 2;
  for (let y = 0; y < bp.height; y++) {
    for (let x = 0; x < bp.width; x++) {
      if (bp.tiles[y][x] !== "wall") continue;
      for (const [dx, dy, x1, y1, x2, y2] of [
        [1, 0, 1, 0, 1, 1],
        [-1, 0, 0, 0, 0, 1],
        [0, 1, 0, 1, 1, 1],
        [0, -1, 0, 0, 1, 0],
      ] as const) {
        const n = bp.tiles[y + dy]?.[x + dx];
        if (n && n !== "wall") line(ctx, (x + x1) * T, (y + y1) * T, (x + x2) * T, (y + y2) * T);
      }
    }
  }

  ctx.fillStyle = C.blueLine;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const label = (x: number, y: number, s: string, size = 0.36) => {
    ctx.font = `bold ${Math.round(T * size)}px ${FONT}`;
    ctx.fillText(s, (x + 0.5) * T, (y + 0.52) * T);
  };
  bp.tiles.forEach((row, y) =>
    row.forEach((t, x) => {
      if (t === "door") {
        ctx.strokeRect(x * T + T * 0.15, y * T + T * 0.1, T * 0.7, T * 0.8);
        // 今壊れている扉は、設計図では普通に描くだけ（見比べて探す）
      }
      if (t === "shelf") label(x, y, "棚", 0.3);
      if (t === "hidden") {
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(x * T + T * 0.2, y * T + T * 0.15, T * 0.6, T * 0.7);
        ctx.setLineDash([]);
      }
    }),
  );
  for (const o of bp.objects) {
    const { x, y } = o.pos;
    if (o.kind === "monster") {
      ctx.beginPath();
      ctx.arc((x + 0.5) * T, (y + 0.5) * T, T * 0.36, 0, Math.PI * 2);
      ctx.stroke();
      label(x, y, o.monster === "slime" ? "ス" : "骨", 0.34);
    } else if (o.kind === "chest") {
      ctx.strokeRect(x * T + T * 0.1, y * T + T * 0.2, T * 0.8, T * 0.6);
      label(x, y, TREASURE_SHORT[o.treasure], 0.38);
    } else if (o.kind === "trap") {
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(x * T + T * 0.15, y * T + T * 0.15, T * 0.7, T * 0.7);
      ctx.setLineDash([]);
      label(x, y, "罠", 0.3);
    } else {
      label(x, y, "灯", 0.32);
    }
  }
  // 部屋の名前と、勇者が通る順
  ctx.fillStyle = "rgba(255,211,77,0.95)";
  for (const r of bp.rooms) {
    const tiles = r.tiles.filter((p) => p.x !== bp.stairs.x || p.y !== bp.stairs.y);
    const top = tiles.reduce((a, p) => (p.y < a.y || (p.y === a.y && p.x < a.x) ? p : a));
    ctx.font = `bold ${Math.round(T * 0.26)}px ${FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const name = r.staff ? "職員通路" : `${r.order + 1}. ${r.name}`;
    if (!r.staff) ctx.fillText(name, top.x * T + 3, top.y * T + 2);
  }
  ctx.fillStyle = C.blueLine;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  label(bp.entrance.x, bp.entrance.y, "入口", 0.26);
  label(bp.stairs.x, bp.stairs.y, "階段", 0.26);

  // 清掃員の現在地だけは出しておく
  const j = g.janitor;
  ctx.fillStyle = "#ffd34d";
  ctx.beginPath();
  ctx.arc((j.px + 0.5) * T, (j.py + 0.5) * T, T * 0.16, 0, Math.PI * 2);
  ctx.fill();
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

