import React, { useEffect, useRef, useState } from 'react';
import { Move, RGB } from '../types';
import { displayColorFor } from '../paletteDisplay';

interface Props {
  initialTubes: number[][];
  capacity: number;
  moves: Move[];
  paletteRgb: (RGB | null)[];
  onBack: () => void;
  onRestart: () => void;
}

function applyMoves(initial: number[][], moves: Move[], upTo: number): number[][] {
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
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const width = Math.min(Math.max(320, window.innerWidth - 48), 900);
  const tubeWidth = 42;
  const tubeGap = 18;
  const rows = Math.ceil(tubes.length / Math.max(1, Math.floor((width + tubeGap) / (tubeWidth + tubeGap))));
  const columns = Math.max(1, Math.min(tubes.length, Math.floor((width + tubeGap) / (tubeWidth + tubeGap))));
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
    ctx.strokeStyle = isFrom ? '#e74c3c' : isTo ? '#27ae60' : '#333';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + tubeHeight - 12);
    ctx.quadraticCurveTo(x, y + tubeHeight, x + 12, y + tubeHeight);
    ctx.lineTo(x + tubeWidth - 12, y + tubeHeight);
    ctx.quadraticCurveTo(x + tubeWidth, y + tubeHeight, x + tubeWidth, y + tubeHeight - 12);
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

    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#666';
    ctx.textAlign = 'center';
    ctx.fillText(`#${i + 1}`, x + tubeWidth / 2, y + tubeHeight + 17);
    ctx.restore();
  }

  if (currentMove) {
    const fromX = getX(currentMove.from) + tubeWidth / 2;
    const fromY = getY(currentMove.from) - 2;
    const toX = getX(currentMove.to) + tubeWidth / 2;
    const toY = getY(currentMove.to) - 2;
    const midX = (fromX + toX) / 2;
    const arrowY = Math.max(4, Math.min(fromY, toY) - 2);

    ctx.save();
    ctx.strokeStyle = '#222';
    ctx.fillStyle = '#222';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(fromX, arrowY + 8);
    ctx.quadraticCurveTo(midX, arrowY - 18, toX, arrowY + 8);
    ctx.stroke();
    const angle = Math.atan2(arrowY + 8 - (arrowY - 1), toX - (toX - 8));
    ctx.beginPath();
    ctx.moveTo(toX, arrowY + 8);
    ctx.lineTo(toX - 9 * Math.cos(angle - Math.PI / 6), arrowY + 8 - 9 * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(toX - 9 * Math.cos(angle + Math.PI / 6), arrowY + 8 - 9 * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.font = '13px sans-serif';
  ctx.fillStyle = '#666';
  ctx.textAlign = 'right';
  ctx.fillText(`${Math.min(step, moveCount)} / ${moveCount}`, width - 8, height - 4);
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
    const redraw = () => drawSolution(canvas, tubesNow, capacity, paletteRgb, currentMove, step, moves.length);
    redraw();
    window.addEventListener('resize', redraw);
    return () => window.removeEventListener('resize', redraw);
  }, [tubesNow, capacity, paletteRgb, currentMove, step, moves.length]);

  const scrollToBottom = () => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  const scrollToTop = () => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });

  return (
    <div className="step-panel">
      <h2>(3/3) 解答</h2>

      {moves.length === 0 ? (
        <p>すでに揃っています。動かす手はありません。</p>
      ) : (
        <p>解けました。手順を表示しますので [+] / [-] ボタンで進めてください。</p>
      )}

      <div className="solution-scroll-controls">
        <button onClick={scrollToBottom} aria-label="下へスクロール">▼</button>
      </div>

      <div className="solution-canvas-wrapper" ref={scrollRef}>
        <canvas ref={canvasRef} aria-label="Water Sort Puzzle の解答手順" />
      </div>

      <div className="solution-scroll-controls">
        <button onClick={scrollToTop} aria-label="上へスクロール">▲</button>
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
