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
    // UIをブロックしないよう次のフレームで実行
    await new Promise((r) => setTimeout(r, 30));
    const solveResult = solve({ tubes: data.tubes, capacity: data.capacity });
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
        <h1>Water Sort Puzzle を解く</h1>
      </header>

      {step === "upload" && <ImageUpload onImageLoaded={handleImageLoaded} />}

      {step === "grid" && image && (
        <GridEditor
          image={image}
          onBack={restart}
          onConfirm={handleGridConfirm}
        />
      )}

      {solving && (
        <div className="step-panel">
          <p>解いています...</p>
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
              <h2>(3/3) 解答</h2>
              <p className="error-msg">
                解けませんでした。{result.message ?? ""}
              </p>
              <p>
                読み取ったグリッドの色（特に「不明」セルの推測結果）や、空の試験管の数が正しいか確認してください。
              </p>
              <div className="button-row">
                <button onClick={() => setStep("grid")}>
                  グリッドを調整し直す
                </button>
                <button onClick={restart}>最初から</button>
              </div>
            </div>
          )}
        </>
      )}

      <footer className="app-footer">
        <p>
          画像はブラウザ内でのみ処理され、サーバーへは送信されません。オリジナルサイト（
          <a
            href="https://baclips.com/solve-water-sort-puzzle/"
            target="_blank"
            rel="noreferrer"
          >
            baclips.com
          </a>
          ）の仕様をベースに、色が1つだけ不明でも解けるよう拡張した非公式版です。
        </p>
      </footer>
    </div>
  );
};
