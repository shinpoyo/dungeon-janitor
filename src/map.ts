// 1 フロアぶんの設計図。ここに書いた状態が「勇者が初めて来たときの、あるべき姿」。
//
//  # 壁   . 床   D 扉   H 職員用の隠し戸（勇者には壁に見える）   S 倉庫の棚
//  @ 清掃員の初期位置（職員通路）   E 勇者の入口   > 下り階段（勇者のゴール）
//  m モンスター   c 宝箱   t 罠   f 松明
//
// 勇者は入口の間から扉をたどって階段の間へ進む。左の職員通路は勇者からは見えず、
// 隠し戸で各部屋の横に出られる。勇者より先回りするための道。
const FLOOR_1 = [
  "#############",
  "#>...#.....m#",
  "#..m.D..c...#",
  "#f...#.t..f.#",
  "#c..t#......#",
  "##H####D#####",
  "#..#.....m..#",
  "#S.#.c......#",
  "#S.H...t..f.#",
  "#S.#..m.....#",
  "#..######D###",
  "#..#........#",
  "#..H..m..c..#",
  "#..#f....t..#",
  "#..##D#######",
  "#..#........#",
  "#@.H.t..m..f#",
  "#..#....E...#",
  "#############",
];

// 勇者が通る順の部屋の名前
const ROOM_NAMES = ["入口の間", "苔の間", "骨の回廊", "宝物庫", "階段の間"];

export type Tile = "wall" | "floor" | "door" | "hidden" | "shelf";

export type Pos = { x: number; y: number };

export type TreasureKind = "herb" | "sword" | "gold";
export type MonsterKind = "slime" | "skeleton";

export type BlueprintObject =
  | { kind: "monster"; pos: Pos; monster: MonsterKind }
  | { kind: "chest"; pos: Pos; treasure: TreasureKind }
  | { kind: "trap"; pos: Pos }
  | { kind: "torch"; pos: Pos };

export type Room = {
  id: number;
  name: string;
  tiles: Pos[];
  staff: boolean; // 職員通路（勇者は入らない）
  order: number; // 勇者が通る順。職員通路は -1
};

export type Blueprint = {
  width: number;
  height: number;
  tiles: Tile[][];
  start: Pos;
  entrance: Pos;
  stairs: Pos;
  objects: BlueprintObject[];
  rooms: Room[];
  roomAt: number[][]; // 床ごとの部屋番号。扉・壁は -1
  heroRooms: Room[]; // 勇者が通る順
};

// 宝箱の中身は、勇者の進み具合で決まる（奥ほど良い物）
function treasureFor(order: number): TreasureKind {
  if (order <= 1) return "herb";
  if (order <= 3) return "sword";
  return "gold";
}

const DIRS: Pos[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

export function neighbors(p: Pos): Pos[] {
  return DIRS.map((d) => ({ x: p.x + d.x, y: p.y + d.y }));
}

export const samePos = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y;

export function loadBlueprint(): Blueprint {
  const rows = FLOOR_1;
  const height = rows.length;
  const width = rows[0].length;
  const tiles: Tile[][] = [];
  const raw: { ch: string; pos: Pos }[] = [];
  let start: Pos = { x: 1, y: 1 };
  let entrance: Pos = { x: 1, y: 1 };
  let stairs: Pos = { x: 1, y: 1 };

  rows.forEach((row, y) => {
    tiles.push([]);
    [...row].forEach((ch, x) => {
      const pos = { x, y };
      let tile: Tile = "floor";
      if (ch === "#") tile = "wall";
      else if (ch === "D") tile = "door";
      else if (ch === "H") tile = "hidden";
      else if (ch === "S") tile = "shelf";
      else if (ch === "@") start = pos;
      else if (ch === "E") entrance = pos;
      else if (ch === ">") stairs = pos;
      else if ("mctf".includes(ch)) raw.push({ ch, pos });
      tiles[y].push(tile);
    });
  });

  // 部屋分け：扉と隠し戸で区切られた床のかたまり
  const roomAt = tiles.map((row) => row.map(() => -1));
  const rooms: Room[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (tiles[y][x] !== "floor" && tiles[y][x] !== "shelf") continue;
      if (roomAt[y][x] >= 0) continue;
      const id = rooms.length;
      const room: Room = { id, name: "", tiles: [], staff: false, order: -1 };
      const stack = [{ x, y }];
      roomAt[y][x] = id;
      while (stack.length) {
        const p = stack.pop()!;
        room.tiles.push(p);
        if (tiles[p.y][p.x] === "shelf" || samePos(p, start)) room.staff = true;
        for (const n of neighbors(p)) {
          const t = tiles[n.y]?.[n.x];
          if ((t === "floor" || t === "shelf") && roomAt[n.y][n.x] < 0) {
            roomAt[n.y][n.x] = id;
            stack.push(n);
          }
        }
      }
      rooms.push(room);
    }
  }

  // 勇者の通る順：入口の部屋から、扉をはさんだ隣の部屋へ幅優先でたどる
  const heroRooms: Room[] = [];
  const first = rooms[roomAt[entrance.y][entrance.x]];
  const queue = [first];
  const visited = new Set([first.id]);
  while (queue.length) {
    const r = queue.shift()!;
    r.order = heroRooms.length;
    r.name = ROOM_NAMES[r.order] ?? `${r.order + 1}の間`;
    heroRooms.push(r);
    for (const p of r.tiles) {
      for (const d of neighbors(p)) {
        if (tiles[d.y]?.[d.x] !== "door") continue;
        for (const n of neighbors(d)) {
          const id = roomAt[n.y]?.[n.x] ?? -1;
          if (id >= 0 && !visited.has(id) && !rooms[id].staff) {
            visited.add(id);
            queue.push(rooms[id]);
          }
        }
      }
    }
  }
  for (const r of rooms) if (r.staff) r.name = "職員通路";

  let monsterCount = 0;
  const objects: BlueprintObject[] = raw.map(({ ch, pos }) => {
    const order = rooms[roomAt[pos.y][pos.x]].order;
    if (ch === "m") return { kind: "monster", pos, monster: monsterCount++ % 2 === 0 ? "slime" : "skeleton" };
    if (ch === "c") return { kind: "chest", pos, treasure: treasureFor(order) };
    if (ch === "t") return { kind: "trap", pos };
    return { kind: "torch", pos };
  });

  return { width, height, tiles, start, entrance, stairs, objects, rooms, roomAt, heroRooms };
}

export function roomOf(bp: Blueprint, p: Pos): Room | null {
  const id = bp.roomAt[p.y]?.[p.x] ?? -1;
  return id >= 0 ? bp.rooms[id] : null;
}

// 清掃員は隠し戸を通れる。勇者は通れない
export function isWalkable(bp: Blueprint, p: Pos, staff: boolean): boolean {
  if (p.x < 0 || p.y < 0 || p.x >= bp.width || p.y >= bp.height) return false;
  const t = bp.tiles[p.y][p.x];
  return t === "floor" || t === "door" || (staff && t === "hidden");
}

// 光をさえぎるか
export function blocksLight(bp: Blueprint, p: Pos): boolean {
  const t = bp.tiles[p.y]?.[p.x];
  return t === undefined || t === "wall" || t === "hidden" || t === "shelf";
}

// 幅優先探索で最短経路を返す。from は含まず to は含む。たどり着けなければ null
export function findPath(
  bp: Blueprint,
  from: Pos,
  to: Pos,
  staff: boolean,
  blocked: (p: Pos) => boolean = () => false,
): Pos[] | null {
  if (samePos(from, to)) return [];
  const key = (p: Pos) => p.y * bp.width + p.x;
  const prev = new Map<number, Pos>();
  const queue: Pos[] = [from];
  prev.set(key(from), from);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const n of neighbors(cur)) {
      if (prev.has(key(n))) continue;
      const isGoal = samePos(n, to);
      if (!isWalkable(bp, n, staff) || (!isGoal && blocked(n))) continue;
      prev.set(key(n), cur);
      if (isGoal) {
        const path: Pos[] = [n];
        let p = cur;
        while (!samePos(p, from)) {
          path.unshift(p);
          p = prev.get(key(p))!;
        }
        return path;
      }
      queue.push(n);
    }
  }
  return null;
}

// 2 点の間に光をさえぎるものがないか（端点は見ない）
export function lineOfSight(bp: Blueprint, a: Pos, b: Pos): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  for (let i = 1; i < steps; i++) {
    const x = Math.round(a.x + (dx * i) / steps);
    const y = Math.round(a.y + (dy * i) / steps);
    if (blocksLight(bp, { x, y })) return false;
  }
  return true;
}
