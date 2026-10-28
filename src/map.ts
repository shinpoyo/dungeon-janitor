// 1 フロアぶんの設計図。ここに書いた状態が「勇者が初めて来たときの、あるべき姿」。
//
//  # 壁   . 床   D 扉   S 倉庫の棚   @ 清掃員の初期位置
//  E 勇者の入口   > 下り階段（勇者のゴール）
//  m モンスター   c 宝箱   t 罠   f 松明
const FLOOR_1 = [
  "###########",
  "#SSS#..m..#",
  "#...D..c..#",
  "#.@.#t...f#",
  "##D######D#",
  "#f..m#....#",
  "#..t.D.m..#",
  "#c...#..c.#",
  "###D####t##",
  "#.....#...#",
  "#.m.t.D.m.#",
  "#f....#.c.#",
  "####D###D##",
  "#.t.....m.#",
  "#...c..f..#",
  "#E...m...>#",
  "###########",
];

export type Tile = "wall" | "floor" | "door" | "shelf";

export type Pos = { x: number; y: number };

export type TreasureKind = "herb" | "sword" | "gold";
export type MonsterKind = "slime" | "skeleton";

export type BlueprintObject =
  | { kind: "monster"; pos: Pos; monster: MonsterKind }
  | { kind: "chest"; pos: Pos; treasure: TreasureKind }
  | { kind: "trap"; pos: Pos }
  | { kind: "torch"; pos: Pos };

export type Blueprint = {
  width: number;
  height: number;
  tiles: Tile[][];
  start: Pos;
  entrance: Pos;
  stairs: Pos;
  objects: BlueprintObject[];
};

// 宝箱の中身は、置いた場所の深さ（下の方ほど奥）で決まる
function treasureFor(y: number, height: number): TreasureKind {
  const depth = y / height;
  if (depth < 0.4) return "herb";
  if (depth < 0.7) return "sword";
  return "gold";
}

export function loadBlueprint(): Blueprint {
  const rows = FLOOR_1;
  const height = rows.length;
  const width = rows[0].length;
  const tiles: Tile[][] = [];
  const objects: BlueprintObject[] = [];
  let start: Pos = { x: 1, y: 1 };
  let entrance: Pos = { x: 1, y: 1 };
  let stairs: Pos = { x: 1, y: 1 };
  let monsterCount = 0;

  rows.forEach((row, y) => {
    tiles.push([]);
    [...row].forEach((ch, x) => {
      const pos = { x, y };
      let tile: Tile = "floor";
      if (ch === "#") tile = "wall";
      else if (ch === "D") tile = "door";
      else if (ch === "S") tile = "shelf";
      else if (ch === "@") start = pos;
      else if (ch === "E") entrance = pos;
      else if (ch === ">") stairs = pos;
      else if (ch === "m") {
        objects.push({ kind: "monster", pos, monster: monsterCount++ % 2 === 0 ? "slime" : "skeleton" });
      } else if (ch === "c") objects.push({ kind: "chest", pos, treasure: treasureFor(y, height) });
      else if (ch === "t") objects.push({ kind: "trap", pos });
      else if (ch === "f") objects.push({ kind: "torch", pos });
      tiles[y].push(tile);
    });
  });

  return { width, height, tiles, start, entrance, stairs, objects };
}

export function isWalkable(bp: Blueprint, p: Pos): boolean {
  if (p.x < 0 || p.y < 0 || p.x >= bp.width || p.y >= bp.height) return false;
  const t = bp.tiles[p.y][p.x];
  return t === "floor" || t === "door";
}

const DIRS: Pos[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

// 幅優先探索で最短経路を返す。from は含まず to は含む。たどり着けなければ null
export function findPath(
  bp: Blueprint,
  from: Pos,
  to: Pos,
  blocked: (p: Pos) => boolean = () => false,
): Pos[] | null {
  if (from.x === to.x && from.y === to.y) return [];
  const key = (p: Pos) => p.y * bp.width + p.x;
  const prev = new Map<number, Pos>();
  const queue: Pos[] = [from];
  prev.set(key(from), from);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const d of DIRS) {
      const n = { x: cur.x + d.x, y: cur.y + d.y };
      if (prev.has(key(n))) continue;
      const isGoal = n.x === to.x && n.y === to.y;
      if (!isWalkable(bp, n) || (!isGoal && blocked(n))) continue;
      prev.set(key(n), cur);
      if (isGoal) {
        const path: Pos[] = [n];
        let p = cur;
        while (!(p.x === from.x && p.y === from.y)) {
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

export function neighbors(p: Pos): Pos[] {
  return DIRS.map((d) => ({ x: p.x + d.x, y: p.y + d.y }));
}

export const samePos = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y;
