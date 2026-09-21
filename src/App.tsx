import React, { useState } from "react";
import { GridConfirmResult, GridEditor } from "./components/GridEditor";
import { ImageUpload } from "./components/ImageUpload";
import { SolutionViewer } from "./components/SolutionViewer";
import { solve } from "./solver";
import { Move, RGB } from "./types";

type Step = "upload" | "grid" | "result";

interface ResultData {
  tubes: number[][];
  capacity: number;
  paletteRgb: (RGB | null)[];
  moves: Move[];
  warnings: string[];
  solvable: boolean;
  message?: string;
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

  const handleGridConfirm = async (data: GridConfirmResult) => {
    setSolving(true);
    await new Promise((r) => setTimeout(r, 30));

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
          ) : (
            <div className="step-panel">
              <h2>解析結果</h2>
              <p className="error-msg">
                解法を見つけられませんでした。{result.message ?? ""}
              </p>
              <p>
                色の認識結果や空の管の数が正しいか確認して、盤面を調整してください。
              </p>
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
