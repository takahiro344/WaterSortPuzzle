import React, { useMemo, useState } from 'react';
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
      tubes[m.to].push(tubes[m.from].pop() as number);
    }
  }
  return tubes;
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

  const tubesNow = useMemo(() => applyMoves(initialTubes, moves, step), [initialTubes, moves, step]);

  const currentMove = step < moves.length ? moves[step] : null;

  return (
    <div className="step-panel">
      <h2>(3/3) 解答</h2>
      {moves.length === 0 ? (
        <p>すでに揃っています。動かす手はありません。</p>
      ) : (
        <p>
          解けました。全 {moves.length} 手中 {Math.min(step, moves.length)} 手目まで表示しています。
          [+] で次の手、[-] で前の手に戻れます。
        </p>
      )}

      <div className="tubes-view">
        {tubesNow.map((tube, i) => {
          const highlight = currentMove && (currentMove.from === i || currentMove.to === i);
          return (
            <div
              key={i}
              className={
                'tube' + (highlight ? (currentMove!.from === i ? ' tube-from' : ' tube-to') : '')
              }
            >
              <div className="tube-slots">
                {Array.from({ length: capacity }).map((_, slotIdx) => {
                  const levelFromTop = capacity - 1 - slotIdx; // 上から数えたスロット
                  const colorId = tube[levelFromTop];
                  const rgb = colorId !== undefined ? paletteRgb[colorId] ?? null : null;
                  const bg = colorId !== undefined ? displayColorFor(colorId, rgb) : 'transparent';
                  return <div key={slotIdx} className="tube-slot" style={{ background: bg }} />;
                })}
              </div>
              <div className="tube-index">#{i + 1}</div>
            </div>
          );
        })}
      </div>

      {currentMove && (
        <p className="move-desc">
          次の手: 試験管 #{currentMove.from + 1} → 試験管 #{currentMove.to + 1}
          （{currentMove.amount} 個）
        </p>
      )}

      <div className="button-row">
        <button onClick={() => setStep(0)} disabled={step === 0}>
          ▲ 最初
        </button>
        <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          - 戻る
        </button>
        <button
          onClick={() => setStep((s) => Math.min(moves.length, s + 1))}
          disabled={step >= moves.length}
        >
          + 進む
        </button>
        <button onClick={() => setStep(moves.length)} disabled={step >= moves.length}>
          ▼ 最後
        </button>
      </div>

      <div className="button-row">
        <button onClick={onBack}>戻る</button>
        <button onClick={onRestart}>最初から</button>
      </div>
    </div>
  );
};
