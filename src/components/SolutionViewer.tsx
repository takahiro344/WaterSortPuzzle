import React, { useEffect, useRef, useState } from "react";
import { displayColorFor } from "../paletteDisplay";
import { Move, RGB } from "../types";

interface Props {
  initialTubes: number[][];
  capacity: number;
  moves: Move[];
  paletteRgb: (RGB | null)[];
  onBack: () => void;
  onRestart: () => void;
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
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const tubeWidth = 42;
  const tubeGap = 18;
  // 横に並べきれず1行が長くなりすぎないよう、常に最大2段（2行）に分けて配置する。
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
      const rgb = paletteRgb[colorId] ?? null;
      ctx.fillStyle = displayColorFor(colorId, rgb);
      const slotY = y + tubeHeight - (level + 1) * 30;
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
    // 段（行）ごとに試験管のY座標が異なるため、開始・終了それぞれの試験管の
    // 実際の位置を使って矢印を描く（以前は両端を同じ高さに固定していたため、
    // 別の段への移動で矢印がずれて見えていた）。
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
    // 矢じりの向きは、曲線の終点における実際の接線方向（制御点→終点）から求める。
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
      );
    redraw();
    window.addEventListener("resize", redraw);
    return () => window.removeEventListener("resize", redraw);
  }, [tubesNow, capacity, paletteRgb, currentMove, step, moves.length]);

  const scrollToBottom = () =>
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  const scrollToTop = () =>
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });

  return (
    <div className="step-panel">
      <h2>(3/3) 解答</h2>

      {moves.length === 0 ? (
        <p>すでに揃っています。動かす手はありません。</p>
      ) : (
        <p>
          解けました。手順を表示しますので [+] / [-] ボタンで進めてください。
        </p>
      )}

      <div className="solution-scroll-controls">
        <button onClick={scrollToBottom} aria-label="下へスクロール">
          ▼
        </button>
      </div>

      <div className="solution-canvas-wrapper" ref={scrollRef}>
        <canvas ref={canvasRef} aria-label="Water Sort Puzzle の解答手順" />
      </div>

      <div className="solution-scroll-controls">
        <button onClick={scrollToTop} aria-label="上へスクロール">
          ▲
        </button>
      </div>

      {currentMove && (
        <p className="move-desc">
          {currentMove.from + 1} → {currentMove.to + 1}
        </p>
      )}

      {moves.length > 0 && (
        <div className="solution-controls">
          <button
            className="solution-step-button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step <= 0}
          >
            -
          </button>
          <button
            className="solution-step-button"
            onClick={() => setStep((s) => Math.min(moves.length, s + 1))}
            disabled={step >= moves.length}
          >
            +
          </button>
        </div>
      )}

      <div className="button-row">
        <button onClick={onBack}>戻る</button>
        <button onClick={onRestart}>最初から</button>
      </div>
    </div>
  );
};
