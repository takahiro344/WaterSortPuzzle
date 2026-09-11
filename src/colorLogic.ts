import { AUTO, EMPTY, GridCell, RGB, UNKNOWN } from './types';

function colorDistance(a: RGB, b: RGB): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

// 明るさが十分低い（黒に近い＝背景/ガラスの縁など）場合は空セルとみなす際の閾値
const EMPTY_BRIGHTNESS_MAX = 40;
// 同じ色とみなす距離の閾値
const CLUSTER_THRESHOLD = 36;

export interface ClusterResult {
  palette: RGB[]; // 色ID -> 代表色
  assignedCells: { gridId: number; col: number; row: number; value: number }[];
}

// 取得したピクセル色から、空セルを除いた色をクラスタリングして色IDを割り当てる。
// すでに手動で EMPTY / UNKNOWN が指定されているセルはそのまま尊重する。
export function clusterColors(cells: GridCell[]): ClusterResult {
  const palette: RGB[] = [];
  const assignedCells: { gridId: number; col: number; row: number; value: number }[] = [];

  for (const cell of cells) {
    if (cell.value === EMPTY || cell.value === UNKNOWN) {
      assignedCells.push({ gridId: cell.gridId, col: cell.col, row: cell.row, value: cell.value });
      continue;
    }
    if (!cell.rgb) {
      assignedCells.push({ gridId: cell.gridId, col: cell.col, row: cell.row, value: EMPTY });
      continue;
    }
    const brightness = (cell.rgb.r + cell.rgb.g + cell.rgb.b) / 3;
    if (brightness <= EMPTY_BRIGHTNESS_MAX) {
      assignedCells.push({ gridId: cell.gridId, col: cell.col, row: cell.row, value: EMPTY });
      continue;
    }
    let matched = -1;
    let bestDist = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const d = colorDistance(cell.rgb, palette[i]);
      if (d < bestDist) {
        bestDist = d;
        matched = i;
      }
    }
    if (matched !== -1 && bestDist <= CLUSTER_THRESHOLD) {
      assignedCells.push({ gridId: cell.gridId, col: cell.col, row: cell.row, value: matched });
    } else {
      palette.push(cell.rgb);
      assignedCells.push({ gridId: cell.gridId, col: cell.col, row: cell.row, value: palette.length - 1 });
    }
  }

  return { palette, assignedCells };
}

export interface InferResult {
  ok: boolean;
  inferredColor: number | null;
  message: string;
}

// 「不明」セルが1つだけの場合に、他の色の出現数（本来は各色ちょうど capacity 個）から
// 消去法で不明セルの色を推測する。
export function inferUnknownColor(
  values: number[], // EMPTY / UNKNOWN を含む全セルの値の配列
  capacity: number
): InferResult {
  const unknownCount = values.filter((v) => v === UNKNOWN).length;
  if (unknownCount === 0) {
    return { ok: true, inferredColor: null, message: '不明セルはありません。' };
  }
  if (unknownCount > 1) {
    return { ok: false, inferredColor: null, message: '不明セルは1個までしか推測できません。' };
  }

  const counts = new Map<number, number>();
  let maxColor = -1;
  for (const v of values) {
    if (v === EMPTY || v === UNKNOWN) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
    if (v > maxColor) maxColor = v;
  }

  // capacity に1つ足りない色を探す
  const short: number[] = [];
  for (const [color, count] of counts.entries()) {
    if (count === capacity - 1) short.push(color);
    if (count > capacity) {
      return {
        ok: false,
        inferredColor: null,
        message: `色 ${color} の出現数が ${count} 個あり、想定（${capacity}個）を超えています。グリッドを見直してください。`,
      };
    }
  }

  // 既存の色候補では1つも「あと1個で完成」の色がない場合、
  // これまで検出されていない新しい色である可能性がある。
  if (short.length === 0) {
    const newColorId = maxColor + 1;
    return {
      ok: true,
      inferredColor: newColorId,
      message: '既知の色では過不足が見つからなかったため、未検出の新しい色として補完しました。',
    };
  }
  if (short.length > 1) {
    return {
      ok: false,
      inferredColor: null,
      message: '出現数が1個足りない色が複数あり、一意に推測できませんでした。グリッドの読み取りを確認してください。',
    };
  }

  return {
    ok: true,
    inferredColor: short[0],
    message: `他の色の出現数から、不明セルは色 ${short[0]} と推測しました。`,
  };
}
