import {
  type Blueprint,
  type MonsterKind,
  type Pos,
  type Room,
  type TreasureKind,
  findPath,
  isWalkable,
  lineOfSight,
  neighbors,
  roomOf,
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
export const PREP_SECONDS = 90;
export const HERO_MAX_HP = 10;
export const REVIVE_SECONDS = 8;

const WALK_SPEED = 5; // マス/秒
const HERO_SPEED = 2.2;
const LANTERN = 2.6; // 清掃員のランタンが照らす半径
const TORCH_LIGHT = 3.6;
const HERO_LIGHT = 3.2;
const BOREDOM_PER_SEC = 1.6; // 何も起きないと下がるワクワク

const WORK_SECONDS = {
  charm: 0.8,
  clear: 1.2,
  chest: 1.0,
  trap: 1.5,
  torch: 0.5,
  stain: 1.2,
  door: 2.0,
};

export type Thing =
  | { kind: "monster"; pos: Pos; monster: MonsterKind; state: "standing" | "down" | "reviving" | "gone"; reviveLeft: number }
  | { kind: "chest"; pos: Pos; expected: TreasureKind; content: TreasureKind | null; open: boolean }
  | { kind: "trap"; pos: Pos; armed: boolean }
  | { kind: "torch"; pos: Pos; lit: boolean }
  | { kind: "stain"; pos: Pos; stain: "blood" | "scorch" | "graffiti"; cleaned: boolean }
  | { kind: "door"; pos: Pos; broken: boolean };

export type Task = { pos: Pos };

export type Bubble = { text: string; x: number; y: number; life: number; tone: "info" | "good" | "bad" };

export type LogLine = { ok: boolean; text: string };

// 前の勇者が残した「冒険の書」。部屋ごとに何をしたか
export type BookPage = { room: string; lines: string[]; torn: boolean };

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

export type Ending = "clear" | "down" | "bored";

export type Hero = Walker & {
  hp: number;
  fun: number;
  room: number; // 今いる部屋の、勇者の通る順
  wait: number;
  checked: Set<Thing>;
  enteredRooms: Set<number>;
  fighting: Thing | null;
  goal: Thing | null;
  caughtCooldown: number;
  ending: Ending | null;
  endIn: number;
};

export type Phase = "intro" | "prep" | "hero" | "result";

export type Game = {
  bp: Blueprint;
  seed: number;
  phase: Phase;
  timeLeft: number;
  things: Thing[];
  book: BookPage[];
  janitor: Janitor;
  hero: Hero | null;
  bubbles: Bubble[];
  log: LogLine[];
  caught: number;
  storageOpen: boolean;
  heroSpeed: number;
  visible: Uint8Array;
  seen: Uint8Array;
};

function walker(pos: Pos): Walker {
  return { pos: { ...pos }, px: pos.x, py: pos.y, path: [], step: 0 };
}

const monsterName = (m: MonsterKind) => (m === "slime" ? "スライム" : "がいこつ");
const times = (n: number) => (n > 1 ? `（${n}回）` : "");

// 前の勇者が通ったあとの荒れ方と、その冒険の書を作る
function wreck(bp: Blueprint, rand: () => number): { things: Thing[]; book: BookPage[] } {
  const things: Thing[] = [];
  for (const o of bp.objects) {
    if (o.kind === "monster") {
      const beaten = rand() < 0.85;
      things.push({ kind: "monster", pos: o.pos, monster: o.monster, state: beaten ? "down" : "standing", reviveLeft: 0 });
    } else if (o.kind === "chest") {
      const looted = rand() < 0.8;
      things.push({ kind: "chest", pos: o.pos, expected: o.treasure, content: looted ? null : o.treasure, open: looted });
    } else if (o.kind === "trap") {
      things.push({ kind: "trap", pos: o.pos, armed: rand() >= 0.6 });
    } else {
      things.push({ kind: "torch", pos: o.pos, lit: rand() >= 0.45 });
    }
  }

  // 扉は、勇者が入っていく側の部屋のものとして数える
  const doorRoom = new Map<string, number>();
  const doors: Pos[] = [];
  bp.tiles.forEach((row, y) =>
    row.forEach((t, x) => {
      if (t !== "door") return;
      const p = { x, y };
      doors.push(p);
      const orders = neighbors(p)
        .map((n) => roomOf(bp, n))
        .filter((r): r is Room => !!r && !r.staff)
        .map((r) => r.order);
      doorRoom.set(`${x},${y}`, Math.max(...orders));
    }),
  );
  const broken = new Set(shuffle(doors, rand).slice(0, 1 + Math.floor(rand() * 2)));
  for (const d of doors) things.push({ kind: "door", pos: d, broken: broken.has(d) });

  // 汚れは、何も置いていない勇者の部屋の床にだけ付ける
  const occupied = (p: Pos) => things.some((t) => samePos(t.pos, p)) || samePos(p, bp.stairs) || samePos(p, bp.entrance);
  const addStain = (p: Pos, stain: "blood" | "scorch" | "graffiti") => {
    if (occupied(p)) return false;
    things.push({ kind: "stain", pos: p, stain, cleaned: false });
    return true;
  };
  for (const m of things.filter((t) => t.kind === "monster" && t.state === "down")) {
    if (rand() < 0.4) {
      const spots = neighbors(m.pos).filter((p) => bp.tiles[p.y][p.x] === "floor");
      if (spots.length) addStain(spots[Math.floor(rand() * spots.length)], "blood");
    }
  }
  for (const r of bp.heroRooms) {
    const floor = shuffle(r.tiles, rand);
    const scorch = Math.floor(rand() * 2.2);
    let placed = 0;
    for (const p of floor) if (placed < scorch && addStain(p, "scorch")) placed++;
  }
  const graffitiRoom = bp.heroRooms[1 + Math.floor(rand() * (bp.heroRooms.length - 1))];
  for (const p of shuffle(graffitiRoom.tiles, rand)) if (addStain(p, "graffiti")) break;

  // 冒険の書
  const tornAt = 1 + Math.floor(rand() * (bp.heroRooms.length - 1));
  const book: BookPage[] = bp.heroRooms.map((r) => {
    const inRoom = things.filter((t) => roomOf(bp, t.pos)?.id === r.id);
    const lines: string[] = [];
    const doorsBroken = things.filter((t) => t.kind === "door" && t.broken && doorRoom.get(`${t.pos.x},${t.pos.y}`) === r.order);
    if (doorsBroken.length) lines.push("扉を蹴破って入った");
    for (const kind of ["slime", "skeleton"] as const) {
      const n = inRoom.filter((t) => t.kind === "monster" && t.monster === kind && t.state === "down").length;
      if (n) lines.push(`${monsterName(kind)}を${n > 1 ? `${n}体` : ""}倒した`);
    }
    const looted = inRoom.filter((t) => t.kind === "chest" && t.open).length;
    if (looted) lines.push(`宝箱を開けた${looted > 1 ? `（${looted}つ）` : ""}`);
    const sprung = inRoom.filter((t) => t.kind === "trap" && !t.armed).length;
    if (sprung) lines.push(`罠にかかった${times(sprung)}`);
    const out = inRoom.filter((t) => t.kind === "torch" && !t.lit).length;
    if (out) lines.push(`松明を蹴り倒した${out > 1 ? `（${out}本）` : ""}`);
    const stains = (s: string) => inRoom.filter((t) => t.kind === "stain" && t.stain === s).length;
    if (stains("blood")) lines.push(`派手に転んだ${times(stains("blood"))}`);
    if (stains("scorch")) lines.push(`火の魔法をぶっぱなした${times(stains("scorch"))}`);
    if (stains("graffiti")) lines.push("記念に落書きをした");
    if (!lines.length) lines.push("何もしなかった");
    return { room: r.name, lines, torn: r.order === tornAt };
  });

  return { things, book };
}

export function newGame(bp: Blueprint, seed: number): Game {
  const janitor: Janitor = { ...walker(bp.start), inv: [], queue: [], work: null, arrivedFor: null, pathFor: null };
  const { things, book } = wreck(bp, mulberry32(seed));
  const g: Game = {
    bp,
    seed,
    phase: "intro",
    timeLeft: PREP_SECONDS,
    things,
    book,
    janitor,
    hero: null,
    bubbles: [],
    log: [],
    caught: 0,
    storageOpen: false,
    heroSpeed: 1,
    visible: new Uint8Array(bp.width * bp.height),
    seen: new Uint8Array(bp.width * bp.height),
  };
  // 職員通路は最初から分かっている
  for (const r of bp.rooms) if (r.staff) for (const p of r.tiles) g.seen[p.y * bp.width + p.x] = 1;
  updateLight(g);
  return g;
}

export const thingsAt = (g: Game, p: Pos) => g.things.filter((t) => samePos(t.pos, p));

// モンスターと宝箱はその上を歩けない
function isBlocking(g: Game, p: Pos): boolean {
  return g.things.some(
    (t) => ((t.kind === "monster" && t.state !== "gone") || t.kind === "chest") && samePos(t.pos, p),
  );
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

// ---- 明かり ----

function updateLight(g: Game) {
  const { bp } = g;
  g.visible.fill(0);
  const light = (cx: number, cy: number, r: number) => {
    const c = { x: Math.round(cx), y: Math.round(cy) };
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if (x < 0 || y < 0 || x >= bp.width || y >= bp.height) continue;
        if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
        if (!lineOfSight(bp, c, { x, y })) continue;
        g.visible[y * bp.width + x] = 1;
      }
    }
  };
  light(g.janitor.px, g.janitor.py, LANTERN);
  for (const t of g.things) if (t.kind === "torch" && t.lit) light(t.pos.x, t.pos.y, TORCH_LIGHT);
  if (g.hero) light(g.hero.px, g.hero.py, HERO_LIGHT);
  for (let i = 0; i < g.visible.length; i++) if (g.visible[i]) g.seen[i] = 1;
}

// ---- 清掃員 ----

// 目的のマスに作業しに行くとき、どこに立つか
function standPositions(g: Game, target: Pos): Pos[] {
  const tile = g.bp.tiles[target.y]?.[target.x];
  if (tile === "shelf" || isBlocking(g, target)) {
    return neighbors(target).filter((p) => isWalkable(g.bp, p, true) && !isBlocking(g, p));
  }
  return isWalkable(g.bp, target, true) ? [target] : [];
}

function routeTo(g: Game, from: Pos, target: Pos, staff: boolean): Pos[] | null {
  let best: Pos[] | null = null;
  const stands = staff
    ? standPositions(g, target)
    : isBlocking(g, target)
      ? neighbors(target).filter((p) => isWalkable(g.bp, p, false) && !isBlocking(g, p))
      : [target];
  for (const s of stands) {
    const path = findPath(g.bp, from, s, staff, (p) => isBlocking(g, p));
    if (path && (!best || path.length < best.length)) best = path;
  }
  return best;
}

export function enqueue(g: Game, pos: Pos): boolean {
  const j = g.janitor;
  if (g.phase !== "prep" && g.phase !== "hero") return false;
  const already = j.queue.findIndex((t) => samePos(t.pos, pos));
  if (already >= 0) {
    j.queue.splice(already, 1);
    return true;
  }
  if (j.queue.length >= 6) {
    say(g, j.pos, "予定がいっぱい", "bad");
    return false;
  }
  if (standPositions(g, pos).length === 0) return false;
  j.queue.push({ pos });
  return true;
}

export function clearQueue(g: Game) {
  g.janitor.queue = [];
  g.janitor.path = [];
  g.janitor.pathFor = null;
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
      // 蘇生札がなければ、倒れた体を片付けるだけにする（勇者に見せないための手）
      if (!take("charm")) return start(WORK_SECONDS.clear, () => (todo.state = "gone"));
      return start(WORK_SECONDS.charm, () => {
        todo.state = "reviving";
        todo.reviveLeft = REVIVE_SECONDS;
      });
    case "chest": {
      const treasures = j.inv.filter((i): i is TreasureKind => i === "herb" || i === "sword" || i === "gold");
      const pick = treasures.includes(todo.expected) ? todo.expected : (treasures[0] ?? null);
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
      const route = routeTo(g, j.pos, task.pos, true);
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
  j.pathFor = null;
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

// ---- 勇者 ----

const TREASURE_RANK: Record<TreasureKind, number> = { herb: 0, sword: 1, gold: 2 };

export function startHero(g: Game) {
  g.phase = "hero";
  g.storageOpen = false;
  g.timeLeft = 0;
  g.hero = {
    ...walker(g.bp.entrance),
    hp: HERO_MAX_HP,
    fun: 60,
    room: 0,
    wait: 1,
    checked: new Set(),
    enteredRooms: new Set(),
    fighting: null,
    goal: null,
    caughtCooldown: 0,
    ending: null,
    endIn: 0,
  };
  say(g, g.bp.entrance, "たのもう！", "info");
  enterRoom(g, g.hero, 0);
}

// 勇者の反応。ワクワクと体力が動き、記録に残る
function react(g: Game, at: Pos, text: string, fun: number, hp = 0) {
  const h = g.hero!;
  h.fun = Math.max(0, Math.min(100, h.fun + fun));
  h.hp = Math.max(0, Math.min(HERO_MAX_HP, h.hp + hp));
  say(g, at, text, fun >= 0 ? "good" : "bad");
  g.log.push({ ok: fun >= 0, text });
}

// 部屋に入った瞬間に目に入るもの：暗さと汚れ
function enterRoom(g: Game, h: Hero, order: number) {
  if (h.enteredRooms.has(order)) return;
  h.enteredRooms.add(order);
  h.room = order;
  const room = g.bp.heroRooms[order];
  const inRoom = g.things.filter((t) => roomOf(g.bp, t.pos)?.id === room.id);
  const dark = inRoom.filter((t) => t.kind === "torch" && !t.lit).length;
  if (dark) react(g, h.pos, dark > 1 ? "真っ暗だ…" : "ちょっと暗いな", -6 * dark);
  for (const t of inRoom) {
    if (t.kind !== "stain" || t.cleaned) continue;
    h.checked.add(t);
    const text = t.stain === "graffiti" ? "「勇者参上」…先客？" : t.stain === "blood" ? "血のあと…先客？" : "焦げてる…先客？";
    react(g, t.pos, text, -5);
  }
}

function heroStep(g: Game, h: Hero, p: Pos) {
  const r = roomOf(g.bp, p);
  if (r && !r.staff && r.order > h.room) enterRoom(g, h, r.order);
  for (const t of thingsAt(g, p)) {
    if (h.checked.has(t)) continue;
    if (t.kind === "trap") {
      h.checked.add(t);
      if (t.armed) {
        t.armed = false;
        react(g, p, "うわっ、罠！", 8, -1);
        h.wait = 0.9;
      } else react(g, p, "罠、作動済み…", -5);
    } else if (t.kind === "door") {
      h.checked.add(t);
      if (t.broken) react(g, p, "扉が壊れてる", -6);
    }
  }
}

function heroMeet(g: Game, h: Hero, t: Thing) {
  h.checked.add(t);
  if (t.kind === "monster") {
    if (t.state === "standing") {
      const slime = t.monster === "slime";
      react(g, t.pos, slime ? "スライムだ！" : "がいこつだ！", slime ? 12 : 18, slime ? -1 : -2);
      h.fighting = t;
      h.wait = 1.2;
    } else if (t.state === "reviving") {
      react(g, t.pos, "…半分起きてる？", -6);
      t.state = "down";
      h.wait = 0.6;
    } else {
      react(g, t.pos, "もう倒れてる…", -6);
      h.wait = 0.5;
    }
  } else if (t.kind === "chest") {
    if (t.open) react(g, t.pos, "空っぽ…", -10);
    else if (t.content === t.expected) {
      if (t.content === "herb") react(g, t.pos, "薬草だ！助かる", 10, 3);
      else react(g, t.pos, `${ITEM_LABEL[t.content]}だ！`, t.content === "gold" ? 15 : 12);
    } else if (t.content && TREASURE_RANK[t.content] < TREASURE_RANK[t.expected]) {
      react(g, t.pos, t.content === "herb" ? "薬草…ここで？" : "しょぼい…", 2, t.content === "herb" ? 3 : 0);
    } else react(g, t.pos, "大当たり！？", 20);
    t.open = true;
    h.wait = 0.7;
  }
}

// 今の部屋でまだ見ていない物へ。見終えたら次の部屋の扉か、階段へ
function nextHeroGoal(g: Game, h: Hero): { thing: Thing | null; path: Pos[] } | null {
  const room = g.bp.heroRooms[h.room];
  let best: { thing: Thing | null; path: Pos[] } | null = null;
  for (const t of g.things) {
    if (h.checked.has(t)) continue;
    if (t.kind !== "monster" && t.kind !== "chest" && t.kind !== "trap") continue;
    if (t.kind === "monster" && t.state === "gone") continue;
    if (roomOf(g.bp, t.pos)?.id !== room.id) continue;
    const path = routeTo(g, h.pos, t.pos, false);
    if (path && (!best || path.length < best.path.length)) best = { thing: t, path };
  }
  if (best) return best;
  const next = g.bp.heroRooms[h.room + 1];
  const goal = next ? next.tiles.find((p) => neighbors(p).some((n) => g.bp.tiles[n.y]?.[n.x] === "door" && neighbors(n).some((m) => roomOf(g.bp, m)?.id === room.id))) : g.bp.stairs;
  if (!goal) return null;
  const path = findPath(g.bp, h.pos, goal, false, (p) => isBlocking(g, p));
  return path ? { thing: null, path } : null;
}

function finish(g: Game, h: Hero, ending: Ending) {
  h.ending = ending;
  h.endIn = 1.6;
  if (ending === "clear") {
    if (h.hp <= 3) react(g, h.pos, "ギリギリの冒険だった！", 15);
    say(g, h.pos, "次の階へ！", "info");
  } else if (ending === "down") say(g, h.pos, "ぐはっ…", "bad");
  else say(g, h.pos, "つまらん、帰る", "bad");
}

// 清掃員が勇者と同じ部屋にいたら見つかる（扉の上でも、すぐ近くなら見つかる）
function checkCaught(g: Game, h: Hero) {
  if (h.caughtCooldown > 0) return;
  const j = g.janitor;
  const jr = roomOf(g.bp, j.pos);
  const hr = roomOf(g.bp, h.pos);
  const near = Math.abs(j.px - h.px) + Math.abs(j.py - h.py) <= 2;
  const sameRoom = jr && hr && !jr.staff && jr.id === hr.id;
  if (!sameRoom && !(near && !jr?.staff)) return;
  if (!lineOfSight(g.bp, h.pos, j.pos)) return;
  g.caught++;
  h.caughtCooldown = 4;
  h.wait = Math.max(h.wait, 1);
  react(g, j.pos, "今の誰！？", -15);
  flee(g);
}

// 見つかったら、やりかけの予定を捨てて一番近い職員通路へ逃げ込む
function flee(g: Game) {
  const j = g.janitor;
  j.work = null;
  clearQueue(g);
  let best: Pos[] | null = null;
  for (const r of g.bp.rooms) {
    if (!r.staff) continue;
    for (const p of r.tiles) {
      if (g.bp.tiles[p.y][p.x] !== "floor") continue;
      const path = findPath(g.bp, j.pos, p, true, (q) => isBlocking(g, q));
      if (path && (!best || path.length < best.length)) best = path;
    }
  }
  if (best?.length) enqueue(g, best[best.length - 1]);
}

function updateHero(g: Game, dt: number) {
  const h = g.hero;
  if (!h) return;
  if (h.ending) {
    h.endIn -= dt;
    if (h.endIn <= 0) g.phase = "result";
    return;
  }
  h.caughtCooldown -= dt;
  checkCaught(g, h);
  if (h.hp <= 0) return finish(g, h, "down");
  if (h.fun <= 0) return finish(g, h, "bored");
  if (h.wait > 0) {
    h.wait -= dt;
    if (h.wait <= 0 && h.fighting?.kind === "monster") {
      h.fighting.state = "down";
      h.fighting = null;
    }
    return;
  }
  h.fun = Math.max(0, h.fun - BOREDOM_PER_SEC * dt);
  if (!h.path.length) {
    if (samePos(h.pos, g.bp.stairs)) return finish(g, h, "clear");
    const next = nextHeroGoal(g, h);
    if (!next) return finish(g, h, "clear");
    h.path = next.path;
    h.goal = next.thing;
    if (!next.path.length && next.thing) heroArrive(g, h, next.thing);
    return;
  }
  if (advance(h, HERO_SPEED, dt, (p) => heroStep(g, h, p)) && h.goal) heroArrive(g, h, h.goal);
}

function heroArrive(g: Game, h: Hero, t: Thing) {
  if (t.kind === "monster" || t.kind === "chest") heroMeet(g, h, t);
  h.goal = null;
}

export function result(g: Game) {
  const h = g.hero!;
  const fun = Math.round(h.fun);
  let stars = 0;
  if (h.ending === "clear") stars = fun >= 75 ? 3 : fun >= 45 ? 2 : 1;
  const title =
    h.ending === "down" ? "勇者が倒れた…（神殿送り）" : h.ending === "bored" ? "勇者が退屈して帰った" : "勇者が階段を下りていった";
  return { stars, fun, hp: h.hp, title, caught: g.caught, pay: h.ending === "clear" ? stars * 40 + fun : 0 };
}

export function update(g: Game, dt: number) {
  g.bubbles = g.bubbles.filter((b) => (b.life -= dt) > 0);
  if (g.phase === "prep") {
    g.timeLeft -= dt;
    updateMonsters(g, dt);
    updateJanitor(g, dt);
    if (g.timeLeft <= 0) startHero(g);
  } else if (g.phase === "hero") {
    for (let i = 0; i < g.heroSpeed; i++) {
      updateMonsters(g, dt);
      updateJanitor(g, dt);
      updateHero(g, dt);
    }
  }
  updateLight(g);
}

export function remainingWork(g: Game): number {
  return g.things.filter(needsWork).length;
}
