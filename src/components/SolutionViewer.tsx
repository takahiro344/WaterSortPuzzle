import React, { useEffect, useRef, useState } from "react";
import { displayColorFor } from "../paletteDisplay";
import { Move, RGB } from "../types";

export interface UnknownCell {
  tubeIndex: number;
  position: number; // 0 = 管の一番下
}

interface Props {
  initialTubes: number[][];
  capacity: number;
  moves: Move[];
  paletteRgb: (RGB | null)[];
  onBack: () => void;
  onRestart: () => void;
  // 見出しと説明文をカスタマイズできるようにする（「?」確認手順の表示にも流用するため）
  title?: string;
  description?: string;
  emptyMovesDescription?: string;
  // まだ色が確定していない「?」のマス。塗りつぶさずに破線＋「?」で表示する。
  unknownCells?: UnknownCell[];
}

function applyMoves(
  initial: number[][],
  moves: Move[],
  upTo: number,
): number[][] {
  const tubes = initial.map((t) => t.slice());

  for (let i = 0; i < upTo; i++) {
    const m = moves[i];

    for (let k = 0; k < m.amount; k++) {
      const color = tubes[m.from].pop();
      if (color !== undefined) tubes[m.to].push(color);
    }
  }

  return tubes;
}

function drawSolution(
  canvas: HTMLCanvasElement,
  tubes: number[][],
  capacity: number,
  paletteRgb: (RGB | null)[],
  currentMove: Move | null,
  step: number,
  moveCount: number,
  unknownCells: UnknownCell[],
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const tubeWidth = 42;
  const tubeGap = 18;
  const columns = Math.max(1, Math.ceil(tubes.length / 2));
  const rows = Math.max(1, Math.ceil(tubes.length / columns));
  const contentWidth = columns * tubeWidth + (columns - 1) * tubeGap;
  const width = Math.max(320, contentWidth + 16);
  const rowHeight = capacity * 34 + 42;
  const height = Math.max(150, rows * rowHeight + 20);

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const getX = (index: number) => {
    const row = Math.floor(index / columns);
    const col = index % columns;
    const rowCount = Math.min(columns, tubes.length - row * columns);
    const rowWidth = rowCount * tubeWidth + (rowCount - 1) * tubeGap;
    return (width - rowWidth) / 2 + col * (tubeWidth + tubeGap);
  };

  const getY = (index: number) => Math.floor(index / columns) * rowHeight + 8;

  const tubeHeight = capacity * 30;

  for (let i = 0; i < tubes.length; i++) {
    const x = getX(i);
    const y = getY(i);
    const isFrom = currentMove?.from === i;
    const isTo = currentMove?.to === i;

    ctx.save();
    ctx.lineWidth = isFrom || isTo ? 4 : 2;
    ctx.strokeStyle = isFrom ? "#e74c3c" : isTo ? "#27ae60" : "#333";

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + tubeHeight - 12);
    ctx.quadraticCurveTo(x, y + tubeHeight, x + 12, y + tubeHeight);
    ctx.lineTo(x + tubeWidth - 12, y + tubeHeight);
    ctx.quadraticCurveTo(
      x + tubeWidth,
      y + tubeHeight,
      x + tubeWidth,
      y + tubeHeight - 12,
    );
    ctx.lineTo(x + tubeWidth, y);
    ctx.stroke();

    const colors = tubes[i];

    for (let level = 0; level < capacity; level++) {
      const colorId = colors[level];
      if (colorId === undefined) continue;

      const slotY = y + tubeHeight - (level + 1) * 30;
      const isUnknown = unknownCells.some(
        (u) => u.tubeIndex === i && u.position === level,
      );

      if (isUnknown) {
        // まだ色が確定していないマス。誤解を避けるため塗りつぶさず、
        // 破線の枠と「?」だけを表示する。
        ctx.save();
        ctx.strokeStyle = "#888";
        ctx.setLineDash([3, 2]);
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 2, slotY + 1, tubeWidth - 4, 28);
        ctx.setLineDash([]);
        ctx.font = "bold 14px sans-serif";
        ctx.fillStyle = "#888";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("?", x + tubeWidth / 2, slotY + 15);
        ctx.restore();
        continue;
      }

      const rgb = paletteRgb[colorId] ?? null;
      ctx.fillStyle = displayColorFor(colorId, rgb);
      ctx.fillRect(x + 2, slotY + 1, tubeWidth - 4, 28);
    }

    ctx.font = "12px sans-serif";
    ctx.fillStyle = "#666";
    ctx.textAlign = "center";
    ctx.fillText(`#${i + 1}`, x + tubeWidth / 2, y + tubeHeight + 17);
    ctx.restore();
  }

  if (currentMove) {
    const fromX = getX(currentMove.from) + tubeWidth / 2;
    const toX = getX(currentMove.to) + tubeWidth / 2;
    const fromTopY = getY(currentMove.from) - 2;
    const toTopY = getY(currentMove.to) - 2;
    const startY = fromTopY + 8;
    const endY = toTopY + 8;
    const midX = (fromX + toX) / 2;
    const controlY = Math.max(4, Math.min(fromTopY, toTopY) - 18);

    ctx.save();
    ctx.strokeStyle = "#222";
    ctx.fillStyle = "#222";
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(fromX, startY);
    ctx.quadraticCurveTo(midX, controlY, toX, endY);
    ctx.stroke();

    const angle = Math.atan2(endY - controlY, toX - midX);

    ctx.beginPath();
    ctx.moveTo(toX, endY);
    ctx.lineTo(
      toX - 9 * Math.cos(angle - Math.PI / 6),
      endY - 9 * Math.sin(angle - Math.PI / 6),
    );
    ctx.lineTo(
      toX - 9 * Math.cos(angle + Math.PI / 6),
      endY - 9 * Math.sin(angle + Math.PI / 6),
    );
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.font = "13px sans-serif";
  ctx.fillStyle = "#666";
  ctx.textAlign = "right";
  ctx.fillText(
    `${Math.min(step, moveCount)} / ${moveCount}`,
    width - 8,
    height - 4,
  );
  ctx.restore();
}

export const SolutionViewer: React.FC<Props> = ({
  initialTubes,
  capacity,
  moves,
  paletteRgb,
  onBack,
  onRestart,
  title = "解法を確認",
  description = "解法が見つかりました。下の操作で手順を1つずつ確認できます。",
  emptyMovesDescription = "この盤面はすでに完成しています。",
  unknownCells = [],
}) => {
  const [step, setStep] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const tubesNow = applyMoves(initialTubes, moves, step);
  const currentMove = step < moves.length ? moves[step] : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const redraw = () =>
      drawSolution(
        canvas,
        tubesNow,
        capacity,
        paletteRgb,
        currentMove,
        step,
        moves.length,
        unknownCells,
      );

    redraw();
    window.addEventListener("resize", redraw);

    return () => window.removeEventListener("resize", redraw);
  }, [tubesNow, capacity, paletteRgb, currentMove, step, moves.length, unknownCells]);

  const scrollToBottom = () => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  };

  const scrollToTop = () => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="step-panel">
      <h2>{title}</h2>

      {moves.length === 0 ? (
        <p>{emptyMovesDescription}</p>
      ) : (
        <p>{description}</p>
      )}

      <div className="solution-scroll-controls">
        <button onClick={scrollToBottom} aria-label="下へ移動">
          ▼
        </button>
      </div>

      <div className="solution-canvas-wrapper" ref={scrollRef}>
        <canvas ref={canvasRef} aria-label="パズルの解法表示" />
      </div>

      <div className="solution-scroll-controls">
        <button onClick={scrollToTop} aria-label="上へ移動">
          ▲
        </button>
      </div>

      {currentMove && (
        <p className="move-desc">
          管 {currentMove.from + 1} から 管 {currentMove.to + 1} へ移動
        </p>
      )}

      {moves.length > 0 && (
        <div className="solution-controls">
          <button
            className="solution-step-button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step <= 0}
          >
            1手戻る
          </button>

          <button
            className="solution-step-button"
            onClick={() => setStep((s) => Math.min(moves.length, s + 1))}
            disabled={step >= moves.length}
          >
            1手進む
          </button>
        </div>
      )}

      <div className="button-row">
        <button onClick={onBack}>盤面を調整する</button>
        <button onClick={onRestart}>別の画像を使う</button>
      </div>
    </div>
  );
};
