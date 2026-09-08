// 色ID: 0以上の整数 = 通常の色
// -1 = 空セル
// -2 = 不明セル（推測対象、グリッド上で最大1個まで許可）
// -3 = 自動判定（画像のピクセル色からクラスタリングして決定する）
export const EMPTY = -1;
export const UNKNOWN = -2;
export const AUTO = -3;

export type CellValue = number; // EMPTY | UNKNOWN | 0,1,2,...

export interface RGB {
  r: number;
  g: number;
  b: number;
}

// グリッド上の1マス（列=試験管インデックス、行=段:下から0,1,2,3）
export interface GridCell {
  col: number;
  row: number;
  x: number;
  y: number;
  rgb: RGB | null; // 取得できたピクセル色
  value: CellValue; // クラスタリング/手動編集後に確定した値
}

// 試験管の状態（下から上の順で色IDを並べたもの。EMPTYは含めない、空段は配列の長さで表現）
export type Tube = number[];

export interface PuzzleState {
  tubes: Tube[];
  capacity: number; // 1本あたりの段数（通常4）
}

export interface Move {
  from: number;
  to: number;
  color: number;
  amount: number;
}

export interface SolveResult {
  solvable: boolean;
  moves: Move[];
  statesExplored: number;
  message?: string;
}
