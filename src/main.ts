import "./style.css";
import {
  CARRY_LIMIT,
  ITEM_LABEL,
  STORAGE_ITEMS,
  type Game,
  clearQueue,
  enqueue,
  newGame,
  putBack,
  remainingWork,
  score,
  startHero,
  takeItem,
  update,
} from "./game";
import { loadBlueprint } from "./map";
import { render } from "./render";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>("board");
const ctx = canvas.getContext("2d")!;
const stage = $("stage");
const bp = loadBlueprint();

let game: Game = newGame(bp, randomSeed());
let tile = 32;
let showBlueprint = false;

function randomSeed() {
  return Math.floor(Math.random() * 2 ** 31);
}

// ---- 画面の大きさ ----

function resize() {
  const w = stage.clientWidth - 12;
  const h = stage.clientHeight - 12;
  tile = Math.max(16, Math.floor(Math.min(w / bp.width, h / bp.height)));
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${tile * bp.width}px`;
  canvas.style.height = `${tile * bp.height}px`;
  canvas.width = tile * bp.width * dpr;
  canvas.height = tile * bp.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
new ResizeObserver(resize).observe(stage);

// ---- 入力 ----

canvas.addEventListener("pointerdown", (e) => {
  if (game.phase !== "shift" || game.storageOpen) return;
  const r = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - r.left) / tile);
  const y = Math.floor((e.clientY - r.top) / tile);
  if (x < 0 || y < 0 || x >= bp.width || y >= bp.height) return;
  enqueue(game, { x, y });
});

$("btn-blueprint").addEventListener("click", () => {
  showBlueprint = !showBlueprint;
  $("btn-blueprint").classList.toggle("on", showBlueprint);
});
$("btn-clear").addEventListener("click", () => clearQueue(game));
$("btn-hero").addEventListener("click", () => {
  if (game.phase === "shift") startHero(game);
});
$("btn-speed").addEventListener("click", () => {
  game.heroSpeed = game.heroSpeed === 1 ? 3 : 1;
});
$("btn-start").addEventListener("click", () => {
  $("intro").hidden = true;
  game.phase = "shift";
});
$("btn-storage-close").addEventListener("click", () => (game.storageOpen = false));
$("btn-retry").addEventListener("click", () => restart(game.seed));
$("btn-next").addEventListener("click", () => restart(randomSeed()));

function restart(seed: number) {
  game = newGame(bp, seed);
  game.phase = "shift";
  showBlueprint = false;
  $("btn-blueprint").classList.remove("on");
  resultShown = false;
}

// ---- 倉庫 ----

let storageKey = "";
function renderStorage() {
  const inv = game.janitor.inv;
  const key = `${game.storageOpen}|${inv.join(",")}`;
  if (key === storageKey) return;
  storageKey = key;
  $("storage").hidden = !game.storageOpen;
  if (!game.storageOpen) return;
  const shelf = $("shelf");
  shelf.replaceChildren(
    ...STORAGE_ITEMS.map((item) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = ITEM_LABEL[item];
      b.disabled = inv.length >= CARRY_LIMIT;
      b.addEventListener("click", () => takeItem(game, item));
      return b;
    }),
  );
  const carry = $("carry");
  carry.replaceChildren(
    ...Array.from({ length: CARRY_LIMIT }, (_, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = inv[i] ? `${ITEM_LABEL[inv[i]]} を戻す` : "（空き）";
      b.disabled = !inv[i];
      b.addEventListener("click", () => putBack(game, i));
      return b;
    }),
  );
}

// ---- 上下の表示 ----

let hudKey = "";
function renderHud() {
  const t = Math.ceil(game.timeLeft);
  const key = `${t}|${remainingWork(game)}|${game.janitor.inv.join(",")}|${game.phase}|${game.heroSpeed}`;
  if (key === hudKey) return;
  hudKey = key;
  $("time").textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
  $("time").classList.toggle("hurry", t <= 20 && game.phase === "shift");
  $("work").textContent = String(remainingWork(game));
  $("inv").replaceChildren(
    ...Array.from({ length: CARRY_LIMIT }, (_, i) => {
      const s = document.createElement("span");
      const item = game.janitor.inv[i];
      s.className = item ? "slot" : "slot empty";
      s.textContent = item ? ITEM_LABEL[item] : "—";
      return s;
    }),
  );
  const inShift = game.phase === "shift";
  $("btn-blueprint").hidden = !inShift;
  $("btn-clear").hidden = !inShift;
  $("btn-hero").hidden = !inShift;
  $("btn-speed").hidden = game.phase !== "hero";
  $("btn-speed").textContent = `早送り ×${game.heroSpeed}`;
  if (!inShift && showBlueprint) {
    showBlueprint = false;
    $("btn-blueprint").classList.remove("on");
  }
}

let resultShown = false;
function renderResult() {
  const show = game.phase === "result";
  $("result").hidden = !show;
  if (!show || resultShown) return;
  resultShown = true;
  const s = score(game);
  $("stars").textContent = "★".repeat(s.stars) + "☆".repeat(3 - s.stars);
  $("summary").textContent = `直すべき ${s.total} か所のうち ${s.good} か所 OK。給料 ${s.pay} G`;
  const list = $("judgements");
  // 同じ感想はまとめて、ダメだったものを先に出す
  const counts = new Map<string, { ok: boolean; n: number }>();
  for (const j of game.judgements) {
    const c = counts.get(j.text) ?? { ok: j.ok, n: 0 };
    c.n++;
    counts.set(j.text, c);
  }
  const sorted = [...counts].sort((a, b) => Number(a[1].ok) - Number(b[1].ok) || b[1].n - a[1].n);
  list.replaceChildren(
    ...sorted.map(([text, c]) => {
      const li = document.createElement("li");
      li.className = c.ok ? "ok" : "ng";
      li.textContent = c.n > 1 ? `${text}（×${c.n}）` : text;
      return li;
    }),
  );
}

// ---- ループ ----

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  update(game, dt);
  render(ctx, game, tile, showBlueprint, now / 1000);
  renderHud();
  renderStorage();
  renderResult();
  requestAnimationFrame(frame);
}
resize();
requestAnimationFrame(frame);

// 動作確認用の窓口
Object.assign(window, {
  __dj: {
    get game() {
      return game;
    },
    tile: () => tile,
  },
});
