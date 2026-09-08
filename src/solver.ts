import { Move, PuzzleState, SolveResult, Tube } from './types';
import { PriorityQueue } from './priorityQueue';

const MAX_STATES = 400000; // 探索ノード数の上限（無限ループ防止）

function cloneTubes(tubes: Tube[]): Tube[] {
  return tubes.map((t) => t.slice());
}

function serialize(tubes: Tube[]): string {
  // 各試験管内は順序が意味を持つが、試験管同士の並びは元の入力順を保持したまま比較する
  return tubes.map((t) => t.join(',')).join('|');
}

function topRun(tube: Tube): { color: number; amount: number } | null {
  if (tube.length === 0) return null;
  const color = tube[tube.length - 1];
  let amount = 0;
  for (let i = tube.length - 1; i >= 0 && tube[i] === color; i--) amount++;
  return { color, amount };
}

function isTubeDone(tube: Tube, capacity: number): boolean {
  if (tube.length === 0) return true;
  if (tube.length !== capacity) return false;
  const c = tube[0];
  return tube.every((v) => v === c);
}

function isGoal(tubes: Tube[], capacity: number): boolean {
  return tubes.every((t) => isTubeDone(t, capacity));
}

// 有効な手を列挙する。「分割注ぎ」は不可＝移動元の同色連続分がすべて移動先に収まる場合のみ許可
function generateMoves(tubes: Tube[], capacity: number): Move[] {
  const moves: Move[] = [];
  for (let i = 0; i < tubes.length; i++) {
    const src = tubes[i];
    if (src.length === 0) continue;
    if (isTubeDone(src, capacity)) continue; // 既に完成した試験管からは動かす意味がない
    const run = topRun(src);
    if (!run) continue;

    for (let j = 0; j < tubes.length; j++) {
      if (i === j) continue;
      const dst = tubes[j];
      const free = capacity - dst.length;
      if (free <= 0) continue;
      if (dst.length > 0 && dst[dst.length - 1] !== run.color) continue;
      // 空の試験管同士の移動は無意味（同じ状態への遷移を避ける）
      if (dst.length === 0 && src.length === run.amount) continue;
      if (free < run.amount) continue; // 分割注ぎ不可
      moves.push({ from: i, to: j, color: run.color, amount: run.amount });
    }
  }
  return moves;
}

function applyMove(tubes: Tube[], move: Move): Tube[] {
  const next = cloneTubes(tubes);
  const src = next[move.from];
  const dst = next[move.to];
  for (let k = 0; k < move.amount; k++) {
    dst.push(src.pop() as number);
  }
  return next;
}

// ヒューリスティック: 未完成の試験管数 + 色が分断されている度合い
function heuristic(tubes: Tube[], capacity: number): number {
  let h = 0;
  const colorTubeSet = new Map<number, Set<number>>();
  for (let i = 0; i < tubes.length; i++) {
    const t = tubes[i];
    if (!isTubeDone(t, capacity) && t.length > 0) h += 1;
    // 同色内の「境目」の数（連続していない部分）をカウント
    for (let k = 1; k < t.length; k++) {
      if (t[k] !== t[k - 1]) h += 1;
    }
    for (const c of t) {
      if (!colorTubeSet.has(c)) colorTubeSet.set(c, new Set());
      colorTubeSet.get(c)!.add(i);
    }
  }
  // 同じ色が何本の試験管に分散しているか（多いほど遠い）
  for (const set of colorTubeSet.values()) {
    h += Math.max(0, set.size - 1) * 2;
  }
  return h;
}

interface SearchNode {
  tubes: Tube[];
  g: number; // ここまでの手数
  move: Move | null;
  parentKey: string | null;
}

export function solve(state: PuzzleState): SolveResult {
  const { tubes, capacity } = state;

  if (isGoal(tubes, capacity)) {
    return { solvable: true, moves: [], statesExplored: 0 };
  }

  const startKey = serialize(tubes);
  const cameFrom = new Map<string, SearchNode>();
  cameFrom.set(startKey, { tubes, g: 0, move: null, parentKey: null });

  const pq = new PriorityQueue<string>();
  pq.push(startKey, heuristic(tubes, capacity));

  const bestG = new Map<string, number>();
  bestG.set(startKey, 0);

  let explored = 0;

  while (pq.size > 0) {
    const key = pq.pop()!;
    const node = cameFrom.get(key)!;
    explored++;

    if (explored > MAX_STATES) {
      return { solvable: false, moves: [], statesExplored: explored, message: '探索が上限に達しました（解が見つかりませんでした）。' };
    }

    if (isGoal(node.tubes, capacity)) {
      // 経路を復元
      const moves: Move[] = [];
      let cur: SearchNode | undefined = node;
      let curKey: string | null = key;
      while (cur && cur.move) {
        moves.push(cur.move);
        curKey = cur.parentKey;
        cur = curKey ? cameFrom.get(curKey) : undefined;
      }
      moves.reverse();
      return { solvable: true, moves, statesExplored: explored };
    }

    const moves = generateMoves(node.tubes, capacity);
    for (const move of moves) {
      const nextTubes = applyMove(node.tubes, move);
      const nextKey = serialize(nextTubes);
      const g = node.g + 1;
      const known = bestG.get(nextKey);
      if (known !== undefined && known <= g) continue;
      bestG.set(nextKey, g);
      cameFrom.set(nextKey, { tubes: nextTubes, g, move, parentKey: key });
      pq.push(nextKey, g + heuristic(nextTubes, capacity));
    }
  }

  return { solvable: false, moves: [], statesExplored: explored, message: '解が見つかりませんでした。読み取った色を確認してください。' };
}
