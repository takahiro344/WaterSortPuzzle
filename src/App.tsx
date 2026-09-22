import React, { useState } from "react";
import {
  AmbiguousCell,
  GridConfirmResult,
  GridEditor,
} from "./components/GridEditor";
import { ImageUpload } from "./components/ImageUpload";
import { SolutionViewer, UnknownCell } from "./components/SolutionViewer";
import { solve, findExposeSequence } from "./solver";
import { Move, RGB } from "./types";

type Step = "upload" | "grid" | "result";

// 曖昧セル（複数候補が指定されたセル）の候補色を総当たりで組み合わせる。
// ただし、同じ色IDが複数の曖昧セルに重複して割り当てられる組み合わせは、
// 実際の盤面としてあり得ない（その色が規定数を超えて重複してしまう）ため生成しない。
// 例: セルA候補[1,2], セルB候補[1,3] -> [1,3], [2,1], [2,3]（[1,1]は除外）
function cartesianProductWithoutDuplicates(
  candidateLists: number[][],
): number[][] {
  const results: number[][] = [];
  const current: number[] = [];
  const used = new Set<number>();

  const backtrack = (index: number) => {
    if (index === candidateLists.length) {
      results.push([...current]);
      return;
    }
    for (const candidate of candidateLists[index]) {
      if (used.has(candidate)) continue; // 他の曖昧セルと色が重複する組み合わせは除外
      used.add(candidate);
      current.push(candidate);
      backtrack(index + 1);
      current.pop();
      used.delete(candidate);
    }
  };

  backtrack(0);
  return results;
}

// 曖昧セルの組み合わせ数がこれを超える場合、自動探索を行わずエラーとする
// （ブラウザが固まるのを防ぐため）。
const MAX_AMBIGUOUS_COMBINATIONS = 300;

// tubes内の各色の出現数を数える。
function countColors(tubes: number[][]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const tube of tubes) {
    for (const value of tube) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return counts;
}

// Water Sort のルール上、各色は必ずちょうど capacity 個存在するはず。
// 過不足があれば、その組み合わせは（見た目上は妥当でも）内部的な色IDの
// 取り違えなどにより物理的にあり得ない盤面になっている可能性が高いので、
// solve() を呼ぶ前に弾いて原因を特定しやすくする。
function findCapacityMismatch(
  tubes: number[][],
  capacity: number,
): { color: number; count: number } | null {
  for (const [color, count] of countColors(tubes)) {
    if (count !== capacity) return { color, count };
  }
  return null;
}

interface ResultData {
  tubes: number[][];
  capacity: number;
  paletteRgb: (RGB | null)[];
  moves: Move[];
  warnings: string[];
  solvable: boolean;
  message?: string;
  // 候補の組み合わせが全滅したときだけ、「?」のどれか1つを露出させる手順を提示する
  exposeMoves?: Move[];
  exposeTargetTubeIndex?: number;
  hadAmbiguousCells?: boolean;
  // まだ色が確定していない「?」セルの一覧（表示時に破線＋「?」で示す）
  unknownCells?: UnknownCell[];
}

export const App: React.FC = () => {
  const [step, setStep] = useState<Step>("upload");
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [result, setResult] = useState<ResultData | null>(null);
  const [solving, setSolving] = useState(false);

  const handleImageLoaded = (img: HTMLImageElement) => {
    setImage(img);
    setStep("grid");
  };

  const solveWithAmbiguousCells = (
    tubes: number[][],
    capacity: number,
    ambiguousCells: AmbiguousCell[],
  ): {
    moves: Move[];
    tubes: number[][];
    warnings: string[];
    solvable: boolean;
    message?: string;
    exposeMoves?: Move[];
    exposeTargetTubeIndex?: number;
  } => {
    const combinations = cartesianProductWithoutDuplicates(
      ambiguousCells.map((cell) => cell.colorIds),
    );

    if (combinations.length > MAX_AMBIGUOUS_COMBINATIONS) {
      return {
        moves: [],
        tubes,
        warnings: [],
        solvable: false,
        message: `候補の組み合わせが${combinations.length}通りあり、多すぎるため自動では試せません（上限${MAX_AMBIGUOUS_COMBINATIONS}通り）。曖昧に指定する交点や候補色の数を減らしてください。`,
      };
    }

    if (combinations.length === 0) {
      return {
        moves: [],
        tubes,
        warnings: [],
        solvable: false,
        message:
          "色が重複しない組み合わせが1つも作れませんでした。同じ交点で選んだ候補色が他の曖昧な交点の候補と重複していないか確認してください。",
      };
    }

    let lastMessage: string | undefined;
    let capacityMismatchCount = 0;
    let lastMismatch: { color: number; count: number } | null = null;
    for (let i = 0; i < combinations.length; i++) {
      const combo = combinations[i];
      const tubesTry = tubes.map((tube) => [...tube]);
      ambiguousCells.forEach((cell, idx) => {
        tubesTry[cell.tubeIndex][cell.position] = combo[idx];
      });

      // 色の出現数が capacity と合わない組み合わせは、盤面として物理的に
      // あり得ないので solve() を呼ばずにスキップする（無駄な探索を省くと
      // 同時に、色IDの取り違えバグなどを見つけやすくする）。
      const mismatch = findCapacityMismatch(tubesTry, capacity);
      if (mismatch) {
        capacityMismatchCount++;
        lastMismatch = mismatch;
        continue;
      }

      const r = solve({ tubes: tubesTry, capacity });
      if (r.solvable) {
        return {
          moves: r.moves,
          tubes: tubesTry,
          warnings: [
            `色が重複しない組み合わせ${combinations.length}通り中${i + 1}通り目で解けました。`,
          ],
          solvable: true,
        };
      }
      lastMessage = r.message;
    }

    if (capacityMismatchCount === combinations.length && lastMismatch) {
      return {
        moves: [],
        tubes,
        warnings: [],
        solvable: false,
        message: `候補の組み合わせを${combinations.length}通りすべて試しましたが、いずれも色ID ${lastMismatch.color} の出現数が${lastMismatch.count}個（本来は${capacity}個）になっており、盤面として成立しませんでした。候補色の判定がずれている可能性があるため、その色を含む交点の候補選択を見直してください。`,
      };
    }

    // 候補の組み合わせをすべて試しても解けなかった場合だけ、次善策として
    // 「?」のうちどれか1つだけでも中身が分かる（試験管の一番上まで既知の色を
    // 退避できる）手順を探す。色そのものは決め打ちせず、他のどの色とも一致しない
    // 仮の値として扱うので、まだ正体不明のままでも計算できる。
    const exposeTargets = ambiguousCells.map((cell) => ({
      tubeIndex: cell.tubeIndex,
      position: cell.position,
    }));
    const expose = findExposeSequence(tubes, capacity, exposeTargets);

    return {
      moves: [],
      tubes,
      warnings: [],
      solvable: false,
      message: `色が重複しない組み合わせを${combinations.length}通りすべて試しましたが、解けるパターンが見つかりませんでした。${lastMessage ?? ""}`,
      exposeMoves: expose?.moves,
      exposeTargetTubeIndex: expose
        ? ambiguousCells[expose.targetIndex].tubeIndex
        : undefined,
    };
  };

  const handleGridConfirm = async (data: GridConfirmResult) => {
    setSolving(true);
    await new Promise((r) => setTimeout(r, 30));

    const ambiguousCells = data.ambiguousCells ?? [];

    if (ambiguousCells.length === 0) {
      const solveResult = solve({
        tubes: data.tubes,
        capacity: data.capacity,
      });

      setResult({
        tubes: data.tubes,
        capacity: data.capacity,
        paletteRgb: data.paletteRgb,
        moves: solveResult.moves,
        warnings: data.warnings,
        solvable: solveResult.solvable,
        message: solveResult.message,
      });
    } else {
      const outcome = solveWithAmbiguousCells(
        data.tubes,
        data.capacity,
        ambiguousCells,
      );

      setResult({
        tubes: outcome.tubes,
        capacity: data.capacity,
        paletteRgb: data.paletteRgb,
        moves: outcome.moves,
        warnings: [...data.warnings, ...outcome.warnings],
        solvable: outcome.solvable,
        message: outcome.message,
        exposeMoves: outcome.exposeMoves,
        exposeTargetTubeIndex: outcome.exposeTargetTubeIndex,
        hadAmbiguousCells: true,
        unknownCells: ambiguousCells.map((cell) => ({
          tubeIndex: cell.tubeIndex,
          position: cell.position,
        })),
      });
    }

    setSolving(false);
    setStep("result");
  };

  const restart = () => {
    setImage(null);
    setResult(null);
    setStep("upload");
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Water Sort Puzzle Solver</h1>
        <p className="subtitle">画像から盤面を読み取り、解法を探索します</p>
      </header>

      {step === "upload" && <ImageUpload onImageLoaded={handleImageLoaded} />}

      {image && (
        // 画像が読み込まれている間は GridEditor をアンマウントせずに保持する。
        // 「盤面を再調整」で grid ステップに戻ったときに、グリッド位置・列数・
        // 候補色の選択状態がリセットされず残るようにするため（表示切り替えのみ）。
        <div style={{ display: step === "grid" ? "block" : "none" }}>
          <GridEditor
            image={image}
            onBack={restart}
            onConfirm={handleGridConfirm}
          />
        </div>
      )}

      {solving && (
        <div className="step-panel">
          <p>盤面を解析しています…</p>
        </div>
      )}

      {step === "result" && result && !solving && (
        <>
          {result.warnings.length > 0 && (
            <div className="warning-box">
              {result.warnings.map((w, i) => (
                <p key={i}>💡 {w}</p>
              ))}
            </div>
          )}

          {result.solvable ? (
            <SolutionViewer
              initialTubes={result.tubes}
              capacity={result.capacity}
              moves={result.moves}
              paletteRgb={result.paletteRgb}
              onBack={() => setStep("grid")}
              onRestart={restart}
            />
          ) : result.exposeMoves && result.exposeTargetTubeIndex !== undefined ? (
            <SolutionViewer
              initialTubes={result.tubes}
              capacity={result.capacity}
              moves={result.exposeMoves}
              paletteRgb={result.paletteRgb}
              onBack={() => setStep("grid")}
              onRestart={restart}
              unknownCells={result.unknownCells}
              title="「?」を確認するための手順"
              description={`盤面全体は解けませんでしたが、色を決め打ちせずに 管 ${
                result.exposeTargetTubeIndex + 1
              } の「?」を一番上まで露出させる手順（${result.exposeMoves.length}手）が見つかりました。下の操作で手順を1つずつ確認できます。実機でこの通りに動かして中身を確認し、判明した色を候補色選択で反映してから、もう一度お試しください。`}
              emptyMovesDescription={`管 ${
                result.exposeTargetTubeIndex + 1
              } の「?」はすでに一番上に露出しています。`}
            />
          ) : (
            <div className="step-panel">
              <h2>解析結果</h2>
              <p className="error-msg">
                解法を見つけられませんでした。{result.message ?? ""}
              </p>
              <p>
                色の認識結果や空の管の数が正しいか確認して、盤面を調整してください。
              </p>
              {result.hadAmbiguousCells && (
                <p>
                  「?」のどれか1つでも露出させる手順は見つかりませんでした。
                </p>
              )}
              <div className="button-row">
                <button onClick={() => setStep("grid")}>盤面を再調整</button>
                <button onClick={restart}>別の画像を使う</button>
              </div>
            </div>
          )}
        </>
      )}

      <footer className="app-footer">
        <p>
          画像とパズル情報はブラウザ内だけで処理され、外部サーバーには送信されません。
          このツールは独自実装による非公式の Water Sort Puzzle Solver です。
        </p>
      </footer>
    </div>
  );
};
