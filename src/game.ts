import {
  type Blueprint,
  type MonsterKind,
  type Pos,
  type TreasureKind,
  findPath,
  isWalkable,
  neighbors,
  samePos,
} from "./map";
import { mulberry32, shuffle } from "./rng";

export type Item = "charm" | "plank" | TreasureKind;

export const ITEM_LABEL: Record<Item, string> = {
  charm: "蘇生札",
  plank: "板",
  herb: "薬草",
  sword: "銀の剣",
  gold: "金貨",
};

export const STORAGE_ITEMS: Item[] = ["charm", "plank", "herb", "sword", "gold"];
export const CARRY_LIMIT = 3;
export const SHIFT_SECONDS = 100;

const WALK_SPEED = 5; // マス/秒
const HERO_SPEED = 4;
const REVIVE_SECONDS = 8;

const WORK_SECONDS = {
  charm: 0.8,
  chest: 1.0,
  trap: 1.5,
  torch: 0.5,
  stain: 1.2,
  door: 2.0,
};

export type Thing =
  | { kind: "monster"; pos: Pos; monster: MonsterKind; state: "standing" | "down" | "reviving"; reviveLeft: number; damaged: boolean }
  | { kind: "chest"; pos: Pos; expected: TreasureKind; content: TreasureKind | null; open: boolean; damaged: boolean }
  | { kind: "trap"; pos: Pos; armed: boolean; damaged: boolean }
  | { kind: "torch"; pos: Pos; lit: boolean; damaged: boolean }
  | { kind: "stain"; pos: Pos; stain: "blood" | "scorch" | "graffiti"; cleaned: boolean; damaged: boolean }
  | { kind: "door"; pos: Pos; broken: boolean; damaged: boolean };

export type Task = { pos: Pos };

export type Bubble = { text: string; x: number; y: number; life: number; tone: "info" | "good" | "bad" };

export type Judgement = { ok: boolean; text: string };

type Walker = {
  pos: Pos;
  px: number;
  py: number;
  path: Pos[];
  step: number; // 次のマスへの進み具合 0..1
};

export type Janitor = Walker & {
  inv: Item[];
  queue: Task[];
  work: { left: number; total: number; done: () => void } | null;
  arrivedFor: Task | null;
  pathFor: Task | null;
};

export type Hero = Walker & {
  wait: number;
  seen: Set<Thing>;
  fighting: Thing | null;
  goal: Thing | null;
  endIn: number | null; // 階段に着いてから結果画面までの間
};

export type Phase = "intro" | "shift" | "hero" | "result";

export type Game = {
  bp: Blueprint;
  seed: number;
  phase: Phase;
  timeLeft: number;
  things: Thing[];
  janitor: Janitor;
  hero: Hero | null;
  bubbles: Bubble[];
  judgements: Judgement[];
  storageOpen: boolean;
  heroSpeed: number;
};

function walker(pos: Pos): Walker {
  return { pos: { ...pos }, px: pos.x, py: pos.y, path: [], step: 0 };
}

// 前の勇者が通ったあとの荒れ方を作る
function wreck(bp: Blueprint, rand: () => number): Thing[] {
  const things: Thing[] = [];
  for (const o of bp.objects) {
    if (o.kind === "monster") {
      things.push({ kind: "monster", pos: o.pos, monster: o.monster, state: "down", reviveLeft: 0, damaged: true });
    } else if (o.kind === "chest") {
      const looted = rand() < 0.8;
      things.push({ kind: "chest", pos: o.pos, expected: o.treasure, content: looted ? null : o.treasure, open: looted, damaged: looted });
    } else if (o.kind === "trap") {
      const sprung = rand() < 0.7;
      things.push({ kind: "trap", pos: o.pos, armed: !sprung, damaged: sprung });
    } else {
      const out = rand() < 0.5;
      things.push({ kind: "torch", pos: o.pos, lit: !out, damaged: out });
    }
  }

  const doors: Pos[] = [];
  bp.tiles.forEach((row, y) => row.forEach((t, x) => t === "door" && doors.push({ x, y })));
  const brokenDoors = new Set(shuffle(doors, rand).slice(0, 2));
  for (const d of doors) things.push({ kind: "door", pos: d, broken: brokenDoors.has(d), damaged: brokenDoors.has(d) });

  // 汚れは、何も置いていない床にだけ付ける
  const occupied = (p: Pos) =>
    things.some((t) => samePos(t.pos, p)) || samePos(p, bp.stairs) || samePos(p, bp.entrance) || samePos(p, bp.start);
  const freeFloor: Pos[] = [];
  bp.tiles.forEach((row, y) =>
    row.forEach((t, x) => {
      if (t === "floor" && !occupied({ x, y }) && y > 4) freeFloor.push({ x, y });
    }),
  );
  const taken = new Set<string>();
  const addStain = (p: Pos, stain: "blood" | "scorch" | "graffiti") => {
    const k = `${p.x},${p.y}`;
    if (taken.has(k) || occupied(p)) return;
    taken.add(k);
    things.push({ kind: "stain", pos: p, stain, cleaned: false, damaged: true });
  };
  for (const m of things.filter((t) => t.kind === "monster")) {
    if (rand() < 0.5) {
      const spots = neighbors(m.pos).filter((p) => isWalkable(bp, p) && bp.tiles[p.y][p.x] === "floor");
      if (spots.length) addStain(spots[Math.floor(rand() * spots.length)], "blood");
    }
  }
  const rest = shuffle(freeFloor, rand);
  rest.slice(0, 3).forEach((p) => addStain(p, "scorch"));
  rest.slice(3, 5).forEach((p) => addStain(p, "graffiti"));
  return things;
}

export function newGame(bp: Blueprint, seed: number): Game {
  const janitor: Janitor = { ...walker(bp.start), inv: [], queue: [], work: null, arrivedFor: null, pathFor: null };
  return {
    bp,
    seed,
    phase: "intro",
    timeLeft: SHIFT_SECONDS,
    things: wreck(bp, mulberry32(seed)),
    janitor,
    hero: null,
    bubbles: [],
    judgements: [],
    storageOpen: false,
    heroSpeed: 1,
  };
}

export const thingsAt = (g: Game, p: Pos) => g.things.filter((t) => samePos(t.pos, p));

// モンスターと宝箱はその上を歩けない
function isBlocking(g: Game, p: Pos): boolean {
  return g.things.some((t) => (t.kind === "monster" || t.kind === "chest") && samePos(t.pos, p));
}

export function needsWork(t: Thing): boolean {
  switch (t.kind) {
    case "monster":
      return t.state === "down";
    case "chest":
      return t.open;
    case "trap":
      return !t.armed;
    case "torch":
      return !t.lit;
    case "stain":
      return !t.cleaned;
    case "door":
      return t.broken;
  }
}

function say(g: Game, p: { x: number; y: number }, text: string, tone: Bubble["tone"] = "info") {
  g.bubbles.push({ text, x: p.x, y: p.y, life: 1.6, tone });
}

// 目的のマスに作業しに行くとき、どこに立つか
function standPositions(g: Game, target: Pos): Pos[] {
  const tile = g.bp.tiles[target.y]?.[target.x];
  if (tile === "shelf" || isBlocking(g, target)) {
    return neighbors(target).filter((p) => isWalkable(g.bp, p) && !isBlocking(g, p));
  }
  return isWalkable(g.bp, target) ? [target] : [];
}

function routeTo(g: Game, from: Pos, target: Pos): Pos[] | null {
  let best: Pos[] | null = null;
  for (const s of standPositions(g, target)) {
    const path = findPath(g.bp, from, s, (p) => isBlocking(g, p));
    if (path && (!best || path.length < best.length)) best = path;
  }
  return best;
}

export function enqueue(g: Game, pos: Pos): boolean {
  const j = g.janitor;
  if (g.phase !== "shift") return false;
  const already = j.queue.findIndex((t) => samePos(t.pos, pos));
  if (already >= 0) {
    j.queue.splice(already, 1);
    return true;
  }
  if (j.queue.length >= 6) {
    say(g, j.pos, "予定がいっぱい", "bad");
    return false;
  }
  if (!routeTo(g, j.pos, pos) && standPositions(g, pos).length === 0) return false;
  j.queue.push({ pos });
  return true;
}

export function clearQueue(g: Game) {
  g.janitor.queue = [];
  g.janitor.path = [];
}

// 着いたマスで、そのとき必要な作業をする
function doWorkAt(g: Game, target: Pos) {
  const j = g.janitor;
  if (g.bp.tiles[target.y][target.x] === "shelf") {
    g.storageOpen = true;
    return;
  }
  const todo = thingsAt(g, target).find(needsWork);
  if (!todo) return;
  const take = (item: Item | null): boolean => {
    if (!item) return false;
    const i = j.inv.indexOf(item);
    if (i < 0) return false;
    j.inv.splice(i, 1);
    return true;
  };
  const start = (seconds: number, done: () => void) => {
    j.work = { left: seconds, total: seconds, done };
  };

  switch (todo.kind) {
    case "monster":
      if (!take("charm")) return say(g, target, "蘇生札がない", "bad");
      return start(WORK_SECONDS.charm, () => {
        todo.state = "reviving";
        todo.reviveLeft = REVIVE_SECONDS;
      });
    case "chest": {
      const treasures = j.inv.filter((i): i is TreasureKind => i === "herb" || i === "sword" || i === "gold");
      const pick = treasures.includes(todo.expected) ? todo.expected : treasures[0] ?? null;
      if (!take(pick)) return say(g, target, "中身を持ってない", "bad");
      return start(WORK_SECONDS.chest, () => {
        todo.content = pick;
        todo.open = false;
      });
    }
    case "trap":
      return start(WORK_SECONDS.trap, () => (todo.armed = true));
    case "torch":
      return start(WORK_SECONDS.torch, () => (todo.lit = true));
    case "stain":
      return start(WORK_SECONDS.stain, () => (todo.cleaned = true));
    case "door":
      if (!take("plank")) return say(g, target, "板がない", "bad");
      return start(WORK_SECONDS.door, () => (todo.broken = false));
  }
}

export function takeItem(g: Game, item: Item) {
  const j = g.janitor;
  if (j.inv.length >= CARRY_LIMIT) return;
  j.inv.push(item);
}

export function putBack(g: Game, index: number) {
  g.janitor.inv.splice(index, 1);
}

// 1 マスずつ歩く。歩き終えたら true
function advance(w: Walker, speed: number, dt: number, onStep?: (p: Pos) => void): boolean {
  if (!w.path.length) {
    w.px = w.pos.x;
    w.py = w.pos.y;
    return true;
  }
  w.step += speed * dt;
  while (w.step >= 1 && w.path.length) {
    w.step -= 1;
    w.pos = w.path.shift()!;
    onStep?.(w.pos);
  }
  if (!w.path.length) {
    w.step = 0;
    w.px = w.pos.x;
    w.py = w.pos.y;
    return true;
  }
  const next = w.path[0];
  w.px = w.pos.x + (next.x - w.pos.x) * w.step;
  w.py = w.pos.y + (next.y - w.pos.y) * w.step;
  return false;
}

function updateJanitor(g: Game, dt: number) {
  const j = g.janitor;
  if (g.storageOpen) return;
  if (j.work) {
    j.work.left -= dt;
    if (j.work.left <= 0) {
      j.work.done();
      j.work = null;
    }
    return;
  }
  const task = j.queue[0];
  if (!task) {
    advance(j, WALK_SPEED, dt);
    return;
  }
  if (j.arrivedFor !== task) {
    // 予定が入れ替わったら経路を引き直す
    if (j.pathFor !== task) {
      const route = routeTo(g, j.pos, task.pos);
      if (!route) {
        say(g, task.pos, "行けない", "bad");
        j.queue.shift();
        return;
      }
      j.path = route;
      j.step = 0;
      j.pathFor = task;
    }
    if (advance(j, WALK_SPEED, dt)) j.arrivedFor = task;
    return;
  }
  j.queue.shift();
  j.arrivedFor = null;
  doWorkAt(g, task.pos);
}

function updateMonsters(g: Game, dt: number) {
  for (const t of g.things) {
    if (t.kind === "monster" && t.state === "reviving") {
      t.reviveLeft -= dt;
      if (t.reviveLeft <= 0) t.state = "standing";
    }
  }
}

const TREASURE_RANK: Record<TreasureKind, number> = { herb: 0, sword: 1, gold: 2 };

// 勇者が入る直前の状態で、仕事の出来を決める
export function judge(g: Game): Judgement[] {
  const out: Judgement[] = [];
  for (const t of g.things) {
    if (!t.damaged) continue;
    switch (t.kind) {
      case "monster":
        if (t.state === "standing") out.push({ ok: true, text: `${monsterName(t.monster)}が元気に出迎えた` });
        else if (t.state === "reviving") out.push({ ok: false, text: `${monsterName(t.monster)}が半分起きたまま倒された` });
        else out.push({ ok: false, text: `${monsterName(t.monster)}が最初から倒れていた` });
        break;
      case "chest":
        if (t.open) out.push({ ok: false, text: "宝箱が空っぽだった" });
        else if (t.content === t.expected) out.push({ ok: true, text: `宝箱から${ITEM_LABEL[t.expected]}が出た` });
        else if (t.content && TREASURE_RANK[t.content] < TREASURE_RANK[t.expected])
          out.push({ ok: false, text: `この深さで${ITEM_LABEL[t.content]}はしょぼい` });
        else out.push({ ok: false, text: `浅い階で${ITEM_LABEL[t.content!]}は気前が良すぎる（経費が赤字）` });
        break;
      case "trap":
        out.push(t.armed ? { ok: true, text: "罠にきれいに引っかかった" } : { ok: false, text: "罠がもう作動していた" });
        break;
      case "torch":
        out.push(t.lit ? { ok: true, text: "松明が灯っていた" } : { ok: false, text: "暗くて足元が見えなかった" });
        break;
      case "stain":
        if (t.cleaned) out.push({ ok: true, text: "床がきれいだった" });
        else
          out.push({
            ok: false,
            text: t.stain === "blood" ? "血のあとがあった。先客がいる？" : t.stain === "scorch" ? "焦げあとが残っていた" : "「勇者参上」の落書きがあった",
          });
        break;
      case "door":
        out.push(t.broken ? { ok: false, text: "扉が壊れたままだった" } : { ok: true, text: "扉が直っていた" });
        break;
    }
  }
  return out;
}

export function monsterName(m: MonsterKind) {
  return m === "slime" ? "スライム" : "がいこつ";
}

export function score(g: Game) {
  const total = g.judgements.length;
  const good = g.judgements.filter((j) => j.ok).length;
  const rate = total ? good / total : 1;
  const stars = rate >= 0.95 ? 3 : rate >= 0.8 ? 2 : rate >= 0.6 ? 1 : 0;
  return { total, good, rate, stars, pay: good * 10 + stars * 30 };
}

// ---- 勇者 ----

export function startHero(g: Game) {
  g.phase = "hero";
  g.storageOpen = false;
  g.janitor.queue = [];
  g.janitor.path = [];
  g.janitor.work = null;
  g.judgements = judge(g);
  // 清掃員は倉庫に戻って物陰から見守る
  g.janitor.pos = { ...g.bp.start };
  g.janitor.px = g.bp.start.x;
  g.janitor.py = g.bp.start.y;
  g.hero = { ...walker(g.bp.entrance), wait: 0.8, seen: new Set(), fighting: null, goal: null, endIn: null };
  say(g, g.bp.entrance, "たのもう！", "info");
}

// 勇者がそのマスに入ったときの反応
function heroStep(g: Game, h: Hero, p: Pos) {
  for (const t of thingsAt(g, p)) {
    if (h.seen.has(t)) continue;
    if (t.kind === "trap") {
      h.seen.add(t);
      if (t.armed) {
        say(g, p, "うわっ！", "good");
        t.armed = false;
        h.wait = 0.9;
      } else say(g, p, "罠、作動済み…", "bad");
    } else if (t.kind === "torch") {
      h.seen.add(t);
      if (!t.lit) say(g, p, "暗いな…", "bad");
    } else if (t.kind === "stain") {
      h.seen.add(t);
      if (!t.cleaned) say(g, p, t.stain === "graffiti" ? "勇者参上…？" : t.stain === "blood" ? "先客がいる？" : "焦げてる…", "bad");
    } else if (t.kind === "door") {
      h.seen.add(t);
      if (t.broken) say(g, p, "扉が壊れてる", "bad");
    }
  }
}

// 勇者がモンスターや宝箱の前に来たときの反応
function heroMeet(g: Game, h: Hero, t: Thing) {
  h.seen.add(t);
  if (t.kind === "monster") {
    if (t.state === "standing") {
      say(g, t.pos, "手ごたえあり！", "good");
      h.fighting = t;
      h.wait = 1.2;
    } else if (t.state === "reviving") {
      say(g, t.pos, "…起きかけ？", "bad");
      t.state = "down";
      h.wait = 0.6;
    } else {
      say(g, t.pos, "もう倒れてる…", "bad");
      h.wait = 0.5;
    }
  } else if (t.kind === "chest") {
    if (t.open) say(g, t.pos, "空っぽ…", "bad");
    else if (t.content === t.expected) say(g, t.pos, `${ITEM_LABEL[t.expected]}だ！`, "good");
    else if (t.content && TREASURE_RANK[t.content] < TREASURE_RANK[t.expected]) say(g, t.pos, "しょぼい…", "bad");
    else say(g, t.pos, "大当たり！？", "good");
    t.open = true;
    h.wait = 0.7;
  }
}

function nextHeroTarget(g: Game, h: Hero): { thing: Thing | null; path: Pos[] } | null {
  let best: { thing: Thing | null; path: Pos[] } | null = null;
  for (const t of g.things) {
    if (h.seen.has(t)) continue;
    if (t.kind === "door" && !t.broken) continue;
    if (t.kind === "stain" && t.cleaned) continue;
    const path = routeTo(g, h.pos, t.pos);
    if (path && (!best || path.length < best.path.length)) best = { thing: t, path };
  }
  if (best) return best;
  const path = findPath(g.bp, h.pos, g.bp.stairs, (p) => isBlocking(g, p));
  return path ? { thing: null, path } : null;
}

function updateHero(g: Game, dt: number) {
  const h = g.hero;
  if (!h) return;
  if (h.endIn !== null) {
    h.endIn -= dt;
    if (h.endIn <= 0) g.phase = "result";
    return;
  }
  if (h.wait > 0) {
    h.wait -= dt;
    if (h.wait <= 0 && h.fighting && h.fighting.kind === "monster") {
      h.fighting.state = "down";
      h.fighting = null;
    }
    return;
  }
  if (!h.path.length) {
    if (samePos(h.pos, g.bp.stairs)) {
      say(g, h.pos, "次の階へ！", "info");
      h.endIn = 1.2;
      return;
    }
    const next = nextHeroTarget(g, h);
    if (!next) {
      h.endIn = 0.8;
      return;
    }
    h.path = next.path;
    h.goal = next.thing;
    if (!next.path.length && next.thing) heroArrive(g, h, next.thing);
    return;
  }
  const arrived = advance(h, HERO_SPEED, dt, (p) => heroStep(g, h, p));
  if (arrived) {
    if (h.goal) heroArrive(g, h, h.goal);
  }
}

function heroArrive(g: Game, h: Hero, t: Thing) {
  if (t.kind === "monster" || t.kind === "chest") heroMeet(g, h, t);
  else h.seen.add(t);
  h.goal = null;
}

export function update(g: Game, dt: number) {
  g.bubbles = g.bubbles.filter((b) => (b.life -= dt) > 0);
  if (g.phase === "shift") {
    g.timeLeft -= dt;
    updateMonsters(g, dt);
    updateJanitor(g, dt);
    if (g.timeLeft <= 0) {
      g.timeLeft = 0;
      startHero(g);
    }
  } else if (g.phase === "hero") {
    const steps = g.heroSpeed;
    for (let i = 0; i < steps; i++) updateHero(g, dt);
  }
}

export function remainingWork(g: Game): number {
  return g.things.filter(needsWork).length;
}
